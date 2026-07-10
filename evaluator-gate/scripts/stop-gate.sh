#!/usr/bin/env bash
# evaluator-gate Stop フック本体。
# 契約: stdout に出すのは decision JSON（block / warn）のみ。それ以外は無出力で exit 0。
# 原則: 内部エラー・評価者不在・redact 失敗は fail-open（ブロックしない／外部送信しない）。
#       ブロックは根拠つき BLOCK 判定のときのみ。
set -uo pipefail

# フックは非ログインシェル（bash -c）で起動する。プロファイルを source すると
# その stdout 出力が decision JSON より先に混ざりゲートが無効化されるため、
# jq / codex / grok の解決に必要な標準パスを「後置」で自己供給する。
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

# OMC 実行モード（ultrawork/ralph 等）中はスキップ（多重ゲート防止）。
# 検出は project-local / session-scoped の state のみ。グローバル state は
# 「別プロジェクトの1つのフラグで全プロジェクトのゲートが死ぬ」ため見ない。
# 12 時間より古い state は stale とみなし無視する（消し忘れでゲートが永久停止しないように）。
now_epoch=$(date +%s)
for mode in ultrawork ralph autopilot team ultrapilot swarm pipeline ultraqa; do
  for msf in "$project/.omc/state/${mode}-state.json" \
             "$project/.omc/state/sessions/$session_id/${mode}-state.json" \
             "$HOME/.omc/state/sessions/$session_id/${mode}-state.json"; do
    [ -f "$msf" ] || continue
    jq -e '.active == true' "$msf" >/dev/null 2>&1 || continue
    msf_epoch=$(stat -f%m "$msf" 2>/dev/null || stat -c%Y "$msf" 2>/dev/null || echo 0)
    if [ $((now_epoch - msf_epoch)) -lt 43200 ]; then
      note "OMC 実行モード ${mode} がアクティブのためスキップ（${msf}）"
      exit 0
    fi
  done
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

# --- 同一セッションの多重 Stop を直列化（取れなければ fail-open で通過） ---
session_lock_acquire "$session_id" || { note "他の Stop 評価が進行中のためスキップ"; exit 0; }
trap 'session_lock_release "$session_id"' EXIT

# --- 決定論 diff ゲート（LLM を起動しない層） ---
current_hash=$(compute_diff_hash "$project")
current_head=$(git -C "$project" rev-parse HEAD 2>/dev/null || echo "")
current_claim=$(claim_hash "$last_msg")
current_br=$(current_branch "$project")
state_load "$session_id"

# セッションが別プロジェクトに移動した場合は state を持ち越さない（block_count/hash の混線防止）
if [ -n "$ST_PROJECT" ] && [ "$ST_PROJECT" != "$project" ]; then
  ST_LAST_HASH=""; ST_LAST_VERDICT=""; ST_LAST_REASON=""; ST_BLOCK_COUNT=0
  ST_BASELINE_HEAD="$current_head"; ST_EVAL_BASE="$current_head"; ST_UPDATED_EPOCH=0
  ST_LAST_CLAIM_HASH=""; ST_ALLOWED_SIG=""; ST_BRANCH="$current_br"
fi

# 完了主張が差し替わったか（同一内容でも再評価すべきか）を先に判定する。
# 「WIP です」で ALLOW → 内容そのままコミット → 「全部完了・テスト通過」に化ける、を防ぐ。
force_eval=0
if [ "$current_claim" != "$ST_LAST_CLAIM_HASH" ] && is_completion_claim "$last_msg"; then
  force_eval=1
fi

# HEAD の移動が「作業（commit）」か「移動（checkout/reset/rebase/merge）」かを reflog で見分ける。
# ブランチ名の比較だけだと、`checkout -b feature` して実装・コミットしたターンまで
# 「切替」とみなして無評価で受理してしまう（reflog の直近エントリは commit なので区別できる）。
nav=0
last_reflog=$(git -C "$project" reflog -1 --format='%gs' HEAD 2>/dev/null || echo "")
case "$last_reflog" in
  checkout:*|reset:*|rebase*|merge*|clone:*|pull:*) nav=1 ;;
