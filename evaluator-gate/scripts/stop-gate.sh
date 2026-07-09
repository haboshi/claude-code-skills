#!/usr/bin/env bash
# evaluator-gate Stop フック本体。
# 契約: stdout に出すのは decision JSON（block / additionalContext）のみ。それ以外は無出力で exit 0。
# 原則: 内部エラー・評価者不在は fail-open（ブロックしない）。ブロックは根拠つき BLOCK 判定のときのみ。
set -uo pipefail

# フックは非ログインシェル（bash -c）で起動する。プロファイルを source すると
# その stdout 出力が decision JSON より先に混ざりゲートが無効化されるため、
# jq / codex / grok の解決に必要な標準パスを「後置」で自己供給する
# （前置すると継承 PATH の優先順位を壊すため、不足分の補完に留める）。
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.grok/bin"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PLUGIN_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

INPUT=$(cat 2>/dev/null || true)
[ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || { note "jq 不在のため無効"; exit 0; }
command -v git >/dev/null 2>&1 || exit 0

session_id=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null) || exit 0
cwd=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
last_msg=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null || true)

# --- ゼロコスト事前チェック（速い順・すべて無音通過） ---
[ "${EVALUATOR_GATE_BYPASS:-0}" = "1" ] && { note "BYPASS=1 によりスキップ"; exit 0; }
for flag in ultrawork ralph autopilot team; do
  if [ -f "$HOME/.omc/state/${flag}-active.flag" ]; then
    note "実行モード ${flag} のフラグ検出によりスキップ"
    exit 0
  fi
done
project=$(resolve_project_root "$cwd") || exit 0
[ -n "$project" ] || exit 0
is_enabled "$project" || exit 0

ensure_dirs
gc_old_state

# --- 決定論 diff ゲート（LLM を起動しない層） ---
current_hash=$(compute_diff_hash "$project")
current_head=$(git -C "$project" rev-parse HEAD 2>/dev/null || echo "")
state_load "$session_id"
MAX_BLOCKS="${EVALUATOR_GATE_MAX_BLOCKS:-3}"

if [ "$current_hash" = "$ST_LAST_HASH" ]; then
  if [ "$ST_LAST_VERDICT" = "BLOCK" ]; then
    # 無修正の再停止: LLM を呼ばず前回指摘を再提示（素通り防止・クォータ消費ゼロ）
    if [ "$ST_BLOCK_COUNT" -ge "$MAX_BLOCKS" ]; then
      state_save "$session_id" "$project" "$current_hash" "ALLOW" "" "$ST_BLOCK_COUNT" "capped" "capped" 0 "$current_head"
      emit_warn_allow "evaluator-gate: 差し戻し上限（${MAX_BLOCKS}回）に到達したため許可に縮退しました。未解消の指摘: $ST_LAST_REASON"
    fi
    nb=$((ST_BLOCK_COUNT + 1))
    state_save "$session_id" "$project" "$current_hash" "BLOCK" "$ST_LAST_REASON" "$nb" "cached" "cached" 0 "$current_head"
    emit_block "（前回の指摘から変更がありません。指摘に対処してから完了してください）$ST_LAST_REASON"
  fi
  # 変更なし + 前回 ALLOW（または初回）: 会話・調査だけのターン → 無音通過
  exit 0
fi

# --- 証拠の範囲決定 ---
# working tree が dirty → HEAD 基準の diff。クリーンなのにハッシュが変化 → ターン内コミット済み
# （前回 HEAD からの範囲 diff を評価）。範囲が取れない場合（初回・checkout・amend/rebase で
# 前回 HEAD が到達不能になった場合等）は評価対象なしとして通過する（既知のエッジケース）。
base_ref=""
if [ -z "$(git -C "$project" status --porcelain 2>/dev/null | head -1)" ]; then
  if [ -n "$ST_LAST_HEAD" ] && [ "$current_head" != "$ST_LAST_HEAD" ] && \
     git -C "$project" merge-base --is-ancestor "$ST_LAST_HEAD" "$current_head" 2>/dev/null; then
    base_ref="$ST_LAST_HEAD"
  else
    state_save "$session_id" "$project" "$current_hash" "ALLOW" "" "$ST_BLOCK_COUNT" "clean" "clean" 0 "$current_head"
    exit 0
  fi
fi

# --- LLM 評価（diff が前回評価時点から変化した場合のみ） ---
if [ "$ST_BLOCK_COUNT" -ge "$MAX_BLOCKS" ]; then
  state_save "$session_id" "$project" "$current_hash" "ALLOW" "" "$ST_BLOCK_COUNT" "capped" "capped" 0 "$current_head"
  emit_warn_allow "evaluator-gate: このセッションの差し戻し上限（${MAX_BLOCKS}回）に到達しているため、外部評価をスキップして許可しました。/evaluate で所見を確認できます。"
