#!/usr/bin/env python3
"""
Markdown to PDF converter with Japanese font support.

Copyright (c) 2026 haboshi
Licensed under the MIT License. See LICENSE file in the project root.

Converts markdown files to PDF using weasyprint, with proper Japanese typography.
Designed for formal documents (reports, contracts, technical documentation).

Usage:
    python md_to_pdf.py input.md output.pdf
    python md_to_pdf.py input.md --toc                    # 目次付き
    python md_to_pdf.py input.md --style technical        # 技術文書スタイル
    python md_to_pdf.py input.md --no-page-numbers        # ページ番号なし

Requirements:
    pip install weasyprint markdown

    macOS environment setup (if needed):
    export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"
"""

import argparse
import os
import re
import sys
from pathlib import Path

import markdown
from weasyprint import CSS, HTML

# 環境変数の自動設定（macOS Homebrew対応）
if sys.platform == "darwin":
    homebrew_lib = "/opt/homebrew/lib"
    if os.path.exists(homebrew_lib):
        current_dyld = os.environ.get("DYLD_LIBRARY_PATH", "")
        if homebrew_lib not in current_dyld:
            os.environ["DYLD_LIBRARY_PATH"] = f"{homebrew_lib}:{current_dyld}"


# =============================================================================
# スタイル定義
# =============================================================================

# 共通の基本スタイル
BASE_STYLES = """
@page {
    size: A4;
    margin: 2.5cm 2cm 3cm 2cm;

    @bottom-center {
        content: counter(page) " / " counter(pages);
        font-family: 'Hiragino Kaku Gothic ProN', sans-serif;
        font-size: 9pt;
        color: #666;
    }
}

@page :first {
    @bottom-center {
        content: "";  /* 最初のページはページ番号なし */
    }
}

body {
    font-family: 'Hiragino Mincho ProN', 'YuMincho', 'Yu Mincho', 'Noto Serif CJK JP', serif;
    font-size: 11pt;
    line-height: 1.8;
    color: #000;
    width: 100%;
}

h1, h2, h3, h4, h5, h6 {
    font-family: 'Hiragino Kaku Gothic ProN', 'YuGothic', 'Yu Gothic', 'Noto Sans CJK JP', sans-serif;
}

p {
    margin: 0.8em 0;
    text-align: justify;
}

ul, ol {
    margin: 0.8em 0;
    padding-left: 2em;
}

li {
    margin: 0.4em 0;
}

/* 表スタイル */
table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    font-size: 10pt;
    table-layout: auto;
    page-break-inside: avoid;
}

th, td {
    border: 1px solid #666;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
}

th {
    background-color: #f0f0f0;
    font-weight: bold;
    font-family: 'Hiragino Kaku Gothic ProN', 'YuGothic', sans-serif;
    white-space: nowrap;
}

/* 表のヘッダー行を各ページで繰り返し */
thead {
    display: table-header-group;
}

tr {
    page-break-inside: avoid;
}

hr {
    border: none;
    border-top: 1px solid #ccc;
    margin: 1.5em 0;
}

strong {
    font-weight: bold;
}

/* コードスタイル */
code {
    font-family: 'SF Mono', 'Monaco', 'Menlo', 'Source Code Pro', monospace;
    font-size: 9pt;
    background-color: #f5f5f5;
    padding: 0.2em 0.4em;
    border-radius: 3px;
}

pre {
    background-color: #f5f5f5;
    padding: 1em;
    font-size: 9pt;
    line-height: 1.4;
    border-radius: 4px;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
    page-break-inside: avoid;
}

pre code {
    background-color: transparent;
    padding: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
}

blockquote {
    border-left: 3px solid #0A2C4A;
    margin: 1em 0;
    padding-left: 1em;
    color: #555;
}

/* 画像スタイル - 正方形領域を最大とする */
img {
    max-width: 100%;
    max-height: 17cm;
    width: auto;
    height: auto;
    display: block;
    margin: 1em auto;
    page-break-inside: avoid;
    object-fit: contain;
}

/* 目次スタイル */
.toc {
    background-color: #f9f9f9;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 1.5em;
    margin-bottom: 2em;
    page-break-after: always;
}

.toc h2 {
    margin-top: 0;
    font-size: 14pt;
    border-bottom: none;
    text-align: center;
}

.toc ul {
    list-style: none;
    padding-left: 0;
    margin: 0;
}

.toc li {
    margin: 0.5em 0;
    line-height: 1.6;
}

.toc li.toc-h2 {
    font-weight: bold;
}

.toc li.toc-h3 {
    padding-left: 1.5em;
    font-size: 10pt;
}

.toc a {
    color: #333;
    text-decoration: none;
}

.toc a:hover {
    text-decoration: underline;
}
"""

