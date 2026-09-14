#!/bin/bash
# codex-pr-review v0.1.0: PR 作成時にブランチ全差分の Codex レビューを一度だけ走らせる。
#
# 背景: codex-bridge の自動レビューは commit/push ごとの「増分」しか見ない。
# 実績評価（レビュー153件・76.3M トークン）の推奨1「全体レビューは PR の検収時を基本にする」に対し、
# 増分化までは codex-bridge 側で入れたが、PR 時点の横断レビューは手動のままだった。
# ~/.claude/settings.json は secret-leak-guard が読み書きとも拒否するため、
# プラグインのフック宣言として配線する（保護された設定に触れない正規の経路）。
#
# 非ブロッキング: 何があっても exit 0。PR 作成は止めない。
set -uo pipefail

REVIEW="$HOME/.claude/skills/codex-bridge/scripts/codex-push-review.sh"

# codex-bridge 未導入なら無音でスキップ（このプラグイン単体では何もしない）
[ -x "$REVIEW" ] || exit 0
command -v codex >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# --draft の PR は検収前なのでスキップする。
# 注意: 配線側が stdin JSON を消費するため TOOL_INPUT は基本 export されない。
# 単体実行時の防御として残す。
if printf '%s' "${TOOL_INPUT:-}" | grep -qE -- '--draft'; then
  exit 0
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
bash "$REVIEW" --full 2>&1 || true

mkdir -p "$STATE_DIR" 2>/dev/null || true
printf '%s\n' "$HEAD_SHA" > "$MARKER" 2>/dev/null || true

exit 0
