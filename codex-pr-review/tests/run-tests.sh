#!/bin/bash
# codex-pr-review: フックの分岐を実モデルなしで検証する。
#   bash codex-pr-review/tests/run-tests.sh
set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUG="$(cd "${TESTS_DIR}/.." && pwd)"
HOOK="${PLUG}/scripts/pr-review.sh"

PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
ng() { FAIL=$((FAIL+1)); printf '  NG   %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }
have() { printf '%s' "$1" | grep -qF -- "$2"; }

WORK=$(cd "$(mktemp -d)" && pwd -P)
BIN="${WORK}/bin"; mkdir -p "${BIN}"

# 偽 codex（存在確認を通すだけ）
printf '#!/bin/bash\nexit 0\n' > "${BIN}/codex"; chmod +x "${BIN}/codex"
# 偽 codex-bridge（呼ばれたことを記録する）
FAKE_HOME="${WORK}/home"
mkdir -p "${FAKE_HOME}/.claude/skills/codex-bridge/scripts"
cat > "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh" <<'EOS'
#!/bin/bash
printf '%s\n' "$*" >> "${CBR_FAKE_LOG}"
echo "=== Codex Push Review (fake...range) ==="
EOS
chmod +x "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh"
export PATH="${BIN}:${PATH}"
export CBR_FAKE_LOG="${WORK}/calls.log"
: > "${CBR_FAKE_LOG}"

mkrepo() {
  R="${WORK}/$1"; rm -rf "$R"; git init -q "$R"
  cd "$R" || return 1
  git config user.email t@t.t; git config user.name T
  echo a > f.txt; git add -A; git commit -qm init
  git checkout -q -b feature
  echo b >> f.txt; git add -A; git commit -qm change
}

echo "=== codex-pr-review テスト ==="

echo "T1: PR 作成時に全差分レビューを呼ぶ"
mkrepo r1 >/dev/null 2>&1
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "ブランチ全差分をレビュー" && ok "レビューを起動する" || ng "起動しない" "$OUT"
have "$(cat "${CBR_FAKE_LOG}")" "--full" && ok "--full で呼ぶ" || ng "--full が渡っていない" "$(cat "${CBR_FAKE_LOG}")"

echo "T2: 同じ HEAD では二度走らせない"
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "スキップ" && ok "重複実行を止める" || ng "重複して走る" "$OUT"
[ "$(grep -c -- "--full" "${CBR_FAKE_LOG}")" = "1" ] && ok "呼び出しは 1 回だけ" || ng "複数回呼ばれた"

echo "T3: 新しいコミットがあれば再度走る"
echo c >> f.txt; git add -A; git commit -qm more
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "ブランチ全差分をレビュー" && ok "HEAD が進めば再実行する" || ng "再実行しない" "$OUT"

echo "T4: codex-bridge 未導入なら無音"
mkrepo r4 >/dev/null 2>&1
OUT=$(HOME="${WORK}/empty-home" bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "無音でスキップする" || ng "未導入でも何か出力した" "$OUT"

echo "T5: draft PR はスキップ（判定は stdin の JSON から行う）"
mkrepo r5 >/dev/null 2>&1
# 配線側は TOOL_INPUT を export しない。stdin の JSON で判定できなければ draft ガードは死んでいる。
OUT=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"gh pr create --draft --title x"}}' | HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "stdin の --draft を見てスキップする" || ng "draft でも走った" "$OUT"
OUT=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"gh pr create --title x"}}' | HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "ブランチ全差分をレビュー" && ok "draft でなければ走る" || ng "通常の PR で走らない" "$OUT"

