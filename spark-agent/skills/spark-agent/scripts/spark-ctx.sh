#!/usr/bin/env bash
# spark-ctx: Spark CLI のアカウント文脈（現在アカウント）を保存し、spark コマンドへ自動注入する。
# macOS 標準 bash 3.2 互換。jq 等の外部依存なし。
#
#   spark-ctx use <email|alias>     現在アカウントを設定（spark accounts に存在するものだけ受理）
#   spark-ctx show                  現在アカウントと access level を表示
#   spark-ctx clear                 文脈を消す（以後は Unified 横断）
#   spark-ctx alias set <name> <email> / alias list / alias rm <name>
#   spark-ctx run [--confirm] <spark subcommand> [args...]
#                                   現在アカウントを注入して spark を実行
#
# 環境変数:
#   SPARK_BIN            実行する spark バイナリ（既定 spark。テストで差し替え）
#   SPARK_AGENT_HOME     状態ディレクトリ（既定 ~/.config/spark-agent）
#   SPARK_AGENT_DRY_RUN  1 なら実行せず、組み立てたコマンドを stdout に出す
#
# exit code: 0 成功 / 1 使い方・検証エラー / 3 --confirm 無しの送信・イベント変更
set -u

# 既定は /usr/local/bin/spark（Spark Desktop が置く場所）を絶対パスで使い、PATH 差し替えの影響を受けない
if [ -z "${SPARK_BIN:-}" ]; then
  if [ -x /usr/local/bin/spark ]; then SPARK_BIN=/usr/local/bin/spark; else SPARK_BIN=spark; fi
fi
STATE_DIR="${SPARK_AGENT_HOME:-$HOME/.config/spark-agent}"
CTX_FILE="$STATE_DIR/context"
ALIAS_FILE="$STATE_DIR/aliases"

# --confirm ゲートの対象（唯一の定義。外部へメールが出る操作と取り消せない操作）。
# Codex 側の rules（install-codex-rules.sh の WRITE）はサブコマンド単位でこれを包含する。
GATED_ACTION_VERBS="send"                    # action send（Send Later 含む）
GATED_EVENT_MODES="create update delete rsvp" # event は参加者に iTIP メールが出る
GATED_DRAFT_FLAGS="--delete"                  # draft --delete は Trash が無く取り消せない

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

die() { echo "spark-ctx: $*" >&2; exit 1; }

# 文脈ファイルが無ければ空（Unified）。あるのに読めないときは失敗（rc 2）にし、呼び出し側で止める
current_account() {
  local content
  [ -e "$CTX_FILE" ] || return 0
  if [ ! -f "$CTX_FILE" ] || [ ! -r "$CTX_FILE" ]; then
    echo "spark-ctx: 文脈ファイルが通常ファイルでないか読めません: ${CTX_FILE}" >&2
    return 2
  fi
  # 読取は単一コマンドで行い、その終了状態を見る（パイプ末尾の成功で失敗を隠さない）
  if ! content=$(cat "$CTX_FILE" 2>/dev/null); then
    echo "spark-ctx: 文脈ファイルの読取に失敗: ${CTX_FILE}" >&2
    return 2
  fi
  # 内容は「account=<アドレス>」1 行だけを有効とする。空・複数行・不正形式は壊れているとみなして止める
  case "$content" in
    account=*@*) ;;
    *) echo "spark-ctx: 文脈ファイルの内容が不正: ${CTX_FILE}（spark-ctx clear で消してから use し直してください）" >&2; return 2 ;;
  esac
  [ "$(printf '%s\n' "$content" | wc -l | tr -d ' ')" = "1" ] || { echo "spark-ctx: 文脈ファイルが複数行: ${CTX_FILE}" >&2; return 2; }
  printf '%s\n' "${content#account=}"
}

# spark accounts の標準出力だけを返す。失敗（IPC 不通など）は非ゼロで伝え、部分出力を解析させない
accounts_output() {
  local out
  out=$("$SPARK_BIN" accounts 2>/dev/null) || return 1
  printf '%s\n' "$out"
}