esac
# reflog が使えない環境では、ブランチ名の変化を移動とみなす（保守的）
if [ -z "$last_reflog" ] && [ -n "$ST_BRANCH" ] && [ "$ST_BRANCH" != "$current_br" ]; then nav=1; fi
# `reflog -1` は「最後の HEAD 更新」であって「今ターンの操作」ではない。
# HEAD も branch も動いていないなら、それは過去ターンのエントリなので移動ではない
# （そう扱わないと、数ターン前の checkout のせいで毎ターン state がリセットされ、
#  差し戻しの再提示・停滞カウンタ・同一内容スキップがすべて失われる）。
head_moved=0
[ -n "$ST_EVAL_BASE" ] && [ "$ST_EVAL_BASE" != "$current_head" ] && head_moved=1
branch_changed=0
[ -n "$ST_BRANCH" ] && [ "$ST_BRANCH" != "$current_br" ] && branch_changed=1
if [ "$head_moved" -eq 0 ] && [ "$branch_changed" -eq 0 ]; then nav=0; fi

if [ "$nav" -eq 1 ] && [ -n "$ST_PROJECT" ]; then
  # 移動そのものはこのターンの「作業」ではない。ベースラインを現在地へ引き直す。
  # 未コミットの変更があればそれは実作業なので、HEAD 基準で評価を続ける。
  if [ -n "$ST_EVAL_BASE" ] && [ "$ST_EVAL_BASE" != "$current_head" ]; then
    note "HEAD の移動を検出（${last_reflog%%:*}）。ベースラインを再設定します"
  fi
  # 未解消の差し戻しが「移動」で消える場合は必ず記録する（stash / reset で
  # 指摘を回避できてしまう経路を transcript から事後検証できるようにする）
  if [ "$ST_LAST_VERDICT" = "BLOCK" ]; then
    note "警告: 未解消の差し戻しがあるまま HEAD が移動しました（${last_reflog%%:*}）。指摘は解消されていません: $(printf '%s' "$ST_LAST_REASON" | head -c 300)"
  fi
  ST_BASELINE_HEAD="$current_head"; ST_EVAL_BASE="$current_head"
  ST_ALLOWED_SIG=""; ST_LAST_HASH=""; ST_LAST_VERDICT=""; ST_BLOCK_COUNT=0
  if [ -z "$(git -C "$project" status --porcelain 2>/dev/null | head -1)" ]; then
    state_write "$session_id" "$project" "$current_head" "$current_head" "$current_hash" "$current_claim" \
                "ALLOW" "" 0 "navigation" "navigation" 0 "$current_br" ""
    exit 0
  fi
fi

if [ "$current_hash" = "$ST_LAST_HASH" ]; then
  case "$ST_LAST_VERDICT" in
    BLOCK)
      # 無修正の再停止: LLM を呼ばず前回指摘を再提示（素通り防止・クォータ消費ゼロ）。
      # block_count は「同一 diff での停滞回数」。上限で警告つき許可に縮退（stuck loop 対策）。
      # diff が変われば評価パスで 1 から数え直す（セッション累積上限ではない）。
      if [ "$ST_BLOCK_COUNT" -ge "$MAX_BLOCKS" ]; then
        # 縮退での許可は「受理」ではないので allowed_sig は記録しない
        state_write "$session_id" "$project" "$ST_BASELINE_HEAD" "$current_head" "$current_hash" "$current_claim" \
                    "ALLOW" "" "$ST_BLOCK_COUNT" "capped" "capped" 0 "$current_br" "$ST_ALLOWED_SIG"
        emit_warn_allow "evaluator-gate: 同一の変更に対する差し戻しが上限（${MAX_BLOCKS}回）に到達したため許可に縮退しました。未解消の指摘: $ST_LAST_REASON"
      fi
      nb=$((ST_BLOCK_COUNT + 1))
      # eval_base は前進させない（未検証のコミットを取り残さないため）
      state_write "$session_id" "$project" "$ST_BASELINE_HEAD" "$ST_EVAL_BASE" "$current_hash" "$current_claim" \
                  "BLOCK" "$ST_LAST_REASON" "$nb" "cached" "cached" 0 "$current_br" "$ST_ALLOWED_SIG" || {
        note "state 保存に失敗したため fail-open（再ブロックを中止）"
        exit 0
      }
      emit_block "（前回の指摘から変更がありません。指摘に対処してから完了してください）$ST_LAST_REASON"
      ;;
    UNAVAILABLE)
      # 前回は評価者が全滅（fail-open 通過）。復旧確認のため 10 分クールダウン後に再評価する
      [ $((now_epoch - ST_UPDATED_EPOCH)) -lt 600 ] && exit 0
      # フォールスルー: 同一 diff だが再評価する（eval_base は前進していないので範囲は保たれる）
      ;;
    *)
      # 変更なし。完了主張が差し替わった場合（force_eval）だけ再評価する
      [ "$force_eval" -eq 1 ] || exit 0
      ;;
  esac
