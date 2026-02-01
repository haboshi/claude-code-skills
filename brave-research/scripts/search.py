#!/usr/bin/env python3
"""Brave Search API 検索スクリプト

Brave Search API を使って Web/ニュース/画像/動画検索を実行する。
結果はマークダウン形式で出力される。

必須環境変数:
    BRAVE_API_KEY: Brave Search API キー

使用例:
    uv run --with requests scripts/search.py "Claude Code plugin"
    uv run --with requests scripts/search.py "AI news" -t news --freshness pw
    uv run --with requests scripts/search.py "architecture diagram" -t images -c 10
"""

import argparse
import json
import os
import sys
from urllib.parse import urlencode

import requests

BASE_URL = "https://api.search.brave.com/res/v1"

ENDPOINTS = {
    "web": "/web/search",
    "news": "/news/search",
    "images": "/images/search",
    "videos": "/videos/search",
}

FRESHNESS_OPTIONS = {
    "pd": "Past 24 hours",
    "pw": "Past week",
    "pm": "Past month",
    "py": "Past year",
}


def get_api_key() -> str:
    api_key = os.environ.get("BRAVE_API_KEY")
    if not api_key:
        # stdout に出力して Claude が読めるようにする
        print("""# BRAVE_API_KEY 未設定

Brave Search API を使用するには API キーが必要です。

## 取得手順
1. https://brave.com/search/api/ にアクセス
2. 「Get Started」からアカウント作成
3. Free AI プラン（無料・2,000件/月）を選択
4. API キーを取得

## 設定方法
```bash
# シェル設定ファイル（~/.zshrc 等）に追加
export BRAVE_API_KEY="your-api-key-here"
```

## 料金プラン
| プラン | 月額 | クエリ数/月 |
|--------|------|------------|
| Free AI | 無料 | 2,000 |
| Base AI | $5/1K件 | 20,000+ |
| Pro AI | $9/1K件 | 無制限 |

## 代替手段
API キーがなくても Claude Code 内蔵の WebSearch ツールで検索可能です。
""")
        sys.exit(1)
    return api_key


def build_params(args: argparse.Namespace) -> dict:
    params = {
        "q": args.query,
        "count": args.count,
    }

    if args.offset > 0:
        params["offset"] = args.offset

    if args.lang:
        params["search_lang"] = args.lang

    if args.country:
        params["country"] = args.country

    if args.freshness:
        params["freshness"] = args.freshness

    if args.summary and args.type == "web":
        params["summary"] = "true"

    return params