echo "T5b: リポジトリ単位で無効化できる（差分を外部へ送らない選択肢）"
mkrepo r5b >/dev/null 2>&1
OUT=$(HOME="${FAKE_HOME}" CODEX_PR_REVIEW=0 bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "環境変数で無効化できる" || ng "無効化が効かない" "$OUT"
mkdir -p .claude; echo 'CBR_PR_REVIEW=0' > .claude/codex-review-limits
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "リポジトリ設定で無効化できる" || ng "リポジトリ設定が効かない" "$OUT"

echo "T5c: 未完了のレビューを『PR レビュー済み』にしない"
mkrepo r5c >/dev/null 2>&1
cat > "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh" <<'EOS'
#!/bin/bash
echo "=== Codex Push Review: 未完了（時間切れ）==="
EOS
chmod +x "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh"
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "記録しません" && ok "未完了は記録しないと明示する" || ng "未完了を黙って記録した" "$OUT"
OUT2=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT2" "スキップ" && ng "未完了なのに次回スキップされた" "$OUT2" || ok "次回もレビューを試みる"
# 偽スクリプトを元に戻す
cat > "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh" <<'EOS'
#!/bin/bash
printf '%s\n' "$*" >> "${CBR_FAKE_LOG}"
echo "=== Codex Push Review (fake...range) ==="
EOS
chmod +x "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh"

echo "T5d: 無効化の書き方の揺れを拾う（効いたつもりで送るのを防ぐ）"
for v in "0" "false" "no" "off" "0  # 機密リポジトリ" " 0 "; do
  mkrepo r5d >/dev/null 2>&1
  mkdir -p .claude; printf 'CBR_PR_REVIEW=%s\n' "$v" > .claude/codex-review-limits
  OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
  [ -z "$OUT" ] || { ng "T5d" "「${v}」で無効化できない: $OUT"; break; }
done
[ -z "$OUT" ] && ok "0 / false / no / off / 行末コメント / 空白を無効化と読む"
mkrepo r5d2 >/dev/null 2>&1
mkdir -p .claude; echo 'CBR_PR_REVIEW=1' > .claude/codex-review-limits
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "ブランチ全差分をレビュー" && ok "1 のときは走る" || ng "1 でも走らない" "$OUT"

echo "T5e: jq が無くても draft ガードが死なない"
mkrepo r5e >/dev/null 2>&1
NOJQ="${WORK}/nojq"; mkdir -p "$NOJQ"
for c in git grep sed tr head cut basename dirname mkdir printf cat bash timeout codex shasum awk wc; do
  src=$(command -v "$c" 2>/dev/null) && ln -sf "$src" "$NOJQ/$c" 2>/dev/null
done
OUT=$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"gh pr create --draft"}}' | PATH="$NOJQ" HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "jq 不在でも draft をスキップする" || ng "jq 不在で draft が素通り" "$OUT"

echo "T5f: スキップを完了と読み違えない"
mkrepo r5f >/dev/null 2>&1
cat > "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh" <<'EOS'
#!/bin/bash
echo "=== Codex Push Review: スキップ（差分が大きすぎる）==="
EOS
chmod +x "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh"
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT" "記録しません" && ok "スキップを完了扱いしない" || ng "スキップを完了として記録した" "$OUT"
OUT2=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
have "$OUT2" "スキップ（この HEAD は PR レビュー済み）" && ng "一度も見ていない HEAD が検収を通る" "$OUT2" || ok "次回もレビューを試みる"
cat > "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh" <<'EOS'
#!/bin/bash
printf '%s\n' "$*" >> "${CBR_FAKE_LOG}"
echo "=== Codex Push Review (fake...range) ==="
EOS
chmod +x "${FAKE_HOME}/.claude/skills/codex-bridge/scripts/codex-push-review.sh"

echo "T6: git リポジトリ外では無音"
mkdir -p "${WORK}/notrepo"; cd "${WORK}/notrepo"
OUT=$(HOME="${FAKE_HOME}" bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "リポジトリ外では走らない" || ng "リポジトリ外で走った" "$OUT"

echo "T7: 常に exit 0（PR 作成を止めない）"
cd "${WORK}/r1" 2>/dev/null || cd "${WORK}"
HOME="${FAKE_HOME}" bash "${HOOK}" >/dev/null 2>&1 && ok "非ブロッキング" || ng "非ゼロで終了した"

cd / || true
rm -rf "${WORK}"
echo ""
echo "=== 結果: PASS ${PASS} / FAIL ${FAIL} ==="
[ "${FAIL}" -eq 0 ]