# spark accounts の出力から「アドレス level」の対を列挙する。実機 1.3.1 の形式:
#   Email Account: a@x.com "a@x.com" (Access: triage)
#   ├── Alias: b@x.com "Name"
#   ├── Calendar: c@y.com - read-only (a@x.com:c@y.com)   ← 他アカウントのアドレスと read-only を含む罠
# "Access:" を含む行（アカウント / Shared Inbox）の先頭アドレスと、"Alias:" 行のアドレス（直前のアカウントの
# level を継承）だけを対象にする。カレンダー行のアドレスは対象外。比較は部分一致でなく完全一致で行う。
account_entries() {
  local out
  out=$(accounts_output) || return 1
  printf '%s\n' "$out" | awk '
    function first_addr(s,   m) { if (match(s, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/)) return substr(s, RSTART, RLENGTH); return "" }
    /Access:/ { cur=$0; sub(/.*Access: */, "", cur); sub(/[) ].*/, "", cur); a=first_addr($0); if (a != "") print a, cur; next }
    /Alias:/  { a=first_addr($0); if (a != "" && cur != "") print a, cur }
  '
}

# 0: 存在 / 1: 不在 / 2: spark accounts が失敗
account_exists() {
  local entries
  entries=$(account_entries) || return 2
  printf '%s\n' "$entries" | awk -v e="$1" '$1==e { found=1; exit } END { exit !found }'
}

account_level() {
  local entries lv
  entries=$(account_entries) || { echo "unknown: spark accounts が失敗"; return 0; }
  lv=$(printf '%s\n' "$entries" | awk -v e="$1" '$1==e { print $2; exit }')
  echo "${lv:-unknown}"
}

# アカウント行（Access: を含む行）のアドレスだけを列挙（Alias・カレンダーは含めない）
account_list() {
  local out
  out=$(accounts_output) || return 1
  printf '%s\n' "$out" | grep -F 'Access:' | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | awk '!seen[$0]++'
}

# alias 名は '=' より前を文字列として完全一致（正規表現として解釈しない）
resolve_alias() {
  [ -f "$ALIAS_FILE" ] || return 0
  awk -F= -v n="$1" '$1==n { sub(/^[^=]*=/, ""); print; exit }' "$ALIAS_FILE"
}

alias_without() {
  [ -f "$ALIAS_FILE" ] || return 0
  awk -F= -v n="$1" '$1!=n' "$ALIAS_FILE"
}

cmd_use() {
  local target email rc tmp
  target="${1:-}"
  [ -n "$target" ] || die "use には <email|alias> が必要です"
  case "$target" in
    *@*) email="$target" ;;
    *)   email=$(resolve_alias "$target")
         [ -n "$email" ] || die "alias '$target' は未登録です。spark-ctx alias list で確認してください" ;;
  esac
  account_exists "$email"; rc=$?
  if [ "$rc" -eq 2 ]; then
    die "spark accounts が失敗したため文脈を変更しません（Spark Desktop の起動と CLI 設定を確認。既存の文脈はそのまま）"
  elif [ "$rc" -ne 0 ]; then
    echo "spark-ctx: '$email' は spark accounts に見つかりません。登録済みアカウント:" >&2
    account_list | sed 's/^/  /' >&2
    exit 1
  fi
  mkdir -p "$STATE_DIR" || die "状態ディレクトリを作成できません: $STATE_DIR"
  # 同じディレクトリの一時ファイルに書いてから rename（途中状態の空ファイルを読ませない）
  tmp="$CTX_FILE.tmp.$$"
  if ! { printf 'account=%s\n' "$email" > "$tmp"; } 2>/dev/null || ! mv -f "$tmp" "$CTX_FILE" 2>/dev/null \
     || [ "$(current_account)" != "$email" ]; then
    rm -f "$tmp" 2>/dev/null
    die "文脈を保存できません: ${CTX_FILE}（書き込み権限とパスを確認してください）"
  fi
  echo "現在アカウント: $email ($(account_level "$email"))"
}

cmd_show() {
  local acct
  acct=$(current_account) || exit 2
  if [ -z "$acct" ]; then
    echo "現在アカウント: (未設定。Unified 横断で実行)"
    return 0
  fi
  echo "現在アカウント: $acct ($(account_level "$acct"))"
  if [ -f "$ALIAS_FILE" ]; then
    awk -F= -v a="$acct" '$2==a { print "alias: " $1 }' "$ALIAS_FILE"
  fi
}

cmd_clear() {
  if [ -e "$CTX_FILE" ]; then
    rm -f "$CTX_FILE" 2>/dev/null
    [ -e "$CTX_FILE" ] && die "文脈を消せません: ${CTX_FILE}（旧アカウントが残っています。権限を確認してください）"
  fi
  echo "文脈を消しました（Unified 横断）"
}

