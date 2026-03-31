#!/usr/bin/env python3
"""
fal.ai GPT Image 1.5 画像生成スクリプト

fal.ai の GPT Image 1.5 モデルを使用して画像を生成します。
Gemini Pro/NB2 障害時のフォールバック先として利用。

Usage:
    uv run --with requests scripts/generate_fal.py "プロンプト"
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

API_ENDPOINT = "https://queue.fal.run/fal-ai/gpt-image-1.5"

VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"]

MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB
_MAX_REDIRECTS = 5
_QUEUE_POLL_INTERVAL = 3  # 秒
_QUEUE_MAX_POLLS = 40  # 最大120秒待機

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


def _validate_url(url: str) -> bool:
    """URLの安全性を検証する（SSRF保護）"""
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


def _safe_download(url: str, dest: Path) -> None:
    """URLから安全に画像をダウンロードする（SSRF保護+アトミック書き込み）"""
    if not _validate_url(url):
        raise ValueError(f"安全でないURLです（HTTPSのみ・プライベートIP禁止）: {url}")

    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

    current_url = url
    resp = None
    for _ in range(_MAX_REDIRECTS):
        resp = requests.get(
            current_url, headers=headers, timeout=60,
            stream=True, allow_redirects=False,
        )
        if resp.is_redirect or resp.status_code in (301, 302, 303, 307, 308):
            resp.close()
            raw_location = resp.headers.get("location", "")
            redirect_url = urljoin(current_url, raw_location)
            if not _validate_url(redirect_url):
                raise ValueError(f"リダイレクト先が安全でないURLです: {redirect_url}")
            current_url = redirect_url
            continue
        break
    else:
        raise ValueError(f"リダイレクト回数が上限({_MAX_REDIRECTS})を超えました")

    resp.raise_for_status()

    content_length = resp.headers.get("content-length")
    try:
        content_length_int = int(content_length) if content_length else 0
    except (ValueError, TypeError):
        content_length_int = 0
    if content_length_int > MAX_DOWNLOAD_SIZE:
        raise ValueError(f"ファイルサイズが上限を超えています: {content_length} bytes")

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest.parent, suffix=dest.suffix)
    try:
        downloaded = 0
        with os.fdopen(tmp_fd, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                downloaded += len(chunk)
                if downloaded > MAX_DOWNLOAD_SIZE:
                    raise ValueError(f"ダウンロードが上限を超えました: {MAX_DOWNLOAD_SIZE} bytes")
                f.write(chunk)
        Path(tmp_path).rename(dest)
    except Exception:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def _print_setup_instructions():
    """APIキーのセットアップ手順を表示"""
    print("=" * 60)
    print("エラー: 環境変数 FAL_AI_API_KEY が設定されていません")
    print("=" * 60)
    print()
    print("fal.ai を使用するには API キーが必要です。")
    print()
    print("■ APIキーの取得方法:")
    print("  1. https://fal.ai/dashboard/keys にアクセス")
    print("  2. アカウントを作成 / ログイン")
    print("  3. API Keys ページでキーを発行")
    print()
    print("■ 環境変数の設定:")
    print()
    print("  # 一時的に設定（現在のターミナルのみ）")
    print('  export FAL_AI_API_KEY="your-api-key-here"')
    print()
    print("  # 永続的に設定（~/.zshrc.local に追記）")
    print('  echo \'export FAL_AI_API_KEY="your-api-key-here"\' >> ~/.zshrc.local')
    print()
    print("  ※ FAL_KEY でも動作します（FAL_AI_API_KEY を優先）")
    print("=" * 60)


def generate_image(
    prompt: str,
    output_path: str = "generated_image.png",
    size: str = "1536x1024",
    quality: str = "low",
) -> str:
    """fal.ai GPT Image 1.5 APIを使用して画像を生成

    Args:
        prompt: 画像生成プロンプト
        output_path: 出力ファイルパス
        size: 画像サイズ（1024x1024, 1536x1024, 1024x1536）
        quality: 品質（low, medium, high）

    Returns:
        保存先の絶対パス。生成失敗時は空文字列。
    """
    api_key = os.environ.get("FAL_AI_API_KEY") or os.environ.get("FAL_KEY")
    if not api_key:
        _print_setup_instructions()
        sys.exit(1)

    if size not in VALID_SIZES:
        print(f"警告: 無効なサイズ '{size}'。1536x1024 を使用します。")
        size = "1536x1024"

    print(f"モデル: fal-ai/gpt-image-1.5")
    print(f"プロンプト: {prompt[:100]}...")
    print(f"サイズ: {size}, 品質: {quality}")
    print("生成中...")

    headers = {
        "Authorization": f"Key {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "prompt": prompt,
        "image_size": size,
        "quality": quality,
    }

    # 1. ジョブ投入（非同期キュー）
    try:
        response = requests.post(
            API_ENDPOINT, json=payload, headers=headers, timeout=30,
        )
    except requests.RequestException as e:
        print(f"APIリクエストエラー: {type(e).__name__}: {str(e)[:200]}")
        return ""

    if response.status_code != 200:
        try:
            detail = response.json().get("detail", response.text[:200])
        except Exception:
            detail = response.text[:200]
        print(f"APIエラー ({response.status_code}): {detail}")
        return ""

    queue_data = response.json()

    # 同期レスポンス（images が直接含まれる場合）
    if "images" in queue_data:
        images = queue_data["images"]
    else:
        # 2. キューポーリング
        status_url = queue_data.get("status_url", "")
        response_url = queue_data.get("response_url", "")
        if not status_url or not response_url:
            print("警告: キューレスポンスにstatus_url/response_urlがありません")
            return ""

        for poll in range(_QUEUE_MAX_POLLS):
            time.sleep(_QUEUE_POLL_INTERVAL)
            try:
                status_resp = requests.get(
                    status_url, headers=headers, timeout=30,
                )
                status_data = status_resp.json()
            except requests.RequestException as e:
                print(f"ポーリングエラー: {type(e).__name__}")
                continue

            queue_status = status_data.get("status", "")
            if queue_status == "COMPLETED":
                break
            if queue_status in ("FAILED", "CANCELLED"):
                print(f"生成失敗: {status_data.get('error', 'unknown')}")
                return ""
        else:
            print("タイムアウト: キュー待機が上限を超えました")
            return ""

        # 3. 結果取得
        try:
            result_resp = requests.get(
                response_url, headers=headers, timeout=30,
            )
            result_data = result_resp.json()
        except requests.RequestException as e:
            print(f"結果取得エラー: {type(e).__name__}")
            return ""

        images = result_data.get("images", [])

    if not images:
        print("警告: 画像が生成されませんでした")
        return ""

    image_url = images[0].get("url", "")
    if not image_url:
        print("警告: 画像URLが取得できませんでした")
        return ""

    output_file = Path(output_path)
    try:
        _safe_download(image_url, output_file)
    except (ValueError, requests.RequestException) as e:
        print(f"ダウンロードエラー: {e}")
        return ""

    print(f"保存完了: {output_file.absolute()}")
    return str(output_file.absolute())


def main():
    parser = argparse.ArgumentParser(
        description="fal.ai GPT Image 1.5 画像生成",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
例:
  uv run --with requests generate_fal.py "かわいい猫のイラスト"
  uv run --with requests generate_fal.py "夕焼けの風景" -s 1536x1024 -o sunset.png
  uv run --with requests generate_fal.py "アイコン" -q high -o icon.png

サイズ:
  1024x1024 (正方形)、1536x1024 (横長)、1024x1536 (縦長)

品質:
  low     高速、参考画像向け
  medium  バランス型
  high    最高品質、日本語テキスト向け
        """,
    )
    parser.add_argument("prompt", help="画像生成プロンプト")
    parser.add_argument(
        "-o", "--output", default="generated_image.png", help="出力ファイルパス"
    )
    parser.add_argument(
        "-s", "--size", default="1536x1024",
        choices=VALID_SIZES, help="画像サイズ",
    )
    parser.add_argument(
        "-q", "--quality", default="low",
        choices=["low", "medium", "high"],
        help="品質（low=高速, medium=バランス, high=最高品質）",
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
