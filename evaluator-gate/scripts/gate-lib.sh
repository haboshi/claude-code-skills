#!/usr/bin/env bash
# evaluator-gate 共有ライブラリ（macOS 標準 bash 3.2 互換。declare -A は使わない）
# 原則:
# - フックの stdout に出してよいのは decision JSON のみ。ログ・注記はすべて stderr。
# - 内部エラーは fail-open（ブロックしない）方向に倒す。

GATE_HOME="${EVALUATOR_GATE_HOME:-$HOME/.claude/evaluator-gate}"
GATE_CONFIG="$GATE_HOME/config.json"
GATE_STATE_DIR="$GATE_HOME/state"
GATE_TMP_DIR="$GATE_HOME/tmp"

note() { printf 'evaluator-gate: %s\n' "$*" >&2; }

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

ensure_dirs() { mkdir -p "$GATE_STATE_DIR" "$GATE_TMP_DIR" 2>/dev/null || true; }

gc_old_state() {
  find "$GATE_STATE_DIR" "$GATE_TMP_DIR" -mindepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null || true
}

# 引数: cwd → stdout: git toplevel（非 git なら非ゼロ終了）
resolve_project_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null
}

# 引数: project 絶対パス → enabled=true なら 0
is_enabled() {
  [ -f "$GATE_CONFIG" ] || return 1
  jq -e --arg p "$1" '.projects[$p].enabled == true' "$GATE_CONFIG" >/dev/null 2>&1
}

# 決定論 diff ハッシュ: HEAD + tracked diff + status + untracked のメタ/内容
# - HEAD を含めることで「ターン内コミットでクリーン化」も変化として検知
# - untracked は全件のメタ（サイズ+mtime）を NUL-safe で記録（51件目以降・1MB 超の変更も検知）、
#   内容ハッシュは先頭 50 件・各 1MB 以下のみ（コスト上限）。symlink は参照先を読まない
compute_diff_hash() {
  local project n
  project="$1"
  {
    git -C "$project" rev-parse HEAD 2>/dev/null
    git -C "$project" diff HEAD --no-color 2>/dev/null
    git -C "$project" status --porcelain 2>/dev/null
    n=0
    git -C "$project" ls-files --others --exclude-standard -z 2>/dev/null | \
    while IFS= read -r -d '' f; do
      fp="$project/$f"
      if [ -L "$fp" ]; then
        printf 'symlink:%s:%s\n' "$f" "$(readlink "$fp" 2>/dev/null || echo '?')"
        continue
      fi
      [ -f "$fp" ] || continue
      meta=$(stat -f '%z:%m' "$fp" 2>/dev/null || echo '0:0')
      printf 'meta:%s:%s\n' "$f" "$meta"
      n=$((n + 1))
      fsize="${meta%%:*}"
      if [ "$n" -le 50 ] && [ "$fsize" -le 1048576 ] 2>/dev/null; then
        git -C "$project" hash-object -- "$f" 2>/dev/null || printf 'unhashable:%s\n' "$f"
      fi
    done
  } | shasum -a 256 | cut -d' ' -f1
}

state_file() { printf '%s/%s.json' "$GATE_STATE_DIR" "$1"; }

# 引数: session_id → ST_LAST_HASH / ST_LAST_VERDICT / ST_LAST_REASON / ST_BLOCK_COUNT /
#                     ST_LAST_HEAD / ST_PROJECT / ST_UPDATED_EPOCH を設定
state_load() {
  local sf
  sf=$(state_file "$1")
  ST_LAST_HASH=""; ST_LAST_VERDICT=""; ST_LAST_REASON=""; ST_BLOCK_COUNT=0; ST_LAST_HEAD=""
  ST_PROJECT=""; ST_UPDATED_EPOCH=0
  [ -f "$sf" ] || return 0
  ST_LAST_HASH=$(jq -r '.last_diff_hash // ""' "$sf" 2>/dev/null || echo "")
  ST_LAST_VERDICT=$(jq -r '.last_verdict // ""' "$sf" 2>/dev/null || echo "")
  ST_LAST_REASON=$(jq -r '.last_reason // ""' "$sf" 2>/dev/null || echo "")
  ST_BLOCK_COUNT=$(jq -r '.block_count // 0' "$sf" 2>/dev/null || echo 0)
  ST_LAST_HEAD=$(jq -r '.last_head // ""' "$sf" 2>/dev/null || echo "")
  ST_PROJECT=$(jq -r '.project // ""' "$sf" 2>/dev/null || echo "")
  ST_UPDATED_EPOCH=$(jq -r '.updated_epoch // 0' "$sf" 2>/dev/null || echo 0)
  case "$ST_BLOCK_COUNT" in ''|*[!0-9]*) ST_BLOCK_COUNT=0 ;; esac
  case "$ST_UPDATED_EPOCH" in ''|*[!0-9]*) ST_UPDATED_EPOCH=0 ;; esac
}

