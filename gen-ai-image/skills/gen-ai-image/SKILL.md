---
name: gen-ai-image
description: fal.ai GPT Image 1.5によるAI画像生成。シンプルモード（CLI直接指定）と詳細モード（対話的パラメータ選択）に対応。「AIで画像を生成して」「fal.aiで画像を作って」「プロンプトから画像生成」で発動。SVG図解にはsvg-diagramを、ヘッダー画像にはsvg-header-imageを優先。
---

# gen-ai-image

fal.ai APIのGPT Image 1.5モデルでプロンプトからAI画像を生成。シンプルモードと詳細モードの2つの使い方に対応。

## 使用タイミング

- 「AIで画像を生成して」「写真風の画像を作って」と依頼されたとき
- プロンプトベースの画像生成が必要なとき
- イラスト・写真風・デジタルアート等の画像が必要なとき

**注意**: SVGベースの図解は `svg-diagram`、テキストベースのヘッダーは `svg-header-image` を優先。

## モード

### シンプルモード（直接実行）

パラメータを直接指定して即座に生成。

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  --prompt "生成したい画像の説明" \
  --output <出力パス.png> \
  [--size <1536x1024|1024x1024|1024x1536>] \
  [--quality <low|medium|high>]
```

### 詳細モード（対話的選択）

`--detailed` フラグでパラメータガイドを表示。AskUserQuestion等を使ってユーザーと対話的にパラメータを決定する際の参考情報。

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js --detailed
```

詳細モードでは以下の情報が表示される:
- サイズ選択ガイド（用途別推奨）
- 品質選択ガイド（内容別推奨）
- プロンプトのコツ
- 対話フロー例

## オプション

### 必須

| オプション | 説明 |
|------------|------|
| `--prompt, -p` | 画像生成プロンプト |
| `--output, -o` | 出力ファイルパス（PNG） |

### 任意

| オプション | 説明 | デフォルト |
|------------|------|------------|
| `--size, -s` | 画像サイズ | 1536x1024 |
| `--quality, -q` | 品質 (low/medium/high) | low |
| `--detailed` | パラメータガイドを表示 | - |

## サイズ

| 値 | アスペクト比 | 用途 |
|----|-------------|------|
| `1536x1024` | 3:2（横長） | ブログ、OGP画像 |
| `1024x1024` | 1:1（正方形） | SNS投稿、アイコン |
| `1024x1536` | 2:3（縦長） | スマホ壁紙、縦バナー |

## 品質

| 値 | 説明 | 推奨用途 |
|----|------|----------|
| `low` | 高速生成 | ラフ、参考画像、人物画像 |
| `medium` | バランス良い | ラベル付き説明画像、クオリティ重視 |
| `high` | 最高品質 | 日本語ラベル多い複雑な画像 |

## 使用例

### 基本

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -p "A beautiful sunset over mountains, digital art" \
  -o sunset.png
```

### 正方形・高品質

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -p "日本の四季を表現した和風イラスト" \
  -o seasons.png \
  -s 1024x1024 -q high
```

### 縦長・ポートレート

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  -p "Cyberpunk cityscape at night, neon lights" \
  -o wallpaper.png \
  -s 1024x1536 -q medium
```

## 前提条件

- Node.js 18+
- `FAL_AI_API_KEY` 環境変数（.envまたは環境変数で設定）
- APIキー取得: https://fal.ai/dashboard/keys
