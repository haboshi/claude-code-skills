# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

pdf-creator-jp は Claude Code スキル（プラグイン）で、Markdown ファイルを日本語フォント対応の高品質 PDF に変換する。単一ファイル `scripts/md_to_pdf.py` が全機能を持つ。

## Commands

```bash
# PDF変換（基本）
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md

# 出力先指定
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf

# オプション: --toc（目次）, --style technical|minimal, --no-page-numbers
```

依存関係は `uv run --with` で動的に解決される。requirements.txt や pyproject.toml は存在しない。

## Architecture

```
SKILL.md              # スキル定義（Claude Codeがスキル呼び出し時に読む）
scripts/md_to_pdf.py  # 全ロジックを含む単一スクリプト
```

### md_to_pdf.py の構造

1. **環境変数設定**（27-33行）: macOS Homebrew の `DYLD_LIBRARY_PATH` を weasyprint import **前**に設定。この順序が重要。
2. **CSS スタイル定義**（44-402行）: `BASE_STYLES` + 3プリセット（`BUSINESS_STYLES`, `TECHNICAL_STYLES`, `MINIMAL_STYLES`）の文字列連結。
3. **目次生成**（409-472行）: `generate_toc()` と `add_heading_ids()` で H2/H3 から目次 HTML を生成。
4. **変換関数**（479-556行）: `markdown_to_pdf()` — Markdown → HTML（python-markdown）→ PDF（weasyprint）。
5. **CLI**（563-610行）: argparse ベースの CLI。

### 重要な設計判断

- `--toc` はデフォルト OFF。ユーザーが「目次をつけて」等と明示的に指定した場合のみ付与する。一般的な「PDFにして」指示では絶対に付けない。
- スタイルのデフォルトは `business`。
- 画像は `<figure>` 要素でラップされ、max-height: 14cm で制限。見出しとの分離防止CSS付き。
- テーブルは長い場合に改ページを許可し、thead を各ページで繰り返す。
- Mermaid 記法は PDF では非対応。検出時に警告を出し、CSS で非表示にする。

## Marketplace / Versioning

このスキルは `haboshi/claude-code-skills` リポジトリでマーケットプレイス配信される。バージョン更新時は以下の2ファイルを**必ず同時に**更新すること:

- `marketplace.json`（ルート）
- `.claude-plugin/marketplace.json`

`claude plugins update` は `.claude-plugin/marketplace.json` を参照するため、片方だけ更新するとバージョン不整合が起きる。
