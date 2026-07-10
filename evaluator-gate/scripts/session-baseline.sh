#!/usr/bin/env bash
# evaluator-gate SessionStart フック。
# セッション開始時点の HEAD を「評価範囲の起点（baseline_head）」として記録する。
# これがないと、セッション初回のターンで「実装 → コミット → 作業ツリーがクリーン」になった場合に
# 評価すべき範囲を特定できず、素通りしてしまう（時刻ヒューリスティックは誤評価の元なので使わない）。
#
# 契約: stdout に出力しない（SessionStart の stdout は次ターンの context に注入されるため）。
#       何が起きても exit 0（セッション開始を妨げない）。
set -uo pipefail

export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
umask 077

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

INPUT=$(cat 2>/dev/null || true)
[ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

session_id=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null) || exit 0
validate_session_id "$session_id" || exit 0
cwd=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"

project=$(resolve_project_root "$cwd") || exit 0
[ -n "$project" ] || exit 0
is_enabled "$project" || exit 0

ensure_dirs
state_load "$session_id"

# 既に state がある（resume / compact による SessionStart 再発火）場合は上書きしない。
# eval_base を巻き戻すと、評価済みの変更を再評価してしまう。
if [ -n "$ST_BASELINE_HEAD" ] && [ "$ST_PROJECT" = "$project" ]; then
  exit 0
fi

head=$(git -C "$project" rev-parse HEAD 2>/dev/null || echo "")
hash=$(compute_diff_hash "$project")
# baseline_head = eval_base = セッション開始時の HEAD。verdict は未評価（空）。
state_write "$session_id" "$project" "$head" "$head" "$hash" "" "" "" 0 "baseline" "baseline" 0 || true
exit 0
