#!/usr/bin/env python3
"""
OpenAI GPT Image 画像生成スクリプト

OpenAI の gpt-image-2 / gpt-image-1.5 / gpt-image-1 モデルを使用して画像を生成・編集します。
gpt-image-2 は透過背景未対応のため、background=transparent 指定時は自動的に gpt-image-1.5 にフォールバックします。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with openai --with pillow scripts/generate_openai.py "プロンプト"
"""

import argparse
import base64
import ipaddress
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB

# SSRF保護: 8進数/10進数IPアドレス表記のバイパス検出パターン
_OCTAL_IP_PATTERN = re.compile(r"^0\d+\.")
_DECIMAL_IP_PATTERN = re.compile(r"^\d{4,}$")
_SHARED_ADDRESS_SPACE = ipaddress.IPv4Network("100.64.0.0/10")


def _is_dangerous_ip(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """IPアドレスがプライベート/ループバック/リンクローカル/予約済みかチェック"""
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            if _is_dangerous_ip(addr.ipv4_mapped):
                return True
        if addr.sixtofour:
            if _is_dangerous_ip(addr.sixtofour):
                return True
        if addr.teredo:
            for teredo_addr in addr.teredo:
                if _is_dangerous_ip(teredo_addr):
                    return True
    if isinstance(addr, ipaddress.IPv4Address) and addr in _SHARED_ADDRESS_SPACE:
        return True
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_reserved or addr.is_multicast or addr.is_unspecified
    )


def _validate_download_url(url: str) -> None:
    """ダウンロードURLの安全性を検証する（SSRF保護）

    - HTTPSスキームのみ許可
    - プライベート/ループバック/リンクローカル/予約済みIP拒否
    - 8進数/10進数IPアドレス表記のバイパスを検出
    - IPv4マップドIPv6、6to4、Teredoも検出
    """
    if not url or not url.startswith("https://"):
        raise ValueError(f"HTTPSのみ許可されています: {url}")
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
    except Exception:
        raise ValueError(f"無効なURLです: {url}")
    if not hostname:
        raise ValueError(f"ホスト名がありません: {url}")
    if hostname == "localhost":
        raise ValueError(f"ブロックされたホストです: {hostname}")
    if _OCTAL_IP_PATTERN.match(hostname) or _DECIMAL_IP_PATTERN.match(hostname):
        raise ValueError(f"ブロックされたIPアドレス表記です: {hostname}")
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        # IPアドレスでない場合（ドメイン名）はスキーム・localhost検証のみで通過
        # DNS Rebinding対策はCLIツールの性質上リスク受容（ネットワークレベルで対応すべき）
        return
    if _is_dangerous_ip(addr):
        raise ValueError(f"プライベートIPアドレスへのアクセスは禁止されています: {hostname}")


