#!/usr/bin/env bash
# aws-harness 合流点 shim
# 契約のあるリポジトリでは Identity を固定してから実 CLI を exec する
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/harness-lib.sh"

real_cli="${AWS_HARNESS_REAL_CLI:-$HOME/.local/bin/claude}"

exec_real() {
  [ -x "$real_cli" ] || { harness_err "Agent CLI が見つかりません: $real_cli"; exit 3; }
  exec "$real_cli" "$@"
}

# 再帰防止: 既に shim を通っていれば検証済みとして素通しする
if [ -n "${AWS_HARNESS_LAUNCHED:-}" ]; then
  exec_real "$@"
fi

# リポジトリルートを求める（git 外なら現在地）
repo=$(git rev-parse --show-toplevel 2>/dev/null) || repo="$PWD"
[ -n "$repo" ] || repo="$PWD"

resolved=$("$SCRIPT_DIR/resolve-contract.sh" "$repo") || exit 3

case "$resolved" in
  PASSTHROUGH)
    exec_real "$@"
    ;;
  "RESOLVED "*)
    cdir="${resolved#RESOLVED }"
    ;;
  *)
    harness_err "契約解決の結果を解釈できません"
    exit 3
    ;;
esac

cid=$(basename "$cdir")
profile=$(jq -r '.aws.credential.profile' "$cdir/contract.json")
region=$(jq -r '.aws.region' "$cdir/contract.json")
provider=$(jq -r '.aws.credential.provider' "$cdir/contract.json")

if [ "$provider" != "aws-vault" ]; then
  harness_err "未対応の credential provider です: $provider"
  exit 3
fi
command -v aws-vault >/dev/null 2>&1 || { harness_err "aws-vault が必要です"; exit 3; }

# 1) 消毒（照合の前に行う。照合そのものの偽装を防ぐため）
# リストが取れない・空のときに黙って 0 回転させない（消毒なしで起動するのを防ぐ）
unset_list=$("$SCRIPT_DIR/build-scoped-config.sh" --list-unset) \
  || { harness_err "消毒リストを取得できません"; exit 3; }
[ -n "$unset_list" ] || { harness_err "消毒リストが空です"; exit 3; }
for v in $unset_list; do
  unset "$v" 2>/dev/null || true
done

# 2) 契約専用の最小 config を配置して固定
scoped=$("$SCRIPT_DIR/build-scoped-config.sh" "$cdir" "$cid") || exit 3
AWS_CONFIG_FILE="$scoped"
AWS_SHARED_CREDENTIALS_FILE="$(dirname "$scoped")/credentials"
AWS_REGION="$region"
AWS_DEFAULT_REGION="$region"
export AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE AWS_REGION AWS_DEFAULT_REGION

# 3) credential を取得した内側で照合し、通れば実 CLI を exec する
AWS_HARNESS_CONTRACT_ID="$cid"
AWS_HARNESS_LAUNCHED=1
export AWS_HARNESS_CONTRACT_ID AWS_HARNESS_LAUNCHED
export AWS_HARNESS_SCRIPT_DIR="$SCRIPT_DIR"
export AWS_HARNESS_CONTRACT_DIR="$cdir"
export AWS_HARNESS_REAL_CLI="$real_cli"

# credential 取得の事前確認。
# bash の exec ビルトインは子プロセスの終了コードをそのまま呼び出し元の終了コードにしてしまうため、
# 「aws-vault exec」を直接 exec すると credential 取得失敗時に aws-vault 自身の終了コード（例: 1）が
# そのまま漏れ、本ハーネスの「拒否は exit 3」という契約が崩れる。
# ここで先に取得可否だけを確認し、失敗を exit 3 に正規化してから、成功時のみ本番の exec に進む。
aws-vault exec "$profile" -- true \
  || { harness_err "credential を取得できません（aws-vault）"; exit 3; }

exec aws-vault exec "$profile" -- "$SCRIPT_DIR/harness-verify-then-exec.sh" "$@"
