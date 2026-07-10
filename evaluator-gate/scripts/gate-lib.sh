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

# 実パス（symlink 解決後）。macOS の sandbox は実パスで評価するため必須。
real_path() {
  ( cd "$1" 2>/dev/null && pwd -P ) 2>/dev/null || printf '%s' "$1"
}

# macOS の sandbox-exec 用プロファイルを生成する。
# 方針: ベースは allow default（評価者 CLI のランタイム依存を全列挙する deny default は
# 壊れやすい）だが、**書き込みは既定拒否**にして必要な場所だけ許可し、読取は
# リポジトリ本体と $HOME の機密を拒否する。SBPL は「最後にマッチしたルールが勝つ」。
#
# 得られる性質（評価者は untrusted な diff / 完了主張を読むため、注入耐性が要る）:
#  - リポジトリ本体を読めない → サニタイズ済み evidence 以外を外部に持ち出せない
#  - $HOME の機密（~/.ssh 等）を読めない
#  - 作業ディレクトリと評価者ランタイムの領域以外に書き込めない
#  - 評価者 CLI 自身のサンドボックス（codex -s read-only）はそのまま併用する（多層防御）。
#    入れ子の sandbox_apply が拒否されるため、モデル駆動のシェル実行も事実上できなくなる。
#
# ネットワークは許可のまま（評価者はサブスク認証で LLM プロバイダに接続する必要がある）。
# process-exec も許可のまま（CLI が自身のバイナリ/ランタイムを起動するため）。
#
# 引数: profile_out_file project_real_path write_root_real_path
write_sandbox_profile() {
  local outf project write_root d
  outf="$1"; project="$2"; write_root="${3:-}"
  {
    printf '(version 1)\n'
    printf '(allow default)\n'

    printf '\n; --- 書き込み: 既定で拒否し、必要な場所だけ許可（後勝ち） ---\n'
    printf '(deny file-write*)\n'
    [ -n "$write_root" ] && printf '(allow file-write* (subpath "%s"))\n' "$write_root"
    printf '(allow file-write* (subpath "/private/tmp"))\n'
    printf '(allow file-write* (subpath "/private/var/folders"))\n'
    printf '(allow file-write* (subpath "/dev"))\n'
    for d in .codex .grok "Library/Caches"; do
      printf '(allow file-write* (subpath "%s"))\n' "$HOME/$d"
    done

    printf '\n; --- 読み取り: リポジトリ本体と $HOME 機密を拒否 ---\n'
    [ -n "$project" ] && printf '(deny file-read* file-read-metadata (subpath "%s"))\n' "$project"
    for d in .ssh .aws .gnupg .kube .docker .config/gcloud .npmrc .netrc .git-credentials; do
      printf '(deny file-read* file-read-metadata (subpath "%s"))\n' "$HOME/$d"
    done
  } > "$outf" 2>/dev/null
}

# sandbox-exec による読取隔離を使うか。
# opt-in（EVALUATOR_GATE_SANDBOX=1）でのみ有効。既定は無効。
# 理由: sandbox-exec 隔離は単独実行では完全に機能する（リポジトリ本体・$HOME 機密の読取を
# OS レベルで遮断）が、Stop フック実運用経路では codex CLI が os error 1 で不安定になる
# 現象があり原因未特定。既定では従来の担保（プロンプト指示 + cwd=evidence + grok --deny Read
# + 生ファイル削除）で運用し、OS レベル隔離が必要な場合に明示的に有効化する。
sandbox_available() {
  [ "${EVALUATOR_GATE_SANDBOX:-0}" = "1" ] || return 1
  command -v sandbox-exec >/dev/null 2>&1
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
    git -C "$project" rev-parse --verify HEAD 2>/dev/null
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

# state schema v2:
#   baseline_head : セッション開始時（SessionStart フック）の HEAD。評価範囲の起点の初期値
#   eval_base     : 「評価済みとして受理した」地点の HEAD。ALLOW のときだけ前進する。
#                   BLOCK / UNAVAILABLE では前進させないため、未検証のコミットが取り残されない
#   last_claim_hash : 直近に評価した完了主張のハッシュ（同一 diff での主張差し替え検知用）
state_load() {
  local sf
  sf=$(state_file "$1")
  ST_LAST_HASH=""; ST_LAST_VERDICT=""; ST_LAST_REASON=""; ST_BLOCK_COUNT=0
  ST_PROJECT=""; ST_UPDATED_EPOCH=0; ST_BASELINE_HEAD=""; ST_EVAL_BASE=""; ST_LAST_CLAIM_HASH=""
  ST_BRANCH=""; ST_ALLOWED_SIG=""
  [ -f "$sf" ] || return 0
  ST_LAST_HASH=$(jq -r '.last_diff_hash // ""' "$sf" 2>/dev/null || echo "")
  ST_LAST_VERDICT=$(jq -r '.last_verdict // ""' "$sf" 2>/dev/null || echo "")
  ST_LAST_REASON=$(jq -r '.last_reason // ""' "$sf" 2>/dev/null || echo "")
  ST_BLOCK_COUNT=$(jq -r '.block_count // 0' "$sf" 2>/dev/null || echo 0)
  ST_PROJECT=$(jq -r '.project // ""' "$sf" 2>/dev/null || echo "")
  ST_UPDATED_EPOCH=$(jq -r '.updated_epoch // 0' "$sf" 2>/dev/null || echo 0)
  ST_BASELINE_HEAD=$(jq -r '.baseline_head // ""' "$sf" 2>/dev/null || echo "")
  ST_EVAL_BASE=$(jq -r '.eval_base // ""' "$sf" 2>/dev/null || echo "")
  ST_LAST_CLAIM_HASH=$(jq -r '.last_claim_hash // ""' "$sf" 2>/dev/null || echo "")
  ST_BRANCH=$(jq -r '.branch // ""' "$sf" 2>/dev/null || echo "")
  ST_ALLOWED_SIG=$(jq -r '.allowed_sig // ""' "$sf" 2>/dev/null || echo "")
  case "$ST_BLOCK_COUNT" in ''|*[!0-9]*) ST_BLOCK_COUNT=0 ;; esac
  case "$ST_UPDATED_EPOCH" in ''|*[!0-9]*) ST_UPDATED_EPOCH=0 ;; esac
}

