---
name: brave-research
description: This skill should be used when the user asks to "調査して", "調べて", "検索して", "最新情報を教えて", "search for", "research", "look up", "find information about", "ニュースを調べて", "画像を検索", or needs web search, news search, image/video search, content extraction, or multi-step research using Brave Search API. Also activates when the user mentions "Brave Search", "Web調査", "リサーチ", or asks for up-to-date information on any topic.
allowed-tools: Bash, Read, Write, AskUserQuestion, WebFetch
---

# Brave Research - Web調査スキル

Brave Search API を活用した Web 調査スキル。単発検索から複数クエリの深掘り調査まで対応する。

---

## 調査開始前の確認フロー

調査を開始する前に、`AskUserQuestion` ツールで以下を確認する。

### 確認項目

| 項目 | 選択肢 | 説明 |
|------|--------|------|
| **調査タイプ** | `quick` / `deep` | quick: 単発検索、deep: マルチステップ深掘り |
| **検索カテゴリ** | `web` / `news` / `images` / `videos` | 検索対象のタイプ |
| **言語** | `ja` / `en` / `auto` | 検索結果の言語 |
| **出力形式** | `text` / `file` | 会話内テキスト or ファイル保存 |

### 調査タイプ別の推奨設定

| ケース | タイプ | カテゴリ | 備考 |
|--------|--------|----------|------|
| 技術調査 | deep | web | 複数ソースの交差検証が有効 |
| 最新ニュース確認 | quick | news | freshness フィルターで鮮度制御 |
| トレンド把握 | quick | web | count=10 で俯瞰 |
| 競合分析 | deep | web + news | 複数クエリで多角的に調査 |
| 画像リソース探索 | quick | images | 参照画像の発見に有効 |

---

## ツール一覧

| ツール | 説明 |
|-------|------|
| `search.py` | Brave Search API 検索（web/news/images/videos） |
| `extract.py` | URL からコンテンツをマークダウン抽出 |

## 前提条件

1. **uv**: `curl -LsSf https://astral.sh/uv/install.sh | sh` でインストール
2. **BRAVE_API_KEY**: 環境変数に Brave Search API キーを設定（https://brave.com/search/api/ で取得）

---

## APIキー未設定時のフォールバック

`BRAVE_API_KEY` が未設定の場合、search.py は取得手順と料金情報を含むガイダンスを出力する。この場合、以下の手順で対応する:

1. search.py の出力（API キー取得手順）をユーザーに提示する
2. **代替手段として Claude Code 内蔵の `WebSearch` ツールを使用して検索を実行する**
3. WebSearch の結果を brave-research と同じフォーマット（タイトル、URL、スニペット）で整理して提示する
4. コンテンツ抽出が必要な場合は `WebFetch` ツールで代替する

WebSearch/WebFetch は API キー不要で即座に使用可能。ただし Brave Search API と比較して検索演算子（`site:`, `filetype:` 等）や鮮度フィルター、画像・動画検索には対応していない点をユーザーに伝える。

---

## 1. search.py - Brave Search API 検索

```bash
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "クエリ" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-t`, `--type` | 検索タイプ (`web`, `news`, `images`, `videos`) | `web` |
| `-c`, `--count` | 結果件数 (1-20) | `5` |
| `-l`, `--lang` | 検索言語 (`ja`, `en`, 等) ※`ja`→`jp`等は自動変換 | なし |
| `--country` | 国コード (`JP`, `US`, 等) | なし |
| `--freshness` | 鮮度フィルター (`pd`:24h, `pw`:1週, `pm`:1月, `py`:1年) | なし |
| `--offset` | ページネーション開始位置 | `0` |
| `-o`, `--output` | 結果をファイルに保存 | なし |
| `--summary` | AI要約キーを取得（web検索のみ） | なし |

### 例

