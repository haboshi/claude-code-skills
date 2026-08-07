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

# --- Task 2: 環境消毒とスコープ config ---
UNSETS=$(bash -c '. '"$PLUG"'/scripts/build-scoped-config.sh --list-unset')
for v in AWS_PROFILE AWS_ACCESS_KEY_ID AWS_ENDPOINT_URL AWS_ENDPOINT_URL_STS \
         AWS_CA_BUNDLE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE \
         AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_WEB_IDENTITY_TOKEN_FILE; do
  echo "$UNSETS" | grep -qx "$v" && ok "消毒リストに $v が含まれる" \
    || bad "消毒リストに $v が含まれる" "リストにない"
done

CDIR="$AWS_HARNESS_HOME/contracts/$CID"
SCOPED=$(bash "$PLUG/scripts/build-scoped-config.sh" "$CDIR" "$CID")
[ -f "$SCOPED" ] && ok "スコープ config が生成される" \
  || bad "スコープ config が生成される" "not found: $SCOPED"

diff -q "$SCOPED" "$CDIR/aws-config" >/dev/null 2>&1 \
  && ok "契約の aws-config がそのまま配置される" \
  || bad "契約の aws-config がそのまま配置される" "内容が一致しない"

# 共有 credentials を参照させないための空ファイルが用意されること
CREDF="$(dirname "$SCOPED")/credentials"
[ -f "$CREDF" ] && [ ! -s "$CREDF" ] && ok "空の credentials プレースホルダが作られる" \
  || bad "空の credentials プレースホルダが作られる" "not empty or missing"

PERM=$(ls -l "$SCOPED" | cut -c2-10)
[ "$PERM" = "rw-------" ] && ok "スコープ config の権限は 600" \
  || bad "スコープ config の権限は 600" "perm=$PERM"

# 消毒が実際に効くこと（SDK が契約以外の profile を名前解決できない）
if command -v python3 >/dev/null 2>&1 && python3 -c "import boto3" >/dev/null 2>&1; then
  SEEN=$(AWS_CONFIG_FILE="$SCOPED" AWS_SHARED_CREDENTIALS_FILE=/dev/null \
    python3 -c "import boto3;print(','.join(sorted(boto3.Session().available_profiles)))" 2>/dev/null)
  [ "$SEEN" = "example-agent" ] && ok "SDK から見える profile は契約の1つだけ" \
    || bad "SDK から見える profile は契約の1つだけ" "seen=$SEEN"
else
  echo "SKIP: boto3 未導入のため SDK 可視性テストを省略"
fi

# パストラバーサルの契約IDは拒否され、runtime/ の外に何も書き込まれないこと
FS_BEFORE=$(find "$WORK" -mindepth 1 | sort)
TRAV_CID="../../aabbccdd1122"
bash "$PLUG/scripts/build-scoped-config.sh" "$CDIR" "$TRAV_CID" >/dev/null 2>&1
TRAV_RC=$?
FS_AFTER=$(find "$WORK" -mindepth 1 | sort)
[ "$TRAV_RC" -eq 3 ] && ok "パストラバーサルの契約IDは拒否(exit 3)" \
  || bad "パストラバーサルの契約IDは拒否(exit 3)" "rc=$TRAV_RC"
[ "$FS_BEFORE" = "$FS_AFTER" ] && ok "runtime/ の外にファイルが作られない" \
  || bad "runtime/ の外にファイルが作られない" "ファイルシステムに差分あり"

# --- Task 3: STS 照合 ---
chmod +x "$TESTS_DIR/fakes/aws" 2>/dev/null
export PATH="$TESTS_DIR/fakes:$PATH"

verify() { bash "$PLUG/scripts/verify-identity.sh" "$AWS_HARNESS_HOME/contracts/$CID" >/dev/null 2>&1; echo $?; }

OKARN="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnly/session"
[ "$(FAKE_AWS_ACCOUNT="$ACCT" FAKE_AWS_ARN="$OKARN" verify)" = "0" ] \
  && ok "Account と ARN が一致すれば通過" || bad "Account と ARN が一致すれば通過" "rc != 0"

[ "$(FAKE_AWS_ACCOUNT=000000000001 FAKE_AWS_ARN="arn:aws:sts::000000000001:assumed-role/ExampleAgentReadOnly/session" verify)" = "3" ] \
  && ok "Account 不一致は拒否" || bad "Account 不一致は拒否" "rc != 3"

[ "$(FAKE_AWS_ACCOUNT=$ACCT FAKE_AWS_ARN="arn:aws:sts::$ACCT:assumed-role/SomeOtherRole/session" verify)" = "3" ] \
  && ok "ARN 不一致は拒否" || bad "ARN 不一致は拒否" "rc != 3"

[ "$(FAKE_AWS_FAIL=1 verify)" = "3" ] && ok "credential 取得失敗は拒否" \
  || bad "credential 取得失敗は拒否" "rc != 3"

# Account ID が生のまま出ないこと
ERRTXT=$(FAKE_AWS_ACCOUNT=000000000001 bash "$PLUG/scripts/verify-identity.sh" \
  "$AWS_HARNESS_HOME/contracts/$CID" 2>&1 >/dev/null)
echo "$ERRTXT" | grep -q "000000000001" \
  && bad "エラー出力に Account ID を出さない" "生の ID が出力された" \
  || ok "エラー出力に Account ID を出さない"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