# 引数: session_id project hash verdict reason block_count codex_v grok_v duration_s [head]
# 戻り値: 保存成功 0 / 失敗 非ゼロ（呼び出し側は BLOCK 前に必ず成功確認する）
state_save() {
  local sf tmpf
  sf=$(state_file "$1"); tmpf="$sf.tmp.$$"
  ensure_dirs
  jq -n --arg project "$2" --arg hash "$3" --arg verdict "$4" --arg reason "$5" \
        --argjson bc "$6" --arg cv "${7:-}" --arg gv "${8:-}" --argjson dur "${9:-0}" \
        --arg head "${10:-}" --arg ts "$(now_iso)" --argjson ep "$(date +%s)" \
    '{schema:1, project:$project, last_diff_hash:$hash,
      last_verdict:(if $verdict=="" then null else $verdict end),
      last_reason:$reason, block_count:$bc, last_head:$head,
      last_eval:{ts:$ts, codex:$cv, grok:$gv, duration_s:$dur},
      updated:$ts, updated_epoch:$ep}' \
    > "$tmpf" 2>/dev/null && mv "$tmpf" "$sf"
}

# 停止をブロックし reason を継続指示として注入（Stop フック公式契約）
emit_block() {
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

# ブロックせず警告だけ通知（縮退時に使用）。
# systemMessage はユーザーに表示され、additionalContext は対応バージョンなら Claude にも注入される。
# どちらが無視されても停止自体は許可される（fail-open）。stderr にも残す。
emit_warn_allow() {
  note "$1"
  jq -n --arg t "$1" '{systemMessage:$t, hookSpecificOutput:{hookEventName:"Stop", additionalContext:$t}}'
  exit 0
}

# 引数: seconds cmd... → cmd の exit code（timeout 時は 124/143 系）
# coreutils timeout/gtimeout があれば使い、なければ watchdog（不在でも無制限実行はしない）
run_with_timeout() {
  local secs tbin cmd_pid wd_pid rc
  secs="$1"; shift
  tbin=""
  if command -v timeout >/dev/null 2>&1; then tbin=timeout
  elif command -v gtimeout >/dev/null 2>&1; then tbin=gtimeout
  fi
  if [ -n "$tbin" ]; then
    # TERM で終わらない子は 5 秒後に KILL
    "$tbin" -k 5 "$secs" "$@"
    return $?
  fi
  "$@" &
  cmd_pid=$!
  ( sleep "$secs"; kill -TERM "$cmd_pid" 2>/dev/null; sleep 5; kill -KILL "$cmd_pid" 2>/dev/null ) &
  wd_pid=$!
  wait "$cmd_pid"; rc=$?
  kill -TERM "$wd_pid" 2>/dev/null
  wait "$wd_pid" 2>/dev/null
  return $rc
}

# session_id の安全性検証（パス構築・rm -rf に使うため）。不正なら非ゼロ（呼び出し側で fail-open）
validate_session_id() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  [ "${#1}" -le 128 ] || return 1
  case "$1" in
    .|..) return 1 ;;
  esac
  return 0
}

# センチネル偽装の無害化: 信頼しないデータからセンチネル文字列を除去（in-place）
scrub_sentinels() {
  sed -i '' \
    -e 's/BUILDER_MESSAGE_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/BUILDER_MESSAGE_END/[SENTINEL-REDACTED]/g' \
    -e 's/DIFF_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/DIFF_END/[SENTINEL-REDACTED]/g' \
    -e 's/DATA_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/DATA_END/[SENTINEL-REDACTED]/g' \
    "$1" 2>/dev/null || true
}

