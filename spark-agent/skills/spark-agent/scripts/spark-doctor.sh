#!/usr/bin/env bash
# spark-doctor: Spark CLI をエージェントから使う前提が揃っているかを診断する。
# 各行を OK: / NG: / WARN: で出し、NG が 1 つでもあれば exit 1。macOS 標準 bash 3.2 互換。
#
# 環境変数（テスト用）:
#   SPARK_BIN                    spark バイナリ（既定 spark）
#   SPARK_AGENT_DESKTOP_CHECK    running|stopped|skip で Desktop 起動判定を上書き
#   SPARK_AGENT_USE_SPARK        use-spark の SKILL.md パス（既定は ~/.agents/skills 等を探索）
#   SPARK_AGENT_HOME             spark-ctx の状態ディレクトリ
set -u

SPARK_BIN="${SPARK_BIN:-spark}"
HERE=$(cd "$(dirname "$0")" && pwd)
NG=0

ok()   { echo "OK:   $*"; }
ng()   { echo "NG:   $*"; NG=$((NG+1)); }
warn() { echo "WARN: $*"; }

check_os() {
  case "$(uname -s)" in
    Darwin) ok "OS macOS" ;;
    MINGW*|MSYS*|CYGWIN*) ok "OS Windows" ;;
    *) ng "OS $(uname -s) は Spark CLI 非対応（macOS / Windows のみ）" ;;
  esac
}

check_binary() {
  if command -v "$SPARK_BIN" >/dev/null 2>&1; then
    ok "spark バイナリ: $(command -v "$SPARK_BIN")"
    return 0
  fi
  if [ "$SPARK_BIN" = "spark" ] && [ -x /usr/local/bin/spark ]; then
    ng "spark は /usr/local/bin/spark にあるが PATH に無い。PATH に /usr/local/bin を追加してください"
  else
    ng "spark が見つからない。Spark Desktop → 設定 → AIエージェント → Spark CLI「セットアップ」を実行してください"
  fi
  return 1
}

check_desktop() {
  case "${SPARK_AGENT_DESKTOP_CHECK:-}" in
    running) ok "Spark Desktop 起動中（override）"; return 0 ;;
    stopped) ng "Spark Desktop が起動していない（override）"; return 1 ;;
    skip)    warn "Spark Desktop の起動判定をスキップ"; return 0 ;;
  esac
  if pgrep -x "Spark Desktop" >/dev/null 2>&1; then
    ok "Spark Desktop 起動中"
  else
    ng "Spark Desktop が起動していない。CLI は Desktop への IPC 接続なので、先に起動してください（open -a 'Spark Desktop'）"
    return 1
  fi
}

find_use_spark() {
  local c
  if [ -n "${SPARK_AGENT_USE_SPARK:-}" ]; then
    [ -f "$SPARK_AGENT_USE_SPARK" ] && echo "$SPARK_AGENT_USE_SPARK"
    return
  fi
  for c in "$HOME/.agents/skills/use-spark/SKILL.md" "$HOME/.codex/skills/use-spark/SKILL.md" "$HOME/.claude/skills/use-spark/SKILL.md"; do
    [ -f "$c" ] && { echo "$c"; return; }
  done
}

semver_of() { grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1; }

# $1 > $2 なら 0
semver_gt() {
  local a b i x y
  a=$1; b=$2
  for i in 1 2 3; do
    x=$(echo "$a" | cut -d. -f"$i"); y=$(echo "$b" | cut -d. -f"$i")
    [ "${x:-0}" -gt "${y:-0}" ] && return 0
    [ "${x:-0}" -lt "${y:-0}" ] && return 1
  done
  return 1
}

check_versions() {
  local cli skill_file skill_ver
  cli=$("$SPARK_BIN" --version 2>/dev/null | semver_of)
  if [ -z "$cli" ]; then ng "spark --version が読めない（Desktop 未起動か IPC 失敗）"; return 1; fi
  ok "spark CLI $cli"
  skill_file=$(find_use_spark)
  if [ -z "$skill_file" ]; then
    warn "use-spark スキルが未導入。npx skills add https://github.com/readdle/spark-cli-skills -g -s use-spark -y"
    return 0
  fi
  # bash 3.2 は "$var。" のように非 ASCII が続くと変数名を誤認するため ${var} で囲む
  skill_ver=$(sed -n '/^metadata:/,/^---/p' "${skill_file}" | grep -E '^[[:space:]]*version:' | semver_of)
  if [ -z "${skill_ver}" ]; then warn "use-spark の version を読めない: ${skill_file}"; return 0; fi
  if semver_gt "${cli}" "${skill_ver}"; then
    warn "CLI ${cli} > use-spark ${skill_ver}。更新: ${SPARK_BIN} skill > ${skill_file}"
  else
    ok "use-spark ${skill_ver}（CLI と整合）"
  fi
}

check_accounts() {
  local out lines
  out=$("$SPARK_BIN" accounts 2>&1) || { ng "spark accounts が失敗: $(echo "$out" | head -3 | tr '\n' ' ')"; return 1; }
  # アカウント行（Access: を含む行）だけを見る。カレンダー行にも他アカウントのアドレスが出るため
  lines=$(echo "$out" | grep -F 'Access:' | sed -E 's/.*(Email Account|Shared Inbox)[^:]*: *//; s/ .*\(Access: */ (/; s/\).*$/)/')
  if [ -z "$lines" ]; then ng "spark accounts にアカウントが無い。Spark Desktop の 設定 → AIエージェント で各アカウントのアクセスを許可してください"; return 1; fi
  ok "アカウント: $(echo "$lines" | tr '\n' ' ')"
  echo "$out" | grep -F 'Access:' | grep -qw send && warn "send 権限のアカウントがある。送信・イベント変更は spark-ctx run --confirm でのみ実行する"
  return 0
}

check_codex_rules() {
  local rules
  rules="${SPARK_AGENT_CODEX_RULES:-${CODEX_HOME:-$HOME/.codex}/rules/spark-agent.rules}"
  command -v codex >/dev/null 2>&1 || return 0
  if [ -f "$rules" ]; then
    ok "Codex rules: $rules"
  else
    warn "Codex rules が未導入。Codex のサンドボックスでは spark の IPC が失敗する。ユーザー承認の上で: bash $HERE/install-codex-rules.sh --yes"
  fi
}

check_context() {
  bash "$HERE/spark-ctx.sh" show 2>/dev/null | sed 's/^/OK:   /' || warn "spark-ctx が動かない"
}

main() {
  check_os
  if check_binary; then
    if check_desktop; then
      check_versions
      check_accounts
    fi
  else
    check_desktop
  fi
  check_codex_rules
  check_context
  if [ "$NG" -gt 0 ]; then
    echo "RESULT: NG ($NG 件)。上の NG を解消してから作業してください"
    exit 1
  fi
  echo "RESULT: OK"
}

main "$@"
