# spark-agent

Spark Desktop を複数メールアカウント・カレンダーの統合層にし、Claude Code と Codex の両方から
同じスキルで「メール確認・返信下書き・カレンダー確認と更新・アカウント切り替え」を行う。

公式 [readdle/spark-cli-skills](https://github.com/readdle/spark-cli-skills) の `use-spark` が
コマンドの正典。本プラグインはその上の運用層で、リファレンスは持たない。

## 構成

```
spark-agent/
├── skills/spark-agent/
│   ├── SKILL.md                 # 運用規約（両エージェント共通）
│   ├── references/workflows.md  # 4 ワークフローの手順
│   └── scripts/
│       ├── spark-ctx.sh         # アカウント切り替えと自動注入・承認ゲート
│       └── spark-doctor.sh      # 環境診断
└── tests/                       # fake spark による決定論テスト（bash 3.2）
```

## 前提

- macOS / Windows + Spark Desktop（起動中）。設定 → AIエージェント → Spark CLI「セットアップ」で
  `spark` を有効化し、アカウントごとに read-only / triage / send を設定する。
- 公式 use-spark を導入: `npx skills add https://github.com/readdle/spark-cli-skills -g -s use-spark -y`

## 導入（Claude Code と Codex の両方）

```bash
ln -s "$(pwd)/spark-agent/skills/spark-agent" ~/.agents/skills/spark-agent
ln -s ../../.agents/skills/spark-agent ~/.claude/skills/spark-agent
```

Codex は `~/.agents/skills` を直接読む。Claude Code は `~/.claude/skills` 経由。

## 使い方

```bash
bash ~/.agents/skills/spark-agent/scripts/spark-doctor.sh
bash ~/.agents/skills/spark-agent/scripts/spark-ctx.sh use work@example.com
bash ~/.agents/skills/spark-agent/scripts/spark-ctx.sh run emails --filter "category:priority is:unread"
bash ~/.agents/skills/spark-agent/scripts/spark-ctx.sh run draft --reply-to 123 --body "..."
bash ~/.agents/skills/spark-agent/scripts/spark-ctx.sh run events --week
bash ~/.agents/skills/spark-agent/scripts/spark-ctx.sh run --confirm event create --title T --start 2026-09-15T10:00 --end 2026-09-15T10:30
```

`action send` と `event *` は `run --confirm` を付けたときだけ実行される（無ければ exit 3）。

## テスト

```bash
bash spark-agent/tests/run-tests.sh
```