# === 機微パスの単一ソース（tracked/untracked で必ず同じ集合を使う） ===
# ここだけを編集すれば、git pathspec 除外（tracked）と is_sensitive_path（untracked）の
# 双方に反映される。二重管理による drift を構造的に防ぐ。
SENSITIVE_GLOBS='.env* *.pem *.key *.p12 *.pfx *.jks *.keystore *id_rsa* *id_ed25519* *id_ecdsa* *secret* *credential* .npmrc .netrc *.tfvars *.tfstate service-account*.json'

# stdout: git diff に渡す :(exclude,icase,glob) 形式の pathspec 群（1行1件）
# 呼び出し元が IFS を変更していても正しく分割できるよう、関数内で IFS を既定に戻す
sensitive_pathspecs() {
  local g IFS_SAVE="$IFS"
  IFS=' '
  set -f  # glob 展開を抑止（*.pem 等がカレントのファイル名に展開されるのを防ぐ）
  for g in $SENSITIVE_GLOBS; do
    printf '%s\n' ":(exclude,icase,glob)**/$g"
  done
  set +f
  IFS="$IFS_SAVE"
}

# secret 漏洩防止: 機微パスの内容を evidence（外部モデルへ送るプロンプト）に載せない
# 大文字小文字を区別しない（Secrets.swift / .ENV 等のすり抜け防止）
is_sensitive_path() {
  local lp base g
  lp=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  base="${lp##*/}"
  for g in $SENSITIVE_GLOBS; do
    # shellcheck disable=SC2254
    case "$base" in $g) return 0 ;; esac
    case "$lp" in $g|*/$g) return 0 ;; esac
  done
  return 1
}

# 高信号 secret の内容ベース redact（best-effort・名前フィルタの補完）。
# 通常名のファイル（docker-compose.yml 等）やビルダーの完了主張に埋まった値を、
# 外部モデルへ送る前にマスクする。正規表現なので完全ではない（SKILL.md に明記）。
redact_secrets() {
  [ -f "$1" ] || return 0
  LC_ALL=C sed -i '' -E \
    -e 's/sk-[A-Za-z0-9_-]{12,}/[REDACTED-APIKEY]/g' \
    -e 's/AKIA[0-9A-Z]{16}/[REDACTED-AWS]/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]{10,}/[REDACTED-SLACK]/g' \
    -e 's/gh[pousr]_[A-Za-z0-9]{20,}/[REDACTED-GH]/g' \
    -e 's/[Bb]earer[[:space:]]+[A-Za-z0-9._-]{20,}/[REDACTED-BEARER]/g' \
    -e 's#(://[^:@/[:space:]]+:)[^@/[:space:]]+@#\1[REDACTED]@#g' \
    -e 's/-----BEGIN[[:space:]][A-Z ]*PRIVATE KEY-----/[REDACTED-PRIVATE-KEY]/g' \
    -e 's/([Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd][[:space:]]*[:=][[:space:]]*)[^[:space:]"'"'"',]+/\1[REDACTED]/g' \
    -e 's/([Ss][Ee][Cc][Rr][Ee][Tt][A-Za-z_]*[[:space:]]*[:=][[:space:]]*)[^[:space:]"'"'"',]+/\1[REDACTED]/g' \
    -e 's/([Tt][Oo][Kk][Ee][Nn][A-Za-z_]*[[:space:]]*[:=][[:space:]]*)[^[:space:]"'"'"',]+/\1[REDACTED]/g' \
    -e 's/([Aa][Pp][Ii][_-]?[Kk][Ee][Yy][[:space:]]*[:=][[:space:]]*)[^[:space:]"'"'"',]+/\1[REDACTED]/g' \
    "$1" 2>/dev/null || true
}

