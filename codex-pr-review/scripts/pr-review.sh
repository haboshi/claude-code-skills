#!/bin/bash
# codex-pr-review v0.2.0: PR 作成時にブランチ全差分の Codex レビューを一度だけ走らせる。
#
# 背景: codex-bridge の自動レビューは commit/push ごとの「増分」しか見ない。
# 実績評価（レビュー153件・76.3M トークン）の推奨1「全体レビューは PR の検収時を基本にする」に対し、
# 増分化までは codex-bridge 側で入れたが、PR 時点の横断レビューは手動のままだった。
# グローバルのユーザー設定ファイルは secret-leak-guard が読み書きとも拒否するため、
# プラグインのフック宣言として配線する（保護された設定に触れない正規の経路）。
#
# **データの送信について**: このフックはブランチ全差分を外部モデル（Codex）へ送る。
# 機密リポジトリで走らせたくない場合は、リポジトリ直下に次のいずれかを置いて無効化する。
#   .claude/codex-review-limits に `CBR_PR_REVIEW=0`
#   環境変数 CODEX_PR_REVIEW=0
#
# 非ブロッキング: 何があっても exit 0。PR 作成は止めない。
set -uo pipefail

REVIEW="$HOME/.claude/skills/codex-bridge/scripts/codex-push-review.sh"

# フックの stdin には tool_input の JSON が来る。--draft の判定に使うので先に読む
# （読まないと判定できない。TOOL_INPUT 環境変数は配線側で export されないため当てにしない）。
HOOK_INPUT=""
if [ ! -t 0 ]; then
  HOOK_INPUT=$(cat 2>/dev/null || true)
fi
GH_CMD=""
if [ -n "${HOOK_INPUT}" ] && command -v jq >/dev/null 2>&1; then
  GH_CMD=$(printf '%s' "${HOOK_INPUT}" | jq -r '.tool_input.command // ""' 2>/dev/null || true)
fi
[ -n "${GH_CMD}" ] || GH_CMD="${TOOL_INPUT:-}"

# codex-bridge 未導入なら無音でスキップ（このプラグイン単体では何もしない）
[ -x "$REVIEW" ] || exit 0
command -v codex >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# draft の PR は検収前なのでスキップする
if printf '%s' "${GH_CMD}" | grep -qE -- '(^| )(-d|--draft)( |$)'; then
  exit 0
fi

# リポジトリ単位の無効化。差分を外部へ送るので、拒否できる口を必ず用意する。
if [ "${CODEX_PR_REVIEW:-1}" = "0" ]; then
  exit 0
fi
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "${ROOT}" ] && [ -f "${ROOT}/.claude/codex-review-limits" ]; then
  if grep -qE '^CBR_PR_REVIEW=0[[:space:]]*$' "${ROOT}/.claude/codex-review-limits" 2>/dev/null; then
    exit 0
  fi
fi

# 同じ HEAD に対して二度走らせない（PR 作成をやり直したときの重複消費を防ぐ）
STATE_DIR="$(git rev-parse --git-dir 2>/dev/null)/codex-bridge"
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0
MARKER="${STATE_DIR}/pr-reviewed-$(git branch --show-current 2>/dev/null | tr '/ ' '__' | tr -cd 'A-Za-z0-9._-')"
if [ -f "$MARKER" ] && [ "$(head -1 "$MARKER" 2>/dev/null)" = "$HEAD_SHA" ]; then
  echo ""
  echo "=== Codex PR Review: スキップ（この HEAD は PR レビュー済み）==="
  exit 0
fi

echo ""
echo "=== Codex PR Review: ブランチ全差分をレビューします ==="
OUT=$(bash "$REVIEW" --full 2>&1 || true)
printf '%s\n' "${OUT}"

# レビューが完了したときだけ「PR レビュー済み」にする。
# 時間切れ・エラーで印を付けると、その HEAD は二度とレビューされないまま
# 検収を通ってしまう（未検証を検証済みとして記録することになる）。
if printf '%s' "${OUT}" | grep -q "未完了"; then
  echo "（未完了のため PR レビュー済みとして記録しません。範囲を絞って再実行してください）"
elif printf '%s' "${OUT}" | grep -q "Codex Push Review"; then
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  printf '%s\n' "$HEAD_SHA" > "$MARKER" 2>/dev/null || true
fi

exit 0