cmd_alias() {
  local sub name email
  sub="${1:-list}"; shift || true
  case "$sub" in
    set)
      name="${1:-}"; email="${2:-}"
      [ -n "$name" ] && [ -n "$email" ] || die "alias set <name> <email>"
      case "$name" in *=*|*" "*) die "alias 名に '=' と空白は使えません" ;; esac
      mkdir -p "$STATE_DIR" || die "状態ディレクトリを作成できません"
      touch "$ALIAS_FILE"
      { alias_without "$name"; printf '%s=%s\n' "$name" "$email"; } > "$ALIAS_FILE.tmp" || die "alias を保存できません"
      mv "$ALIAS_FILE.tmp" "$ALIAS_FILE" || die "alias を保存できません"
      echo "alias $name -> $email"
      ;;
    list)
      [ -f "$ALIAS_FILE" ] && cat "$ALIAS_FILE" || echo "(alias なし)"
      ;;
    rm)
      name="${1:-}"; [ -n "$name" ] || die "alias rm <name>"
      [ -f "$ALIAS_FILE" ] || exit 0
      alias_without "$name" > "$ALIAS_FILE.tmp" || die "alias を保存できません"
      mv "$ALIAS_FILE.tmp" "$ALIAS_FILE" || die "alias を保存できません"
      echo "alias $name を削除"
      ;;
    *) die "alias set|list|rm" ;;
  esac
}

# 引数列に指定トークンが含まれるか（完全一致）
has_token() {
  local needle="$1"; shift
  local a
  for a in "$@"; do [ "$a" = "$needle" ] && return 0; done
  return 1
}

# フラグが含まれるか。`--in x` と `--in=x` の両形式を検出する（後者を CLI が受理する場合の二重注入防止）
has_flag() {
  local needle="$1"; shift
  local a
  for a in "$@"; do
    case "$a" in "$needle"|"$needle"=*) return 0 ;; esac
  done
  return 1
}

# 値を取るフラグ（emails / folders / search / events / event で使う集合。use-spark 1.3.1）
is_value_flag() {
  case "$1" in
    --filter|--page|--page-size|--order|--in|--start|--end|--account|--calendar) return 0 ;;
    --title|--description|--alerts|--location|--video-conference|--add|--remove|--date|--attendees) return 0 ;;
    *) return 1 ;;
  esac
}

# event のモード（create/update/delete/rsvp）。値付きオプションの値は読み飛ばし、`--title create` を
# モードと誤認しない。位置は問わない。見つからなければ空
event_mode() {
  local skip=0 a
  for a in "$@"; do
    if [ "$skip" -eq 1 ]; then skip=0; continue; fi
    case "$a" in
      --*=*) continue ;;
      --*) is_value_flag "$a" && skip=1; continue ;;
      create|update|delete|rsvp) echo "$a"; return 0 ;;
    esac
  done
  return 0
}

# 最初の位置引数のインデックス（1 始まり）を出す。無ければ 0
first_positional_index() {
  local i=0 skip=0 a
  for a in "$@"; do
    i=$((i+1))
    if [ "$skip" -eq 1 ]; then skip=0; continue; fi
    case "$a" in
      --*) is_value_flag "$a" && skip=1; continue ;;
      *) echo "$i"; return 0 ;;
    esac
  done
  echo 0
}

# 裸のシステムフォルダ名を <acct> または <acct>:<Folder> に変換
scope_folder() {
  local acct="$1" folder="$2"
  case "$folder" in
    *@*|*:*) echo "$folder" ;;                      # 既にアカウント付き
    Inbox|inbox) echo "$acct" ;;                    # アカウント Inbox の短縮形（公式）
    Archive|Trash|Sent|Drafts|Spam|Snoozed|Pinned|Starred) echo "$acct:$folder" ;;
    *) echo "$folder" ;;                            # チーム名などはそのまま
  esac
}

guard_fail() {
  echo "spark-ctx: '$*' は外部へ影響する操作です。ユーザーの明示承認をこのターンで得た上で 'run --confirm' を付けてください" >&2
  exit 3
}

exec_spark() {
  if [ "${SPARK_AGENT_DRY_RUN:-0}" = "1" ]; then
    printf '%s' "$SPARK_BIN"; printf ' %q' "$@"; printf '\n'
    return 0
  fi
  exec "$SPARK_BIN" "$@"
}