fi

# --- 証拠の範囲決定 ---
# base = 「まだ評価者に受理されていない起点」。`git diff <base>` は base から現在の作業ツリーまでを
# 出すため、ターン内のコミット済み変更と未コミット変更の両方が1つの証拠に入る。
# base は ALLOW のときだけ current_head へ前進する（BLOCK/UNAVAILABLE では据え置き）。
# 起点が取れない場合（ベースライン未記録＝セッション途中で導入、amend/rebase で到達不能）は、
# 作業ツリーが汚れていれば HEAD 基準、クリーンなら評価対象なしとして通過する。
EMPTY_TREE=4b825dc642cb6eb9a060e54bf8d69288fbee4904
base_ref=""
head_reachable=0
for cand in "$ST_EVAL_BASE" "$ST_BASELINE_HEAD"; do
  [ -n "$cand" ] || continue
  if [ "$cand" = "$current_head" ]; then
    head_reachable=1; break   # コミットなし → 作業ツリー基準（HEAD）で足りる
  fi
  if git -C "$project" merge-base --is-ancestor "$cand" "$current_head" 2>/dev/null; then
    base_ref="$cand"; head_reachable=1; break
  fi
done

# コミットが1つも無いリポジトリでセッションを開始し、このターンで最初のコミットをした場合。
# ベースラインが空なので通常の起点が取れない。空ツリーを起点にして root commit を評価する。
if [ -z "$base_ref" ] && [ "$head_reachable" -eq 0 ] && [ -n "$ST_PROJECT" ] && \
   [ -z "$ST_BASELINE_HEAD" ] && [ -z "$ST_EVAL_BASE" ] && [ -n "$current_head" ]; then
  base_ref="$EMPTY_TREE"; head_reachable=1
fi

tree_dirty=1
[ -z "$(git -C "$project" status --porcelain 2>/dev/null | head -1)" ] && tree_dirty=0

# 履歴書き換え（amend / rebase / reset）で起点が到達不能になった場合。
# 黙って ALLOW にすると、そのターンの実作業が無評価で受理されてしまう。
# 正しい範囲は復元できないので、評価せずに「検証できなかった」ことを可視化して通す。
if [ -z "$base_ref" ] && [ "$head_reachable" -eq 0 ] && [ -n "${ST_EVAL_BASE}${ST_BASELINE_HEAD}" ]; then
  state_write "$session_id" "$project" "$current_head" "$current_head" "$current_hash" "$current_claim" \
              "ALLOW" "" 0 "rewritten" "rewritten" 0 "$current_br" ""
  emit_warn_allow "evaluator-gate: 履歴の書き換え（amend/rebase/reset）を検出したため、このターンの変更は検証できませんでした。ベースラインを現在の HEAD に再設定します。"
fi