fi

wdir="$GATE_TMP_DIR/$session_id"
rm -rf "$wdir"; mkdir -p "$wdir"
printf '%s' "$last_msg" > "$wdir/last_msg_raw.txt"
build_evidence "$project" "$wdir/last_msg_raw.txt" "$wdir" "$base_ref"
printf '%s\n' "You may not modify anything; judge only from the evidence in this prompt." > "$wdir/tool_note.txt"
render_template "$PLUGIN_ROOT/prompts/stop-gate.md" "$wdir/prompt.md" \
  "$wdir/tool_note.txt" "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt"

t0=$(date +%s)
EV_TIMEOUT="${EVALUATOR_GATE_EVAL_TIMEOUT:-240}"
# フック全体の timeout（hooks.json: 300 秒）より手前で必ず切る
[ "$EV_TIMEOUT" -gt 270 ] 2>/dev/null && EV_TIMEOUT=270
# cwd は evidence ディレクトリ（$wdir）を渡す: 評価者にリポジトリ本体の読取をさせない
# （証拠はすべて prompt.md に同梱済み。データ送信面を diff + 完了主張に限定する）
bash "$SCRIPT_DIR/run-evaluator.sh" codex "$wdir/prompt.md" "$wdir/out-codex.txt" "$wdir" "$EV_TIMEOUT" "$wdir/log-codex.txt" &
pid_c=$!
bash "$SCRIPT_DIR/run-evaluator.sh" grok "$wdir/prompt.md" "$wdir/out-grok.txt" "$wdir" "$EV_TIMEOUT" "$wdir/log-grok.txt" &
pid_g=$!
wait "$pid_c"; rc_c=$?
wait "$pid_g"; rc_g=$?
t1=$(date +%s); dur=$((t1 - t0))

v_c=$(parse_verdict "$wdir/out-codex.txt" "$rc_c" "$wdir/reason-codex.txt")
v_g=$(parse_verdict "$wdir/out-grok.txt" "$rc_g" "$wdir/reason-grok.txt")
[ "$v_c" = "UNAVAILABLE" ] && detect_auth_hint "$wdir/out-codex.txt" "$wdir/log-codex.txt" codex
[ "$v_g" = "UNAVAILABLE" ] && detect_auth_hint "$wdir/out-grok.txt" "$wdir/log-grok.txt" grok

# --- 集約: 根拠つき BLOCK が1つでもあれば差し戻し。片方不可は残り単独。両方不可は fail-open ---
if [ "$v_c" = "BLOCK" ] || [ "$v_g" = "BLOCK" ]; then
  reason=""
  if [ "$v_c" = "BLOCK" ]; then
    reason="[codex] $(cat "$wdir/reason-codex.txt")"
  fi
  if [ "$v_g" = "BLOCK" ]; then
    if [ -n "$reason" ]; then
      reason="$reason
[grok] $(cat "$wdir/reason-grok.txt")"
    else
      reason="[grok] $(cat "$wdir/reason-grok.txt")"
    fi
  fi
  if [ "$v_c" = "ALLOW" ]; then
    reason="$reason
（参考: codex は ALLOW 判定。評価者間で相違あり）"
  fi
  if [ "$v_g" = "ALLOW" ]; then
    reason="$reason
（参考: grok は ALLOW 判定。評価者間で相違あり）"
  fi
  reason=$(printf '%s' "$reason" | head -c 4000)
  nb=$((ST_BLOCK_COUNT + 1))
  state_save "$session_id" "$project" "$current_hash" "BLOCK" "$reason" "$nb" "$v_c" "$v_g" "$dur" "$current_head"
  emit_block "外部評価者が完了主張を差し戻しました:
$reason"
elif [ "$v_c" = "ALLOW" ] || [ "$v_g" = "ALLOW" ]; then
  # 評価つき ALLOW でカウンタをリセットする（差し戻し→解消のサイクルごとに上限を回復。
  # 上限は「同一 diff で停滞したループ」を切るためのもので、セッション生涯の累積上限ではない）
  state_save "$session_id" "$project" "$current_hash" "ALLOW" "" 0 "$v_c" "$v_g" "$dur" "$current_head"
  exit 0
else
  note "Codex/Grok とも利用不可のため fail-open（許可）。codex login status / grok login を確認してください"
  state_save "$session_id" "$project" "$current_hash" "ALLOW" "" "$ST_BLOCK_COUNT" "unavailable" "unavailable" "$dur" "$current_head"
  exit 0
fi