cmd_run() {
  local confirm=0 sub acct
  if [ "${1:-}" = "--confirm" ]; then confirm=1; shift; fi
  sub="${1:-}"; [ -n "$sub" ] || die "run <spark subcommand> [args...]"
  # サブコマンド前のグローバルオプション（`run --x action send`）はゲート判定を外す経路になるので受け付けない
  case "$sub" in -*) die "run の直後はサブコマンド名にしてください（'$sub' のようなオプションは不可）" ;; esac
  shift
  # --confirm は run の直後だけ。後ろに置かれたものは spark に渡さず、ゲートも通さない
  has_token --confirm "$@" && die "--confirm は 'run' の直後に置いてください（spark には渡しません）"

  # ゲートは第 1 引数だけでなく全トークンを見る（`action --date X send 1` や `event --calendar X create` で
  # 位置をずらしても素通りさせない。フォルダ名等が偶然一致した場合は --confirm を付ければ通る）
  # ゲートは保守的に「どのトークンにあっても」止める（値に偶然含まれた場合の過剰検出は --confirm で通る）。
  # 注入側は event_mode で実際のモードを判定する（値を誤認して注入しない）
  if [ "$confirm" -eq 0 ]; then
    case "$sub" in
      action) for v in $GATED_ACTION_VERBS; do has_token "$v" "$@" && guard_fail action "$v"; done ;;
      event)  for v in $GATED_EVENT_MODES;  do has_token "$v" "$@" && guard_fail event "$v"; done ;;
      draft)  for v in $GATED_DRAFT_FLAGS;  do has_flag  "$v" "$@" && guard_fail draft "$v"; done ;;
    esac
  fi

  acct=$(current_account) || exit 2   # 文脈ファイルが読めないときは Unified に落とさず止める
  if [ -z "$acct" ]; then
    echo "spark-ctx: 文脈なし。Unified（全アカウント）で実行します" >&2
    exec_spark "$sub" "$@"
    return $?
  fi

  case "$sub" in
    emails|folders) run_positional "$acct" "$sub" "$@" ;;
    search|events)
      if has_flag --in "$@"; then exec_spark "$sub" "$@"; else exec_spark "$sub" "$@" --in "$acct"; fi ;;
    draft)
      # 返信・転送・編集はスレッドのアカウントを継承、--delete は単独オプション（use-spark 仕様）なので注入しない
      if has_flag --account "$@" || has_flag --reply-to "$@" || has_flag --reply-all "$@" \
         || has_flag --forward "$@" || has_flag --edit "$@" || has_flag --delete "$@" \
         || [ "${1:-}" = "signatures" ]; then
        exec_spark draft "$@"
      else
        exec_spark draft --account "$acct" "$@"
      fi ;;
    event)
      # モードの位置は問わないが、オプションの値（`--title create`）はモードとみなさない
      if [ "$(event_mode "$@")" = "create" ] && ! has_flag --calendar "$@"; then
        exec_spark event "$@" --calendar "$acct"
      else
        exec_spark event "$@"
      fi ;;
    *) exec_spark "$sub" "$@" ;;
  esac
}

# emails / folders: 第 1 位置引数が無ければアカウントを、裸フォルダならアカウント付きにする
run_positional() {
  local acct="$1" sub="$2"; shift 2
  local idx i=0 a
  local out=()
  idx=$(first_positional_index "$@")
  if [ "$idx" -eq 0 ]; then
    exec_spark "$sub" "$acct" "$@"
    return $?
  fi
  for a in "$@"; do
    i=$((i+1))
    if [ "$i" -eq "$idx" ]; then out+=("$(scope_folder "$acct" "$a")"); else out+=("$a"); fi
  done
  exec_spark "$sub" "${out[@]}"
}

main() {
  local cmd="${1:-}"
  [ -n "$cmd" ] || { usage; exit 1; }
  shift
  case "$cmd" in
    use)   cmd_use "$@" ;;
    show)  cmd_show ;;
    clear) cmd_clear ;;
    alias) cmd_alias "$@" ;;
    run)   cmd_run "$@" ;;
    -h|--help|help) usage ;;
    *) die "不明なサブコマンド: ${cmd}（use|show|clear|alias|run）" ;;
  esac
}

main "$@"
