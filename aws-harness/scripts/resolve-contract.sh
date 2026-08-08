#!/usr/bin/env bash
# 追跡マーカー .aws-harness から契約ディレクトリを解決する
# usage: resolve-contract.sh <repo-dir>
# stdout: "PASSTHROUGH" | "RESOLVED <contract-dir>"
# exit:   0=続行可 / 3=起動拒否
set -u

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/harness-lib.sh"

repo="${1:-$PWD}"
marker="$repo/.aws-harness"

# 三分岐その1: マーカーなし = 保護不要
if [ ! -f "$marker" ]; then
  printf 'PASSTHROUGH\n'
  exit 0
fi

# ここから先は「保護必須」。以降の失敗はすべて拒否（fail-closed）
if ! command -v jq >/dev/null 2>&1; then
  harness_err "jq が必要です（保護必須のリポジトリのため起動を中止します）"
  exit 3
fi

cid=$(awk -F':[[:space:]]*' '$1=="contract_id"{print $2; exit}' "$marker" 2>/dev/null | tr -d '[:space:]')
if [ -z "$cid" ]; then
  harness_err ".aws-harness に contract_id がありません"
  exit 3
fi

if ! valid_contract_id "$cid"; then
  harness_err "contract_id の形式が不正です"
  exit 3
fi

dir="$(harness_home)/contracts/$cid"
if [ ! -d "$dir" ]; then
  harness_err "契約が見つかりません（このリポジトリは契約を必須としています）"
  exit 3
fi
if [ ! -f "$dir/contract.json" ] || [ ! -f "$dir/aws-config" ]; then
  harness_err "契約ディレクトリが不完全です（contract.json / aws-config が必要）"
  exit 3
fi
if ! jq -e '.aws.account_id and .aws.credential.profile and .aws.expected_principal.arn_prefix' \
     "$dir/contract.json" >/dev/null 2>&1; then
  harness_err "contract.json を解析できないか必須項目が欠けています"
  exit 3
fi

printf 'RESOLVED %s\n' "$dir"
exit 0
