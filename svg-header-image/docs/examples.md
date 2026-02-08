# SVG Header Image - 使用例

## 基本的な使い方

### シンプルなヘッダー

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg \
  -t "AIエージェント入門"
```

### サブタイトル付き

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg \
  -t "Claude Code完全ガイド" \
  -s "プロフェッショナル向け解説"
```

## テーマのバリエーション

### 技術ブログ（ダーク系）

```bash
# デフォルト（Midnight）
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o tech-blog.svg -t "Next.js 15の新機能"

# Ocean Deep
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o tech-blog.svg -t "Kubernetes実践入門" --theme ocean

# Neon Cyber
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o tech-blog.svg -t "サイバーセキュリティ" --theme neon
```

### マーケティング・ビジネス

```bash
# Sunset（情熱的な印象）
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o marketing.svg -t "新サービスリリース" --theme sunset

# Forest（成長・自然）
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o green.svg -t "サステナビリティレポート" --theme forest
```

### ライト系・ソフト

```bash
# Soft Glass（明るい印象）
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o light.svg -t "デザインシステム入門" --theme glass
```

## バッジ・カテゴリ付き

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o featured.svg \
  -t "Claude Code完全ガイド" \
  -s "2025年最新版" \
  --badge "NEW" \
  --category "TUTORIAL"
```

## カスタムサイズ

### YouTubeサムネイル（16:9）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o youtube.svg -t "動画タイトル" -w 1280 -h 720
```

### SNS用正方形

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o sns.svg -t "SNS投稿" -w 1080 -h 1080
```

### OGP画像

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o ogp.svg -t "ブログ記事タイトル" -w 1200 -h 630
```

### Xヘッダー

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o x-header.svg -t "プロフィールヘッダー" -w 1500 -h 500
```

## カスタムテーマ

### テーマファイルの作成

`corporate.json`:
```json
{
  "name": "Corporate Blue",
  "type": "v3",
  "bg": ["#0a1628", "#162d50", "#1e3a5f"],
  "accent": ["#4da6ff", "#66b3ff", "#99ccff"],
  "text": "#ffffff",
  "subText": "#b0c4de"
}
```

### カスタムテーマの使用

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o corporate.svg \
  -t "企業プレゼンテーション" \
  --theme-file ./corporate.json --theme "Corporate Blue"
```

## テーマ一覧の確認

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js --list-themes
```

## WebPへの変換（svg-to-webpプラグイン使用）

```bash
# SVG生成
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg -t "タイトル" --theme midnight

# WebPに変換（svg-to-webpプラグインが必要）
node <svg-to-webp-plugin>/scripts/convert.js \
  -i header.svg -o header.webp --quality 90
```