# 起点から HEAD までのコミット数が異常に多い場合は、このターンの作業ではない履歴を
# 巻き込んでいる可能性が高い（同一ターン内で既存ブランチへ切替えてコミットした等）。
# 誤ブロックを避けるため、評価せずベースラインを引き直して可視化する。
if [ -n "$base_ref" ] && [ "$base_ref" != "$EMPTY_TREE" ]; then
  ncommits=$(git -C "$project" rev-list --count "$base_ref..$current_head" 2>/dev/null || echo 0)
  case "$ncommits" in ''|*[!0-9]*) ncommits=0 ;; esac
  if [ "$ncommits" -gt "${EVALUATOR_GATE_MAX_COMMITS:-50}" ]; then
    state_write "$session_id" "$project" "$current_head" "$current_head" "$current_hash" "$current_claim" \
                "ALLOW" "" 0 "range-too-large" "range-too-large" 0 "$current_br" ""
    emit_warn_allow "evaluator-gate: 起点から ${ncommits} 件のコミットがあり、このターンの作業範囲を特定できないため評価をスキップしました。ベースラインを現在の HEAD に再設定します。"
  fi
fi

if [ "$tree_dirty" -eq 0 ] && [ -z "$base_ref" ]; then
  # クリーン & 評価すべきコミット範囲なし（会話のみ、または起点未記録）→ 無音通過
  state_write "$session_id" "$project" "${ST_BASELINE_HEAD:-$current_head}" "$current_head" \
              "$current_hash" "$current_claim" "ALLOW" "" 0 "clean" "clean" 0 "$current_br" "$ST_ALLOWED_SIG"
  exit 0
fi

# 既に ALLOW された内容と「変更内容そのもの」が同一なら再評価しない。
# （dirty のまま ALLOW → そのままコミット、で同じ差分を二度評価するのを防ぐ）
# ただし完了主張が差し替わって再評価に来た場合（force_eval）は、内容が同じでも評価する。
change_sig=$(compute_change_sig "$project" "${base_ref:-HEAD}")
if [ "${force_eval:-0}" -eq 0 ] && [ -n "$ST_ALLOWED_SIG" ] && [ "$change_sig" = "$ST_ALLOWED_SIG" ]; then
  state_write "$session_id" "$project" "${ST_BASELINE_HEAD:-$current_head}" "$current_head" \
              "$current_hash" "$current_claim" "ALLOW" "" 0 "same-content" "same-content" 0 "$current_br" "$ST_ALLOWED_SIG"
  exit 0
fi

# --- LLM 評価 ---
wdir=$(mktemp -d "$GATE_TMP_DIR/${session_id}.XXXXXX" 2>/dev/null) || { note "tmp 作成失敗のため fail-open"; exit 0; }
# evidence は評価後に必ず消す（完了主張と diff 抜粋をディスクに残さない）。デバッグ時のみ KEEP_TMP=1
trap '[ "${EVALUATOR_GATE_KEEP_TMP:-0}" = "1" ] || rm -rf "$wdir"; session_lock_release "$session_id"' EXIT

printf '%s' "$last_msg" > "$wdir/last_msg_raw.txt"
build_evidence "$project" "$wdir/last_msg_raw.txt" "$wdir" "$base_ref"
# 生の完了主張を残さない（評価者は cwd 配下のファイルを読める）
rm -f "$wdir/last_msg_raw.txt"

# 外部送信前の無害化（センチネル除去 + secret redact）。
# 失敗したら「redact できない内容を外部に送らない」= 評価せず fail-open する。
if ! sanitize_evidence "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt"; then
  note "evidence の secret redact に失敗したため、外部送信せず評価をスキップします（fail-open）"
  exit 0
fi

printf '%s\n' "You may not modify anything; judge only from the evidence in this prompt." > "$wdir/tool_note.txt"
render_template "$PLUGIN_ROOT/prompts/stop-gate.md" "$wdir/prompt.md" \
  "$wdir/tool_note.txt" "$wdir/msg.txt" "$wdir/summary.txt" "$wdir/excerpt.txt"