def _safe_download_url(url: str, save_path) -> None:
    """URLから安全にファイルをダウンロードする（SSRF保護付き）。

    - HTTPSスキームのみ許可
    - プライベートIP/ループバック/リンクローカル拒否
    - リダイレクト無効化（allow_redirects=False）
    - タイムアウト設定
    - サイズ上限チェック
    - 一時ファイル + リネームで不完全ファイル防止
    """
    import tempfile

    import requests

    _validate_download_url(url)

    response = requests.get(url, timeout=30, stream=True, allow_redirects=False)

    # リダイレクトは拒否（API返却URLは直接アクセス可能であるべき）
    # 設計判断: OpenAI APIはSAS付き直接URLを返すためリダイレクト不要。
    # 他プラグイン（generate_rich.py, generate_zhipu.py）はCDNリダイレクトに対応するため
    # リダイレクト先を検証してから追跡する方式。用途に応じた使い分け。
    if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
        response.close()  # stream=True のソケットリーク防止
        raise ValueError(f"リダイレクトは許可されていません: {url}")

    response.raise_for_status()

    save_path = Path(save_path)
    save_path.parent.mkdir(parents=True, exist_ok=True)

    tmp_fd, tmp_path = tempfile.mkstemp(dir=save_path.parent, suffix=save_path.suffix)
    try:
        downloaded = 0
        with os.fdopen(tmp_fd, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_SIZE:
                    raise ValueError(f"ダウンロードが上限を超えました: {MAX_DOWNLOAD_SIZE} bytes")
                f.write(chunk)
        Path(tmp_path).rename(save_path)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise


GPT_IMAGE_2_MODELS = {"gpt-image-2", "gpt-image-2-2026-04-21"}
TRANSPARENT_FALLBACK_MODEL = "gpt-image-1.5"

# gpt-image-2 がサポートする代表的サイズ（公式 image-generation ガイドの Popular sizes）。
# gpt-image-2 は柔軟なサイズに対応し、2K/4K も生成可能。
GPT_IMAGE_2_SIZES = [
    "1024x1024", "1536x1024", "1024x1536",  # 基本
    "2048x2048", "2048x1152",               # 2K（square / landscape）
    "3840x2160", "2160x3840",               # 4K（landscape / portrait）
    "auto",
]

# gpt-image-1.5 系（透過フォールバック先）は基本3サイズ＋auto のみ対応。
# 透過要求で gpt-image-1.5 にフォールバックする際、大サイズを最も近い基本サイズへ丸める。
FALLBACK_SIZE_MAP = {
    "1024x1024": "1024x1024",
    "2048x2048": "1024x1024",  # square
    "1536x1024": "1536x1024",
    "2048x1152": "1536x1024",  # landscape
    "3840x2160": "1536x1024",  # landscape (4K)
    "1024x1536": "1024x1536",
    "2160x3840": "1024x1536",  # portrait (4K)
    "auto": "auto",
}


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1024x1024",
    model: str = "gpt-image-2",
    quality: str = "medium",
    background: str = "auto",
    output_format: str = "png",
    reference_image: str = None,
    n: int = 1
) -> str:
    """OpenAI APIを使用して画像を生成"""
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("エラー: 環境変数 OPENAI_API_KEY が設定されていません")
        sys.exit(1)

    # gpt-image-2 は transparent 背景未対応のため、自動的に gpt-image-1.5 にフォールバック
    if background == "transparent" and model in GPT_IMAGE_2_MODELS:
        clamped_size = FALLBACK_SIZE_MAP.get(size, size)
        msg = f"警告: {model} は透過背景未対応のため {TRANSPARENT_FALLBACK_MODEL} にフォールバックします"
        if clamped_size != size:
            # gpt-image-1.5 は 2K/4K 非対応のため基本サイズへ丸める
            msg += f"（サイズ {size} → {clamped_size} に調整）"
        print(msg)
        model = TRANSPARENT_FALLBACK_MODEL
        size = clamped_size

    client = OpenAI(api_key=api_key)

    print(f"モデル: {model}")
    print(f"プロンプト: {prompt[:100]}...")
    print(f"サイズ: {size}, 品質: {quality}, 背景: {background}")
    if reference_image:
        print(f"参照画像: {reference_image}")
    print("生成中...")

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    if reference_image:
        with open(reference_image, "rb") as f:
            response = client.images.edit(
                model=model,
                image=f,
                prompt=prompt,
                size=size,
            )
    else:
        response = client.images.generate(
            model=model,
            prompt=prompt,
            size=size,
            quality=quality,
            background=background,
            output_format=output_format,
            n=n,
        )

    if response.data:
        for i, image_data in enumerate(response.data):
            if n > 1:
                stem = output_file.stem
                suffix = output_file.suffix
                save_path = output_file.parent / f"{stem}_{i+1:02d}{suffix}"
            else:
                save_path = output_file

            if hasattr(image_data, 'b64_json') and image_data.b64_json:
                image_bytes = base64.b64decode(image_data.b64_json)
                with open(save_path, "wb") as f:
                    f.write(image_bytes)
                print(f"保存完了: {save_path.absolute()}")
            elif hasattr(image_data, 'url') and image_data.url:
                _safe_download_url(image_data.url, save_path)
                print(f"保存完了: {save_path.absolute()}")

        return str(output_file.absolute())

    print("警告: 画像が生成されませんでした")
    return ""


def main():
    parser = argparse.ArgumentParser(
        description="OpenAI GPT Image 画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with openai generate_openai.py "かわいい猫のイラスト"
  uv run --with openai generate_openai.py "夕焼けの風景" -s 1536x1024 -o sunset.png
  uv run --with openai generate_openai.py "アイコン" -b transparent -o icon.png

モデル:
  gpt-image-2              最新・最高品質（デフォルト, 透過背景未対応, 2K/4K対応）
  gpt-image-2-2026-04-21   gpt-image-2 の固定スナップショット
  gpt-image-1.5            前世代・透過背景対応（透過要求時の自動フォールバック先）
  gpt-image-1              旧モデル
  gpt-image-1-mini         軽量・高速・低コスト

サイズ:
  1024x1024 / 1536x1024 / 1024x1536   基本（全モデル対応）
  2048x2048 / 2048x1152               2K（gpt-image-2のみ）
  3840x2160 / 2160x3840               4K（gpt-image-2のみ）
  auto                                モデル自動選択

注:
  background=transparent 指定時に gpt-image-2 系を選んだ場合、自動的に
  gpt-image-1.5 にフォールバックします。1.5 は 2K/4K 非対応のため、
  その際はサイズも最も近い基本サイズへ自動調整されます。
        """
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument("-o", "--output", default="generated_image.png", help="出力ファイルパス")
    parser.add_argument("-s", "--size", default="1024x1024",
                        choices=GPT_IMAGE_2_SIZES,
                        help="画像サイズ（2K/4Kはgpt-image-2のみ。透過時は基本サイズへ自動調整）")
    parser.add_argument("-m", "--model", default="gpt-image-2",
                        choices=["gpt-image-2", "gpt-image-2-2026-04-21",
                                 "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini"],
                        help="モデル（デフォルト: gpt-image-2）")
    parser.add_argument("-q", "--quality", default="medium",
                        choices=["low", "medium", "high", "auto"],
                        help="品質（auto=モデルが自動選択）")
    parser.add_argument("-b", "--background", default="auto",
                        choices=["transparent", "opaque", "auto"],
                        help="背景（transparent=透過）")
    parser.add_argument("-f", "--format", default="png",
                        choices=["png", "jpeg", "webp"],
                        help="出力形式")
    parser.add_argument("-r", "--reference", default=None,
                        help="参照/編集する画像のパス")
    parser.add_argument("-n", "--number", type=int, default=1,
                        choices=range(1, 11),
                        help="生成枚数（1-10）")

    args = parser.parse_args()

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        size=args.size,
        model=args.model,
        quality=args.quality,
        background=args.background,
        output_format=args.format,
        reference_image=args.reference,
        n=args.number
    )


if __name__ == "__main__":
    main()
