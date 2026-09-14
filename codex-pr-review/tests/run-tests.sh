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
echo "=== Codex Push Review (fake) ==="
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

echo "T5: draft PR はスキップ"
mkrepo r5 >/dev/null 2>&1
OUT=$(HOME="${FAKE_HOME}" TOOL_INPUT='gh pr create --draft' bash "${HOOK}" 2>&1)
[ -z "$OUT" ] && ok "draft では走らない" || ng "draft でも走った" "$OUT"

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
