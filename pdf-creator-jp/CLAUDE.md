# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

pdf-creator-jp は Claude Code スキル（プラグイン）で、Markdown ファイルを日本語フォント対応の高品質 PDF に変換する。単一ファイル `scripts/md_to_pdf.py` が全機能を持つ。

## Commands

以下はリポジトリルート（`pdf-creator-jp/`）で開発するときの実行例。
ランタイム（スキル呼び出し時）は SKILL.md の `${CLAUDE_PLUGIN_ROOT}` 形式を使う（相対参照は CWD 依存で失敗する）。

```bash
# PDF変換（基本）
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md

# 出力先指定
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf

# オプション: --style technical|minimal, --no-page-numbers
```

依存関係は `uv run --with` で動的に解決される。requirements.txt や pyproject.toml は存在しない。

## Architecture

```
SKILL.md              # スキル定義（Claude Codeがスキル呼び出し時に読む）
scripts/md_to_pdf.py  # 全ロジックを含む単一スクリプト
```

### md_to_pdf.py の構造

1. **環境変数設定**: macOS Homebrew の `DYLD_LIBRARY_PATH` を weasyprint import **前**に設定。この順序が重要。
2. **CSS スタイル定義**: `BASE_STYLES` + 3プリセット（`BUSINESS_STYLES`, `TECHNICAL_STYLES`, `MINIMAL_STYLES`）の文字列連結。
3. **変換関数**: `markdown_to_pdf()` — Markdown → HTML（python-markdown）→ PDF（weasyprint）。
4. **CLI**: argparse ベースの CLI。

### 重要な設計判断

- 目次機能は提供しない（ユーザー要望により完全除去済み）。
- スタイルのデフォルトは `business`。
- 画像は `<figure>` 要素でラップされ、max-height: 14cm で制限。縦長画像はページまたぎを許可し、見出しのみの空白ページを防止。
- テーブルは長い場合に改ページを許可し、thead を各ページで繰り返す。セル内の長いURL・英単語は `overflow-wrap: anywhere` で折り返し。
- Mermaid 記法は変換されない（本スクリプトに Mermaid の検出・レンダリング処理は存在しない）。````mermaid コードブロックはコードとしてそのまま出力されるため、図を PDF に載せたい場合は事前に `mermaid-to-webp` 等で画像化し、Markdown に画像として埋め込むこと。

## Marketplace / Versioning

このスキルは `haboshi/claude-code-skills` リポジトリでマーケットプレイス配信される。バージョン更新時は以下の2ファイルを**必ず同時に**更新すること:

- `marketplace.json`（ルート）
- `.claude-plugin/marketplace.json`

`claude plugins update` は `.claude-plugin/marketplace.json` を参照するため、片方だけ更新するとバージョン不整合が起きる。