# 引数: session project baseline_head eval_base diff_hash claim_hash verdict reason
#       block_count codex_v grok_v duration_s branch allowed_sig
# 戻り値: 保存成功 0 / 失敗 非ゼロ（呼び出し側は BLOCK 前に必ず成功確認する）
state_write() {
  local sf tmpf
  sf=$(state_file "$1"); tmpf="$sf.tmp.$$"
  ensure_dirs
  jq -n --arg project "$2" --arg bh "$3" --arg eb "$4" --arg hash "$5" --arg ch "$6" \
        --arg verdict "$7" --arg reason "$8" --argjson bc "${9:-0}" \
        --arg cv "${10:-}" --arg gv "${11:-}" --argjson dur "${12:-0}" \
        --arg br "${13:-}" --arg sig "${14:-}" \
        --arg ts "$(now_iso)" --argjson ep "$(date +%s)" \
    '{schema:3, project:$project, baseline_head:$bh, eval_base:$eb, branch:$br,
      last_diff_hash:$hash, last_claim_hash:$ch, allowed_sig:$sig,
      last_verdict:(if $verdict=="" then null else $verdict end),
      last_reason:$reason, block_count:$bc,
      last_eval:{ts:$ts, codex:$cv, grok:$gv, duration_s:$dur},
      updated:$ts, updated_epoch:$ep}' \
    > "$tmpf" 2>/dev/null && mv "$tmpf" "$sf"
}

# 完了主張のハッシュ（同一 diff での主張差し替えを検知する）
claim_hash() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }

# 完了・検証を主張する文面か（同一 diff でもこれが新たに現れたら再評価する）
# 判定は「広めに拾う」側に倒す（見逃すとゲートを素通りされるが、拾いすぎても再評価するだけ）
is_completion_claim() {
  printf '%s' "$1" | grep -qiE '完了|完成|実装しました|修正しました|対応しました|できました|終わりました|テスト.*(通|パス|成功|green)|全件パス|問題ありません|正常に動作|リリース(可能|できます)|出荷可能|マージ可能|done|completed|finished|ready to (ship|merge)|all tests? (pass|green)|tests? (are )?(passing|green)|verified|working (correctly|as expected)'
}