```bash
# 基本的なWeb検索
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "Claude Code plugin development"

# 日本語ニュース検索（直近1週間）
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "AI開発ツール" -t news --freshness pw -l ja

# 画像検索
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "system architecture diagram" -t images -c 10

# 結果をファイルに保存
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "MCP server best practices" -c 10 -o results.md

# 検索演算子の活用
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "site:github.com MCP server brave search"
```

### 検索演算子

Brave Search はネイティブ検索演算子をサポートする:

| 演算子 | 説明 | 例 |
|--------|------|-----|
| `site:` | 特定ドメインに限定 | `site:github.com MCP` |
| `-site:` | 特定ドメインを除外 | `-site:reddit.com AI` |
| `filetype:` | ファイルタイプ指定 | `filetype:pdf AI whitepaper` |
| `intitle:` | タイトル内検索 | `intitle:"best practices"` |
| `"..."` | 完全一致フレーズ | `"Claude Code plugin"` |
| `before:` | 日付以前 | `before:2026-01-01 AI` |
| `after:` | 日付以降 | `after:2025-06-01 MCP` |

---

## 2. extract.py - コンテンツ抽出

```bash
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "URL" [オプション]
```

### オプション

| オプション | 説明 | デフォルト |
|-----------|------|-----------|
| `-o`, `--output` | 抽出結果をファイルに保存 | なし |
| `--max-length` | 最大文字数 | `5000` |

### 例

```bash
# URLからコンテンツを抽出
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "https://example.com/article"

# ファイルに保存
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "https://example.com/article" -o article.md
```

---

## ワークフロー例

### Quick Search: 単発技術調査

```bash
# 1. Web検索で概要把握
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "Brave Search API rate limits pricing" -c 5

# 2. 有用な結果のコンテンツを抽出
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "https://brave.com/search/api/"
```

### Deep Research: マルチステップ調査

```bash
# Phase 1: 広範な検索で主要ソースを特定
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "MCP server architecture best practices 2026" -c 10

# Phase 2: 特定トピックの深掘り
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "MCP server security authentication patterns" -c 5
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "MCP server performance optimization" -c 5

# Phase 3: 主要ソースのコンテンツ抽出
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "https://source1.com/article"
uv run --with requests --with readability-lxml --with lxml_html_clean ${CLAUDE_PLUGIN_ROOT}/scripts/extract.py "https://source2.com/article"

# Phase 4: レポートファイルに結果を統合
# → Claude が検索結果とコンテンツを統合し、構造化レポートを生成
```

---

## Deep Research プロセス

マルチステップ深掘り調査の標準プロセス:

### 1. Planning（計画）
- ユーザーの調査目的を分析し、サブトピックに分解
- 各サブトピックに最適な検索クエリを設計

### 2. Execution（実行）
- 各サブトピックを順次検索
- 有望な結果のコンテンツを抽出
- 情報の矛盾や不足を記録

### 3. Verification（検証）
- 複数ソースの情報を交差検証
- 情報の鮮度と信頼性を評価
- 不足があれば追加検索を実行

### 4. Synthesis（統合）
- 全情報を構造化レポートにまとめる
- 引用リンクを付与
- 調査の限界と注意点を記載

---

## コスト最適化

| Brave API プラン | 月間クエリ | QPS | 価格 |
|-----------------|-----------|-----|------|
| Free AI | 2,000 | 1 | 無料 |
| Base AI | 20,000+ | 20 | $5/1K件 |
| Pro AI | 無制限 | 50 | $9/1K件 |

### コスト節約のヒント

- Quick Search（count=5）で概要把握 → 必要時のみ Deep Research
- `--freshness` フィルターで不要な結果を除外
- `site:` 演算子で信頼性の高いソースに限定
- 同一トピックの再検索を避け、前回結果を参照

---

## ファイル構成

```
brave-research/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── brave-research/
│       └── SKILL.md            # このドキュメント
├── commands/
│   ├── search.md               # /brave-research:search コマンド
│   └── research.md             # /brave-research:research コマンド
├── scripts/
│   ├── search.py               # Brave Search API 検索
│   └── extract.py              # URL コンテンツ抽出
└── README.md
```
