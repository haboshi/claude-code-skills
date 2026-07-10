#!/usr/bin/env bash
# /evaluate 用 advisory ドライバ。何もブロックせず、両評価者の所見レポートを stdout に出す。
# usage: evaluate.sh [評価の焦点（任意）]
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PLUGIN_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

focus="${1:-}"
proj_dir="${CLAUDE_PROJECT_DIR:-$PWD}"
project=$(resolve_project_root "$proj_dir") || { echo "git リポジトリではないため評価対象がありません"; exit 0; }
command -v jq >/dev/null 2>&1 || { echo "jq が必要です" >&2; exit 1; }

umask 077
ensure_dirs
wdir=$(mktemp -d "$GATE_TMP_DIR/advisory.XXXXXX") || { echo "一時ディレクトリの作成に失敗しました" >&2; exit 1; }
trap 'rm -rf "$wdir"' EXIT

printf '%s' "（/evaluate によるオンデマンド評価。ビルダーの完了主張はありません。現在の作業状態そのものを評価してください）" > "$wdir/last_msg_raw.txt"
build_evidence "$project" "$wdir/last_msg_raw.txt" "$wdir"
rm -f "$wdir/last_msg_raw.txt"
printf '%s\n' "You may not modify anything; judge only from the evidence in this prompt." > "$wdir/tool_note.txt"
if [ -n "$focus" ]; then
  printf 'Additional focus requested by the user: %s\n' "$focus" > "$wdir/focus.txt"
else
  : > "$wdir/focus.txt"
fi
# 外部送信前の無害化（Stop ゲートと同一処理）。focus も信頼しないデータとして扱う。
# 失敗したら送信しない（fail-closed）
if ! sanitize_evidence "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt" "$wdir/focus.txt"; then
  echo "evidence の無害化に失敗したため、外部送信を中止しました" >&2
  exit 1
fi
render_template "$PLUGIN_ROOT/prompts/advisory.md" "$wdir/prompt.md" \
  "$wdir/tool_note.txt" "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt" "$wdir/focus.txt"

EV_TIMEOUT="${EVALUATOR_GATE_EVAL_TIMEOUT:-240}"
[ "$EV_TIMEOUT" -gt 240 ] 2>/dev/null && EV_TIMEOUT=240
# cwd は evidence ディレクトリ: 評価者にリポジトリ本体の読取をさせない（stop-gate.sh と同方針）
export EVALUATOR_GATE_PROJECT="$project"
bash "$SCRIPT_DIR/run-evaluator.sh" codex "$wdir/prompt.md" "$wdir/out-codex.txt" "$wdir" "$EV_TIMEOUT" "$wdir/log-codex.txt" &
pid_c=$!
bash "$SCRIPT_DIR/run-evaluator.sh" grok "$wdir/prompt.md" "$wdir/out-grok.txt" "$wdir" "$EV_TIMEOUT" "$wdir/log-grok.txt" &
pid_g=$!
wait "$pid_c"; rc_c=$?
wait "$pid_g"; rc_g=$?

echo "## Codex の所見"
if [ "$rc_c" -eq 0 ] && [ -s "$wdir/out-codex.txt" ]; then
  cat "$wdir/out-codex.txt"
else
  echo "（利用不可: rc=${rc_c}。'codex login status' を確認してください）"
  detect_auth_hint "$wdir/out-codex.txt" "$wdir/log-codex.txt" codex
fi
echo
echo "## Grok の所見"
if [ "$rc_g" -eq 0 ] && [ -s "$wdir/out-grok.txt" ]; then
  cat "$wdir/out-grok.txt"
else
  echo "（利用不可: rc=${rc_g}。'grok login' を確認してください — トークンは7日で失効）"
  detect_auth_hint "$wdir/out-grok.txt" "$wdir/log-grok.txt" grok
fi
