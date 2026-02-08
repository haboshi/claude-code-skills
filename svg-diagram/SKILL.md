---
name: svg-diagram
description: LLMでカスタムデザインのSVG図解を生成。Mermaidでは表現できない自由配置の図解・インフォグラフィック向け。「図解を作って」「アーキテクチャ図」「インフォグラフィック」で発動。
---

# SVG Diagram Creator

LLM（Gemini 3 Flash等）にカスタムデザインのSVG図解を生成させるプラグイン。
Mermaidでは対応できない自由配置・装飾付きの図解に使用。

## 使用タイミング

- カスタムレイアウト・自由配置の図解が必要なとき
- ブランドカラー・特定デザインの図が必要なとき
- インフォグラフィック・装飾付き図が必要なとき

**通常のフローチャート・シーケンス図・ER図は `mermaid-to-webp` を優先。**

## クイックスタート

```bash
# 基本的な図解生成
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  --prompt "3層アーキテクチャ図：フロントエンド、API、DB" \
  --output diagram.svg

# ライトテーマ
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  --prompt "CI/CDパイプライン図" \
  --output pipeline.svg \
  --theme light

# カスタムサイズ
node ${CLAUDE_PLUGIN_ROOT}/scripts/generate.js \
  --prompt "マイクロサービス構成図" \
  --output microservices.svg \
  --width 2560 --height 1440
```

## オプション

| オプション | 短縮 | 説明 | デフォルト |
|-----------|------|------|-----------|
| `--prompt` | `-p` | 図の説明（必須） | - |
| `--output` | `-o` | 出力SVGパス（必須） | - |
| `--theme` | `-t` | dark / light | dark |
| `--model` | `-m` | OpenRouterモデル | google/gemini-3-flash-preview |
| `--width` | `-w` | viewBox幅 | 1920 |
| `--height` | `-h` | viewBox高さ | 1080 |
| `--system-prompt` | - | カスタムシステムプロンプト | - |
| `--max-tokens` | - | 最大出力トークン数 | - |
| `--temperature` | - | 温度パラメータ (0.0-2.0) | - |

## 参照ドキュメント

- `docs/reference.md` - カラーパレット・フォント・SVG要素リファレンス

## 注意

- 要 `OPENROUTER_API_KEY` 環境変数
- 出力はSVGのまま使用推奨（ラスタライズすると品質低下）
- WebP/PNG変換が必要な場合は `svg-to-webp` プラグインと組み合わせ

## 前提条件

- Node.js 18+
- OPENROUTER_API_KEY 環境変数
