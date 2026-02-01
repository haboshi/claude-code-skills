# brave-research

Brave Search API を活用した Web 調査プラグイン。単発検索からマルチステップの深掘り調査まで対応。

## 機能

- **Web検索**: Brave Search API による高品質な Web 検索
- **ニュース検索**: 最新ニュースの検索（鮮度フィルター対応）
- **画像・動画検索**: 画像/動画リソースの検索
- **コンテンツ抽出**: URL からメインコンテンツをマークダウンで抽出
- **Deep Research**: マルチステップの深掘り調査とレポート生成

## 前提条件

1. **uv**: Python パッケージランナー
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **Brave Search API キー**: 環境変数 `BRAVE_API_KEY` に設定
   - https://brave.com/search/api/ で取得（Free: 2,000件/月）

## コマンド

| コマンド | 説明 |
|---------|------|
| `/brave-research:search [クエリ]` | 単発の Web 検索 |
| `/brave-research:research [トピック]` | マルチステップ深掘り調査 |

## スクリプト

```bash
# Web検索
uv run --with requests scripts/search.py "Claude Code plugin" -c 10

# ニュース検索（直近1週間）
uv run --with requests scripts/search.py "AI development" -t news --freshness pw

# 画像検索
uv run --with requests scripts/search.py "system architecture" -t images

# コンテンツ抽出
uv run --with requests --with readability-lxml --with lxml_html_clean scripts/extract.py "https://example.com/article"
```

## ライセンス

MIT
