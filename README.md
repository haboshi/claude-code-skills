# Claude Code Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.6.0-blue.svg)](#)
[![Skills](https://img.shields.io/badge/skills-11-green.svg)](#利用可能なスキル)

Claude Code用スキルコレクション

## インストール

### Claude Code内

```
/plugin marketplace add haboshi/claude-code-skills
```

### ターミナル（CLI）

```bash
claude plugin marketplace add https://github.com/haboshi/claude-code-skills
# マーケットプレイス名: haboshi-skills
claude plugin install pdf-creator-jp@haboshi-skills
```

## 利用可能なスキル

### pdf-creator-jp

Markdownファイルを日本語フォント対応の高品質PDFに変換します。

**特徴:**
- 日本語フォント対応（ヒラギノ/游書体）
- 3種類のスタイルプリセット（business/technical/minimal）
- 表の改ページ対応（ヘッダー繰り返し・セル内折り返し）
- ページ番号挿入

**使用例:**
```bash
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf --style technical
```

詳細: [pdf-creator-jp/SKILL.md](./pdf-creator-jp/SKILL.md)

### image-creator

Google Gemini / OpenAI GPT Image / ZhipuAI GLM-Image で画像を生成・編集します（fal.ai 自動フォールバック対応）。

**特徴:**
- 4プロバイダー対応（Gemini / OpenAI gpt-image-2 / GLM-Image / fal.ai）
- gpt-image-2 の 2K/4K 高解像度生成
- 透過背景生成
- 背景除去（Vision API / マゼンタ除去）
- ステッカーシート生成・分割

**使用例:**
```bash
python3 scripts/generate_openai.py "かわいい猫のイラスト" -b transparent -o cat.png
```

詳細: [image-creator/SKILL.md](./image-creator/SKILL.md)

### その他のスキル

| スキル | 概要 |
|---|---|
| [svg-header-image](./svg-header-image/) | テンプレートベースのSVGヘッダー画像生成（外部API不要） |
| [svg-diagram](./svg-diagram/) | LLMによるカスタムSVG図解生成（OpenRouter） |
| [line-sticker-creator](./line-sticker-creator/) | LINEスタンプセット生成（LINE Creators Market仕様検証込み） |
| [svg-to-webp](./svg-to-webp/) | SVG→WebP/PNG変換（sharp） |
| [mermaid-to-webp](./mermaid-to-webp/) | Mermaid記法→WebP/PNG変換 |
| [tts](./tts/) | テキスト音声変換（OpenAI/COEIROINK/VOICEVOX、発音辞書内蔵） |
| [brave-research](./brave-research/) | Brave Search APIによるWeb検索・コンテンツ抽出 |
| [deep-research](./deep-research/) | マルチエージェント並列深掘り調査 |
| [skill-creator-pro](./skill-creator-pro/) | スキル配布パイプライン（検証・セキュリティスキャン・パッケージング） |

## 動作要件

**pdf-creator-jp:**
- macOS（ヒラギノ/游書体が必要）
- Python 3.9+
- weasyprint, markdown

**image-creator:**
- macOS 14.0+ (Vision API使用時)
- Python 3.9+
- `GEMINI_API_KEY` または `OPENAI_API_KEY`

## Contributing

プルリクエスト歓迎です。

## License

MIT License - [LICENSE](./LICENSE)
