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
# allow は実行ファイルを絶対パスで固定する（bare "spark" は PATH 差し替えで別バイナリになり得るため prompt）
if [ -n "${SPARK_BIN:-}" ]; then SPARK_ABS="$SPARK_BIN"
elif [ -x /usr/local/bin/spark ]; then SPARK_ABS=/usr/local/bin/spark
else SPARK_ABS=$(command -v spark 2>/dev/null || true); fi
[ -n "$SPARK_ABS" ] || { echo "install-codex-rules: spark が見つかりません（Spark Desktop で CLI をセットアップしてください）" >&2; exit 1; }
case "$SPARK_ABS" in /*) ;; *) SPARK_ABS=$(command -v "$SPARK_ABS" 2>/dev/null || true) ;; esac
# 解決後も絶対パスかつ実行可能なファイルであることを確認する（相対パスのまま allow を書かない）
case "$SPARK_ABS" in
  /*) [ -f "$SPARK_ABS" ] && [ -x "$SPARK_ABS" ] || {
        echo "install-codex-rules: spark が実行可能なファイルではありません: $SPARK_ABS" >&2; exit 1; } ;;
  *)  echo "install-codex-rules: spark の絶対パスを解決できません（SPARK_BIN=${SPARK_ABS}）。絶対パスで指定してください" >&2; exit 1 ;;
esac
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
  allow : ${SPARK_ABS} の読み取り系（accounts / emails / search / thread / events / availability など。絶対パス固定）
  prompt: bare 'spark'（PATH 解決に依存するため）と、書き込み・送信系（draft / comment / action / contact-action / event）
  ${SCRIPT_DECISION}: bash ${CTX} ... と bash ${DOCTOR}（--allow-scripts で allow）
ユーザーの承認を得てから --yes を付けて再実行してください。
EOF
  exit 2
fi

mkdir -p "$(dirname "$OUT")" || { echo "install-codex-rules: $(dirname "$OUT") を作成できません" >&2; exit 1; }

# 一時ファイルに書いて検証してから置換する（失敗時は既存の rules を保持する）
TMP="$OUT.tmp.$$"
write_failed=0
cat > "$TMP" <<EOF || write_failed=1
# spark-agent が生成（$(date +%Y-%m-%d)）。spark は Spark Desktop への IPC のためサンドボックス外で実行する。
# 再生成: bash $HERE/install-codex-rules.sh --yes$( [ "$SCRIPT_DECISION" = allow ] && printf ' --allow-scripts' )

# READ はメールボックス・カレンダーを変更しないサブコマンドだけ（use-spark 1.3.1 で確認）。prefix_rule は
# 語の後ろの引数も許可するため、後続引数で書き込みになるものを含めない: draft（signatures 含む）・comment・
# action・contact-action・event は WRITE 側。thread --download-attachments と attachment --stream は
# ローカルへの読み出しであり、サーバー側の状態は変えない。
READ = ["accounts", "folders", "emails", "search", "thread", "attachment", "events", "availability",
        "contacts", "team", "meetings", "meeting", "templates", "template", "skill", "--version"]
WRITE = ["draft", "comment", "action", "contact-action", "event"]
SPARK = "$SPARK_ABS"
CTX = "$CTX"
DOCTOR = "$DOCTOR"

# 読み取りは絶対パスの spark だけ allow。bare "spark" は PATH 次第で別バイナリになるので prompt に留める
prefix_rule(
    pattern = [SPARK, READ],
    decision = "allow",
    justification = "Spark CLI の読み取りは Desktop への IPC が必要でサンドボックス内では失敗する",
    match = [SPARK + " accounts", SPARK + " emails --filter is:unread", SPARK + " events --week"],
    not_match = [SPARK + " action send 1", SPARK + " draft --to a@b.com"],
)

prefix_rule(
    pattern = ["spark", READ],
    decision = "prompt",
    justification = "bare spark は PATH 解決に依存する。絶対パス " + SPARK + " を使えば無確認で通る",
    match = ["spark accounts"],
)

prefix_rule(
    pattern = [[SPARK, "spark"], WRITE],
    decision = "prompt",
    justification = "下書き・操作・送信・イベント変更は確認してから実行する",
    match = [SPARK + " action archive 1", "spark event create --title T"],
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

if [ "$write_failed" -ne 0 ] || [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "install-codex-rules: 一時ファイルに書き込めません: ${TMP}（既存の ${OUT} は変更していません）" >&2
  exit 1
fi
# テスト用: 生成物を意図的に壊して「検証失敗時に既存を保持する」経路を確認する
[ "${SPARK_AGENT_BREAK_RULES:-0}" = "1" ] && printf 'this is not starlark(\n' >> "$TMP"

if command -v codex >/dev/null 2>&1; then
  if ! codex execpolicy check --rules "$TMP" -- "$SPARK_ABS" accounts >/dev/null 2>&1; then
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
