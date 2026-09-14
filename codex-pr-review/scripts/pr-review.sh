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
  # 開いたままの stdin で止まると PreToolUse フックが PR 作成ごと固める。
  # 取れなくても後段の生文字列判定で draft を拾えるようにする。
  if command -v timeout >/dev/null 2>&1; then
    HOOK_INPUT=$(timeout 5 head -c 262144 2>/dev/null || true)
  elif command -v gtimeout >/dev/null 2>&1; then
    HOOK_INPUT=$(gtimeout 5 head -c 262144 2>/dev/null || true)
  else
    HOOK_INPUT=$(head -c 262144 2>/dev/null || true)
  fi
fi
GH_CMD=""
PARSED=0
if [ -n "${HOOK_INPUT}" ] && command -v jq >/dev/null 2>&1; then
  GH_CMD=$(printf '%s' "${HOOK_INPUT}" | jq -r '.tool_input.command // ""' 2>/dev/null || true)
  [ -n "${GH_CMD}" ] && PARSED=1
fi
# jq が無い環境で JSON を解けないと draft ガードが黙って死ぬ。
# その場合は生の入力をそのまま判定対象にする。JSON の中では --draft が引用符に
# 隣接するため、空白区切りではなく「英数字・ハイフン・下線以外」を境界に使う。
[ -n "${GH_CMD}" ] || GH_CMD="${HOOK_INPUT}"
[ -n "${GH_CMD}" ] || GH_CMD="${TOOL_INPUT:-}"

# codex-bridge 未導入なら無音でスキップ（このプラグイン単体では何もしない）
[ -x "$REVIEW" ] || exit 0
command -v codex >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# draft の PR は検収前なのでスキップする。
# --draft は生 JSON でも拾えるよう、英数字以外を境界として扱う。
if printf '%s' "${GH_CMD}" | grep -qE -- '(^|[^A-Za-z0-9_-])--draft([^A-Za-z0-9_-]|$)'; then
  exit 0
fi
# 短縮形の -d は誤検知しやすいので、コマンド文字列を正しく取り出せたときだけ見る。
if [ "${PARSED}" = "1" ] && printf '%s' "${GH_CMD}" | grep -qE -- '(^| )-d( |$)'; then
  exit 0
fi

# 注意: 実行コマンドを特定できなかった場合はレビューを実行する。
# draft の判定は「検収前の PR に無駄なレビューを走らせない」ためのコスト最適化であって、
# 送信可否の制御ではない。送信可否は下の無効化設定が決めており、そちらは stdin に依存しない。
# ここで「判定できないから走らない」に倒すと、手動実行や stdin を持たない呼び出しが
# 静かに何もしなくなり、PR 検収のレビューが存在しないのに存在するように見える。

# リポジトリ単位の無効化。差分を外部へ送るので、拒否できる口を必ず用意する。
# 「無効化したつもりが効いていない」が一番まずいので、判定は緩く・迷ったら送らない。
# 有効と見なすのは 1 / true / yes / on のみ。それ以外の値は無効扱いにする。
cbr_pr_enabled() {
  local v
  v=$(printf '%s' "${1:-}" | tr 'A-Z' 'a-z' | tr -d '[:space:]')
  case "$v" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if [ -n "${CODEX_PR_REVIEW+x}" ] && ! cbr_pr_enabled "${CODEX_PR_REVIEW}"; then
  exit 0
fi
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
LIMITS="${ROOT:+${ROOT}/.claude/codex-review-limits}"
if [ -n "${LIMITS}" ] && [ -f "${LIMITS}" ]; then
  # 設定ファイルがあるのに読めないときは送らない。
  # 読めないことを「指定なし＝送ってよい」と解釈すると、無効化したつもりの
  # リポジトリから差分が出ていく。判断できないなら送らない側へ倒す。
  if [ ! -r "${LIMITS}" ]; then
    exit 0
  fi
  # 行末コメントや空白、= の前後の空白を許容する。書き方の揺れで送信が続くのを防ぐ。
  RAW=$(grep -E '^[[:space:]]*CBR_PR_REVIEW[[:space:]]*=' "${LIMITS}" 2>/dev/null | tail -1 | sed 's/^[^=]*=//; s/#.*//')
  if [ -n "${RAW}" ] && ! cbr_pr_enabled "${RAW}"; then
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
# 完了の印は「=== Codex Push Review (<範囲>) ===」という見出しだけ。
# スキップ時の見出しは「Codex Push Review: スキップ」で、これを完了と読むと
# 一度も見ていない HEAD が検収を通る。括弧付きの形だけを完了と見なす。
if printf '%s' "${OUT}" | grep -q 'Codex Push Review ('; then
  mkdir -p "$STATE_DIR" 2>/dev/null || true
  printf '%s\n' "$HEAD_SHA" > "$MARKER" 2>/dev/null || true
else
  echo "（レビューが完了しなかったため PR レビュー済みとして記録しません）"
fi

exit 0