# ビジネススタイル（デフォルト）
BUSINESS_STYLES = BASE_STYLES + """
h1 {
    font-size: 20pt;
    font-weight: bold;
    text-align: center;
    margin-top: 0;
    margin-bottom: 1.5em;
    color: #0A2C4A;
    padding-bottom: 0.5em;
    border-bottom: 3px double #0A2C4A;
}

h2 {
    font-size: 14pt;
    font-weight: bold;
    margin-top: 2em;
    margin-bottom: 0.8em;
    color: #0A2C4A;
    border-bottom: 2px solid #0A2C4A;
    padding-bottom: 0.3em;
    page-break-after: avoid;
}

h3 {
    font-size: 12pt;
    font-weight: bold;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    color: #333;
    border-left: 4px solid #0A2C4A;
    padding-left: 0.5em;
    page-break-after: avoid;
}

h4 {
    font-size: 11pt;
    font-weight: bold;
    margin-top: 1em;
    margin-bottom: 0.5em;
    color: #333;
}
"""

# 技術文書スタイル
TECHNICAL_STYLES = BASE_STYLES + """
h1 {
    font-size: 18pt;
    font-weight: bold;
    text-align: left;
    margin-top: 0;
    margin-bottom: 1em;
    color: #222;
    border-bottom: 1px solid #333;
    padding-bottom: 0.3em;
}

h2 {
    font-size: 14pt;
    font-weight: bold;
    margin-top: 1.5em;
    margin-bottom: 0.6em;
    color: #222;
    page-break-after: avoid;
}

h3 {
    font-size: 12pt;
    font-weight: bold;
    margin-top: 1em;
    margin-bottom: 0.4em;
    color: #333;
    page-break-after: avoid;
}

h4 {
    font-size: 11pt;
    font-weight: bold;
    margin-top: 0.8em;
    margin-bottom: 0.3em;
    color: #444;
}

/* 技術文書向けコードブロック強調 */
pre {
    background-color: #1e1e1e;
    color: #d4d4d4;
    border: none;
    border-radius: 6px;
}

code {
    background-color: #e8e8e8;
    color: #c7254e;
}

pre code {
    background-color: transparent;
    color: inherit;
}
"""

# ミニマルスタイル
MINIMAL_STYLES = BASE_STYLES + """
h1 {
    font-size: 16pt;
    font-weight: bold;
    text-align: left;
    margin-top: 0;
    margin-bottom: 1em;
    color: #000;
}

h2 {
    font-size: 13pt;
    font-weight: bold;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    color: #000;
    page-break-after: avoid;
}

h3 {
    font-size: 11pt;
    font-weight: bold;
    margin-top: 1em;
    margin-bottom: 0.4em;
    color: #000;
    page-break-after: avoid;
}

h4 {
    font-size: 11pt;
    font-weight: normal;
    font-style: italic;
    margin-top: 0.8em;
    margin-bottom: 0.3em;
    color: #333;
}

/* ミニマル向けシンプルな表 */
th {
    background-color: transparent;
    border-bottom: 2px solid #000;
}

td {
    border: none;
    border-bottom: 1px solid #ddd;
}
"""

# スタイルマッピング
STYLES = {
    "business": BUSINESS_STYLES,
    "technical": TECHNICAL_STYLES,
    "minimal": MINIMAL_STYLES,
}

# ページ番号なし用のスタイル上書き
NO_PAGE_NUMBERS_STYLE = """
@page {
    @bottom-center {
        content: "";
    }
}
@page :first {
    @bottom-center {
        content: "";
    }
}
"""


# =============================================================================
# 目次生成
# =============================================================================

def generate_toc(html_content: str) -> str:
    """
    HTMLから目次を生成する。

    Args:
        html_content: 変換済みのHTML

    Returns:
        目次HTML
    """
    # 見出しを抽出（h2, h3のみ - 深すぎる階層を避ける）
    heading_pattern = re.compile(r'<h([23])(?:\s+id="([^"]*)")?[^>]*>(.*?)</h\1>', re.IGNORECASE | re.DOTALL)
    headings = heading_pattern.findall(html_content)

    if not headings:
        return ""

    toc_items = []
    for level, id_attr, text in headings:
        # HTMLタグを除去
        clean_text = re.sub(r'<[^>]+>', '', text).strip()
        # IDがない場合は生成
        if not id_attr:
            id_attr = re.sub(r'[^\w\s-]', '', clean_text).replace(' ', '-').lower()

        toc_items.append(f'<li class="toc-h{level}"><a href="#{id_attr}">{clean_text}</a></li>')

    toc_html = f"""
<div class="toc">
    <h2>目次</h2>
    <ul>
        {"".join(toc_items)}
    </ul>
</div>
"""
    return toc_html


