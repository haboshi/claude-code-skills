#!/usr/bin/env bash
# evaluator-gate Stop フック本体。
# 契約: stdout に出すのは decision JSON（block / warn）のみ。それ以外は無出力で exit 0。
# 原則: 内部エラー・評価者不在は fail-open（ブロックしない）。ブロックは根拠つき BLOCK 判定のときのみ。
set -uo pipefail

# フックは非ログインシェル（bash -c）で起動する。プロファイルを source すると
# その stdout 出力が decision JSON より先に混ざりゲートが無効化されるため、
# jq / codex / grok の解決に必要な標準パスを「後置」で自己供給する
# （前置すると継承 PATH の優先順位を壊すため、不足分の補完に留める）。
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.grok/bin"
# evidence（diff 抜粋・完了主張）を含む一時ファイルは所有者のみ可読
umask 077

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PLUGIN_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
. "$SCRIPT_DIR/gate-lib.sh"

INPUT=$(cat 2>/dev/null || true)
[ -n "$INPUT" ] || exit 0
command -v jq >/dev/null 2>&1 || { note "jq 不在のため無効"; exit 0; }
command -v git >/dev/null 2>&1 || exit 0

session_id=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null) || exit 0
# session_id はパス構築（state/tmp）に使うため厳格検証。不正は fail-open
validate_session_id "$session_id" || { note "session_id が不正な形式のためスキップ"; exit 0; }
cwd=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "$cwd" ] || cwd="${CLAUDE_PROJECT_DIR:-$PWD}"
last_msg=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null || true)

# --- ゼロコスト事前チェック（速い順・すべて fail-open で通過） ---
[ "${EVALUATOR_GATE_BYPASS:-0}" = "1" ] && { note "BYPASS=1 によりスキップ"; exit 0; }
project=$(resolve_project_root "$cwd") || exit 0
[ -n "$project" ] || exit 0
is_enabled "$project" || exit 0

# OMC 実行モード（ultrawork/ralph 等）中はスキップ。
# OMC の実状態は <mode>-state.json の .active（project-local / session-scoped）。
# 旧来の -active.flag も後方互換として見る（存在すれば尊重）。
for mode in ultrawork ralph autopilot team ultrapilot swarm pipeline ultraqa; do
  for msf in "$project/.omc/state/${mode}-state.json" \
             "$project/.omc/state/sessions/$session_id/${mode}-state.json" \
             "$HOME/.omc/state/${mode}-state.json" \
             "$HOME/.omc/state/sessions/$session_id/${mode}-state.json"; do
    if [ -f "$msf" ] && jq -e '.active == true' "$msf" >/dev/null 2>&1; then
      note "OMC 実行モード ${mode} がアクティブのためスキップ（${msf}）"
      exit 0
    fi
  done
  if [ -f "$HOME/.omc/state/${mode}-active.flag" ]; then
    note "実行モードフラグ ${mode}-active.flag によりスキップ"
    exit 0
  fi
done

ensure_dirs
gc_old_state

# --- 数値 env の検証（typo で比較が壊れて保護が消えるのを防ぐ） ---
MAX_BLOCKS="${EVALUATOR_GATE_MAX_BLOCKS:-3}"
case "$MAX_BLOCKS" in ''|*[!0-9]*) MAX_BLOCKS=3 ;; esac
EV_TIMEOUT="${EVALUATOR_GATE_EVAL_TIMEOUT:-240}"
case "$EV_TIMEOUT" in ''|*[!0-9]*) EV_TIMEOUT=240 ;; esac
# フック全体の timeout（hooks.json: 300 秒）より手前で必ず切る
[ "$EV_TIMEOUT" -gt 270 ] && EV_TIMEOUT=270

# --- 決定論 diff ゲート（LLM を起動しない層） ---
current_hash=$(compute_diff_hash "$project")
current_head=$(git -C "$project" rev-parse HEAD 2>/dev/null || echo "")
state_load "$session_id"

# セッションが別プロジェクトに移動した場合は state を持ち越さない（block_count/hash の混線防止）
if [ -n "$ST_PROJECT" ] && [ "$ST_PROJECT" != "$project" ]; then
  ST_LAST_HASH=""; ST_LAST_VERDICT=""; ST_LAST_REASON=""; ST_BLOCK_COUNT=0; ST_LAST_HEAD=""; ST_UPDATED_EPOCH=0
fi

if [ "$current_hash" = "$ST_LAST_HASH" ]; then
  case "$ST_LAST_VERDICT" in
    BLOCK)
      # 無修正の再停止: LLM を呼ばず前回指摘を再提示（素通り防止・クォータ消費ゼロ）。
      # block_count は「同一 diff での停滞回数」。上限で警告つき許可に縮退（stuck loop 対策）。
      # diff が変われば評価パスで 0/1 にリセットされる（セッション累積上限ではない）。
      if [ "$ST_BLOCK_COUNT" -ge "$MAX_BLOCKS" ]; then
        state_save "$session_id" "$project" "$current_hash" "ALLOW" "" "$ST_BLOCK_COUNT" "capped" "capped" 0 "$current_head"
        emit_warn_allow "evaluator-gate: 同一の変更に対する差し戻しが上限（${MAX_BLOCKS}回）に到達したため許可に縮退しました。未解消の指摘: $ST_LAST_REASON"
      fi
      nb=$((ST_BLOCK_COUNT + 1))
      state_save "$session_id" "$project" "$current_hash" "BLOCK" "$ST_LAST_REASON" "$nb" "cached" "cached" 0 "$current_head" || {
        note "state 保存に失敗したため fail-open（再ブロックを中止）"
        exit 0
      }
      emit_block "（前回の指摘から変更がありません。指摘に対処してから完了してください）$ST_LAST_REASON"
      ;;
    UNAVAILABLE)
      # 前回は評価者が全滅（fail-open 通過）。復旧確認のため 10 分クールダウン後に再評価する
      now_epoch=$(date +%s)
      if [ $((now_epoch - ST_UPDATED_EPOCH)) -lt 600 ]; then
        exit 0
      fi
      # フォールスルー: 同一 diff だが再評価する
      ;;
    *)
      # 変更なし + 前回 ALLOW（または初回）: 会話・調査だけのターン → 無音通過
      exit 0
      ;;
  esac
