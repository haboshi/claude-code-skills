# Claude Code Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](#)
[![Skills](https://img.shields.io/badge/skills-2-green.svg)](#利用可能なスキル)

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
- 目次自動生成
- ページ番号挿入

**使用例:**
```bash
uv run --with weasyprint --with markdown scripts/md_to_pdf.py input.md output.pdf --toc
```

詳細: [pdf-creator-jp/SKILL.md](./pdf-creator-jp/SKILL.md)

### image-creator

Google Gemini / OpenAI GPT Imageで画像を生成・編集します。

**特徴:**
- Gemini / OpenAI 両対応
- 透過背景生成
- 背景除去（Vision API / マゼンタ除去）
- ステッカーシート生成・分割

**使用例:**
```bash
python3 scripts/generate_openai.py "かわいい猫のイラスト" -b transparent -o cat.png
```

詳細: [image-creator/SKILL.md](./image-creator/SKILL.md)

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
