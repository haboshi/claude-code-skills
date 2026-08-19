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

### 収録プラグイン一覧（17個）

**ドキュメント生成**: pdf-creator-jp, bizdoc（ビジネス白基調のSVG図解付き1枚HTML生成 + doc-hub 統合管理）
**画像生成**: image-creator, svg-header-image, svg-diagram, line-sticker-creator
**画像変換**: svg-to-webp, mermaid-to-webp, drawio-bridge（.drawio の検証・SVG化・HTML埋め込み整形。図の生成は担当しない）
**音声**: tts（発音辞書機能を内蔵）
**調査**: brave-research
**セキュリティ**: web-vuln-report（非破壊の脆弱性診断→日本語報告書 HTML/PDF 生成）
**開発ツール**: skill-creator-pro（配布パイプライン特化）, harness-analytics（transcript ログ分析→改善示唆）, provider-harness（外部プロバイダ統合のメタスキル + ドメインスキル + /provider-harvest 知見還流）, evaluator-gate（Stop フック完了ゲート。Codex/Grok の外部評価者が完了主張を検証して差し戻し。/evaluator-gate 切替・/evaluate 所見評価）, orca-spinoff（Orca IDE の `orca` CLI で課題をチケット起票→別 worktree へフルハンドオフ。スクリプトなしの指示書型スキル）

#### 図解系の住み分け

図を扱う依頼が来たら、まずこの表でルーティングする。

| 依頼 | 使うもの | 出力 |
|---|---|---|
| 図を新しく描く・後から GUI で編集したい | **公式 drawio スキル**（外部・`/plugin install drawio@drawio`） | `.drawio` / PNG / SVG / PDF |
| 既にある `.drawio` を検証・SVG化・HTML に埋め込む | **drawio-bridge**（本リポ） | 検証結果 / SVG |
| Mermaid 記法の図を画像化する | mermaid-to-webp | WebP / PNG |
| LLM に自由レイアウトの SVG を描かせる | svg-diagram | SVG |
| 業務文書の中に図解を入れる | bizdoc（自前のインライン SVG パターン8種） | 1枚 HTML |
| ラスタ画像・インフォグラフィック | image-creator / codex-imagegen | PNG |

draw.io 本体の図解知識は [jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp) の公式プラグインが
担っており、**自作しない**（Mermaid 変換・ELK レイアウト・export・browser URL まで公式が網羅済み）。
公式は SKILL.md 1ファイルで scripts を持たないため、他スキルからプログラム的に呼べる層だけを
drawio-bridge が補う、という分担にしている。

> 公式スキルの description は「図を作りたい」全般を広く拾うため、mermaid-to-webp / svg-diagram /
> bizdoc と発動が競合しうる。外部マーケットプレイス由来で編集しても更新で戻るので、
> **description は触らず本表でルーティングを判断する**。

廃止済み（2026-07 棚卸し）: gen-ai-image（image-creator の fal.ai フォールバックに機能内包）、task-planner（汎用の計画スキルで代替。タスク記述フォーマットは docs/task-decomposition-format.md に知見として残置）、tts-dict（tts へ統合）、deep-research（実走ブラインド審査でグローバル汎用スキルに 2-0 敗北し一本化。設計知見は docs/deep-research-design-notes.md に残置）。

### スクリプト言語

- Python スクリプト: image-creator, pdf-creator-jp, brave-research, skill-creator-pro, line-sticker-creator
- Node.js スクリプト: svg-to-webp, svg-header-image, svg-diagram, mermaid-to-webp, tts, harness-analytics, bizdoc, drawio-bridge
- Bash スクリプト: provider-harness（SessionEnd/SessionStart フック用。macOS 標準 bash 3.2 互換）, evaluator-gate（Stop フック用。同じく bash 3.2 互換）

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

# npm test が定義されているプラグイン（svg-to-webp / mermaid-to-webp / svg-diagram / tts）
cd svg-to-webp && npm test

# bizdoc（doc-hub の Node.js テストスイート）
cd bizdoc && npm test

# drawio-bridge（検証・SVG後処理・CLI検出。draw.io Desktop 未導入なら実 CLI テストは skip）
cd drawio-bridge && npm test

# Bash テスト（evaluator-gate — fake 評価者による決定論テスト、実 LLM 呼び出しなし）
bash evaluator-gate/tests/run-tests.sh
```

### 必要な環境変数（プラグインごと）

- `GEMINI_API_KEY` — image-creator（Geminiプロバイダ使用時）
- `OPENAI_API_KEY` — image-creator（OpenAIプロバイダ使用時）, tts
- `ZHIPU_API_KEY` — image-creator（ZhipuAIプロバイダ使用時）
- `FAL_AI_API_KEY` — image-creator（fal.ai フォールバック使用時）
- `BRAVE_API_KEY` — brave-research
