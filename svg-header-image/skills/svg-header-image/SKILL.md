---
name: svg-header-image
description: テンプレートベースのSVGヘッダー画像生成。タイトル・サブタイトルから美しいヘッダー画像を作成。外部API不要。「ヘッダー画像作って」「タイトル画像を作って」「アイキャッチを生成」で発動。
---

# SVG Header Image Generator

テンプレートベースでプロフェッショナルなヘッダー画像をSVGで生成。ノイズテクスチャ、グローエフェクト、コーナーアクセント等のリッチな表現を含む。外部API不要。

## 使用タイミング

- 「ヘッダー画像を作って」「タイトル画像を作って」と依頼されたとき
- YouTubeサムネイル、ブログアイキャッチが必要なとき
- テキストベースのビジュアル画像が必要なとき

**図解・フローチャートが必要なら `svg-diagram` または `mermaid-to-webp` を使用。**

## 基本コマンド

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  --output <output.svg> \
  --title "メインタイトル" \
  [options]
```

## オプション

### 必須

| オプション | 説明 |
|------------|------|
| `--output, -o` | 出力SVGファイルパス |
| `--title, -t` | メインタイトル |

### 任意

| オプション | 説明 | デフォルト |
|------------|------|------------|
| `--subtitle, -s` | サブタイトル | なし |
| `--theme` | テーマ名 | midnight |
| `--theme-file` | カスタムテーマJSONファイル | なし |
| `--badge` | バッジテキスト（右上） | なし |
| `--category` | カテゴリラベル（上部） | なし |
| `--width, -w` | 出力幅（px） | 1920 |
| `--height, -h` | 出力高さ（px） | 1080 |
| `--list-themes` | テーマ一覧を表示 | - |

## テーマ一覧

### ダーク系（技術系コンテンツ向け）

| テーマ | 名前 | 特徴 |
|--------|------|------|
| `midnight` | Midnight | ダークブルー系、サイバー感。デフォルト |
| `ocean` | Ocean Deep | ブルー/シアン系、深海感 |
| `lavender` | Lavender Dream | パープル系、幻想的 |
| `neon` | Neon Cyber | サイバーパンク、グリッドパターン |
| `geometric` | Bold Geometric | ダーク、幾何学的装飾 |

### 暖色系

| テーマ | 名前 | 特徴 |
|--------|------|------|
| `sunset` | Sunset | レッド/ピンク系、情熱的 |
| `forest` | Forest | グリーン系、自然・成長 |

### ライト系

| テーマ | 名前 | 特徴 |
|--------|------|------|
| `glass` | Soft Glass | ライト系、柔らかい印象 |

## 使用例

### 基本

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg \
  -t "AIエージェント入門"
```

### バッジ・サブタイトル付き

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg \
  -t "Claude Code完全ガイド" \
  -s "2025年最新版" \
  --badge "NEW" \
  --category "TUTORIAL"
```

### カスタムサイズ（正方形）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o square.svg \
  -t "SNS用画像" \
  -w 1080 -h 1080
```

### カスタムテーマ

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

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -o header.svg \
  -t "企業プレゼン" \
  --theme-file ./corporate.json --theme "Corporate Blue"
```

## WebPへの変換

生成したSVGをWebPに変換するには `svg-to-webp` プラグインを使用:

```bash
node <svg-to-webp-plugin>/scripts/convert.js \
  -i header.svg -o header.webp --quality 90
```

## 前提条件

- Node.js 16+ (Intl.Segmenter使用)
- **外部APIキー不要**

## エフェクト

| エフェクト | 説明 |
|------------|------|
| ノイズテクスチャ | フィルムグレイン風の質感 |
| グローエフェクト | 光の拡散効果（背景のオーブ） |
| ドロップシャドウ | テキストに深みを追加 |
| グリッドパターン | 背景に繊細なパターン |
| コーナーアクセント | 四隅の装飾線 |
