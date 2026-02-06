#!/usr/bin/env python3
"""
ZhipuAI GLM-Image 画像生成スクリプト

ZhipuAI の GLM-Image モデルを使用して画像を生成します。
16Bパラメータの自己回帰+拡散デコーダーハイブリッドモデル。
テキスト描画精度91.16%、日本語・中国語プロンプトに強い。

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Usage:
    uv run --with requests --with pillow scripts/generate_zhipu.py "プロンプト"
"""

import argparse
import ipaddress
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

API_ENDPOINT = "https://api.z.ai/api/paas/v4/images/generations"

MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB
_MAX_REDIRECTS = 5
_MIN_VALID_IMAGE_SIZE = 1000  # CDNエラーページ（通常数百バイト）を除外する閾値

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


def _validate_cdn_url(url: str) -> bool:
    """CDN URLの安全性を検証する（SSRF保護）"""
    if not url or not url.startswith("https://"):
        return False
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname or ""
    except Exception:
        return False
    if not hostname:
        return False
    if hostname == "localhost":
        return False
    if _OCTAL_IP_PATTERN.match(hostname) or _DECIMAL_IP_PATTERN.match(hostname):
        return False
    try:
        addr = ipaddress.ip_address(hostname)
        if _is_dangerous_ip(addr):
            return False
    except ValueError:
        pass
    return True


def _safe_download_cdn(url: str, dest: Path, max_retries: int = 8) -> None:
    """CDN URLから安全に画像をダウンロードする（SSRF保護+リトライ付き）

    - HTTPSスキームのみ許可
    - プライベート/ループバックIP拒否
    - リダイレクト先もURL検証
    - タイムアウト設定
    - サイズ上限チェック
    - アトミック書き込み（tempfile + rename）
    """
    if not _validate_cdn_url(url):
        raise ValueError(f"安全でないURLです（HTTPSのみ・プライベートIP禁止）: {url}")

    dl_headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

    dl_resp = None
    for attempt in range(max_retries):
        if attempt > 0:
            wait = min(2 * attempt, 10)
            print(f"CDN配信待機 {wait}秒... ({attempt + 1}/{max_retries})")
            time.sleep(wait)

        current_url = url
        for _ in range(_MAX_REDIRECTS):
            dl_resp = requests.get(
                current_url, headers=dl_headers, timeout=60,
                stream=True, allow_redirects=False
            )
            if dl_resp.is_redirect or dl_resp.status_code in (301, 302, 303, 307, 308):
                dl_resp.close()
                raw_location = dl_resp.headers.get("location", "")
                redirect_url = urljoin(current_url, raw_location)
                if not _validate_cdn_url(redirect_url):
                    raise ValueError(f"リダイレクト先が安全でないURLです: {redirect_url}")
                current_url = redirect_url
                continue
            break
        else:
            raise ValueError(f"リダイレクト回数が上限({_MAX_REDIRECTS})を超えました")

        dl_resp.raise_for_status()

        # サイズ事前チェック（Content-Lengthヘッダー）
        content_length = dl_resp.headers.get("content-length")
        try:
            content_length_int = int(content_length) if content_length else 0
        except (ValueError, TypeError):
            content_length_int = 0
        if content_length_int > MAX_DOWNLOAD_SIZE:
            raise ValueError(f"ファイルサイズが上限を超えています: {content_length} bytes")

        if dl_resp.status_code == 200 and content_length_int > _MIN_VALID_IMAGE_SIZE:
            break
        # content-length がない場合はとりあえずチャンクで確認
        if dl_resp.status_code == 200 and not content_length:
            break
        dl_resp.close()  # 条件不一致時のソケットリーク防止
    else:
        status = dl_resp.status_code if dl_resp else "N/A"
        raise ValueError(f"画像ダウンロードエラー ({status}): {url}")

    # アトミック書き込み
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest.parent, suffix=dest.suffix)
    try:
        downloaded = 0
        with os.fdopen(tmp_fd, "wb") as f:
            for chunk in dl_resp.iter_content(chunk_size=8192):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_SIZE:
                    raise ValueError(f"ダウンロードが上限を超えました: {MAX_DOWNLOAD_SIZE} bytes")
                f.write(chunk)
        Path(tmp_path).rename(dest)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise

RECOMMENDED_SIZES = [
    "1280x1280",
    "1568x1056",
    "1056x1568",
    "1472x1088",
    "1088x1472",
    "1728x960",
    "960x1728",
]


