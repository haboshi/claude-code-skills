---
description: Brave Search APIでWeb検索を実行。クエリを指定して検索結果を取得する。
argument-hint: "<検索クエリ>"
allowed-tools: Bash, Read, Write, AskUserQuestion, WebFetch
---

Brave Search API を使って Web 検索を実行する。

## 引数の確認

検索クエリ: $ARGUMENTS

$ARGUMENTS が空の場合は、AskUserQuestion で検索したい内容を確認する。

## 検索実行フロー

### 1. 検索オプションの判定

依頼文から決める（質問しない。既定で足りなければ結果を見てから絞り直す）:

- **検索タイプ**: web（既定）/ news（「ニュース」「最新」「今週」）/ images（「画像」「写真」）/ videos（「動画」）
- **結果件数**: 5（既定）/ 「たくさん」「一覧」→ 10〜20
- **鮮度フィルター**: なし（既定）/ 「今日」→ 24h、「今週」→ 1週間、「最近」→ 1ヶ月

### 2. 検索の実行

判定した設定で検索を実行する:

```bash
uv run --with requests ${CLAUDE_PLUGIN_ROOT}/scripts/search.py "クエリ" [オプション]
```

オプションの組み立て:
- 検索タイプが web 以外: `-t [type]` を追加
- 結果件数が 5 以外: `-c [count]` を追加
- 鮮度フィルターあり: `--freshness [pd|pw|pm|py]` を追加
- 日本語クエリ: `-l ja --country JP` を追加

### 3. 結果の提示

検索結果を見やすく整理して提示する:

- 各結果のタイトル、URL、スニペットを表示
- 結果が多い場合はサマリーテーブルを作成
- 有用そうなソースを強調

### 4. 深掘りの提案

検索結果を提示した後、必要に応じて以下を提案する:

- 特定の結果のコンテンツ抽出（extract.py を使用）
- 関連クエリによる追加検索
- /brave-research:research による本格的な深掘り調査
