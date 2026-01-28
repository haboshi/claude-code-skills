# Task Planner Plugin

実装計画とタスク分解を行う Claude Code プラグイン。

## 特徴

| 機能 | 説明 |
|------|------|
| **適応型プロセス** | タスク規模に応じて計画の深度を自動調整 |
| **リッチタスク記述** | What/Where/How/Why/Verify 形式 |
| **インタビュー駆動** | 不明点は推測せず確認 |
| **リスク評価** | Medium/Large タスクで自動実行 |
| **再帰的検証** | ギャップ発見時に自動で再計画 |
| **承認待ち** | 明示的確認までコード生成しない |

## コマンド

| コマンド | 用途 |
|---------|------|
| `/task-planner:plan` | 完全な実装計画を策定 |
| `/task-planner:decompose` | 既存計画のタスク分解のみ |

## インストール

### マーケットプレイスからインストール

```bash
/plugin marketplace add haboshi/claude-code-skills
/plugin install task-planner@haboshi/claude-code-skills
```

## ディレクトリ構造

```
task-planner/
├── .claude-plugin/
│   └── plugin.json       # プラグイン定義
├── commands/
│   ├── plan.md           # /task-planner:plan コマンド
│   └── decompose.md      # /task-planner:decompose コマンド
├── SKILL.md              # プラグイン概要
└── README.md             # このファイル
```

## プロセス

### /task-planner:plan（規模に応じて自動調整）

```
Small:  EXPLORE → CLARIFY → DECOMPOSE → VALIDATE
Medium: EXPLORE → CLARIFY → PLAN(簡易) → DECOMPOSE → VALIDATE
Large:  EXPLORE → CLARIFY → PLAN(完全) → DECOMPOSE → VALIDATE
```

### /task-planner:decompose

```
EXPLORE → INTERVIEW → DECOMPOSE → VALIDATE
```

## タスク記述フォーマット

```markdown
### Task [N]: [タスクタイトル]

**What**: [具体的なアクション]
**Where**: [ファイルパス、関数名]
**How**: [実装アプローチ]
**Why**: [目的]
**Verify**: [検証手順]
```

## モデル

**Claude Opus 4.5** を使用（計画には最高の推論能力が必要）。

## 関連コマンド

計画承認後に使用:

- `/tdd` - テスト駆動開発で実装
- `/build-fix` - ビルドエラー発生時
- `/code-review` - 実装完了後のレビュー

## ライセンス

MIT
