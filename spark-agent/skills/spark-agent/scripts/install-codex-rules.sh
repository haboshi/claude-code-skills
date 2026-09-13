#!/usr/bin/env bash
# install-codex-rules: Codex が spark / spark-ctx をサンドボックス外で実行できるよう rules を配置する。
#
# 根拠: spark は Spark Desktop への IPC クライアントで、Codex の read-only / workspace-write サンドボックスでは
# 「Spark CLI can't access your Spark Desktop application」になる（2026-09-13 実測、Codex 0.154.0）。
# Codex の rules は prefix_rule の decision="allow" で「サンドボックス外でプロンプトなしに実行」、
# "prompt" で「実行前に確認」となる（公式 docs: agent-configuration/rules）。
#
# 生成先: ${CODEX_HOME:-$HOME/.codex}/rules/spark-agent.rules（既存は上書き）
#
# 使い方: install-codex-rules.sh --yes [--allow-scripts]
#   --yes            Codex の承認設定を書き換えることにユーザーが同意した印。無ければ生成内容の要約だけ出して exit 2。
#                    エージェントは、ユーザーに内容を示して承認を得てから --yes を付ける。
#   --allow-scripts  spark-ctx / spark-doctor の bash 起動も allow にする（既定は prompt）。
#                    既定を prompt にしている理由: allow はスクリプトの絶対パスをサンドボックス外で無確認実行する
#                    許可なので、そのスクリプトが Codex の作業ツリー内で書き換え可能なとき（このリポを開いている
#                    セッション等）、サンドボックス脱出の経路になる。bare `spark <読み取り>` は /usr/local/bin の
#                    バイナリなので allow で問題ない。
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
CTX="$HERE/spark-ctx.sh"
DOCTOR="$HERE/spark-doctor.sh"
RULES_DIR="${CODEX_HOME:-$HOME/.codex}/rules"
OUT="${SPARK_AGENT_CODEX_RULES:-$RULES_DIR/spark-agent.rules}"
YES=0; SCRIPT_DECISION="prompt"
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --allow-scripts) SCRIPT_DECISION="allow" ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "install-codex-rules: 不明な引数 $a" >&2; exit 1 ;;
  esac
done

if [ "$YES" -ne 1 ]; then
  cat <<EOF
install-codex-rules: 次の内容で $OUT を書きます（Codex がサンドボックス外で実行してよいコマンドの規則）。
  allow : spark の読み取り系（accounts / emails / search / thread / events / availability など）
  prompt: spark の書き込み・送信系（draft / comment / action / contact-action / event）
  ${SCRIPT_DECISION}: bash ${CTX} ... と bash ${DOCTOR}（--allow-scripts で allow）
ユーザーの承認を得てから --yes を付けて再実行してください。
EOF
  exit 2
fi

mkdir -p "$(dirname "$OUT")" || { echo "install-codex-rules: $(dirname "$OUT") を作成できません" >&2; exit 1; }

# 一時ファイルに書いて検証してから置換する（失敗時は既存の rules を保持する）
TMP="$OUT.tmp.$$"
cat > "$TMP" <<EOF
# spark-agent が生成（$(date +%Y-%m-%d)）。spark は Spark Desktop への IPC のためサンドボックス外で実行する。
# 再生成: bash $HERE/install-codex-rules.sh --yes$( [ "$SCRIPT_DECISION" = allow ] && printf ' --allow-scripts' )

# READ はメールボックス・カレンダーを変更しないサブコマンドだけ（use-spark 1.3.1 で確認）。prefix_rule は
# 語の後ろの引数も許可するため、後続引数で書き込みになるものを含めない: draft（signatures 含む）・comment・
# action・contact-action・event は WRITE 側。thread --download-attachments と attachment --stream は
# ローカルへの読み出しであり、サーバー側の状態は変えない。
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
    decision = "$SCRIPT_DECISION",
    justification = "アカウント文脈の操作（ローカル状態のみ）",
    match = ["bash " + CTX + " show"],
)

prefix_rule(
    pattern = ["bash", CTX, "run", READ],
    decision = "$SCRIPT_DECISION",
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
    decision = "$SCRIPT_DECISION",
    justification = "環境診断（読み取りのみ）",
)
EOF

[ -s "$TMP" ] || { rm -f "$TMP"; echo "install-codex-rules: 一時ファイルに書き込めません: $TMP" >&2; exit 1; }
# テスト用: 生成物を意図的に壊して「検証失敗時に既存を保持する」経路を確認する
[ "${SPARK_AGENT_BREAK_RULES:-0}" = "1" ] && printf 'this is not starlark(\n' >> "$TMP"

if command -v codex >/dev/null 2>&1; then
  if ! codex execpolicy check --rules "$TMP" -- spark accounts >/dev/null 2>&1; then
    rm -f "$TMP"
    echo "install-codex-rules: 生成した rules を codex execpolicy check が読めません。既存の $OUT は変更していません" >&2
    exit 1
  fi
  verified="verified by codex execpolicy check"
else
  verified="unverified: codex コマンドが無いため構文検証をしていない"
fi
mv "$TMP" "$OUT" || { rm -f "$TMP"; echo "install-codex-rules: $OUT に置換できません（既存は保持）" >&2; exit 1; }
echo "installed: $OUT ($verified)"
