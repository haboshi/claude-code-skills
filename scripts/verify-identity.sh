#!/usr/bin/env bash
# STS の実測 Identity を契約の期待値と照合する
# usage: verify-identity.sh <contract-dir>
# exit: 0=一致 / 3=不一致・取得失敗
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/harness-lib.sh"

cdir="${1:-}"
[ -f "$cdir/contract.json" ] || { harness_err "契約が見つかりません"; exit 3; }
command -v jq >/dev/null 2>&1 || { harness_err "jq が必要です"; exit 3; }
command -v aws >/dev/null 2>&1 || { harness_err "aws CLI が必要です"; exit 3; }

want_acct=$(jq -r '.aws.account_id' "$cdir/contract.json")
want_arn=$(jq -r '.aws.expected_principal.arn_prefix' "$cdir/contract.json")

ident=$(aws sts get-caller-identity --output json 2>/dev/null) || {
  harness_err "AWS の認証情報を取得できません（再認証が必要です）"
  exit 3
}

got_acct=$(printf '%s' "$ident" | jq -r '.Account // empty')
got_arn=$(printf '%s' "$ident" | jq -r '.Arn // empty')

if [ -z "$got_acct" ] || [ -z "$got_arn" ]; then
  harness_err "STS の応答を解析できません"
  exit 3
fi

if [ "$got_acct" != "$want_acct" ]; then
  harness_err "Account が契約と一致しません（期待 $(mask_account "$want_acct") / 実測 $(mask_account "$got_acct")）"
  exit 3
fi

case "$got_arn" in
  "$want_arn"*) : ;;
  *)
    harness_err "ロールが契約と一致しません（期待するロール接頭辞に一致しない Identity です）"
    exit 3
    ;;
esac

exit 0
