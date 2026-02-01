#!/usr/bin/env python3
"""URL コンテンツ抽出スクリプト

URL からメインコンテンツを抽出し、マークダウン形式で出力する。
readability-lxml を使用して記事本文を自動抽出する。

使用例:
    uv run --with requests --with readability-lxml --with lxml_html_clean scripts/extract.py "https://example.com/article"
    uv run --with requests --with readability-lxml --with lxml_html_clean scripts/extract.py "https://example.com" -o article.md
"""

import argparse
import re
import sys
from html import unescape
from urllib.parse import urlparse

import requests

try:
    from readability import Document
except ImportError:
    print(
        "Error: readability-lxml is required. Run with:\n"
        "  uv run --with requests --with readability-lxml --with lxml_html_clean scripts/extract.py",
        file=sys.stderr,
    )
    sys.exit(1)

BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "[::1]"}


def validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        print(f"Error: Unsupported URL scheme '{parsed.scheme}'", file=sys.stderr)
        sys.exit(1)
    if parsed.hostname and parsed.hostname in BLOCKED_HOSTS:
        print(f"Error: Access to {parsed.hostname} is blocked", file=sys.stderr)
        sys.exit(1)


def fetch_url(url: str) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
    }

    try:
        response = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
        response.raise_for_status()
        response.encoding = response.apparent_encoding or "utf-8"
        return response.text
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else "unknown"
        print(f"Error: HTTP {status} fetching {url}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print(f"Error: Could not connect to {url}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.Timeout:
        print(f"Error: Request timed out for {url}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.RequestException as e:
        print(f"Error: Request failed for {url}: {e}", file=sys.stderr)
        sys.exit(1)


def html_to_markdown(html_content: str) -> str:
    """Convert HTML to simplified markdown."""
    text = html_content

    # Handle headings
    for level in range(6, 0, -1):
        pattern = rf"<h{level}[^>]*>(.*?)</h{level}>"
        replacement = f"\n{'#' * level} \\1\n"
        text = re.sub(pattern, replacement, text, flags=re.DOTALL | re.IGNORECASE)

    # Handle paragraphs
    text = re.sub(r"<p[^>]*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "", text, flags=re.IGNORECASE)

    # Handle links
    text = re.sub(
        r'<a[^>]*href="([^"]*)"[^>]*>(.*?)</a>',
        r"[\2](\1)",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle bold/strong
    text = re.sub(
        r"<(?:strong|b)[^>]*>(.*?)</(?:strong|b)>",
        r"**\1**",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle italic/em
    text = re.sub(
        r"<(?:em|i)[^>]*>(.*?)</(?:em|i)>",
        r"*\1*",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle code blocks
    text = re.sub(
        r"<pre[^>]*><code[^>]*>(.*?)</code></pre>",
        r"\n```\n\1\n```\n",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle inline code
    text = re.sub(
        r"<code[^>]*>(.*?)</code>",
        r"`\1`",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle list items
    text = re.sub(
        r"<li[^>]*>(.*?)</li>",
        r"\n- \1",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle blockquotes
    text = re.sub(
        r"<blockquote[^>]*>(.*?)</blockquote>",
        r"\n> \1\n",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Handle line breaks
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)

    # Handle horizontal rules
    text = re.sub(r"<hr\s*/?>", "\n---\n", text, flags=re.IGNORECASE)

    # Remove script and style content
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)

    # Remove remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Unescape HTML entities
    text = unescape(text)

    # Clean up whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)
    text = text.strip()

    return text


def extract_content(html: str, url: str, max_length: int) -> str:
    doc = Document(html, url=url)
    title = doc.title()
    content_html = doc.summary()

    markdown = html_to_markdown(content_html)

    if len(markdown) > max_length:
        markdown = markdown[:max_length] + "\n\n...(truncated)"

    lines = [
        f"# {title}",
        f"**Source**: {url}",
        "",
        "---",
        "",
        markdown,
    ]

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="URL からコンテンツを抽出しマークダウンで出力",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("url", help="抽出対象の URL")
    parser.add_argument(
        "-o",
        "--output",
        help="抽出結果をファイルに保存",
    )
    parser.add_argument(
        "--max-length",
        type=int,
        default=5000,
        help="最大文字数 (default: 5000)",
    )

    args = parser.parse_args()

    if args.max_length <= 0:
        print("Error: max-length must be positive", file=sys.stderr)
        sys.exit(1)

    validate_url(args.url)
    html = fetch_url(args.url)
    output = extract_content(html, args.url, args.max_length)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"Content saved to: {args.output}")
    else:
        print(output)


if __name__ == "__main__":
    main()