def add_heading_ids(html_content: str) -> str:
    """
    見出しにIDを追加する（目次リンク用）。

    Args:
        html_content: 変換済みのHTML

    Returns:
        ID付きHTML
    """
    def replace_heading(match):
        level = match.group(1)
        existing_id = match.group(2)
        text = match.group(3)

        if existing_id:
            return match.group(0)  # 既存のIDがあればそのまま

        # IDを生成
        clean_text = re.sub(r'<[^>]+>', '', text).strip()
        new_id = re.sub(r'[^\w\s-]', '', clean_text).replace(' ', '-').lower()

        return f'<h{level} id="{new_id}">{text}</h{level}>'

    pattern = re.compile(r'<h([23])(?:\s+id="([^"]*)")?[^>]*>(.*?)</h\1>', re.IGNORECASE | re.DOTALL)
    return pattern.sub(replace_heading, html_content)


# =============================================================================
# メイン変換関数
# =============================================================================

def markdown_to_pdf(
    md_file: str,
    pdf_file: str | None = None,
    style: str = "business",
    include_toc: bool = False,
    page_numbers: bool = True,
) -> str:
    """
    Convert markdown file to PDF with Japanese font support.

    Args:
        md_file: Path to input markdown file
        pdf_file: Path to output PDF file (optional, defaults to same name as input)
        style: Style preset ("business", "technical", "minimal")
        include_toc: Whether to include table of contents
        page_numbers: Whether to include page numbers

    Returns:
        Path to generated PDF file
    """
    md_path = Path(md_file)

    if pdf_file is None:
        pdf_file = str(md_path.with_suffix('.pdf'))

    # Expand ~ to home directory
    pdf_file = str(Path(pdf_file).expanduser())

    # Read markdown content
    md_content = md_path.read_text(encoding='utf-8')

    # チェックボックス前処理（Markdown変換前に処理）
    # 1. チェックボックス行の前に空行がない場合を修正（リストとして認識させる）
    md_content = re.sub(r'([^\n])\n(- \[[ x]\])', r'\1\n\n\2', md_content)
    # 2. チェックボックス記号を Unicode に変換
    md_content = re.sub(r'^- \[x\] ', '- ☑ ', md_content, flags=re.MULTILINE)
    md_content = re.sub(r'^- \[ \] ', '- ☐ ', md_content, flags=re.MULTILINE)

    # Convert to HTML
    html_content = markdown.markdown(
        md_content,
        extensions=['tables', 'fenced_code', 'codehilite', 'toc']
    )

    # 見出しにIDを追加
    html_content = add_heading_ids(html_content)

    # 目次を生成
    toc_html = ""
    if include_toc:
        toc_html = generate_toc(html_content)

    # Get document title from first h1 or filename
    title_match = re.search(r'<h1[^>]*>(.*?)</h1>', html_content, re.IGNORECASE | re.DOTALL)
    title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else md_path.stem

    # Create full HTML document
    full_html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
</head>
<body>
{toc_html}
{html_content}
</body>
</html>"""

    # Build CSS
    css_content = STYLES.get(style, BUSINESS_STYLES)
    if not page_numbers:
        css_content += NO_PAGE_NUMBERS_STYLE

    # Generate PDF
    HTML(string=full_html).write_pdf(pdf_file, stylesheets=[CSS(string=css_content)])

    return pdf_file


# =============================================================================
# CLI
# =============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Markdownファイルを日本語フォント対応のPDFに変換します。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用例:
  %(prog)s report.md                          # 基本変換
  %(prog)s report.md output.pdf               # 出力先指定
  %(prog)s report.md --toc                    # 目次付き
  %(prog)s report.md --style technical        # 技術文書スタイル
  %(prog)s report.md --toc --style minimal    # 目次付きミニマル

スタイル:
  business   ビジネス文書向け（デフォルト）- 見出し装飾あり
  technical  技術文書向け - コードブロック強調、ダークテーマ
  minimal    シンプル - 最小限の装飾
        """
    )

    parser.add_argument("input", help="入力Markdownファイル")
    parser.add_argument("output", nargs="?", help="出力PDFファイル（省略時は入力ファイル名.pdf）")
    parser.add_argument("--toc", action="store_true", help="目次を生成")
    parser.add_argument("--style", "-s", choices=["business", "technical", "minimal"],
                        default="business", help="スタイルプリセット（デフォルト: business）")
    parser.add_argument("--no-page-numbers", action="store_true", help="ページ番号を非表示")

    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"エラー: ファイルが見つかりません: {args.input}", file=sys.stderr)
        sys.exit(1)

    try:
        output = markdown_to_pdf(
            args.input,
            args.output,
            style=args.style,
            include_toc=args.toc,
            page_numbers=not args.no_page_numbers,
        )
        print(f"生成完了: {output}")
    except Exception as e:
        print(f"エラー: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