# base（起点）から現在の作業ツリーまでの「変更内容そのもの」の署名。
# 同じ内容が ALLOW 済みなら、コミットしただけの再停止で再評価しないために使う。
#
# 表現は「パス:作業ツリーの内容ハッシュ」の正規形にする。diff テキストを直接ハッシュすると、
# untracked のファイルがコミットされて tracked に変わった瞬間に表現が変わり、
# 内容が同一でも署名が一致しなくなる（＝受理済みの内容を二度評価してしまう）。
# 1 パス分の署名レコード。パス名はハッシュ化するため、改行を含む名前でもレコードが壊れない。
# symlink は target を、通常ファイルは blob ハッシュと mode を含める。
sig_record() {
  local project p fp ph
  project="$1"; p="$2"; fp="$project/$p"
  ph=$(printf '%s' "$p" | shasum -a 256 | cut -d' ' -f1)
  if [ -L "$fp" ]; then
    printf '%s:symlink:%s\n' "$ph" "$(readlink "$fp" 2>/dev/null | shasum -a 256 | cut -d' ' -f1)"
  elif [ -f "$fp" ]; then
    printf '%s:file:%s:%s\n' "$ph" \
      "$(git -C "$project" hash-object -- "$p" 2>/dev/null || echo unhashable)" \
      "$(stat -f%Lp "$fp" 2>/dev/null || stat -c%a "$fp" 2>/dev/null || echo '')"
  elif [ -d "$fp" ]; then
    # submodule（gitlink）は作業ツリー上ディレクトリなので、参照先の OID を署名に含める。
    # そうしないと別リビジョンを指していても同一署名になり、same-content で素通りする
    printf '%s:gitlink:%s\n' "$ph" "$(git -C "$fp" rev-parse --verify HEAD 2>/dev/null || echo none)"
  else
    printf '%s:deleted\n' "$ph"
  fi
}

compute_change_sig() {
  local project base f
  project="$1"; base="${2:-HEAD}"
  {
    git -C "$project" diff --name-only -z "$base" 2>/dev/null | \
    while IFS= read -r -d '' f; do sig_record "$project" "$f"; done
    git -C "$project" ls-files --others --exclude-standard -z 2>/dev/null | \
    while IFS= read -r -d '' f; do
      [ -e "$project/$f" ] || [ -L "$project/$f" ] || continue
      sig_record "$project" "$f"
    done
  } | sort | shasum -a 256 | cut -d' ' -f1
}

# 現在のブランチ名（detached は固定文字列）
current_branch() {
  git -C "$1" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'DETACHED'
}

# セッション単位の排他ロック（同一セッションの多重 Stop で評価が交錯するのを防ぐ）
# 取得できなければ非ゼロ（呼び出し側は fail-open で通過する）。
# フックが強制終了（hook timeout の SIGKILL）されると trap が走らずロックが残るため、
# 10 分より古いロックは stale として回収する。さもないとそのセッションのゲートが
# 恒久的に無効化されてしまう（静かに機能しなくなるのが最悪）。
session_lock_acquire() {
  local ld age lock_epoch waited=0 max_wait="${EVALUATOR_GATE_LOCK_WAIT:-20}"
  # 非数値・過大な値で無制限待ちにならないよう検証する。
  # フック全体は 300 秒予算（ロック待ち 20 + 評価 240 + KILL 猶予 5 + 諸経費）
  case "$max_wait" in ''|*[!0-9]*) max_wait=20 ;; esac
  [ "$max_wait" -gt 20 ] && max_wait=20
  ensure_dirs
  ld="$GATE_STATE_DIR/$1.lock"
  while :; do
    mkdir "$ld" 2>/dev/null && return 0
    lock_epoch=$(stat -f%m "$ld" 2>/dev/null || stat -c%Y "$ld" 2>/dev/null || echo 0)
    age=$(( $(date +%s) - lock_epoch ))
    if [ "$age" -gt 600 ]; then
      note "stale なロックを回収します（${age}秒経過）"
      rmdir "$ld" 2>/dev/null || return 1
      continue
    fi
    # 先行する評価の完了を短時間だけ待つ（無条件に評価を捨てない）
    [ "$waited" -ge "$max_wait" ] && return 1
    sleep 1
    waited=$((waited + 1))
  done
}
session_lock_release() { rmdir "$GATE_STATE_DIR/$1.lock" 2>/dev/null || true; }

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

# センチネル偽装の無害化: 信頼しないデータからセンチネル文字列を除去。
# 失敗したら非ゼロ（呼び出し側は「無害化できないなら外部送信しない」= fail-closed）
scrub_sentinels() {
  local f tmpf
  f="$1"
  [ -f "$f" ] || return 0
  tmpf="$f.scrub.$$"
  sed \
    -e 's/BUILDER_MESSAGE_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/BUILDER_MESSAGE_END/[SENTINEL-REDACTED]/g' \
    -e 's/DIFF_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/DIFF_END/[SENTINEL-REDACTED]/g' \
    -e 's/DATA_BEGIN/[SENTINEL-REDACTED]/g' \
    -e 's/DATA_END/[SENTINEL-REDACTED]/g' \
    "$f" > "$tmpf" 2>/dev/null || { rm -f "$tmpf"; return 1; }
  mv "$tmpf" "$f" 2>/dev/null || { rm -f "$tmpf"; return 1; }
  return 0
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
  local lp base g rc=1 glob_was_off=1
  lp=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  base="${lp##*/}"
  # $SENSITIVE_GLOBS の展開でカレントディレクトリのファイル名に置換されるのを防ぐ
  # （例: PWD に .env.example があると `.env*` が実ファイル名へ化けて除外集合が変質する）
  case "$-" in *f*) glob_was_off=0 ;; esac
  set -f
  for g in $SENSITIVE_GLOBS; do
    # shellcheck disable=SC2254
    case "$base" in $g) rc=0; break ;; esac
    # shellcheck disable=SC2254
    case "$lp" in $g|*/$g) rc=0; break ;; esac
  done
  [ "$glob_was_off" -eq 1 ] && set +f
  return $rc
}