# 引数: project last_msg_file workdir [base_ref]
# base_ref なし: working tree の diff（HEAD 基準）+ untracked を証拠にする
# base_ref あり: base_ref..HEAD のコミット範囲 diff を証拠にする（ターン内コミット済みの場合）
# 生成物: workdir/{msg.txt, summary.txt, excerpt.txt}
build_evidence() {
  local project msg_file wdir base_ref DIFF_ARGS msg_size untracked tracked dlines dsize esize
  project="$1"; msg_file="$2"; wdir="$3"; base_ref="${4:-}"
  if [ -n "$base_ref" ]; then
    DIFF_ARGS="$base_ref..HEAD"
  else
    DIFF_ARGS="HEAD"
  fi
  # tracked diff にも機微パスの内容を含めない（名前は --stat に出るが値は出さない）
  # 除外集合は SENSITIVE_GLOBS（単一ソース）から生成し、位置パラメータに載せる
  local IFS_SAVE="$IFS" specs
  specs=$(sensitive_pathspecs)
  IFS=$'\n'
  set -f
  set -- $specs
  set +f
  IFS="$IFS_SAVE"
  mkdir -p "$wdir"

  # ビルダー最終メッセージ（先頭 3000 バイト + 末尾 1000 バイトに切り詰め）
  msg_size=$(stat -f%z "$msg_file" 2>/dev/null || echo 0)
  if [ "$msg_size" -gt 4200 ]; then
    { head -c 3000 "$msg_file"; printf '\n...[中略: メッセージが長いため省略]...\n'; tail -c 1000 "$msg_file"; } > "$wdir/msg.txt"
  else
    cp "$msg_file" "$wdir/msg.txt"
  fi

  # サマリ: diff --stat + untracked 一覧（range モードでは untracked は対象外）
  {
    if [ -n "$base_ref" ]; then
      printf '# Committed changes in this turn (%s):\n' "$DIFF_ARGS"
    fi
    git -C "$project" diff "$DIFF_ARGS" --stat 2>/dev/null | tail -40
    if [ -z "$base_ref" ]; then
      untracked=$(git -C "$project" ls-files --others --exclude-standard 2>/dev/null | head -50)
      if [ -n "$untracked" ]; then
        printf '\n# New (untracked) files:\n%s\n' "$untracked"
      fi
    fi
  } > "$wdir/summary.txt"

  # 抜粋: 400 行 / 32KB 以下なら全文、超過時は変更量上位 5 ファイル各 120 行
  tracked="$wdir/tracked.diff"
  git -C "$project" diff "$DIFF_ARGS" --no-color -- "$@" 2>/dev/null > "$tracked"
  dlines=$(wc -l < "$tracked" | tr -d ' ')
  dsize=$(stat -f%z "$tracked" 2>/dev/null || echo 0)
  {
    if [ "$dlines" -le 400 ] && [ "$dsize" -le 32768 ]; then
      cat "$tracked"
    else
      printf '[TRUNCATED: full diff is %s lines / %s bytes — showing top changed files only]\n' "$dlines" "$dsize"
      git -C "$project" diff "$DIFF_ARGS" --numstat -- "$@" 2>/dev/null | sort -rn | head -5 | \
      while IFS=$(printf '\t') read -r _add _del f; do
        [ -n "$f" ] || continue
        printf '\n===== %s (first 120 lines of diff) =====\n' "$f"
        git -C "$project" diff "$DIFF_ARGS" --no-color -- "$f" 2>/dev/null | head -120
      done
    fi
    if [ -z "$base_ref" ]; then
      # untracked ファイルの内容抜粋（テキストのみ・機微パス除外・先頭 5 ファイル・各 100 行）
      git -C "$project" ls-files --others --exclude-standard -z 2>/dev/null | \
      { shown=0
        while IFS= read -r -d '' f; do
          [ "$shown" -ge 5 ] && break
          is_sensitive_path "$f" && continue
          fp="$project/$f"
          # symlink は参照先を読まない（無害な名前のリンクで任意ファイルを evidence に
          # 引き込ませない — 外部モデルへの送信面を作らない）
          [ -L "$fp" ] && continue
          [ -f "$fp" ] || continue
          grep -Iq . "$fp" 2>/dev/null || continue
          printf '\n===== new file: %s (first 100 lines) =====\n' "$f"
          head -100 "$fp"
          shown=$((shown+1))
        done; }
    fi
  } > "$wdir/excerpt.txt"

  # 全体キャップ 48KB
  esize=$(stat -f%z "$wdir/excerpt.txt" 2>/dev/null || echo 0)
  if [ "$esize" -gt 49152 ]; then
    head -c 49152 "$wdir/excerpt.txt" > "$wdir/excerpt.txt.cap"
    printf '\n[TRUNCATED: evidence size cap 48KB]\n' >> "$wdir/excerpt.txt.cap"
    mv "$wdir/excerpt.txt.cap" "$wdir/excerpt.txt"
  fi
}

