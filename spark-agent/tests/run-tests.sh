#!/usr/bin/env bash
# spark-agent 決定論テスト（fake spark・実 Spark Desktop 不要）
# 実行: bash spark-agent/tests/run-tests.sh
set -u

TESTS_DIR=$(cd "$(dirname "$0")" && pwd)
PLUG=$(cd "$TESTS_DIR/.." && pwd)
SCRIPTS="$PLUG/skills/spark-agent/scripts"
CTX="$SCRIPTS/spark-ctx.sh"
DOC="$SCRIPTS/spark-doctor.sh"

die() { echo "SETUP FAILED: $*" >&2; exit 2; }
WORK=$(mktemp -d "${TMPDIR:-/tmp}/spark-agent-tests.XXXXXX") || die "mktemp"
trap 'rm -rf "$WORK"' EXIT
chmod +x "$TESTS_DIR/fakes/spark" || die "chmod"

export SPARK_BIN="$TESTS_DIR/fakes/spark"
export SPARK_AGENT_HOME="$WORK/home"
export FAKE_CALL_LOG_DIR="$WORK/log"
export SPARK_AGENT_DESKTOP_CHECK=running
export SPARK_AGENT_USE_SPARK="$WORK/use-spark/SKILL.md"
export SPARK_AGENT_CODEX_RULES="$WORK/codex-rules/spark-agent.rules"
mkdir -p "$WORK/codex-rules" && : > "$SPARK_AGENT_CODEX_RULES"
mkdir -p "$FAKE_CALL_LOG_DIR" "$WORK/use-spark"
printf '%s\n' "---" "name: use-spark" "metadata:" "  version: 1.3.1" "---" > "$SPARK_AGENT_USE_SPARK"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1  ($2)"; }
last_call() { tail -1 "$FAKE_CALL_LOG_DIR/spark-calls.log" 2>/dev/null; }
dry() { SPARK_AGENT_DRY_RUN=1 bash "$CTX" run "$@" 2>/dev/null; }