# 高信号 secret の内容ベース redact（best-effort・名前フィルタの補完）。
# 通常名のファイル（docker-compose.yml 等）やビルダーの完了主張に埋まった値を、
# 外部モデルへ送る前にマスクする。正規表現なので完全ではない（SKILL.md に明記）。
# 重要: 失敗したら非ゼロを返す（呼び出し側は「redact できないなら外部送信しない」= fail-closed）。
redact_secrets() {
  local f tmpf K
  f="$1"
  [ -f "$f" ] || return 0
  tmpf="$f.redact.$$"
  # 秘密を示すキー名（BSD sed -E は (?i) 非対応のため文字クラスで大小を吸収）
  K='([Pp][Aa][Ss][Ss][Ww][Oo]?[Rr]?[Dd]|[Ss][Ee][Cc][Rr][Ee][Tt]|[Tt][Oo][Kk][Ee][Nn]|[Aa][Pp][Ii][_-]?[Kk][Ee][Yy]|[Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll]|[Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn]|[Pp][Aa][Ss][Ss][Pp][Hh][Rr][Aa][Ss][Ee])[A-Za-z_]*'
  # PEM ブロックは BEGIN..END の本文ごと落とす（1行目だけ潰しても鍵本体が残るため）
  # 値は「引用符あり（空白を含みうる）」→「引用符なし」の順にマスクする
  LC_ALL=C sed -E \
    -e '/-----BEGIN[[:space:]][A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/,/-----END[[:space:]][A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/c\
[REDACTED-PEM-BLOCK]' \
    -e 's/sk-[A-Za-z0-9_-]{12,}/[REDACTED-APIKEY]/g' \
    -e 's/(AKIA|ASIA)[0-9A-Z]{16}/[REDACTED-AWS]/g' \
    -e 's/xox[baprse]-[A-Za-z0-9-]{10,}/[REDACTED-SLACK]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{20,}/[REDACTED-GH]/g' \
    -e 's/gh[pousr]_[A-Za-z0-9]{20,}/[REDACTED-GH]/g' \
    -e 's/npm_[A-Za-z0-9]{20,}/[REDACTED-NPM]/g' \
    -e 's/AIza[A-Za-z0-9_-]{30,}/[REDACTED-GCP]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/[REDACTED-JWT]/g' \
    -e 's/[Bb]earer[[:space:]]+[A-Za-z0-9._-]{20,}/[REDACTED-BEARER]/g' \
    -e 's#(://[^:@/[:space:]]+:)[^@/[:space:]]+@#\1[REDACTED]@#g' \
    -e "s/([\"']?${K}[\"']?[[:space:]]*[:=][[:space:]]*\")[^\"]*\"/\1[REDACTED]\"/g" \
    -e "s/([\"']?${K}[\"']?[[:space:]]*[:=][[:space:]]*')[^']*'/\1[REDACTED]'/g" \
    -e "s/([\"']?${K}[\"']?[[:space:]]*[:=][[:space:]]*\`)[^\`]*\`/\1[REDACTED]\`/g" \
    -e "s/(${K}[[:space:]]*[:=][[:space:]]*)[^[:space:]\"'\`,;}]+/\1[REDACTED]/g" \
    "$f" > "$tmpf" 2>/dev/null || { rm -f "$tmpf"; return 1; }
  [ -s "$tmpf" ] || [ ! -s "$f" ] || { rm -f "$tmpf"; return 1; }
  mv "$tmpf" "$f" 2>/dev/null || { rm -f "$tmpf"; return 1; }
  return 0
}

# 信頼しないデータの無害化（センチネル除去 + secret redact）。
# いずれかが失敗したら非ゼロ = 外部送信してはならない（fail-closed）。
sanitize_evidence() {
  local d
  for d in "$@"; do
    scrub_sentinels "$d" || return 1
    redact_secrets "$d" || return 1
  done
  return 0
}

