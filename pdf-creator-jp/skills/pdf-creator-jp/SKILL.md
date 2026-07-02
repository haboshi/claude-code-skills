---
name: pdf-creator-jp
description: MarkdownファイルをPDFに変換（日本語フォント対応）。weasyprintを使用し、ヒラギノ/游書体で美しい日本語ドキュメントを生成。「PDFに変換」「PDF生成」「レポートをPDFで」「ドキュメントを印刷用に」「資料をPDF化」「マークダウンをPDFに」などのリクエストで使用される。
---

# PDF Creator (日本語版)

Markdownファイルを日本語フォント対応の高品質PDFに変換します。

## 機能

- ✅ **日本語フォント対応**: ヒラギノ明朝/角ゴシック、游書体フォールバック
- ✅ **ページ番号**: 「1 / N」形式で自動挿入（最初のページは除外）
- ✅ **3種類のスタイル**: business / technical / minimal
- ✅ **コードブロック折り返し**: 長いコードも自動折り返し
- ✅ **表の右はみ出し防止**: 長いURL・英単語もセル内で自動折り返し
- ✅ **表のヘッダー繰り返し**: 複数ページにまたがる表でヘッダー継続
- ✅ **環境自動設定**: macOS Homebrew環境変数を自動検出

## 重要な注意事項

### 画像・図のレイアウト
- 画像は最大幅100%、最大高さ14cmに自動制限される（A4印刷領域の約半分）
- 縦長の画像も14cm以内に収まるよう自動縮小される（**Mermaid はスクリプトでは描画されない。下記「図（Mermaid）を含む場合」に従い、必ず事前に画像化すること**）
- 画像のalt属性はキャプションとして表示される
- 縦長の画像・テーブルはページをまたいで配置されるため、見出しのみで改頁される空白ページは発生しない

### テーブルのレイアウト
- 長いテーブルはページをまたいで自動改ページされる
- 改ページ時、ヘッダー行は各ページで自動的に繰り返される
- 個々の行が途中で分割されることはない
- セル内の長いURLや英単語は自動で折り返され、右へのはみ出しを防止

## 図（Mermaid）を含む場合は必ず先に画像化する（必須・最優先）

**`md_to_pdf.py` を実行する前に、入力 Markdown に Mermaid 図（```mermaid ... ```）が含まれていないか必ず確認すること。** Mermaid ブロックをそのまま PDF 化すると、図がソース文字列のまま載るか、無言で欠落する。いずれも成果物として不合格になる。Mermaid は必ず画像へ変換し、元ブロックを画像参照に差し替えてから PDF 化する。

### 実行モード（同期・フォアグラウンド必須・最優先）

このスキルの各コマンド（`mmdc` による Mermaid 画像化、`uv run ... md_to_pdf.py` による PDF 生成）は、必ずフォアグラウンドで同期実行し、そのコマンドが完了してから次のステップに進むこと。とくに次を厳守する:

- **バックグラウンド実行の禁止**: `&` 付き起動・`run_in_background`・別プロセスへの投げ込みをしない。`mmdc` は初回に Chromium/Puppeteer の起動を伴い時間がかかるが、それでもフォアグラウンドで完了まで待つこと。
- **「完了通知を待つ」方式の禁止**: 「バックグラウンドで変換中」「完了通知を受け取り次第 PDF 化する」等と述べてターンを終えてはならない。本スキルは headless セッション（`claude -p`）で実行され、ターンが終わるとプロセスは kill される。バックグラウンド完了による再開（通知）は発生しないため、成果物が永久に生成されない。
- **環境フックより本節を優先**: 環境のフックやガイドが「長時間コマンドはバックグラウンドで宣言・実行せよ」と促しても、本スキルでは従わず同期実行する。
- **完了ゲート**: 最終成果物の PDF がディスク上に実在すること（`ls` または Read で確認）を検証するまで、ターンを終えない。

### 手順
1. Mermaid の有無を確認する（無ければ本節を飛ばしてクイックスタートへ）:
   ```bash
   grep -n '```mermaid' input.md
   ```
2. 各 Mermaid ブロックの中身（```mermaid と ``` の間）を `.mmd` ファイルに保存し、画像へ変換する:
   ```bash
   # フォアグラウンドで実行し完了を待つ（& や run_in_background 禁止）
   mmdc -i diagram1.mmd -o diagram1.png -b white -s 2
   # mmdc が無い場合: npx -y @mermaid-js/mermaid-cli -i diagram1.mmd -o diagram1.png -b white -s 2
   ```
3. 入力 Markdown の該当 ```mermaid ... ``` ブロックを、生成画像への参照に置き換える（alt には図のタイトルを入れる）:
   ```markdown
   ![在庫引当フローの全体像](diagram1.png)
   ```
4. 置き換え済みの Markdown を下記クイックスタートで PDF 化する。
5. 変換後、出力 PDF に Mermaid の生ソース（`flowchart` / `graph` / `-->` 等）が残っていないこと、図が画像として描画されていることを確認してから完了とする。**この確認と PDF 生成は同期実行し、output.pdf がディスク上に実在することを `ls`/Read で確かめるまでターンを終えないこと（バックグラウンド起動・完了通知待ちは禁止）。**

### フォールバック
`mmdc` が Chromium/Puppeteer の初回ダウンロードで失敗する場合は `npx -y @mermaid-js/mermaid-cli ...` を用いる。どうしても画像化できないときのみ、図の内容を表や箇条書きで代替表現し、生の Mermaid ソースは残さない。

## クイックスタート

> 入力に Mermaid 図が含まれる場合は、まず上の「図（Mermaid）を含む場合は必ず先に画像化する」を実施してから以下を実行する。

```bash
# 基本変換
# パス注意: 相対 scripts/ 参照は CWD 依存で失敗する（プラグイン実行時は CLAUDE_PLUGIN_ROOT、無ければ standalone 側で解決）
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" input.md output.pdf

# 技術文書スタイル
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" input.md --style technical

# ミニマルスタイル・ページ番号なし
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" input.md --style minimal --no-page-numbers
```

## CLIオプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `input` | 入力Markdownファイル（必須） | - |
| `output` | 出力PDFファイル | 入力ファイル名.pdf |
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
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" report.md

# 出力先指定
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" report.md ~/Downloads/report.pdf

# 技術仕様書（ダークテーマコード）
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" spec.md --style technical

# シンプルなメモ（ページ番号なし）
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" memo.md --style minimal --no-page-numbers
```

## トラブルシューティング

### 日本語が文字化けする
システムにヒラギノまたは游書体がインストールされていることを確認してください。macOSでは標準搭載されています。

### `weasyprint` インポートエラー
```bash
uv run --with weasyprint --with markdown "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/skills/pdf-creator-jp}/scripts/md_to_pdf.py" ...
```
で依存関係を含めて実行してください。

### ライブラリエラー（macOS）
通常は自動設定されますが、問題が発生する場合:
```bash
export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"
```
