#!/usr/bin/env bash
#
# secret-scan.sh — PreToolUse 決定論ゲートの最小例（系統A / 短期ロードマップ）
#
# Claude Code の PreToolUse hook（matcher: "Edit|Write"）から command 型で呼ばれ、
# 標準入力の JSON ペイロード（tool_input を含む）に危険パターンが無いか検査する。
# 検出したら理由を stderr に出して exit 2（＝ツール実行をブロック）、無ければ exit 0。
#
# 位置づけ: 決定論・高頻度・block 可の層。合成カスケードの段1に相当する
# （03章「合成カスケード」段1 / 06章「系統A hooks 3層」の PreToolUse）。
#
# 誤検知しやすい点（運用前に必ず読むこと）:
#   - この最小例は jq を使わず、標準入力の生ペイロード全体を grep する。実運用では
#     tool_input を jq でパースし、file_path やコマンド文字列に対象を絞ること。
#   - テストフィクスチャやドキュメントに含まれるダミーの秘密情報
#     （例: api_key = "XXXX..." のサンプル）も検出しうる。test/ や fixtures/ 配下の
#     除外、allowlist の付与は運用に合わせて足すこと。
#   - 秘密情報の実値・作業端末の絶対パスはこのスクリプトに一切書かない
#     （下記コメントの XXXX はすべてプレースホルダ）。
#
set -euo pipefail

# --- 定数（危険パターン・終了コードを一箇所に集約） --------------------------

# hook がブロックする際の終了コード（Claude Code 規約: 2 で block, stderr を提示）
readonly EXIT_BLOCK=2

# 秘密情報らしき代入: (api_key|secret|token|password) [:=] "16文字以上の英数記号"
# 例（プレースホルダ）: api_key = "XXXXXXXXXXXXXXXXXXXX"
readonly SECRET_ASSIGNMENT="(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9_-]{16,}"

# 破壊的・不可逆なコマンド（\s は移植性のため [[:space:]] で表記）。
# 終端クラス [[:space:]"] は JSON 文字列の閉じ引用符 " も境界として許容する。
# rm パターンは絶対/ホームパス（/ ・/* ・~）への削除を保守的に検出する（誤検知より安全側）。
readonly DANGEROUS_COMMANDS=(
  'rm[[:space:]]+-[A-Za-z]*[rf][A-Za-z]*[[:space:]]+[/~]'             # rm -rf / , rm -rf /* , rm -rf ~ 等
  'git[[:space:]]+push[[:space:]]+.*--force'                         # git push --force[-with-lease]
  'git[[:space:]]+push[[:space:]]+(.*[[:space:]])?-f([[:space:]"]|$)' # git push -f （短縮形。トークン境界の -f のみ）
)

# --- 検査 --------------------------------------------------------------------

# 標準入力（hook ペイロード）を一括で読む。空入力でも空文字列となり exit 0 で通す。
payload="$(cat)"

# 理由を stderr に出してブロック終了する。$1 は次ターンのガイダンスとして使われる。
block() {
  echo "secret-scan: blocked — $1" >&2
  exit "$EXIT_BLOCK"
}

if grep -qiE "$SECRET_ASSIGNMENT" <<<"$payload"; then
  block "秘密情報らしき代入を検出（api_key/secret/token/password への長い文字列リテラル）。環境変数・シークレットストア経由へ変更してください。"
fi

for pattern in "${DANGEROUS_COMMANDS[@]}"; do
  if grep -qiE "$pattern" <<<"$payload"; then
    block "破壊的コマンドの疑い（パターン: ${pattern}）。実行前に対象と影響範囲を確認してください。"
  fi
done

exit 0
