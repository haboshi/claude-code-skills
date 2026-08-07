#!/usr/bin/env bash
# aws-harness 決定論テスト（実 AWS 呼び出しなし）
# 実行: bash tests/run-tests.sh
set -u

TESTS_DIR=$(cd "$(dirname "$0")" && pwd)
PLUG=$(cd "$TESTS_DIR/.." && pwd)

die() { echo "SETUP FAILED: $*" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || die "jq が必要です"
command -v git >/dev/null 2>&1 || die "git が必要です"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/aws-harness-tests.XXXXXX") || die "mktemp"
[ -d "$WORK" ] && [ -w "$WORK" ] || die "作業ディレクトリを作成できません"
trap 'rm -rf "$WORK"' EXIT

export AWS_HARNESS_HOME="$WORK/harness-home"
mkdir -p "$AWS_HARNESS_HOME/contracts" || die "harness home"

CID="a3f1c9d2-7b64-4e0a-9c15-2d8ef60b71a4"
ACCT="000000000000"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL: $1  ($2)"; }

# 契約ディレクトリを作る
make_contract() { # $1: contract id, $2: account id
  d="$AWS_HARNESS_HOME/contracts/$1"
  mkdir -p "$d"
  jq -n --arg id "$1" --arg acct "$2" \
    '{schema:1, contract_id:$id, project:"example-project",
      aws:{account_id:$acct, region:"ap-northeast-1",
           credential:{provider:"aws-vault", profile:"example-agent"},
           expected_principal:{arn_prefix:("arn:aws:sts::"+$acct+":assumed-role/ExampleAgentReadOnly/")}},
      authority:{mode:"read-only"}}' > "$d/contract.json"
  printf '[profile example-agent]\nregion = ap-northeast-1\n' > "$d/aws-config"
  echo "$d"
}

# リポジトリを作る
make_repo() { # $1: repo name, $2: marker content ("" ならマーカーなし)
  r="$WORK/$1"
  mkdir -p "$r"
  git -C "$r" init -q 2>/dev/null || die "git init"
  [ -n "${2:-}" ] && printf '%s' "$2" > "$r/.aws-harness"
  echo "$r"
}

resolve() { bash "$PLUG/scripts/resolve-contract.sh" "$1" 2>/dev/null; }
resolve_rc() { bash "$PLUG/scripts/resolve-contract.sh" "$1" >/dev/null 2>&1; echo $?; }

# --- Task 1: 契約解決の三分岐 ---
make_contract "$CID" "$ACCT" >/dev/null

R=$(make_repo repo-nomarker "")
[ "$(resolve "$R")" = "PASSTHROUGH" ] && ok "マーカーなしは PASSTHROUGH" \
  || bad "マーカーなしは PASSTHROUGH" "got: $(resolve "$R")"

R=$(make_repo repo-ok "contract_id: $CID
required: true
")
case "$(resolve "$R")" in
  "RESOLVED "*"/$CID") ok "契約ありは RESOLVED" ;;
  *) bad "契約ありは RESOLVED" "got: $(resolve "$R")" ;;
esac

R=$(make_repo repo-missing "contract_id: 11111111-2222-3333-4444-555555555555
required: true
")
[ "$(resolve_rc "$R")" = "3" ] && ok "契約実体なしは拒否(exit 3)" \
  || bad "契約実体なしは拒否(exit 3)" "rc: $(resolve_rc "$R")"

R=$(make_repo repo-badid "contract_id: ../../etc/passwd
required: true
")
[ "$(resolve_rc "$R")" = "3" ] && ok "不正な契約IDは拒否(exit 3)" \
  || bad "不正な契約IDは拒否(exit 3)" "rc: $(resolve_rc "$R")"

BROKEN="$AWS_HARNESS_HOME/contracts/bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
mkdir -p "$BROKEN"; printf '{ not json' > "$BROKEN/contract.json"
printf '[profile x]\n' > "$BROKEN/aws-config"
R=$(make_repo repo-broken "contract_id: bbbbbbbb-cccc-dddd-eeee-ffffffffffff
required: true
")
[ "$(resolve_rc "$R")" = "3" ] && ok "契約JSON破損は拒否(exit 3)" \
  || bad "契約JSON破損は拒否(exit 3)" "rc: $(resolve_rc "$R")"

R=$(make_repo repo-nokey "required: true
")
[ "$(resolve_rc "$R")" = "3" ] && ok "マーカーに契約IDがなければ拒否(exit 3)" \
  || bad "マーカーに契約IDがなければ拒否(exit 3)" "rc: $(resolve_rc "$R")"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