# 引数: project last_msg_file workdir [base_ref]
# base_ref は diff の起点。`git diff <base_ref>` は「base_ref から現在の作業ツリーまで」を出すため、
# ターン内のコミット済み変更と未コミット変更の両方が1つの証拠に含まれる。
# 省略時は HEAD（＝作業ツリーの未コミット変更のみ）。untracked は常に追記する。
# 生成物: workdir/{msg.txt, summary.txt, excerpt.txt}
build_evidence() {
  local project msg_file wdir base_ref DIFF_ARGS msg_size untracked tracked dlines dsize esize
  project="$1"; msg_file="$2"; wdir="$3"; base_ref="${4:-}"
  DIFF_ARGS="${base_ref:-HEAD}"
  # tracked diff にも機微パスの内容を含めない（名前は --stat に出るが値は出さない）
  # 除外集合は SENSITIVE_GLOBS（単一ソース）から生成し、位置パラメータに載せる
  local IFS_SAVE="$IFS" specs glob_was_off=1
  case "$-" in *f*) glob_was_off=0 ;; esac
  specs=$(sensitive_pathspecs)
  IFS=$'\n'
  set -f
  set -- $specs
  [ "$glob_was_off" -eq 1 ] && set +f   # 呼び出し元の noglob 状態を壊さない
  IFS="$IFS_SAVE"
  mkdir -p "$wdir"

  # ビルダー最終メッセージ（先頭 3000 バイト + 末尾 1000 バイトに切り詰め）
  msg_size=$(stat -f%z "$msg_file" 2>/dev/null || echo 0)
  if [ "$msg_size" -gt 4200 ]; then
    { head -c 3000 "$msg_file"; printf '\n...[中略: メッセージが長いため省略]...\n'; tail -c 1000 "$msg_file"; } > "$wdir/msg.txt"
  else
    cp "$msg_file" "$wdir/msg.txt"
  fi

  # サマリ: diff --stat + untracked 一覧
  {
    if [ -n "$base_ref" ]; then
      printf '# Changes in this turn (including commits), diffed against %s:\n' "$DIFF_ARGS"
    fi
    git -C "$project" diff "$DIFF_ARGS" --stat 2>/dev/null | tail -40
    untracked=$(git -C "$project" ls-files --others --exclude-standard 2>/dev/null | head -50)
    if [ -n "$untracked" ]; then
      printf '\n# New (untracked) files:\n%s\n' "$untracked"
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
  } > "$wdir/excerpt.txt"

  # 全体キャップ 48KB
  esize=$(stat -f%z "$wdir/excerpt.txt" 2>/dev/null || echo 0)
  if [ "$esize" -gt 49152 ]; then
    head -c 49152 "$wdir/excerpt.txt" > "$wdir/excerpt.txt.cap"
    printf '\n[TRUNCATED: evidence size cap 48KB]\n' >> "$wdir/excerpt.txt.cap"
    mv "$wdir/excerpt.txt.cap" "$wdir/excerpt.txt"
  fi

  # 未 redact の中間ファイルを残さない。
  # 評価者の read-only サンドボックスは「書き込み」を禁じるだけで読み取りは防げないため、
  # 生 diff がディスクに残っているとサニタイズを迂回して読まれうる。
  rm -f "$tracked"
  [ -s "$wdir/excerpt.txt" ] || [ -s "$wdir/summary.txt" ] || return 1
  return 0
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
      # 根拠なし BLOCK は採用しない（幻覚由来の差し戻しを防ぐ）:
      #  - 理由が 20 バイト未満
      #  - 構造化された指摘（`file:line — 問題 — 期待` 形式の em dash 行、または file:line 参照）が皆無
      # いずれも UNAVAILABLE = fail-open 方向に倒す
      rlen=$(wc -c < "$rfile" | tr -d ' ')
      if [ "$rlen" -lt 20 ]; then echo UNAVAILABLE; return 0; fi
      # 構造化された指摘が最低1件必要:
      #   (a) `path:123` 形式の位置参照を含む行、または
      #   (b) `対象 — 問題 — 期待` のように em dash が2つ以上ある行
      # 「場所は不明ですが品質が低い — 直してください」のような曖昧BLOCKは採用しない
      if ! grep -qE '[^[:space:]]+:[0-9]+' "$rfile" && \
         ! grep -qE '—[^—]*—' "$rfile"; then
        note "根拠が構造化されていない BLOCK のため採用しません（fail-open）"
        echo UNAVAILABLE; return 0
      fi
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
