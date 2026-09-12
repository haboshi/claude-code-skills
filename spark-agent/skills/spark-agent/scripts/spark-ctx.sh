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

SPARK_BIN="${SPARK_BIN:-spark}"
STATE_DIR="${SPARK_AGENT_HOME:-$HOME/.config/spark-agent}"
CTX_FILE="$STATE_DIR/context"
ALIAS_FILE="$STATE_DIR/aliases"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
}

die() { echo "spark-ctx: $*" >&2; exit 1; }

current_account() {
  [ -f "$CTX_FILE" ] || return 0
  sed -n 's/^account=//p' "$CTX_FILE" | head -1
}

accounts_output() {
  "$SPARK_BIN" accounts 2>&1
}

# メールアドレスが spark accounts の出力に単語として現れるか
account_exists() {
  accounts_output | grep -Fqw -- "$1"
}

# アドレスを含む最初の行から access level 語を拾う（形式差に耐えるため行全体を走査）
account_level() {
  local line lv
  line=$(accounts_output | grep -F -- "$1" | head -1)
  for lv in read-only triage send disabled off; do
    if printf '%s\n' "$line" | grep -qw -- "$lv"; then echo "$lv"; return 0; fi
  done
  echo unknown
}

resolve_alias() {
  [ -f "$ALIAS_FILE" ] || return 0
  grep -- "^$1=" "$ALIAS_FILE" | head -1 | cut -d= -f2-
}

cmd_use() {
  local target email
  target="${1:-}"
  [ -n "$target" ] || die "use には <email|alias> が必要です"
  case "$target" in
    *@*) email="$target" ;;
    *)   email=$(resolve_alias "$target")
         [ -n "$email" ] || die "alias '$target' は未登録です。spark-ctx alias list で確認してください" ;;
  esac
  if ! account_exists "$email"; then
    echo "spark-ctx: '$email' は spark accounts に見つかりません。登録済みアカウント:" >&2
    accounts_output | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' | sort -u | sed 's/^/  /' >&2
    exit 1
  fi
  mkdir -p "$STATE_DIR" || die "状態ディレクトリを作成できません: $STATE_DIR"
  printf 'account=%s\n' "$email" > "$CTX_FILE"
  echo "現在アカウント: $email ($(account_level "$email"))"
}

cmd_show() {
  local acct
  acct=$(current_account)
  if [ -z "$acct" ]; then
    echo "現在アカウント: (未設定。Unified 横断で実行)"
    return 0
  fi
  echo "現在アカウント: $acct ($(account_level "$acct"))"
  if [ -f "$ALIAS_FILE" ]; then
    grep -- "=$acct\$" "$ALIAS_FILE" | cut -d= -f1 | sed 's/^/alias: /'
  fi
}

cmd_clear() {
  rm -f "$CTX_FILE"
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
      grep -v -- "^$name=" "$ALIAS_FILE" > "$ALIAS_FILE.tmp" || true
      printf '%s=%s\n' "$name" "$email" >> "$ALIAS_FILE.tmp"
      mv "$ALIAS_FILE.tmp" "$ALIAS_FILE"
      echo "alias $name -> $email"
      ;;
    list)
      [ -f "$ALIAS_FILE" ] && cat "$ALIAS_FILE" || echo "(alias なし)"
      ;;
    rm)
      name="${1:-}"; [ -n "$name" ] || die "alias rm <name>"
      [ -f "$ALIAS_FILE" ] || exit 0
      grep -v -- "^$name=" "$ALIAS_FILE" > "$ALIAS_FILE.tmp" || true
      mv "$ALIAS_FILE.tmp" "$ALIAS_FILE"
      echo "alias $name を削除"
      ;;
    *) die "alias set|list|rm" ;;
  esac
}

# 引数列に指定トークンが含まれるか
has_token() {
  local needle="$1"; shift
  local a
  for a in "$@"; do [ "$a" = "$needle" ] && return 0; done
  return 1
}

# 値を取るフラグ（emails / folders / search / events 共通で十分な集合）
is_value_flag() {
  case "$1" in
    --filter|--page|--page-size|--order|--in|--start|--end|--account|--calendar) return 0 ;;
    *) return 1 ;;
  esac
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
  shift

  case "$sub" in
    action) [ "${1:-}" = "send" ] && [ "$confirm" -eq 0 ] && guard_fail action send ;;
    event)  case "${1:-}" in create|update|delete|rsvp) [ "$confirm" -eq 0 ] && guard_fail event "$1" ;; esac ;;
  esac

  acct=$(current_account)
  if [ -z "$acct" ]; then
    echo "spark-ctx: 文脈なし。Unified（全アカウント）で実行します" >&2
    exec_spark "$sub" "$@"
    return $?
  fi

  case "$sub" in
    emails|folders) run_positional "$acct" "$sub" "$@" ;;
    search|events)
      if has_token --in "$@"; then exec_spark "$sub" "$@"; else exec_spark "$sub" "$@" --in "$acct"; fi ;;
    draft)
      if has_token --account "$@" || has_token --reply-to "$@" || has_token --reply-all "$@" \
         || has_token --forward "$@" || has_token --edit "$@" || [ "${1:-}" = "signatures" ]; then
        exec_spark draft "$@"
      else
        exec_spark draft --account "$acct" "$@"
      fi ;;
    event)
      if [ "${1:-}" = "create" ] && ! has_token --calendar "$@"; then
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
    *) die "不明なサブコマンド: $cmd（use|show|clear|alias|run）" ;;
  esac
}

main "$@"
