#!/usr/bin/env bash
# PreToolUse(Bash): 保護対象リポジトリでの Identity 変更操作を deny する
# 検出であって境界ではない（境界は IAM と実行環境の隔離が担う）
#
# 保護対象かどうかは「cwd に .aws-harness があるか」で判定する。
# shim が export する環境変数に依存しないため、shim を経ない起動でも作動する。
# 入力の読み取り・保護対象の判定は hook-lib.sh に集約（3フックで共通）
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

# 保護対象でなければ一切干渉しない（依存が無くてもここで抜ける）
[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

# ここから先は保護対象。判断できない状態はすべて deny に倒す
hook_require_jq "Bash の検査"

printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 || deny "フック入力が JSON ではありません"
cmd=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) \
  || deny "フック入力を解析できません"

# コマンドが空なら検査対象なし
[ -n "$cmd" ] || exit 0

case "$cmd" in
  *"--profile"*)                 deny "契約セッションでは profile の切り替えを禁止しています" ;;
  *"AWS_PROFILE="*)              deny "契約セッションでは AWS_PROFILE の設定を禁止しています" ;;
  *"AWS_CONFIG_FILE="*|*"AWS_SHARED_CREDENTIALS_FILE="*)
                                 deny "契約セッションでは AWS 設定ファイルの差し替えを禁止しています" ;;
  *"AWS_ENDPOINT_URL"*)          deny "契約セッションでは AWS エンドポイントの変更を禁止しています" ;;
  *"aws configure"*)             deny "契約セッションでは aws configure を禁止しています" ;;
  *"aws sso login"*|*"aws login"*) deny "契約セッションでは別 Identity のログインを禁止しています" ;;
  *"aws-vault"*)                 deny "契約セッションでは aws-vault の直接実行を禁止しています" ;;
  *".aws/credentials"*|*".aws/config"*|*".aws/sso"*)
                                 deny "契約セッションでは AWS 認証設定への直接アクセスを禁止しています" ;;
  *"claude "*|*"claude-"*)       deny "Agent CLI は aws-harness の shim 経由で起動してください" ;;
esac

exit 0
