---
name: svg-to-webp
description: SVG画像をWebP/PNG形式に変換。単一ファイル・ディレクトリ一括変換対応。sharpベースの高品質変換。「SVGをWebPに変換」「画像を軽量化」「サムネイルを最適化」で発動。
---

# SVG to WebP/PNG Converter

SVG画像をWebPまたはPNG形式に変換するプラグイン。sharpによる高品質変換。

## 使用タイミング

- SVGをWebP/PNGに変換するとき
- 画像を軽量化したいとき
- サムネイル画像の最適化が必要なとき
- Web用に画像形式を統一したいとき

## クイックスタート

```bash
# 単一ファイル変換
node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --input input.svg --output output.webp

# PNG形式で出力
node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --input input.svg --output output.png --format png

# ディレクトリ一括変換
node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --input-dir ./svgs --output-dir ./webps
```

## オプション

| オプション | 短縮 | 説明 | デフォルト |
|-----------|------|------|-----------|
| `--input` | `-i` | 入力SVGファイルパス | - |
| `--output` | `-o` | 出力ファイルパス | - |
| `--input-dir` | - | 入力ディレクトリ（一括変換） | - |
| `--output-dir` | - | 出力ディレクトリ（一括変換） | - |
| `--width` | `-w` | 出力幅 | 1920 |
| `--height` | `-h` | 出力高さ | 1080 |
| `--quality` | `-q` | 品質 1-100 | 80 |
| `--format` | `-f` | 出力形式: webp, png | webp |
| `--fit` | - | リサイズ方式: contain, cover, fill, inside, outside | contain |
| `--background` | `-b` | 背景色 | transparent |

## 背景色指定

- `transparent` - 透明背景
- `white` / `black` - 名前指定
- `#RGB` - 短縮形 (#f00 = 赤)
- `#RRGGBB` - 6桁16進数
- `#RRGGBBAA` - アルファ付き

## 前提条件

- Node.js 18+
- sharp (npm install で自動インストール)
