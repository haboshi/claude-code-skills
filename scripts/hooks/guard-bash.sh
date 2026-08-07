#!/usr/bin/env bash
# PreToolUse(Bash): 保護対象リポジトリでの Identity 変更操作を deny する
# 検出であって境界ではない（境界は IAM と実行環境の隔離が担う）
#
# 保護対象かどうかは「cwd に .aws-harness があるか」で判定する。
# shim が export する環境変数に依存しないため、shim を経ない起動でも作動する。
set -u

deny() { printf 'aws-harness: %s\n' "$1" >&2; exit 2; }

# 標準入力の読み取りは外部コマンド（cat）に依存せず bash 組込みの read だけで行う。
# jq や PATH が壊れた環境でも「保護対象でなければ素通しする」を成立させるため。
input=""
IFS= read -r -d '' input

# 0バイト入力は「JSON 破損」と違い jq が rc=0/空文字で通してしまうため .cwd 抽出の
# 成否だけでは検知できない。入力自体が読めない状態は保護対象かどうかも判定できない
# 「想定外入力」として、保護対象・非保護対象を問わず一律 deny する（安全側に倒す）。
[ -n "$input" ] || deny "フック入力が空です"

# 作業ディレクトリの決定（jq を使わずに済む経路を先に試す）
proj="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$proj" ] && command -v jq >/dev/null 2>&1; then
  # cwd 欠落（空文字）は正常系として $PWD へフォールバックする一方、
  # JSON 自体が壊れていて jq が解釈できない場合はフォールバックせず即座に deny する
  # （「想定外入力は必ず exit 2」の原則。cwd を特定できないまま $PWD を信用しない）。
  proj=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null) \
    || deny "フック入力を解析できません"
fi
[ -n "$proj" ] || proj="$PWD"

# 保護対象でなければ一切干渉しない（依存が無くてもここで抜ける）
[ -f "$proj/.aws-harness" ] || exit 0

# ここから先は保護対象。判断できない状態はすべて deny に倒す
command -v jq >/dev/null 2>&1 || deny "jq が無いため Bash の検査ができません"

printf '%s' "$input" | jq -e . >/dev/null 2>&1 || deny "フック入力が JSON ではありません"
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) \
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
