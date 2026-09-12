#!/usr/bin/env bash
# install-codex-rules: Codex が spark / spark-ctx をサンドボックス外で実行できるよう rules を配置する。
#
# 根拠: spark は Spark Desktop への IPC クライアントで、Codex の read-only / workspace-write サンドボックスでは
# 「Spark CLI can't access your Spark Desktop application」になる（2026-09-13 実測、Codex 0.154.0）。
# Codex の rules は prefix_rule の decision="allow" で「サンドボックス外でプロンプトなしに実行」、
# "prompt" で「実行前に確認」となる（公式 docs: agent-configuration/rules）。
#
# 生成先: ${CODEX_HOME:-$HOME/.codex}/rules/spark-agent.rules（既存は上書き）
# 読み取り系は allow、書き込み・送信系（draft / comment / action / contact-action / event、run --confirm）は prompt。
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
CTX="$HERE/spark-ctx.sh"
DOCTOR="$HERE/spark-doctor.sh"
RULES_DIR="${CODEX_HOME:-$HOME/.codex}/rules"
OUT="${SPARK_AGENT_CODEX_RULES:-$RULES_DIR/spark-agent.rules}"

mkdir -p "$(dirname "$OUT")" || { echo "install-codex-rules: $(dirname "$OUT") を作成できません" >&2; exit 1; }

cat > "$OUT" <<EOF
# spark-agent が生成（$(date +%Y-%m-%d)）。spark は Spark Desktop への IPC のためサンドボックス外で実行する。
# 再生成: bash $HERE/install-codex-rules.sh

READ = ["accounts", "folders", "emails", "search", "thread", "attachment", "events", "availability",
        "contacts", "team", "meetings", "meeting", "templates", "template", "skill", "--version"]
WRITE = ["draft", "comment", "action", "contact-action", "event"]
CTX = "$CTX"
DOCTOR = "$DOCTOR"

prefix_rule(
    pattern = ["spark", READ],
    decision = "allow",
    justification = "Spark CLI の読み取りは Desktop への IPC が必要でサンドボックス内では失敗する",
    match = ["spark accounts", "spark emails --filter is:unread", "spark events --week"],
    not_match = ["spark action send 1", "spark draft --to a@b.com"],
)

prefix_rule(
    pattern = ["spark", WRITE],
    decision = "prompt",
    justification = "下書き・操作・送信・イベント変更は確認してから実行する",
    match = ["spark action archive 1", "spark event create --title T"],
)

prefix_rule(
    pattern = ["bash", CTX, ["use", "show", "clear", "alias"]],
    decision = "allow",
    justification = "アカウント文脈の操作（ローカル状態のみ）",
    match = ["bash " + CTX + " show"],
)

prefix_rule(
    pattern = ["bash", CTX, "run", READ],
    decision = "allow",
    justification = "現在アカウントにスコープした読み取り",
    match = ["bash " + CTX + " run emails --filter is:unread"],
    not_match = ["bash " + CTX + " run action send 1"],
)

prefix_rule(
    pattern = ["bash", CTX, "run", WRITE + ["--confirm"]],
    decision = "prompt",
    justification = "書き込み・送信・イベント変更は確認してから実行する",
    match = ["bash " + CTX + " run --confirm action send 1", "bash " + CTX + " run draft --to a@b.com"],
)

prefix_rule(
    pattern = ["bash", DOCTOR],
    decision = "allow",
    justification = "環境診断（読み取りのみ）",
)
EOF

echo "installed: $OUT"
if command -v codex >/dev/null 2>&1; then
  if codex execpolicy check --rules "$OUT" -- spark accounts >/dev/null 2>&1; then
    echo "OK: codex execpolicy check が rules を読み込めた"
  else
    echo "WARN: codex execpolicy check が失敗。rules の構文か Codex の版を確認してください" >&2
    exit 1
  fi
fi
