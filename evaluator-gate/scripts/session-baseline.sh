#!/usr/bin/env bash
# evaluator-gate SessionStart フック。
# セッション開始時点の HEAD を「評価範囲の起点（baseline_head）」として記録する。
# これがないと、セッション初回のターンで「実装 → コミット → 作業ツリーがクリーン」になった場合に
# 評価すべき範囲を特定できず、素通りしてしまう（時刻ヒューリスティックは誤評価の元なので使わない）。
#
# 契約: baseline 記録経路は stdout に出力しない（SessionStart の stdout は次ターンの
#       context に注入される）。例外として、未 opt-in の git リポでは1行だけ督促を
#       意図的に出す（下記）。何が起きても exit 0（セッション開始を妨げない）。
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

# 未 opt-in（is_enabled でない）の git リポジトリでは、まだ on/off の判断をしていない場合に
# 限り、24h に1回だけ「有効化できます」と督促する。ゲートは per-project opt-in（既定 OFF）で
# 能動的に on にしないと作動しないため、これがないと機能が死蔵しやすい。
# on/off どちらかを設定済み（判断済み）のプロジェクトには二度と出さない。
# SessionStart の stdout は次ターンの context に注入される（＝ビルダーがそこで判断できる）。
if ! is_enabled "$project"; then
  if ! has_project_decision "$project" && should_nudge "$project"; then
    record_nudge "$project"
    printf '[evaluator-gate] このリポジトリは完了ゲートが未設定です。有効化するなら `/evaluator-gate on`（Codex/Grok の外部評価者が「完了」主張を git 差分と突き合わせて検証し、実装が伴わなければ差し戻します。既定 OFF）。機密性の高いリポジトリでは有効化しないでください（差分が外部モデルに送信されます）。\n'
  fi
  exit 0
fi

ensure_dirs
state_load "$session_id"

# 既に state がある（resume / compact による SessionStart 再発火）場合は上書きしない。
# eval_base を巻き戻すと評価済みの変更を再評価し、逆に前進させると未評価の変更を取り逃す。
# 判定は「state が存在するか」で行う。baseline_head が空でも正当な状態（コミットゼロの
# リポジトリでセッションを開始した場合）なので、それを「未記録」と誤認してはいけない。
if [ -n "$ST_PROJECT" ] && [ "$ST_PROJECT" = "$project" ]; then
  exit 0
fi

head=$(git -C "$project" rev-parse --verify HEAD 2>/dev/null || echo "")
hash=$(compute_diff_hash "$project")
branch=$(current_branch "$project")
# baseline_head = eval_base = セッション開始時の HEAD。verdict は未評価（空）。
state_write "$session_id" "$project" "$head" "$head" "$hash" "" "" "" 0 "baseline" "baseline" 0 "$branch" "" || true
exit 0
