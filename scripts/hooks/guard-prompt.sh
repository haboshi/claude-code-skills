#!/usr/bin/env bash
# UserPromptSubmit: 保護対象で Identity が契約と食い違っていたらプロンプトを止める
# SessionStart はブロックできないため、実効的な停止はここで行う
#
# 2つのことを検出する:
#   1. shim を経ずに起動された（保護対象なのに契約 ID が立っていない）
#   2. セッション中に Identity が契約と食い違った
set -u

# 自身のディレクトリを解決する。dirname(1) は外部コマンドで PATH に依存するため使わず、
# bash 組込みのパラメータ展開だけで求める（PATH が壊れた環境でも hook-lib.sh を
# 読み込めるようにするため。cd/pwd はどちらもシェル組込みで PATH に依存しない）。
case "$0" in
  */*) HOOK_DIR=$(cd "${0%/*}" && pwd) ;;
  *)   HOOK_DIR=$(pwd) ;;
esac
. "$HOOK_DIR/hook-lib.sh"

hook_read_input                 # HOOK_INPUT に代入（サブシェルにしない）
hook_project_dir                # HOOK_PROJECT_DIR に代入

# 保護対象でなければ干渉しない
[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

# 検出1: 保護対象なのに shim を経ていない
[ -n "${AWS_HARNESS_CONTRACT_ID:-}" ] \
  || deny "このリポジトリは契約を必須としていますが、aws-harness の shim を経ずに起動されています。セッションを終了し、shim 経由で起動し直してください"

# 検出2: Identity が契約と食い違っていないか
script_dir="${AWS_HARNESS_SCRIPT_DIR:-}"
[ -n "$script_dir" ] || script_dir="${CLAUDE_PLUGIN_ROOT:-}/scripts"
cdir="${AWS_HARNESS_CONTRACT_DIR:-}"

[ -n "$cdir" ] || deny "契約の場所が分かりません（セッションを終了して起動し直してください）"
[ -x "$script_dir/verify-identity.sh" ] || deny "照合スクリプトが見つかりません"

"$script_dir/verify-identity.sh" "$cdir" >/dev/null 2>&1 \
  || deny "現在の AWS Identity が契約と一致しません。セッションを終了して起動し直してください"

exit 0