# codex 公式プラグインの stop-review-gate との二重発火に対する注意喚起（best-effort）
if grep -rls '"stopReviewGate": *true' "$HOME/.claude/plugins/data/codex-openai-codex" >/dev/null 2>&1; then
  note "注意: codex 公式プラグインの stop-review-gate が有効な workspace があります。同一プロジェクトでの併用は避けてください"
fi

t0=$(date +%s)
# cwd は evidence ディレクトリ（$wdir）を渡す: 評価者にリポジトリ本体の読取をさせない
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
keep_base="${ST_EVAL_BASE:-${ST_BASELINE_HEAD:-$current_head}}"
if [ "$v_c" = "BLOCK" ] || [ "$v_g" = "BLOCK" ]; then
  reason=""
  [ "$v_c" = "BLOCK" ] && reason="[codex] $(cat "$wdir/reason-codex.txt")"
  if [ "$v_g" = "BLOCK" ]; then
    if [ -n "$reason" ]; then reason="$reason
[grok] $(cat "$wdir/reason-grok.txt")"
    else reason="[grok] $(cat "$wdir/reason-grok.txt")"; fi
  fi
  [ "$v_c" = "ALLOW" ] && reason="$reason
（参考: codex は ALLOW 判定。評価者間で相違あり）"
  [ "$v_g" = "ALLOW" ] && reason="$reason
（参考: grok は ALLOW 判定。評価者間で相違あり）"
  reason=$(printf '%s' "$reason" | head -c 4000)
  # 同一 diff で既に BLOCK していたなら停滞回数を継ぐ。新しい diff なら 1 から
  if [ "$current_hash" = "$ST_LAST_HASH" ] && [ "$ST_LAST_VERDICT" = "BLOCK" ]; then
    nb=$((ST_BLOCK_COUNT + 1))
  else
    nb=1
  fi
  # state 保存が失敗した場合は再ブロックループを止められないため fail-open に倒す
  if state_write "$session_id" "$project" "${ST_BASELINE_HEAD:-$current_head}" "$keep_base" \
                 "$current_hash" "$current_claim" "BLOCK" "$reason" "$nb" "$v_c" "$v_g" "$dur" \
                 "$current_br" "$ST_ALLOWED_SIG"; then
    emit_block "外部評価者が完了主張を差し戻しました:
$reason"
  else
    note "state 保存に失敗したためブロックを見送り fail-open"
    emit_warn_allow "evaluator-gate: 評価は BLOCK でしたが内部状態を保存できないため許可に縮退しました。指摘: $(printf '%s' "$reason" | head -c 1500)"
  fi
elif [ "$v_c" = "ALLOW" ] || [ "$v_g" = "ALLOW" ]; then
  # 受理: eval_base を現 HEAD へ前進させ、停滞カウンタをリセットする。
  # 受理内容の署名は「新しい eval_base（= 現 HEAD）から見た差分」で取る。
  # こうすると、その未コミット差分をそのままコミットした次の停止で署名が一致し、
  # 同じ内容を二度評価しない（基準を base_ref にすると commit で署名がずれる）。
  accepted_sig=$(compute_change_sig "$project" "$current_head")
  state_write "$session_id" "$project" "${ST_BASELINE_HEAD:-$current_head}" "$current_head" \
              "$current_hash" "$current_claim" "ALLOW" "" 0 "$v_c" "$v_g" "$dur" "$current_br" "$accepted_sig" || \
    note "state 保存に失敗しました（次の停止で再評価されます）"
  exit 0
else
  note "Codex/Grok とも利用不可のため fail-open（許可）。codex login status / grok login を確認してください。10分後の停止から再評価します"
  # eval_base は前進させない（復旧後に同じ範囲を再評価できるようにする）
  state_write "$session_id" "$project" "${ST_BASELINE_HEAD:-$current_head}" "$keep_base" \
              "$current_hash" "$current_claim" "UNAVAILABLE" "" "$ST_BLOCK_COUNT" "unavailable" "unavailable" "$dur" \
              "$current_br" "$ST_ALLOWED_SIG" || note "state 保存に失敗しました"
  exit 0
fi
