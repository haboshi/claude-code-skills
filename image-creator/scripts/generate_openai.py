#!/usr/bin/env python3
"""
OpenAI GPT Image 画像生成スクリプト

OpenAI の gpt-image-1 / gpt-image-1.5 モデルを使用して画像を生成・編集します。

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
    if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
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


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1024x1024",
    model: str = "gpt-image-1.5",
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
  gpt-image-1      標準モデル
  gpt-image-1-mini 軽量・高速
  gpt-image-1.5    最新・高品質（推奨）
        """
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument("-o", "--output", default="generated_image.png", help="出力ファイルパス")
    parser.add_argument("-s", "--size", default="1024x1024",
                        choices=["1024x1024", "1536x1024", "1024x1536", "auto"],
                        help="画像サイズ")
    parser.add_argument("-m", "--model", default="gpt-image-1.5",
                        choices=["gpt-image-1", "gpt-image-1-mini", "gpt-image-1.5"],
                        help="モデル")
    parser.add_argument("-q", "--quality", default="medium",
                        choices=["low", "medium", "high"],
                        help="品質")
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