def _print_setup_instructions():
    """APIキーのセットアップ手順を表示"""
    print("=" * 60)
    print("エラー: 環境変数 GLM_API_KEY / ZAI_API_KEY が設定されていません")
    print("=" * 60)
    print()
    print("GLM-Image を使用するには Z.ai の API キーが必要です。")
    print()
    print("■ APIキーの取得方法:")
    print("  1. https://z.ai にアクセス")
    print("  2. アカウントを作成 / ログイン")
    print("  3. API Keys ページでキーを発行")
    print()
    print("■ 環境変数の設定（どちらでも可）:")
    print()
    print("  # 一時的に設定（現在のターミナルのみ）")
    print('  export GLM_API_KEY="your-api-key-here"')
    print()
    print("  # 永続的に設定（~/.zshrc または ~/.bashrc に追記）")
    print('  echo \'export GLM_API_KEY="your-api-key-here"\' >> ~/.zshrc')
    print()
    print("  ※ ZAI_API_KEY でも動作します（GLM_API_KEY を優先）")
    print()
    print("■ 料金: $0.015 / 枚（初回2枚無料）")
    print("■ ドキュメント: https://docs.z.ai/guides/image/glm-image")
    print("=" * 60)


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1280x1280",
    quality: str = "hd",
) -> str:
    """GLM-Image APIを使用して画像を生成

    Args:
        prompt: 画像生成プロンプト
        output_path: 出力ファイルパス
        size: 画像サイズ（推奨: 1280x1280, 1568x1056, 1056x1568 等）
        quality: 品質 ("hd"=高品質約20秒, "standard"=標準5-10秒)

    Returns:
        保存先の絶対パス。生成失敗時は空文字列。
    """
    api_key = os.environ.get("GLM_API_KEY") or os.environ.get("ZAI_API_KEY")
    if not api_key:
        _print_setup_instructions()
        sys.exit(1)

    print(f"モデル: glm-image")
    print(f"プロンプト: {prompt[:100]}...")
    print(f"サイズ: {size}, 品質: {quality}")
    print("生成中...")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "glm-image",
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "response_format": "b64_json",
    }

    response = requests.post(API_ENDPOINT, json=payload, headers=headers)
    data = response.json()

    if response.status_code != 200:
        error_msg = data.get("message", "Unknown error")
        print(f"APIエラー ({response.status_code}): {error_msg}")
        sys.exit(1)

    image_list = data.get("data", [])
    if not image_list:
        print("警告: 画像が生成されませんでした")
        return ""

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    b64_data = image_list[0].get("b64_json", "")
    if b64_data:
        import base64

        output_file.write_bytes(base64.b64decode(b64_data))
    else:
        image_url = image_list[0].get("url", "")
        if not image_url:
            print("警告: 画像データが取得できませんでした")
            return ""
        _safe_download_cdn(image_url, output_file)

    print(f"保存完了: {output_file.absolute()}")

    return str(output_file.absolute())


def main():
    parser = argparse.ArgumentParser(
        description="ZhipuAI GLM-Image 画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with requests --with pillow generate_zhipu.py "かわいい猫のイラスト"
  uv run --with requests --with pillow generate_zhipu.py "技術文書の図解" -s 1568x1056 -o diagram.png
  uv run --with requests --with pillow generate_zhipu.py "ロゴデザイン" -q standard -o logo.png

モデル:
  glm-image    16Bパラメータ、テキスト描画精度91.16%%

推奨サイズ:
  1280x1280 (正方形)、1568x1056 (横長)、1056x1568 (縦長)
  1472x1088、1088x1472、1728x960、960x1728

品質:
  hd        高品質（約20秒）
  standard  標準（5-10秒）
        """,
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument(
        "-o", "--output", default="generated_image.png", help="出力ファイルパス"
    )
    parser.add_argument(
        "-s",
        "--size",
        default="1280x1280",
        choices=RECOMMENDED_SIZES,
        help="画像サイズ",
    )
    parser.add_argument(
        "-q",
        "--quality",
        default="hd",
        choices=["hd", "standard"],
        help="品質（hd=高品質, standard=高速）",
    )

    args = parser.parse_args()

    generate_image(
        prompt=args.prompt,
        output_path=args.output,
        size=args.size,
        quality=args.quality,
    )


if __name__ == "__main__":
    main()