# cat + 末尾改行の保証（改行なしで終わるデータが次の境界行と連結するのを防ぐ）
cat_with_final_newline() {
  cat "$1"
  if [ -s "$1" ] && [ -n "$(tail -c 1 "$1")" ]; then printf '\n'; fi
}

# 引数: template out tool_note_file msg_file summary_file excerpt_file [focus_file]
# プレースホルダは行単位（{{NAME}} のみの行）で置換する
render_template() {
  local tpl outf f_tool f_msg f_sum f_exc f_focus line
  tpl="$1"; outf="$2"; f_tool="$3"; f_msg="$4"; f_sum="$5"; f_exc="$6"; f_focus="${7:-}"
  : > "$outf"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      '{{TOOL_NOTE}}') cat_with_final_newline "$f_tool" >> "$outf" ;;
      '{{LAST_ASSISTANT_MESSAGE}}') cat_with_final_newline "$f_msg" >> "$outf" ;;
      '{{DIFF_SUMMARY}}') cat_with_final_newline "$f_sum" >> "$outf" ;;
      '{{DIFF_EXCERPT}}') cat_with_final_newline "$f_exc" >> "$outf" ;;
      '{{FOCUS}}')
        if [ -n "$f_focus" ] && [ -s "$f_focus" ]; then cat_with_final_newline "$f_focus" >> "$outf"; fi ;;
      *) printf '%s\n' "$line" >> "$outf" ;;
    esac
  done < "$tpl"
}

# 引数: out_file rc reason_out_file → stdout: ALLOW | BLOCK | UNAVAILABLE
# 1行目プロトコル（ALLOW:/BLOCK:）を厳密に適用: 最初の非空行のみを判定に使う。
# 前置きの後に紛れた BLOCK 行を拾って誤差し戻しするより、逸脱は UNAVAILABLE（fail-open）に倒す。
parse_verdict() {
  local outf rc rfile verdict_line rlen
  outf="$1"; rc="$2"; rfile="$3"
  : > "$rfile"
  [ "$rc" -eq 0 ] || { echo UNAVAILABLE; return 0; }
  [ -s "$outf" ] || { echo UNAVAILABLE; return 0; }
  verdict_line=$(grep -m1 -E '.' "$outf" | grep -E '^(ALLOW|BLOCK):' | head -1)
  case "$verdict_line" in
    ALLOW:*) echo ALLOW; return 0 ;;
    BLOCK:*)
      # 理由 = 判定行の残り + 以降の指摘行（上限 1800 バイト）
      {
        printf '%s\n' "${verdict_line#BLOCK:}"
        awk 'found {print} /^BLOCK:/ && !found {found=1}' "$outf" | head -40
      } | head -c 1800 > "$rfile"
      # 根拠なし BLOCK の機械的最低ライン: 20 バイト未満の理由は判定不能扱い
      rlen=$(wc -c < "$rfile" | tr -d ' ')
      if [ "$rlen" -lt 20 ]; then echo UNAVAILABLE; return 0; fi
      echo BLOCK; return 0 ;;
    *) echo UNAVAILABLE; return 0 ;;
  esac
}

# 引数: out_file log_file evaluator_name — auth 系エラーの兆候を stderr に注記
detect_auth_hint() {
  if cat "$1" "$2" 2>/dev/null | grep -qiE 'auth|login|unauthorized|expired|forbidden|401|403|usage limit|rate limit'; then
    case "$3" in
      grok)  note "Grok の認証/制限エラーの可能性。'grok login' で再認証してください（トークンは7日で失効）" ;;
      codex) note "Codex の認証/クォータエラーの可能性。'codex login status' を確認してください" ;;
    esac
  fi
}
