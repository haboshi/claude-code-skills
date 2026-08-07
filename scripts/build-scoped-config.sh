#!/usr/bin/env bash
# 契約専用の最小 AWS config を配置し、消毒すべき環境変数名を提供する
# usage: build-scoped-config.sh <contract-dir> <contract-id>
#        build-scoped-config.sh --list-unset
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/harness-lib.sh"

# 契約以外の Identity へ到達しうる、または STS 照合を偽装しうる変数
scoped_env_unset_list() {
  cat <<'EOF'
AWS_PROFILE
AWS_DEFAULT_PROFILE
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
AWS_SECURITY_TOKEN
AWS_CREDENTIAL_EXPIRATION
AWS_ENDPOINT_URL
AWS_ENDPOINT_URL_STS
AWS_CA_BUNDLE
AWS_CONFIG_FILE
AWS_SHARED_CREDENTIALS_FILE
AWS_WEB_IDENTITY_TOKEN_FILE
AWS_ROLE_ARN
AWS_ROLE_SESSION_NAME
AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
AWS_CONTAINER_CREDENTIALS_FULL_URI
AWS_CONTAINER_AUTHORIZATION_TOKEN
AWS_EC2_METADATA_SERVICE_ENDPOINT
EOF
}

if [ "${1:-}" = "--list-unset" ]; then
  scoped_env_unset_list
  exit 0
fi

cdir="${1:-}"
cid="${2:-}"
[ -n "$cdir" ] && [ -n "$cid" ] || { harness_err "usage: build-scoped-config.sh <contract-dir> <contract-id>"; exit 3; }
valid_contract_id "$cid" || { harness_err "不正な契約IDです"; exit 3; }
[ -f "$cdir/aws-config" ] || { harness_err "契約に aws-config がありません"; exit 3; }

rt="$(harness_home)/runtime/$cid"
mkdir -p "$rt" || { harness_err "runtime ディレクトリを作成できません"; exit 3; }
chmod 700 "$rt" || { harness_err "runtime ディレクトリの権限を設定できません"; exit 3; }

out="$rt/config"
umask 077
cp "$cdir/aws-config" "$out" || { harness_err "config を配置できません"; exit 3; }
chmod 600 "$out" || { harness_err "config の権限を設定できません"; exit 3; }

# 空の credentials ファイル（共有 credentials を参照させないため）
: > "$rt/credentials" || { harness_err "credentials プレースホルダを作成できません"; exit 3; }
chmod 600 "$rt/credentials" || { harness_err "credentials の権限を設定できません"; exit 3; }

printf '%s\n' "$out"