fi

# --- 証拠の範囲決定 ---
# working tree が dirty → HEAD 基準の diff。クリーンなのにハッシュが変化 → ターン内コミット済み
# （前回 HEAD からの範囲 diff を評価）。セッション初回のクリーン停止でも、直近1時間以内の
# コミットがあれば HEAD~1..HEAD を評価する（「初回ターンで実装→コミット→完了」の素通り対策）。
# それでも範囲が取れない場合（古いクリーン状態・amend/rebase で前回 HEAD が到達不能等）は
# 評価対象なしとして通過する（既知の限界。SKILL.md 参照）。
base_ref=""
if [ -z "$(git -C "$project" status --porcelain 2>/dev/null | head -1)" ]; then
  if [ -n "$ST_LAST_HEAD" ] && [ "$current_head" != "$ST_LAST_HEAD" ] && \
     git -C "$project" merge-base --is-ancestor "$ST_LAST_HEAD" "$current_head" 2>/dev/null; then
    base_ref="$ST_LAST_HEAD"
  else
    head_epoch=$(git -C "$project" log -1 --format=%ct 2>/dev/null || echo 0)
    now_epoch=$(date +%s)
    if [ -z "$ST_LAST_HEAD" ] && [ $((now_epoch - head_epoch)) -lt 3600 ] && \
       git -C "$project" rev-parse -q --verify 'HEAD~1' >/dev/null 2>&1; then
      base_ref="HEAD~1"
    else
      state_save "$session_id" "$project" "$current_hash" "ALLOW" "" 0 "clean" "clean" 0 "$current_head"
      exit 0
    fi
  fi
fi

# --- LLM 評価（diff が前回評価時点から変化した場合のみ） ---
wdir=$(mktemp -d "$GATE_TMP_DIR/${session_id}.XXXXXX" 2>/dev/null) || { note "tmp 作成失敗のため fail-open"; exit 0; }
# evidence は評価後に必ず消す（完了主張と diff 抜粋をディスクに残さない）。デバッグ時のみ KEEP_TMP=1
trap '[ "${EVALUATOR_GATE_KEEP_TMP:-0}" = "1" ] || rm -rf "$wdir"' EXIT

printf '%s' "$last_msg" > "$wdir/last_msg_raw.txt"
build_evidence "$project" "$wdir/last_msg_raw.txt" "$wdir" "$base_ref"
# 外部送信前の無害化: センチネル偽装の除去 + 高信号 secret の内容ベース redact
# （名前フィルタを通り抜けた docker-compose.yml 等や、完了主張本文に埋まった値をマスク）
for ef in msg summary excerpt; do
  scrub_sentinels "$wdir/$ef.txt"
  redact_secrets "$wdir/$ef.txt"
done
printf '%s\n' "You may not modify anything; judge only from the evidence in this prompt." > "$wdir/tool_note.txt"
render_template "$PLUGIN_ROOT/prompts/stop-gate.md" "$wdir/prompt.md" \
  "$wdir/tool_note.txt" "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt"

# codex 公式プラグインの stop-review-gate との二重発火に対する注意喚起（best-effort）
if grep -rls '"stopReviewGate": *true' "$HOME/.claude/plugins/data/codex-openai-codex" >/dev/null 2>&1; then
  note "注意: codex 公式プラグインの stop-review-gate が有効な workspace があります。同一プロジェクトでの併用は避けてください"
fi

t0=$(date +%s)
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
  # state 保存が失敗した場合は再ブロックループが止められないため、fail-open に倒す
  if state_save "$session_id" "$project" "$current_hash" "BLOCK" "$reason" 1 "$v_c" "$v_g" "$dur" "$current_head"; then
    emit_block "外部評価者が完了主張を差し戻しました:
$reason"
  else
    note "state 保存に失敗したためブロックを見送り fail-open"
    emit_warn_allow "evaluator-gate: 評価は BLOCK でしたが内部状態を保存できないため許可に縮退しました。指摘: $(printf '%s' "$reason" | head -c 1500)"
  fi
elif [ "$v_c" = "ALLOW" ] || [ "$v_g" = "ALLOW" ]; then
  # 評価つき ALLOW で停滞カウンタをリセット（差し戻し→解消のサイクルごとに回復）
  state_save "$session_id" "$project" "$current_hash" "ALLOW" "" 0 "$v_c" "$v_g" "$dur" "$current_head"
  exit 0
else
  note "Codex/Grok とも利用不可のため fail-open（許可）。codex login status / grok login を確認してください。10分後の停止から再評価します"
  state_save "$session_id" "$project" "$current_hash" "UNAVAILABLE" "" "$ST_BLOCK_COUNT" "unavailable" "unavailable" "$dur" "$current_head"
  exit 0
fi
