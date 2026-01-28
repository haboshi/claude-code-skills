# Claude Code Skills

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](#)
[![Skills](https://img.shields.io/badge/skills-1-green.svg)](#利用可能なスキル)

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

## 動作要件

- macOS（ヒラギノ/游書体が必要）
- Python 3.9+
- weasyprint, markdown（uv経由で自動インストール）

## Contributing

プルリクエスト歓迎です。

## License

MIT License - [LICENSE](./LICENSE)
