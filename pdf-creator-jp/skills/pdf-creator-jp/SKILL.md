---
name: pdf-creator-jp
description: MarkdownファイルをPDFに変換（日本語フォント対応）。weasyprintを使用し、ヒラギノ/游書体で美しい日本語ドキュメントを生成。「PDFに変換」「PDF生成」「レポートをPDFで」「ドキュメントを印刷用に」「資料をPDF化」「マークダウンをPDFに」などのリクエストで使用される。
---

# PDF Creator (日本語版)

Markdownファイルを日本語フォント対応の高品質PDFに変換します。

## 機能

- ✅ **日本語フォント対応**: ヒラギノ明朝/角ゴシック、游書体フォールバック
- ✅ **ページ番号**: 「1 / N」形式で自動挿入（最初のページは除外）
- ✅ **目次自動生成**: `--toc` オプションでH2/H3見出しから自動生成
- ✅ **3種類のスタイル**: business / technical / minimal
- ✅ **コードブロック折り返し**: 長いコードも自動折り返し
- ✅ **表のヘッダー繰り返し**: 複数ページにまたがる表でヘッダー継続
- ✅ **環境自動設定**: macOS Homebrew環境変数を自動検出

## 重要な注意事項

- **目次（`--toc`）はデフォルトで無効**。ユーザーが「目次をつけて」「TOC付きで」等と明示的に指示した場合のみ `--toc` を付与すること。自動的に付けてはならない。
- **画像は正方形領域（17cm×17cm）を最大**として自動調整される。縦長の画像も見切れない。

## クイックスタート

```bash
# 基本変換
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf

# 目次付き
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md --toc

# 技術文書スタイル
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md --style technical

# フルオプション
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf --toc --style business
```

## CLIオプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `input` | 入力Markdownファイル（必須） | - |
| `output` | 出力PDFファイル | 入力ファイル名.pdf |
| `--toc` | 目次を生成（**ユーザーが明示的に依頼した場合のみ付与**） | なし |
| `--style`, `-s` | スタイルプリセット | business |
| `--no-page-numbers` | ページ番号を非表示 | ページ番号あり |

## スタイルプリセット

### `business`（デフォルト）
- **用途**: ビジネスレポート、提案書、分析資料
- **特徴**:
  - 見出し: ダークブルー(#0A2C4A) + 下線装飾
  - H1: 中央揃え、二重線
  - H3: 左側に縦線アクセント
  - フォーマル感のあるデザイン

### `technical`
- **用途**: 技術文書、仕様書、マニュアル
- **特徴**:
  - 見出し: シンプルな黒
  - H1: 左揃え、単線
  - コードブロック: ダークテーマ（VS Code風）
  - コード重視のレイアウト

### `minimal`
- **用途**: シンプルな文書、メモ、軽量PDF
- **特徴**:
  - 最小限の装飾
  - 見出し: 太字のみ
  - 表: 枠線なし、下線のみ
  - 軽量で読みやすい

## 出力仕様

| 項目 | 値 |
|------|-----|
| 用紙サイズ | A4 |
| 余白 | 上下2.5cm/3cm、左右2cm |
| 本文 | 11pt、行間1.8 |
| 見出し | ヒラギノ角ゴシック |
| 本文 | ヒラギノ明朝 |
| ページ番号 | 「1 / N」形式（フッター中央） |

## フォント設定

| 用途 | 優先フォント | フォールバック |
|------|-------------|---------------|
| 本文 | Hiragino Mincho ProN | YuMincho, Noto Serif CJK JP |
| 見出し | Hiragino Kaku Gothic ProN | YuGothic, Noto Sans CJK JP |
| コード | SF Mono | Monaco, Menlo, Source Code Pro |

## 使用例

```bash
# レポートをPDFに（基本）
uv run --with weasyprint --with markdown scripts/md_to_pdf.py report.md

# 目次付きビジネスレポート
uv run --with weasyprint --with markdown scripts/md_to_pdf.py report.md ~/Downloads/report.pdf --toc

# 技術仕様書（ダークテーマコード）
uv run --with weasyprint --with markdown scripts/md_to_pdf.py spec.md --style technical --toc

# シンプルなメモ（ページ番号なし）
uv run --with weasyprint --with markdown scripts/md_to_pdf.py memo.md --style minimal --no-page-numbers
```

## トラブルシューティング

### 日本語が文字化けする
システムにヒラギノまたは游書体がインストールされていることを確認してください。macOSでは標準搭載されています。

### `weasyprint` インポートエラー
```bash
uv run --with weasyprint --with markdown scripts/md_to_pdf.py ...
```
で依存関係を含めて実行してください。

### ライブラリエラー（macOS）
通常は自動設定されますが、問題が発生する場合:
```bash
export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"
```
