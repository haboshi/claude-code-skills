#!/usr/bin/env bash
# aws-harness 共通関数（bash 3.2 互換）

harness_home() {
  if [ -n "${AWS_HARNESS_HOME:-}" ]; then
    printf '%s' "$AWS_HARNESS_HOME"
  else
    printf '%s' "$HOME/.claude/aws-harness"
  fi
}

# Account ID を末尾4桁だけ表示する（12桁以外はそのまま伏せる）
mask_account() {
  _a="${1:-}"
  case "$_a" in
    ????????????) printf '****%s' "${_a#????????}" ;;
    *) printf '****' ;;
  esac
}

# 契約 ID の形式検査（UUID 形式のみ許可。パス要素の混入を防ぐ）
valid_contract_id() {
  case "${1:-}" in
    *[!0-9a-fA-F-]*) return 1 ;;
    ????????-????-????-????-????????????) return 0 ;;
    *) return 1 ;;
  esac
}

harness_err() { printf 'aws-harness: %s\n' "$*" >&2; }
