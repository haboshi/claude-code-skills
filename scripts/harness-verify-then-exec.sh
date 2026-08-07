#!/usr/bin/env bash
# aws-vault exec の内側で照合し、通れば実 CLI を exec する
set -u

SCRIPT_DIR="${AWS_HARNESS_SCRIPT_DIR:?}"
. "$SCRIPT_DIR/harness-lib.sh"

"$SCRIPT_DIR/verify-identity.sh" "${AWS_HARNESS_CONTRACT_DIR:?}" || exit 3

real_cli="${AWS_HARNESS_REAL_CLI:?}"
[ -x "$real_cli" ] || { harness_err "Agent CLI が見つかりません: $real_cli"; exit 3; }
exec "$real_cli" "$@"
