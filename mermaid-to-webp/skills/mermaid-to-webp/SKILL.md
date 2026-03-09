---
name: mermaid-to-webp
description: Mermaid記法のダイアグラムをWebP/PNG画像に変換。フローチャート、シーケンス図、ER図、ガントチャート等に対応。「Mermaidで図を作って画像にして」「フローチャートを画像化」「ダイアグラムをWebPに」で発動。
---

# Mermaid to WebP/PNG Converter

Mermaid記法のダイアグラムをWebPまたはPNG画像に変換するプラグイン。

**変換フロー:**
```
[Mermaid Text] -> [mermaid-cli] -> [PNG] -> [sharp] -> [WebP/PNG]
```

## 使用タイミング

- Mermaidで図を作って画像にしたいとき
- フローチャート・シーケンス図を画像として出力したいとき
- ドキュメント用のダイアグラム画像が必要なとき

## 対応ダイアグラム

- フローチャート (flowchart/graph)
- シーケンス図 (sequenceDiagram)
- クラス図 (classDiagram)
- 状態図 (stateDiagram)
- ER図 (erDiagram)
- ガントチャート (gantt)
- パイチャート (pie)
- マインドマップ (mindmap)

## クイックスタート

```bash
# ファイルから変換
node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --input diagram.mmd --output output.webp

# 標準入力から変換
echo "graph TD; A-->B;" | node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --stdin --output output.webp

# オプション付き
node ${CLAUDE_PLUGIN_ROOT}/scripts/convert.js \
  --input diagram.mmd --output output.webp \
  --theme dark --quality 90 --width 2560 --height 1440
```

## オプション

| オプション | 短縮 | 説明 | デフォルト |
|-----------|------|------|-----------|
| `--input` | `-i` | 入力Mermaidファイル (.mmd) | - |
| `--output` | `-o` | 出力ファイルパス | - |
| `--stdin` | - | 標準入力から読み込み | false |
| `--width` | `-w` | 出力幅 | 1920 |
| `--height` | `-h` | 出力高さ | 1080 |
| `--quality` | `-q` | 品質 1-100 | 85 |
| `--format` | `-f` | 出力形式: webp, png | webp |
| `--fit` | - | リサイズ方式: contain, cover, fill, inside, outside | contain |
| `--background` | `-b` | 背景色 | white |
| `--theme` | `-t` | Mermaidテーマ: default, dark, forest, neutral | default |

## 注意

- mermaid-cliはPuppeteerを使用するため、初回実行時にChromiumのダウンロードが発生する可能性がある
- 一時ファイルは処理完了後に自動クリーンアップされる

## 前提条件

- Node.js 18+
- @mermaid-js/mermaid-cli
- sharp
