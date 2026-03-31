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
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests

API_ENDPOINT = "https://queue.fal.run/fal-ai/gpt-image-1.5"

VALID_SIZES = ["1024x1024", "1536x1024", "1024x1536"]

MAX_DOWNLOAD_SIZE = 20 * 1024 * 1024  # 20MB
_MAX_REDIRECTS = 5

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
