---
description: evaluator-gate（Stop 時の外部モデル完了ゲート）の per-project オン/オフ/状態確認
argument-hint: "on | off | status"
---

引数: $ARGUMENTS（省略時は status）

## Step 1: トグル/状態確認の実行

`bash "${CLAUDE_PLUGIN_ROOT}/scripts/gate-config.sh" $ARGUMENTS` を実行する。
project キーはスクリプトが `git rev-parse --show-toplevel` で決定する（カレントの git リポジトリ単位・既定 OFF の opt-in）。

## Step 2: 結果の報告

- on / off: 切り替え結果を1行で報告する。
- status: スクリプト出力（enabled 状態・セッション state・Codex/Grok の利用可否）を表に整えて報告する。grok の auth が7日近く古い場合は `grok login` での再認証を促す。

## 不変条件

- このコマンドは `~/.claude/evaluator-gate/config.json` 以外を書き換えない。
- ビルダー（Claude 本体）が評価回避の目的で off にしてはならない。off はユーザー（人間）の明示指示があるときのみ実行する。`EVALUATOR_GATE_BYPASS=1` も同様に人間専用の緊急脱出口であり、ビルダーが自発的に設定してはならない。