def search(
    search_type: str,
    params: dict,
    api_key: str,
) -> dict:
    endpoint = ENDPOINTS.get(search_type)
    if not endpoint:
        print(f"Error: Unknown search type '{search_type}'", file=sys.stderr)
        sys.exit(1)

    url = f"{BASE_URL}{endpoint}"
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }

    try:
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        try:
            return response.json()
        except (ValueError, json.JSONDecodeError):
            print("Error: Invalid JSON response from Brave Search API", file=sys.stderr)
            sys.exit(1)
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else "unknown"
        print(f"Error: HTTP {status} from Brave Search API", file=sys.stderr)
        if e.response is not None:
            try:
                error_data = e.response.json()
                print(
                    f"Details: {json.dumps(error_data, ensure_ascii=False)}",
                    file=sys.stderr,
                )
            except (ValueError, json.JSONDecodeError):
                print(f"Response: {e.response.text[:500]}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to Brave Search API", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.Timeout:
        print("Error: Request timed out", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.RequestException as e:
        print(f"Error: Request failed: {e}", file=sys.stderr)
        sys.exit(1)


def format_web_results(data: dict) -> str:
    lines = []
    results = data.get("web", {}).get("results", [])

    if not results:
        return "No web results found."

    lines.append(f"## Web Search Results ({len(results)} results)\n")

    for i, result in enumerate(results, 1):
        title = result.get("title", "No title")
        url = result.get("url", "")
        description = result.get("description", "No description")
        age = result.get("age", "")

        lines.append(f"### {i}. {title}")
        lines.append(f"**URL**: {url}")
        if age:
            lines.append(f"**Age**: {age}")
        lines.append(f"\n{description}\n")

    summary_key = data.get("summarizer", {}).get("key")
    if summary_key:
        lines.append(f"\n**Summary Key**: `{summary_key}`")
        lines.append("(Use this key with Brave Summarizer API for AI summary)\n")

    return "\n".join(lines)


def format_news_results(data: dict) -> str:
    lines = []
    results = data.get("results", [])

    if not results:
        return "No news results found."

    lines.append(f"## News Search Results ({len(results)} results)\n")

    for i, result in enumerate(results, 1):
        title = result.get("title", "No title")
        url = result.get("url", "")
        description = result.get("description", "No description")
        age = result.get("age", "")
        source = result.get("meta_url", {}).get("hostname", "")

        lines.append(f"### {i}. {title}")
        lines.append(f"**URL**: {url}")
        if source:
            lines.append(f"**Source**: {source}")
        if age:
            lines.append(f"**Age**: {age}")
        lines.append(f"\n{description}\n")

    return "\n".join(lines)


def format_image_results(data: dict) -> str:
    lines = []
    results = data.get("results", [])

    if not results:
        return "No image results found."

    lines.append(f"## Image Search Results ({len(results)} results)\n")

    for i, result in enumerate(results, 1):
        title = result.get("title", "No title")
        url = result.get("url", "")
        source_url = result.get("source", "")
        width = result.get("properties", {}).get("width", "?")
        height = result.get("properties", {}).get("height", "?")

        lines.append(f"### {i}. {title}")
        lines.append(f"**Image URL**: {url}")
        if source_url:
            lines.append(f"**Source**: {source_url}")
        lines.append(f"**Size**: {width}x{height}\n")

    return "\n".join(lines)


def format_video_results(data: dict) -> str:
    lines = []
    results = data.get("results", [])

    if not results:
        return "No video results found."

    lines.append(f"## Video Search Results ({len(results)} results)\n")

    for i, result in enumerate(results, 1):
        title = result.get("title", "No title")
        url = result.get("url", "")
        description = result.get("description", "No description")
        age = result.get("age", "")
        creator = result.get("creator", "")

        lines.append(f"### {i}. {title}")
        lines.append(f"**URL**: {url}")
        if creator:
            lines.append(f"**Creator**: {creator}")
        if age:
            lines.append(f"**Age**: {age}")
        lines.append(f"\n{description}\n")

    return "\n".join(lines)


FORMATTERS = {
    "web": format_web_results,
    "news": format_news_results,
    "images": format_image_results,
    "videos": format_video_results,
}


def main():
    parser = argparse.ArgumentParser(
        description="Brave Search API 検索",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("query", help="検索クエリ")
    parser.add_argument(
        "-t",
        "--type",
        choices=["web", "news", "images", "videos"],
        default="web",
        help="検索タイプ (default: web)",
    )
    parser.add_argument(
        "-c",
        "--count",
        type=int,
        default=5,
        help="結果件数 1-20 (default: 5)",
    )
    parser.add_argument(
        "-l",
        "--lang",
        help="検索言語 (例: jp, en) ※日本語は 'jp'",
    )
    parser.add_argument(
        "--country",
        help="国コード (例: JP, US)",
    )
    parser.add_argument(
        "--freshness",
        choices=["pd", "pw", "pm", "py"],
        help="鮮度フィルター (pd:24h, pw:1週, pm:1月, py:1年)",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=0,
        help="ページネーション開始位置 (default: 0)",
    )
    parser.add_argument(
        "-o",
        "--output",
        help="結果をファイルに保存",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="AI要約キーを取得（web検索のみ）",
    )

    args = parser.parse_args()

    # Validate inputs
    if not 1 <= args.count <= 20:
        print("Error: count must be between 1 and 20", file=sys.stderr)
        sys.exit(1)
    if args.offset < 0:
        print("Error: offset must be non-negative", file=sys.stderr)
        sys.exit(1)

    api_key = get_api_key()
    params = build_params(args)
    data = search(args.type, params, api_key)

    formatter = FORMATTERS.get(args.type, format_web_results)
    output = formatter(data)

    # Add query metadata header
    header_lines = [
        f"# Brave Search: {args.query}",
        f"**Type**: {args.type} | **Count**: {args.count}",
    ]
    if args.freshness:
        header_lines.append(
            f"**Freshness**: {FRESHNESS_OPTIONS.get(args.freshness, args.freshness)}"
        )
    if args.lang:
        header_lines.append(f"**Language**: {args.lang}")
    header_lines.append("")

    full_output = "\n".join(header_lines) + "\n" + output

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(full_output)
        print(f"Results saved to: {args.output}")
    else:
        print(full_output)


if __name__ == "__main__":
    main()