# --- ctx: use / show / clear ---
out=$(bash "$CTX" use nobody@example.com 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "見つかりません" && echo "$out" | grep -q "work@example.com" \
  && ok "T1 未知アカウントは拒否し候補を列挙" || bad "T1" "rc=$rc out=$out"

out=$(bash "$CTX" use work@example.com 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ "$out" = "現在アカウント: work@example.com (triage)" ] \
  && ok "T2 use が保存し level を表示" || bad "T2" "rc=$rc out=$out"

out=$(bash "$CTX" show 2>&1)
[ "$out" = "現在アカウント: work@example.com (triage)" ] && ok "T3 show（他アカウントのカレンダー行の read-only に惑わされない）" || bad "T3" "$out"

out=$(bash "$CTX" use me-alias@example.com 2>&1)
[ "$out" = "現在アカウント: me-alias@example.com (send)" ] && ok "T3b Spark の Alias は親アカウントの level を継承" || bad "T3b" "$out"

out=$(bash "$CTX" use nobody@example.com 2>&1)
echo "$out" | grep -qF "  personal@example.com" && ! echo "$out" | grep -qF "me-alias" && ! echo "$out" | grep -q "祝日" \
  && ok "T3c 候補列挙はアカウント行のみ（Alias・カレンダーを含めない）" || bad "T3c" "$out"

out=$(bash "$CTX" use cal-only@example.com 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "見つかりません" && ok "T3d カレンダー行にしか無いアドレスは拒否" || bad "T3d" "rc=$rc out=$out"

out=$(bash "$CTX" use me@example.com 2>&1)
[ "$out" = "現在アカウント: me@example.com (triage)" ] && ok "T3e 部分文字列を含む先行アカウント（some@）の level を拾わない" || bad "T3e" "$out"

out=$(bash "$CTX" alias set kaisha work@example.com 2>&1) && bash "$CTX" alias set kojin personal@example.com >/dev/null 2>&1
bash "$CTX" use kojin >/dev/null 2>&1; rc=$?
out=$(bash "$CTX" show 2>&1)
[ "$rc" -eq 0 ] && echo "$out" | grep -q "personal@example.com (send)" && echo "$out" | grep -q "alias: kojin" \
  && ok "T4 alias 解決と show の alias 表示" || bad "T4" "rc=$rc out=$out"

out=$(bash "$CTX" use nanika 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "未登録" && ok "T5 未登録 alias は拒否" || bad "T5" "rc=$rc out=$out"

out=$(bash "$CTX" alias set 'a=b' x@example.com 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "T6 alias 名の '=' を拒否" || bad "T6" "rc=$rc out=$out"

bash "$CTX" alias set work.prod work@example.com >/dev/null 2>&1; bash "$CTX" alias set workXprod client@example.com >/dev/null 2>&1
bash "$CTX" use work.prod >/dev/null 2>&1
out=$(bash "$CTX" show 2>&1)
bash "$CTX" alias rm work.prod >/dev/null 2>&1
rest=$(bash "$CTX" alias list 2>&1)
echo "$out" | grep -q "work@example.com" && echo "$rest" | grep -qF "workXprod=client@example.com" && ! echo "$rest" | grep -qF "work.prod=" \
  && ok "T6b alias 名は完全一致（'.' を正規表現として扱わない）" || bad "T6b" "show=$out list=$rest"

out=$(SPARK_AGENT_HOME="$WORK/ro" bash -c 'mkdir -p "$SPARK_AGENT_HOME/context" && bash "$0" use work@example.com' "$CTX" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "文脈を保存できません" && ok "T6c 保存失敗は非ゼロで終了し成功表示しない" || bad "T6c" "rc=$rc out=$out"

# --- run: 注入規則（personal@example.com が現在アカウント） ---
bash "$CTX" use personal@example.com >/dev/null 2>&1
out=$(dry emails --filter "is:unread")
[ "$out" = "$SPARK_BIN emails personal@example.com --filter is:unread" ] && ok "T7 emails 位置引数なし → アカウント注入" || bad "T7" "$out"

out=$(dry emails Archive --page 2)
[ "$out" = "$SPARK_BIN emails personal@example.com:Archive --page 2" ] && ok "T8 emails 裸フォルダ → acct:Folder" || bad "T8" "$out"

out=$(dry emails Inbox)
[ "$out" = "$SPARK_BIN emails personal@example.com" ] && ok "T9 emails Inbox → アカウント短縮形" || bad "T9" "$out"

out=$(dry emails other@example.com:Archive)
[ "$out" = "$SPARK_BIN emails other@example.com:Archive" ] && ok "T10 明示アカウントは上書きしない" || bad "T10" "$out"

out=$(dry emails --page-size 20 "My Team")
[ "$out" = "$SPARK_BIN emails --page-size 20 My\\ Team" ] && ok "T11 値付きフラグ越しの位置引数（チーム名）は素通し" || bad "T11" "$out"

out=$(dry folders)
[ "$out" = "$SPARK_BIN folders personal@example.com" ] && ok "T12 folders → アカウント注入" || bad "T12" "$out"

out=$(dry search "契約更新")
[ "$out" = "$SPARK_BIN search 契約更新 --in personal@example.com" ] && ok "T13 search → --in 注入" || bad "T13" "$out"

out=$(dry search --filter "from:a@b.com" --in work@example.com)
[ "$out" = "$SPARK_BIN search --filter from:a@b.com --in work@example.com" ] && ok "T14 search --in 既存なら二重注入しない" || bad "T14" "$out"

out=$(dry draft --to a@b.com --subject S --body B)
[ "$out" = "$SPARK_BIN draft --account personal@example.com --to a@b.com --subject S --body B" ] && ok "T15 draft 新規 → --account 注入" || bad "T15" "$out"

out=$(dry draft --reply-to 123 --body B)
[ "$out" = "$SPARK_BIN draft --reply-to 123 --body B" ] && ok "T16 draft 返信は注入しない（スレッドのアカウントを継承）" || bad "T16" "$out"

out=$(dry --confirm draft --delete 123)
[ "$out" = "$SPARK_BIN draft --delete 123" ] && ok "T16b draft --delete は単独オプションなので注入しない" || bad "T16b" "$out"

out=$(dry draft signatures)
[ "$out" = "$SPARK_BIN draft signatures" ] && ok "T17 draft signatures は素通し" || bad "T17" "$out"

out=$(dry events --week)
[ "$out" = "$SPARK_BIN events --week --in personal@example.com" ] && ok "T18 events → --in 注入" || bad "T18" "$out"

out=$(dry --confirm event create --title T --start 2026-09-15T10:00 --end 2026-09-15T10:30)
[ "$out" = "$SPARK_BIN event create --title T --start 2026-09-15T10:00 --end 2026-09-15T10:30 --calendar personal@example.com" ] \
  && ok "T19 event create → --calendar 注入" || bad "T19" "$out"

out=$(dry --confirm event update ABC --title T2)
[ "$out" = "$SPARK_BIN event update ABC --title T2" ] && ok "T20 event update は calendar 注入しない" || bad "T20" "$out"

out=$(dry --confirm event --title T create --start 2026-09-15T10:00)
[ "$out" = "$SPARK_BIN event --title T create --start 2026-09-15T10:00 --calendar personal@example.com" ] \
  && ok "T20b event の create が後方にあっても --calendar を注入" || bad "T20b" "$out"

out=$(dry --confirm event create --title T --calendar=x@example.com)
[ "$out" = "$SPARK_BIN event create --title T --calendar=x@example.com" ] && ok "T20c --calendar=値 形式があれば二重注入しない" || bad "T20c" "$out"

out=$(dry search "topic" --in=work@example.com)
[ "$out" = "$SPARK_BIN search topic --in=work@example.com" ] && ok "T14b --in=値 形式があれば二重注入しない" || bad "T14b" "$out"

out=$(bash "$CTX" run draft --delete=123 2>&1); rc=$?
[ "$rc" -eq 3 ] && ok "T23h draft --delete=値 形式もゲート" || bad "T23h" "rc=$rc"

out=$(dry thread 42)
[ "$out" = "$SPARK_BIN thread 42" ] && ok "T21 その他は素通し" || bad "T21" "$out"

# --- 安全ゲート ---
before=$(wc -l < "$FAKE_CALL_LOG_DIR/spark-calls.log" | tr -d ' ')
out=$(bash "$CTX" run action send 99 2>&1); rc=$?
after=$(wc -l < "$FAKE_CALL_LOG_DIR/spark-calls.log" | tr -d ' ')
[ "$rc" -eq 3 ] && [ "$before" = "$after" ] && ! grep -qx "action send 99" "$FAKE_CALL_LOG_DIR/spark-calls.log" \
  && ok "T22 action send は --confirm なしで exit 3・spark は一切呼ばれない" || bad "T22" "rc=$rc before=$before after=$after"

out=$(bash "$CTX" run event create --title T --confirm 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "run' の直後" && ! grep -q -- "--confirm" "$FAKE_CALL_LOG_DIR/spark-calls.log" \
  && ok "T22b 後置の --confirm は拒否され spark に渡らない" || bad "T22b" "rc=$rc out=$out"

out=$(bash "$CTX" run event delete ABC 2>&1); rc=$?
[ "$rc" -eq 3 ] && ok "T23 event delete も --confirm なしで exit 3" || bad "T23" "rc=$rc"

out=$(bash "$CTX" run draft --delete 123 2>&1); rc=$?
[ "$rc" -eq 3 ] && ok "T23d draft --delete（取り消し不能）も --confirm なしで exit 3" || bad "T23d" "rc=$rc"
out=$(SPARK_AGENT_DRY_RUN=1 bash "$CTX" run --confirm draft --delete 123 2>/dev/null)
[ "$out" = "$SPARK_BIN draft --delete 123" ] && ok "T23e --confirm 付き draft --delete は注入なしで実行" || bad "T23e" "$out"

# ゲート対象の動詞は spark-ctx.sh の GATED_* が唯一の定義。Codex rules の WRITE 側がそれを包含していることを確認
for v in action event draft; do
  grep -q "\"$v\"" "$SCRIPTS/install-codex-rules.sh" && ok "T23f rules の WRITE に '$v' を含む（ゲート対象の包含）" || bad "T23f" "$v missing in WRITE"
done

out=$(bash "$CTX" run action --date 2026-09-14 send 99 2>&1); rc=$?
[ "$rc" -eq 3 ] && ok "T23b action の send を後ろにずらしてもゲートされる" || bad "T23b" "rc=$rc"
out=$(bash "$CTX" run event --calendar x@example.com create --title T 2>&1); rc=$?
[ "$rc" -eq 3 ] && ok "T23c event の create を後ろにずらしてもゲートされる" || bad "T23c" "rc=$rc"

out=$(bash "$CTX" run --confirm action send 99 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ "$(last_call)" = "action send 99" ] && ok "T24 --confirm 付きなら実行される" || bad "T24" "rc=$rc last=$(last_call)"

out=$(bash "$CTX" run action archive 5 6 2>&1); rc=$?
[ "$rc" -eq 0 ] && [ "$(last_call)" = "action archive 5 6" ] && ok "T25 action archive はゲート対象外" || bad "T25" "rc=$rc"

# --- 文脈なし ---
bash "$CTX" clear >/dev/null 2>&1
out=$(SPARK_AGENT_DRY_RUN=1 bash "$CTX" run emails --filter "is:unread" 2>"$WORK/err")
[ "$out" = "$SPARK_BIN emails --filter is:unread" ] && grep -q "Unified" "$WORK/err" \
  && ok "T26 文脈なしは素通しし stderr で告知" || bad "T26" "out=$out err=$(cat "$WORK/err")"

out=$(SPARK_AGENT_HOME="$WORK/rocl" bash -c 'mkdir -p "$SPARK_AGENT_HOME/context" && bash "$0" clear' "$CTX" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "文脈を消せません" && ok "T26b clear の失敗は非ゼロで終了し成功表示しない" || bad "T26b" "rc=$rc out=$out"

# --- doctor ---
bash "$CTX" use work@example.com >/dev/null 2>&1
out=$(bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 0 ] && echo "$out" | grep -q "RESULT: OK" && echo "$out" | grep -q "spark CLI 1.3.1" \
  && echo "$out" | grep -q "WARN: send" && echo "$out" | grep -q "OK:   現在アカウント: work@example.com" \
  && ok "T27 doctor 全 OK（send は WARN、文脈表示）" || bad "T27" "rc=$rc out=$out"

out=$(SPARK_AGENT_DESKTOP_CHECK=stopped bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   Spark Desktop が起動していない" && ! echo "$out" | grep -q "spark CLI 1.3.1" \
  && ok "T28 Desktop 停止は NG・以降の IPC 依存チェックを飛ばす" || bad "T28" "rc=$rc out=$out"

out=$(FAKE_SPARK_VERSION=1.4.0 bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 0 ] && echo "$out" | grep -q "WARN: CLI 1.4.0 > use-spark 1.3.1" && ok "T29 版ずれは WARN と更新手順" || bad "T29" "rc=$rc out=$out"

out=$(SPARK_BIN=/nonexistent/spark bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   spark が見つからない" && echo "$out" | grep -q "セットアップ" \
  && ok "T30 spark 不在は NG とセットアップ案内" || bad "T30" "rc=$rc out=$out"

out=$(SPARK_AGENT_USE_SPARK="$WORK/none.md" bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   use-spark スキル（コマンド正典・必須依存）が未導入" && ok "T31 use-spark 未導入は NG（必須依存）" || bad "T31" "rc=$rc out=$out"

out=$(FAKE_SPARK_MODE=noaccounts bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   spark accounts にアカウントが無い" \
  && ok "T32 実機文面 'No accounts found.' は NG（アクセス未許可）" || bad "T32" "rc=$rc out=$out"

out=$(FAKE_SPARK_MODE=noipc bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   spark accounts が失敗: Error: Spark CLI can't access" \
  && ok "T33 実機文面の IPC エラーは NG として表示" || bad "T33" "rc=$rc out=$out"

out=$(SPARK_AGENT_CTX_SCRIPT="$WORK/missing-ctx.sh" bash "$DOC" 2>&1); rc=$?
[ "$rc" -eq 1 ] && echo "$out" | grep -q "NG:   spark-ctx.sh が見つからない" && ok "T31b spark-ctx 欠落は NG（必須の実行経路）" || bad "T31b" "rc=$rc out=$out"

if command -v codex >/dev/null 2>&1; then
  printf 'garbage(\n' > "$WORK/existing.rules"; cp "$WORK/existing.rules" "$WORK/keep.rules"
  out=$(SPARK_AGENT_CODEX_RULES="$WORK/keep.rules" SPARK_AGENT_BREAK_RULES=1 bash "$SCRIPTS/install-codex-rules.sh" --yes 2>&1); rc=$?
  cmp -s "$WORK/existing.rules" "$WORK/keep.rules" && [ "$rc" -eq 1 ] && echo "$out" | grep -q "変更していません" \
    && ok "T35b 生成物の検証に失敗したら既存 rules を保持して非ゼロ終了" || bad "T35b" "rc=$rc out=$out"
  out=$(SPARK_AGENT_CODEX_RULES="$WORK/none.rules" bash "$DOC" 2>&1); rc=$?
  echo "$out" | grep -q "WARN: Codex rules が未導入" && ok "T34 Codex rules 未導入は WARN" || bad "T34" "out=$out"
  out=$(SPARK_AGENT_CODEX_RULES="$WORK/gen.rules" bash "$SCRIPTS/install-codex-rules.sh" 2>&1); rc=$?
  [ "$rc" -eq 2 ] && [ ! -f "$WORK/gen.rules" ] && echo "$out" | grep -q "承認を得てから --yes" \
    && ok "T35a install-codex-rules は --yes なしでは書かず要約だけ出す" || bad "T35a" "rc=$rc out=$out"
  out=$(SPARK_AGENT_CODEX_RULES="$WORK/gen.rules" bash "$SCRIPTS/install-codex-rules.sh" --yes 2>&1); rc=$?
  [ "$rc" -eq 0 ] && grep -q 'pattern = \["spark", READ\]' "$WORK/gen.rules" && grep -q "$SCRIPTS/spark-ctx.sh" "$WORK/gen.rules" \
    && ok "T35 install-codex-rules --yes が rules を生成し execpolicy check を通る" || bad "T35" "rc=$rc out=$out"
  dec=$(codex execpolicy check --rules "$WORK/gen.rules" -- spark accounts 2>/dev/null)
  echo "$dec" | grep -q '"allow"' && ok "T36 rules: spark accounts は allow" || bad "T36" "$dec"
  dec=$(codex execpolicy check --rules "$WORK/gen.rules" -- spark action send 1 2>/dev/null)
  echo "$dec" | grep -q '"prompt"' && ok "T37 rules: spark action send は prompt" || bad "T37" "$dec"
  dec=$(codex execpolicy check --rules "$WORK/gen.rules" -- bash "$SCRIPTS/spark-ctx.sh" run emails --filter "is:unread" 2>/dev/null)
  echo "$dec" | grep -q '"prompt"' && ok "T38 rules: spark-ctx run emails は既定 prompt（スクリプト書き換えによる脱出を防ぐ）" || bad "T38" "$dec"
  SPARK_AGENT_CODEX_RULES="$WORK/gen2.rules" bash "$SCRIPTS/install-codex-rules.sh" --yes --allow-scripts >/dev/null 2>&1
  dec=$(codex execpolicy check --rules "$WORK/gen2.rules" -- bash "$SCRIPTS/spark-ctx.sh" run emails --filter "is:unread" 2>/dev/null)
  echo "$dec" | grep -q '"allow"' && ok "T38b rules: --allow-scripts なら spark-ctx run emails は allow" || bad "T38b" "$dec"
  dec=$(codex execpolicy check --rules "$WORK/gen.rules" -- bash "$SCRIPTS/spark-ctx.sh" run --confirm event create --title T 2>/dev/null)
  echo "$dec" | grep -q '"prompt"' && ok "T39 rules: spark-ctx run --confirm event は prompt" || bad "T39" "$dec"
else
  echo "SKIP: T34-T39 codex 未導入"
fi

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
