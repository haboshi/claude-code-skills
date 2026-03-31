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
