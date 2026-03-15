# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリ概要

Claude Code用プラグイン（スキル）のマーケットプレイスコレクション。各プラグインはトップレベルディレクトリとして独立しており、Claude Codeのプラグインシステムで利用される。

マーケットプレイス名: `haboshi-skills`

## アーキテクチャ

### プラグイン構造（共通パターン）

各プラグインは以下の構造を持つ:

```
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json          # プラグインマニフェスト（name, version, description）
├── skills/
│   └── <skill-name>/
│       └── SKILL.md          # スキル定義（YAML frontmatter + 実行手順）
├── commands/                  # スラッシュコマンド定義（.md）※一部プラグインのみ
├── scripts/                   # 実行スクリプト（Python/Node.js）
└── docs/                      # リファレンス・サンプル（一部プラグインのみ）
```

### マーケットプレイスマニフェスト（二重管理に注意）

マニフェストは2箇所に存在し、**内容を完全一致させる必要がある**:

- `marketplace.json`（ルート） — GitHub公開用
- `.claude-plugin/marketplace.json` — Claude Codeインストール時に読み込まれる実体

プラグイン追加・更新時は**必ず両ファイルを同時に更新**すること。片方だけ更新すると乖離が発生する。

#### marketplace.json の禁止フィールド

プラグインエントリに `"skills"` フィールドを含めてはならない。Claude Codeのマーケットプレイススキーマでバリデーションエラーになり、インストールが失敗する。スキルの検出は `skills/<name>/SKILL.md` の自動ディスカバリで行われる。

```jsonc
// NG — インストール時にスキーマエラー
{ "name": "foo", "skills": ["skills/foo"] }

// OK
{ "name": "foo", "source": "./foo" }
```

### 収録プラグイン一覧（13個）

**ドキュメント生成**: pdf-creator-jp
**画像生成**: image-creator, gen-ai-image, svg-header-image, svg-diagram, line-sticker-creator
**画像変換**: svg-to-webp, mermaid-to-webp
**音声**: tts, tts-dict
**調査**: brave-research, deep-research
**開発ツール**: task-planner, skill-creator-pro

### スクリプト言語

- Python スクリプト: image-creator, pdf-creator-jp, brave-research, skill-creator-pro, line-sticker-creator
- Node.js スクリプト: svg-to-webp, svg-header-image, svg-diagram, mermaid-to-webp, tts, tts-dict, gen-ai-image

Python は `uv run --with <deps>` で実行（venv不要）。Node.js は各プラグインの `node_modules` を使用。

## 開発ガイド

### 新規プラグイン追加手順

1. トップレベルにディレクトリを作成
2. `.claude-plugin/plugin.json` にマニフェストを作成
3. `skills/<name>/SKILL.md` にスキル定義を作成（YAML frontmatter必須）
4. `scripts/` に実行スクリプトを配置
5. **`marketplace.json`（ルート）と `.claude-plugin/marketplace.json` の両方の `plugins` 配列に追加**

### SKILL.md の構造

```markdown
---
name: <skill-name>
description: <トリガーフレーズを含む詳細説明>
---

# スキル名

## 機能説明
## クイックスタート（実行コマンド例）
## パラメータ・オプション
```

### テスト実行

プラグインごとにテストが独立している:

```bash
# Python テスト（image-creator等）
cd image-creator && python -m pytest scripts/

# Node.js テスト（svg-header-image等）
cd svg-header-image && node scripts/generate.test.js

# gen-ai-image テスト
cd gen-ai-image && node scripts/generate.test.js
```

### 必要な環境変数（プラグインごと）

- `GEMINI_API_KEY` — image-creator（Geminiプロバイダ使用時）
- `OPENAI_API_KEY` — image-creator（OpenAIプロバイダ使用時）, tts
- `ZHIPU_API_KEY` — image-creator（ZhipuAIプロバイダ使用時）
- `FAL_KEY` — gen-ai-image
- `BRAVE_API_KEY` — brave-research
