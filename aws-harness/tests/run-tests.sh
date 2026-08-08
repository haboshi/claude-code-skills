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

# arn_prefix の末尾に / がない契約は拒否される（境界が契約の書き方に依存しないこと）
NOSLASH_CID="c2b4a139-1111-2222-3333-444455556666"
NOSLASH_DIR="$AWS_HARNESS_HOME/contracts/$NOSLASH_CID"
mkdir -p "$NOSLASH_DIR"
jq -n --arg id "$NOSLASH_CID" --arg acct "$ACCT" \
  '{schema:1, contract_id:$id, project:"example-project",
    aws:{account_id:$acct, region:"ap-northeast-1",
         credential:{provider:"aws-vault", profile:"example-agent"},
         expected_principal:{arn_prefix:("arn:aws:sts::"+$acct+":assumed-role/ExampleAgentReadOnly")}},
    authority:{mode:"read-only"}}' > "$NOSLASH_DIR/contract.json"
printf '[profile example-agent]\nregion = ap-northeast-1\n' > "$NOSLASH_DIR/aws-config"

verify_noslash() { bash "$PLUG/scripts/verify-identity.sh" "$NOSLASH_DIR" >/dev/null 2>&1; echo $?; }
[ "$(FAKE_AWS_ACCOUNT="$ACCT" FAKE_AWS_ARN="$OKARN" verify_noslash)" = "3" ] \
  && ok "arn_prefix の末尾に / がない契約は拒否される" \
  || bad "arn_prefix の末尾に / がない契約は拒否される" "rc != 3"

# 末尾 / ありの契約でも、接頭辞を共有する別ロールは拒否される（境界の回帰テスト）
SHAREDARN="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnlyAdmin/session"
[ "$(FAKE_AWS_ACCOUNT="$ACCT" FAKE_AWS_ARN="$SHAREDARN" verify)" = "3" ] \
  && ok "接頭辞を共有する別ロールは拒否される" \
  || bad "接頭辞を共有する別ロールは拒否される" "rc != 3"

# --- Task 4: 合流点 shim ---
chmod +x "$TESTS_DIR/fakes/aws-vault" "$TESTS_DIR/fakes/claude" 2>/dev/null
export AWS_HARNESS_REAL_CLI="$TESTS_DIR/fakes/claude"

launch() { # $1: repo, 残り: 引数
  r="$1"; shift
  ( cd "$r" && FAKE_CLI_ENV_OUT="$WORK/env.json" \
      bash "$PLUG/scripts/harness-launch.sh" "$@" >/dev/null 2>&1; echo $? )
}
envget() { jq -r ".$1 // empty" "$WORK/env.json" 2>/dev/null; }

R=$(make_repo repo-launch-none "")
[ "$(launch "$R" --flag)" = "0" ] && ok "マーカーなしは素通しで起動する" \
  || bad "マーカーなしは素通しで起動する" "rc != 0"
[ "$(envget contract_id)" = "" ] && ok "素通し時は契約 ID を立てない" \
  || bad "素通し時は契約 ID を立てない" "id=$(envget contract_id)"
[ "$(envget args)" = "--flag" ] && ok "素通し時も引数を実 CLI へ渡す" \
  || bad "素通し時も引数を実 CLI へ渡す" "args=$(envget args)"

R=$(make_repo repo-launch-ok "contract_id: $CID
required: true
")
# 消毒対象（build-scoped-config.sh --list-unset）の全変数に ambient な「漏れた値」を
# 事前に仕込んでおき、起動後に fake claude 側でその値が残っていないか全件確認する
# （2変数だけの手検査だと消毒ループの回帰を検出できないため; fix round 1 対応）。
RC=$(
  cd "$R" || exit 2
  FAKE_CLI_ENV_OUT="$WORK/env.json"; export FAKE_CLI_ENV_OUT
  FAKE_AWS_ACCOUNT="$ACCT"; export FAKE_AWS_ACCOUNT
  FAKE_AWS_ARN="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnly/session"; export FAKE_AWS_ARN
  FAKE_CLI_CHECK_VARS="$UNSETS"; export FAKE_CLI_CHECK_VARS
  for v in $UNSETS; do
    export "$v=leaked-$v"
  done
  bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1
  echo $?
)
[ "$RC" = "0" ] && ok "契約ありは検証を通って起動する" || bad "契約ありは検証を通って起動する" "rc=$RC"
[ "$(envget contract_id)" = "$CID" ] && ok "契約セッションは契約 ID を立てる" \
  || bad "契約セッションは契約 ID を立てる" "id=$(envget contract_id)"
[ "$(envget profile)" = "" ] && ok "AWS_PROFILE が消毒される" \
  || bad "AWS_PROFILE が消毒される" "profile=$(envget profile)"
[ "$(envget endpoint)" = "" ] && ok "AWS_ENDPOINT_URL が消毒される" \
  || bad "AWS_ENDPOINT_URL が消毒される" "endpoint=$(envget endpoint)"
case "$(envget config_file)" in
  *"/runtime/$CID/config") ok "AWS_CONFIG_FILE がスコープ config を指す" ;;
  *) bad "AWS_CONFIG_FILE がスコープ config を指す" "got=$(envget config_file)" ;;
esac
case "$(envget creds_file)" in
  *"/runtime/$CID/credentials") ok "AWS_SHARED_CREDENTIALS_FILE がスコープ credentials を指す" ;;
  *) bad "AWS_SHARED_CREDENTIALS_FILE がスコープ credentials を指す" "got=$(envget creds_file)" ;;
esac
[ "$(envget vault_profile)" = "example-agent" ] && ok "契約の profile で credential を取る" \
  || bad "契約の profile で credential を取る" "p=$(envget vault_profile)"

# 消毒対象の全変数のうち、AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE の2つは
# 消毒後に契約専用の値へ意図的に再設定されるため __UNSET__ にはならない（上の2つの
# 個別チェックで検証済みなのでここでは除外する）。残りは起動時に必ず __UNSET__
# （未設定）になっていることを検査する。「leaked-$v でないこと」ではなく番兵
# __UNSET__ そのものを要求することで、「unset が空文字設定に退化する」回帰も
# 検出できるようにする（fix round 2 対応）。
for v in $UNSETS; do
  case "$v" in
    AWS_CONFIG_FILE|AWS_SHARED_CREDENTIALS_FILE) continue ;;
  esac
  [ "$(envget "san_$v")" = "__UNSET__" ] && ok "起動時に $v が未設定になる" \
    || bad "起動時に $v が未設定になる" "got=$(envget "san_$v")"
done

R=$(make_repo repo-launch-deny "contract_id: 11111111-2222-3333-4444-555555555555
required: true
")
[ "$(launch "$R")" = "3" ] && ok "契約が壊れていれば起動を拒否する" \
  || bad "契約が壊れていれば起動を拒否する" "rc != 3"

R=$(make_repo repo-launch-mismatch "contract_id: $CID
required: true
")
RC=$(cd "$R" && FAKE_AWS_ACCOUNT=000000000001 \
  FAKE_AWS_ARN="arn:aws:sts::000000000001:assumed-role/ExampleAgentReadOnly/session" \
  bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "3" ] && ok "STS 不一致なら起動を拒否する" || bad "STS 不一致なら起動を拒否する" "rc=$RC"

RC=$(cd "$R" && FAKE_VAULT_FAIL=1 bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "3" ] && ok "credential 取得失敗なら起動を拒否する" \
  || bad "credential 取得失敗なら起動を拒否する" "rc=$RC"

# 再帰防止が「本当に検証をスキップした」ことを積極的に証明するため、
# 検証が実際に走れば必ず拒否される条件（STS 不一致 かつ credential 取得失敗）を
# あえて仕込む。それでも起動できる（rc=0）ことが再帰防止の直接証拠になる
# （fix round 1 対応。以前は正当な契約と一致するデフォルト値のままだったため、
#   再帰防止コードを削除しても検証が偶然通ってしまい変異を検出できなかった）。
RC=$(cd "$R" && FAKE_CLI_ENV_OUT="$WORK/env2.json" AWS_HARNESS_LAUNCHED=1 \
  FAKE_AWS_ACCOUNT=000000000001 \
  FAKE_AWS_ARN="arn:aws:sts::000000000001:assumed-role/ExampleAgentReadOnly/session" \
  FAKE_VAULT_FAIL=1 \
  bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "0" ] && ok "既に shim 経由なら再検証せず素通しする（再帰防止）" \
  || bad "既に shim 経由なら再検証せず素通しする（再帰防止）" "rc=$RC"

# --- Task 5: PreToolUse(Bash) ---
# 保護対象かどうかは cwd のマーカーで判定する（環境変数の継承に依存しない）
GUARDED="$WORK/repo-ok"          # .aws-harness を持つ（Task 1 で作成済み）
UNGUARDED="$WORK/repo-nomarker"  # マーカーなし

bashhook() { # $1: command 文字列, $2: cwd
  printf '%s' "$1" \
    | jq -Rs --arg n Bash --arg d "$2" \
        '{hook_event_name:"PreToolUse", tool_name:$n, cwd:$d, tool_input:{command:.}}' \
    | bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1
  echo $?
}

for c in "aws --profile other s3 ls" \
         "AWS_PROFILE=other aws s3 ls" \
         "aws configure set x y" \
         "aws sso login --profile other" \
         "aws-vault exec other -- aws s3 ls" \
         "echo x > ~/.aws/credentials" \
         "cat ~/.aws/sso/cache/x.json" \
         "claude --dangerously-skip-permissions"; do
  [ "$(bashhook "$c" "$GUARDED")" = "2" ] && ok "deny: $c" || bad "deny: $c" "rc != 2"
done

for c in "aws s3 ls" \
         "aws sts get-caller-identity" \
         "git status" \
         "PGPASSWORD=\"\$DB_PASS\" psql -c 'select 1'"; do
  [ "$(bashhook "$c" "$GUARDED")" = "0" ] && ok "allow: $c" || bad "allow: $c" "rc != 0"
done

[ "$(bashhook "aws --profile other s3 ls" "$UNGUARDED")" = "0" ] \
  && ok "マーカーのないリポジトリには干渉しない" \
  || bad "マーカーのないリポジトリには干渉しない" "rc != 0"

# fail-closed: 壊れた入力・依存不在は deny（cwd が読めない場合も含む）
RC=$(printf 'not json' | bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "JSON 破損は deny(exit 2)" || bad "JSON 破損は deny(exit 2)" "rc=$RC"

# jq 不在（PATH を潰す。bash 自体は絶対パスで起動する）
RC=$(jq -n --arg d "$GUARDED" '{hook_event_name:"PreToolUse", tool_name:"Bash", cwd:$d, tool_input:{command:"aws s3 ls"}}' \
  | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$GUARDED" /bin/bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "保護対象で依存不在なら deny(exit 2)" || bad "保護対象で依存不在なら deny(exit 2)" "rc=$RC"

# 保護対象でなければ jq 不在でも素通し（非 AWS プロジェクトを巻き込まない）
RC=$(printf '{}' | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$UNGUARDED" \
  /bin/bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "0" ] && ok "非保護対象は依存不在でも素通し" || bad "非保護対象は依存不在でも素通し" "rc=$RC"

# 0バイトの stdin: jq は「壊れた JSON」と違い空入力を rc=0/空文字として通してしまうため、
# .cwd 抽出の成否だけでは検知できない別経路。入力自体が読めない＝何を判定しているかも
# 分からない「想定外入力」として、保護対象・非保護対象を問わず一律 deny(exit 2) にする
# （JSON 破損時の deny 判定と同じ「安全側に倒す」方針。詳細な判断理由は task-5-report.md）。
RC=$(: | CLAUDE_PROJECT_DIR="$GUARDED" bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "0バイト stdin は保護対象で deny(exit 2)" \
  || bad "0バイト stdin は保護対象で deny(exit 2)" "rc=$RC"

RC=$(: | CLAUDE_PROJECT_DIR="$UNGUARDED" bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "0バイト stdin は非保護対象でも deny(exit 2)" \
  || bad "0バイト stdin は非保護対象でも deny(exit 2)" "rc=$RC"

# --- Task 6: ファイル deny と prompt enforcement ---
filehook() { # $1: file_path, $2: cwd
  jq -n --arg p "$1" --arg d "$2" \
      '{hook_event_name:"PreToolUse", tool_name:"Read", cwd:$d, tool_input:{file_path:$p}}' \
    | AWS_HARNESS_PLUGIN_ROOT="$PLUG" \
      bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1
  echo $?
}

[ "$(filehook "$HOME/.aws/credentials" "$GUARDED")" = "2" ] && ok "deny: ~/.aws/credentials の読み取り" \
  || bad "deny: ~/.aws/credentials の読み取り" "rc != 2"
[ "$(filehook "$HOME/.aws/sso/cache/x.json" "$GUARDED")" = "2" ] && ok "deny: SSO キャッシュの読み取り" \
  || bad "deny: SSO キャッシュの読み取り" "rc != 2"
[ "$(filehook "$AWS_HARNESS_HOME/contracts/$CID/contract.json" "$GUARDED")" = "2" ] \
  && ok "deny: 契約ファイルへのアクセス" || bad "deny: 契約ファイルへのアクセス" "rc != 2"
[ "$(filehook "$PLUG/scripts/harness-launch.sh" "$GUARDED")" = "2" ] && ok "deny: shim 自身へのアクセス" \
  || bad "deny: shim 自身へのアクセス" "rc != 2"
[ "$(filehook "$GUARDED/README.md" "$GUARDED")" = "0" ] && ok "allow: 通常のリポジトリファイル" \
  || bad "allow: 通常のリポジトリファイル" "rc != 0"
[ "$(filehook "$HOME/.aws/credentials" "$UNGUARDED")" = "0" ] \
  && ok "マーカーのないリポジトリには干渉しない（ファイル）" \
  || bad "マーカーのないリポジトリには干渉しない（ファイル）" "rc != 0"

# fix round 1: 相対パスの .aws/ が *"/.aws/"* パターンに拾われず素通ししていた指摘への回帰テスト
for rel in ".aws/credentials" "./.aws/credentials" "../.aws/credentials"; do
  [ "$(filehook "$rel" "$GUARDED")" = "2" ] && ok "deny: 相対パス $rel" \
    || bad "deny: 相対パス $rel" "rc != 2"
done

RC=$(printf 'not json' | CLAUDE_PROJECT_DIR="$GUARDED" \
  bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "ファイルフックの JSON 破損は deny" || bad "ファイルフックの JSON 破損は deny" "rc=$RC"

# fix round 1: guard-bash.sh には既にある PATH=/nonexistent の fail-closed テストを
# guard-files.sh にも追加する（レビュー指摘: 依存不在時の deny を全フックで揃える）
RC=$(printf '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"x"}}' \
  | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$GUARDED" /bin/bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "guard-files: 保護対象で依存不在なら deny(exit 2)" \
  || bad "guard-files: 保護対象で依存不在なら deny(exit 2)" "rc=$RC"

RC=$(printf '{}' | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$UNGUARDED" \
  /bin/bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "0" ] && ok "guard-files: 非保護対象は依存不在でも素通し" \
  || bad "guard-files: 非保護対象は依存不在でも素通し" "rc=$RC"

prompthook() { # $1: cwd, $2: 契約 ID（空 = shim を経ていない起動）
  printf '{"hook_event_name":"UserPromptSubmit","prompt":"x"}' \
    | CLAUDE_PROJECT_DIR="$1" AWS_HARNESS_CONTRACT_ID="${2:-}" \
      AWS_HARNESS_CONTRACT_DIR="$AWS_HARNESS_HOME/contracts/$CID" \
      AWS_HARNESS_SCRIPT_DIR="$PLUG/scripts" \
      bash "$PLUG/scripts/hooks/guard-prompt.sh" >/dev/null 2>&1
  echo $?
}

[ "$(FAKE_AWS_ACCOUNT=$ACCT FAKE_AWS_ARN="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnly/s" prompthook "$GUARDED" "$CID")" = "0" ] \
  && ok "照合が通ればプロンプトを通す" || bad "照合が通ればプロンプトを通す" "rc != 0"
[ "$(FAKE_AWS_ACCOUNT=000000000001 FAKE_AWS_ARN="arn:aws:sts::000000000001:assumed-role/X/s" prompthook "$GUARDED" "$CID")" = "2" ] \
  && ok "照合が崩れたらプロンプトを止める" || bad "照合が崩れたらプロンプトを止める" "rc != 2"
[ "$(prompthook "$UNGUARDED" "")" = "0" ] && ok "マーカーのないリポジトリには干渉しない（プロンプト）" \
  || bad "マーカーのないリポジトリには干渉しない（プロンプト）" "rc != 0"

# shim バイパスの検出: 保護対象なのに shim を経ていなければ止める
[ "$(prompthook "$GUARDED" "")" = "2" ] \
  && ok "shim を経ない起動を検出して止める" || bad "shim を経ない起動を検出して止める" "rc != 2"

# fix round 1: guard-bash.sh には既にある PATH=/nonexistent の fail-closed テストを
# guard-prompt.sh にも追加する（レビュー指摘: 依存不在時の deny を全フックで揃える）
RC=$(printf '{"hook_event_name":"UserPromptSubmit","prompt":"x"}' \
  | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$GUARDED" AWS_HARNESS_CONTRACT_ID="$CID" \
    AWS_HARNESS_CONTRACT_DIR="$AWS_HARNESS_HOME/contracts/$CID" AWS_HARNESS_SCRIPT_DIR="$PLUG/scripts" \
    /bin/bash "$PLUG/scripts/hooks/guard-prompt.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "guard-prompt: 保護対象で依存不在なら deny(exit 2)" \
  || bad "guard-prompt: 保護対象で依存不在なら deny(exit 2)" "rc=$RC"

RC=$(printf '{"hook_event_name":"UserPromptSubmit","prompt":"x"}' \
  | PATH="/nonexistent" CLAUDE_PROJECT_DIR="$UNGUARDED" \
    /bin/bash "$PLUG/scripts/hooks/guard-prompt.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "0" ] && ok "guard-prompt: 非保護対象は依存不在でも素通し" \
  || bad "guard-prompt: 非保護対象は依存不在でも素通し" "rc=$RC"

# --- Task 7: 配線と公開安全性 ---
jq -e '.name == "aws-harness" and .version and .description' "$PLUG/.claude-plugin/plugin.json" >/dev/null 2>&1 \
  && ok "plugin.json が必須項目を持つ" || bad "plugin.json が必須項目を持つ" "不正または欠落"

jq -e '.hooks.PreToolUse and .hooks.UserPromptSubmit' "$PLUG/hooks/hooks.json" >/dev/null 2>&1 \
  && ok "hooks.json が PreToolUse と UserPromptSubmit を配線している" \
  || bad "hooks.json が PreToolUse と UserPromptSubmit を配線している" "欠落"

REPO_ROOT=$(cd "$PLUG/.." && pwd)
for m in "$REPO_ROOT/marketplace.json" "$REPO_ROOT/.claude-plugin/marketplace.json"; do
  jq -e '[.plugins[] | select(.name=="aws-harness")] | length == 1' "$m" >/dev/null 2>&1 \
    && ok "$(basename "$(dirname "$m")")/marketplace.json に登録されている" \
    || bad "$(basename "$(dirname "$m")")/marketplace.json に登録されている" "未登録"
  jq -e '[.plugins[] | select(.name=="aws-harness") | has("skills")] | any | not' "$m" >/dev/null 2>&1 \
    && ok "$(basename "$(dirname "$m")")/marketplace.json に skills フィールドがない" \
    || bad "$(basename "$(dirname "$m")")/marketplace.json に skills フィールドがない" "禁止フィールドあり"
done

# 二重マニフェストの一致
A=$(jq -S '[.plugins[] | select(.name=="aws-harness")]' "$REPO_ROOT/marketplace.json")
B=$(jq -S '[.plugins[] | select(.name=="aws-harness")]' "$REPO_ROOT/.claude-plugin/marketplace.json")
[ "$A" = "$B" ] && ok "両マニフェストのエントリが一致する" || bad "両マニフェストのエントリが一致する" "不一致"

# 公開安全性: コミット対象に実情報が混入していないこと
# --exclude=run-tests.sh: このテスト自身の検査パターン文字列（"/Users/" 等のリテラル）が
# 自己マッチして誤検知するのを避ける（実リークの検出範囲は変えない）。
LEAK=$(grep -rEn --exclude=run-tests.sh '(/Users/|/home/[^/]+/|[a-z0-9-]+\.awsapps\.com)' \
  "$PLUG/scripts" "$PLUG/templates" "$PLUG/skills" "$PLUG/tests" \
  "$PLUG/hooks" "$PLUG/.claude-plugin" 2>/dev/null \
  | grep -v '\$HOME' | head -5)
[ -z "$LEAK" ] && ok "個人パス・SSO URL がコミット対象に無い" \
  || bad "個人パス・SSO URL がコミット対象に無い" "$LEAK"

ACCTLEAK=$(grep -rEn '(^|[^0-9a-zA-Z-])[0-9]{12}([^0-9a-zA-Z-]|$)' \
  "$PLUG/scripts" "$PLUG/templates" "$PLUG/skills" \
  "$PLUG/hooks" "$PLUG/.claude-plugin" 2>/dev/null \
  | grep -v '000000000000' | head -5)
[ -z "$ACCTLEAK" ] && ok "例示以外の Account ID がコミット対象に無い" \
  || bad "例示以外の Account ID がコミット対象に無い" "$ACCTLEAK"

# fix round 2: hook-lib.sh 自体が読めない（欠落・権限不備）場合の deny(exit 2) 確認。
# リポジトリ本体のファイル権限は変更せず、$WORK 配下の一時ディレクトリへコピーした上で
# そのコピーだけ chmod 000 する（$WORK は先頭の trap で EXIT 時に丸ごと削除される）。
HOOKCOPY="$WORK/hook-lib-unreadable"
mkdir -p "$HOOKCOPY"
cp "$PLUG/scripts/hooks/"*.sh "$HOOKCOPY/"
chmod 000 "$HOOKCOPY/hook-lib.sh"

RC=$(printf '{}' | CLAUDE_PROJECT_DIR="$GUARDED" bash "$HOOKCOPY/guard-bash.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "guard-bash: hook-lib.sh を読めなければ deny(exit 2)" \
  || bad "guard-bash: hook-lib.sh を読めなければ deny(exit 2)" "rc=$RC"

RC=$(printf '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"x"}}' \
  | CLAUDE_PROJECT_DIR="$GUARDED" bash "$HOOKCOPY/guard-files.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "guard-files: hook-lib.sh を読めなければ deny(exit 2)" \
  || bad "guard-files: hook-lib.sh を読めなければ deny(exit 2)" "rc=$RC"

RC=$(printf '{"hook_event_name":"UserPromptSubmit","prompt":"x"}' \
  | CLAUDE_PROJECT_DIR="$GUARDED" bash "$HOOKCOPY/guard-prompt.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "guard-prompt: hook-lib.sh を読めなければ deny(exit 2)" \
  || bad "guard-prompt: hook-lib.sh を読めなければ deny(exit 2)" "rc=$RC"

chmod 755 "$HOOKCOPY/hook-lib.sh"  # trap の rm -rf が確実に効くよう明示的に戻す（保険）

# --- Task 7 fix round 1: Grep/Glob 対応・$HOME 未設定 fail-closed ---

# Important 1a: hooks.json の配線そのものに Grep/Glob が乗っているかの構造チェック。
# 以下の filehook_tool テストは guard-files.sh を直接起動するため hooks.json の
# matcher を経由せず、matcher の書き忘れだけでは検知できない。matcher 単体を
# 別途 jq で確認する。
jq -e '[.hooks.PreToolUse[] | select(.matcher | test("Read"))][0].matcher
       | test("Grep") and test("Glob")' "$PLUG/hooks/hooks.json" >/dev/null 2>&1 \
  && ok "hooks.json の PreToolUse matcher が Grep/Glob を含む" \
  || bad "hooks.json の PreToolUse matcher が Grep/Glob を含む" "欠落"

# Important 1b: matcher に無かった Grep/Glob を追加。この2ツールは file_path ではなく
# path フィールドにパスを持つため、guard-files.sh の抽出も拡張している。
filehook_tool() { # $1: tool_name, $2: field名(file_path|path), $3: 値, $4: cwd
  jq -n --arg n "$1" --arg f "$2" --arg p "$3" --arg d "$4" \
      '{hook_event_name:"PreToolUse", tool_name:$n, cwd:$d, tool_input:{($f):$p}}' \
    | AWS_HARNESS_PLUGIN_ROOT="$PLUG" \
      bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1
  echo $?
}

[ "$(filehook_tool Grep path "$HOME/.aws/credentials" "$GUARDED")" = "2" ] \
  && ok "deny: Grep(path=~/.aws/credentials)" || bad "deny: Grep(path=~/.aws/credentials)" "rc != 2"
[ "$(filehook_tool Glob path "$HOME/.aws/credentials" "$GUARDED")" = "2" ] \
  && ok "deny: Glob(path=~/.aws/credentials)" || bad "deny: Glob(path=~/.aws/credentials)" "rc != 2"
[ "$(filehook_tool Grep path "$GUARDED/README.md" "$GUARDED")" = "0" ] \
  && ok "allow: Grep(path=通常のリポジトリファイル)" || bad "allow: Grep(path=通常のリポジトリファイル)" "rc != 0"

# Important 2: $HOME 未設定でも3フックとも fail-closed（unset は $() サブシェル内に
# 閉じ込め、テスト本体の環境には影響させない）

# guard-files.sh: HOME・AWS_HARNESS_HOME の両方が未設定なら harness_root を
# 決定できないため、通常ファイルへのアクセスも含め deny(exit 2) に倒す。
RC=$(
  unset HOME AWS_HARNESS_HOME
  jq -n --arg d "$GUARDED" \
      '{hook_event_name:"PreToolUse", tool_name:"Read", cwd:$d, tool_input:{file_path:($d+"/README.md")}}' \
    | CLAUDE_PROJECT_DIR="$GUARDED" bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1
  echo $?
)
[ "$RC" = "2" ] && ok "guard-files: HOME・AWS_HARNESS_HOME 未設定なら deny(exit 2)" \
  || bad "guard-files: HOME・AWS_HARNESS_HOME 未設定なら deny(exit 2)" "rc=$RC"

# guard-files.sh: AWS_HARNESS_HOME が設定済みなら harness_root 決定は $HOME に
# 触れずに完了する（if ブロックを通らない）。この経路で通常ファイルへのアクセスを
# 判定するとき、case 文にまだ生の "$HOME/.aws/"* が残っていれば HOME 未設定で
# set -u のクラッシュ（exit 1 = fail-open）を起こす。当初この case 文の削除は
# 冗長コードの整理のつもりだったが、mutation 検証でこの経路特有の再発を確認した
# ため、この組み合わせを専用テストとして固定する。
RC=$(
  unset HOME
  jq -n --arg d "$GUARDED" \
      '{hook_event_name:"PreToolUse", tool_name:"Read", cwd:$d, tool_input:{file_path:($d+"/README.md")}}' \
    | CLAUDE_PROJECT_DIR="$GUARDED" bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1
  echo $?
)
[ "$RC" = "0" ] && ok "guard-files: AWS_HARNESS_HOME設定・HOME未設定でも通常ファイルはクラッシュせず判定できる" \
  || bad "guard-files: AWS_HARNESS_HOME設定・HOME未設定でも通常ファイルはクラッシュせず判定できる" "rc=$RC"

# guard-bash.sh / guard-prompt.sh は $HOME を参照しないため無関係のはずだが、
# 未設定環境でも deny 判定そのものが壊れない（exit 1 に退化しない）ことを確認する。
RC=$(
  unset HOME
  printf '%s' "aws configure set x y" \
    | jq -Rs --arg n Bash --arg d "$GUARDED" \
        '{hook_event_name:"PreToolUse", tool_name:$n, cwd:$d, tool_input:{command:.}}' \
    | bash "$PLUG/scripts/hooks/guard-bash.sh" >/dev/null 2>&1
  echo $?
)
[ "$RC" = "2" ] && ok "guard-bash: HOME 未設定でも deny 判定が壊れない" \
  || bad "guard-bash: HOME 未設定でも deny 判定が壊れない" "rc=$RC"

RC=$(
  unset HOME
  printf '{"hook_event_name":"UserPromptSubmit","prompt":"x"}' \
    | CLAUDE_PROJECT_DIR="$GUARDED" AWS_HARNESS_CONTRACT_ID="" \
      bash "$PLUG/scripts/hooks/guard-prompt.sh" >/dev/null 2>&1
  echo $?
)
[ "$RC" = "2" ] && ok "guard-prompt: HOME 未設定でも deny 判定が壊れない" \
  || bad "guard-prompt: HOME 未設定でも deny 判定が壊れない" "rc=$RC"

# --- 最終修正: 消毒リストの fail-closed ---
# cat が使えない環境でも消毒リストが取れること（printf 化の回帰）
CATLESS=$(mktemp -d)
for c in jq git awk sed grep bash env chmod mkdir cp; do
  cp_path=$(command -v "$c" 2>/dev/null) && ln -sf "$cp_path" "$CATLESS/$c" 2>/dev/null
done
N=$(PATH="$CATLESS" bash "$PLUG/scripts/build-scoped-config.sh" --list-unset 2>/dev/null | wc -l | tr -d ' ')
[ "$N" -ge 15 ] && ok "cat が無くても消毒リストを取得できる" \
  || bad "cat が無くても消毒リストを取得できる" "取得数=$N"
rm -rf "$CATLESS"

# 消毒リストが空を返す状況では shim が起動を拒否すること
FAKEDIR=$(mktemp -d)
cp -f "$PLUG/scripts/harness-launch.sh" "$FAKEDIR/" 2>/dev/null
cp -f "$PLUG/scripts/harness-lib.sh" "$FAKEDIR/" 2>/dev/null
cp -f "$PLUG/scripts/resolve-contract.sh" "$FAKEDIR/" 2>/dev/null
printf '#!/usr/bin/env bash\n[ "$1" = "--list-unset" ] && exit 0\nexit 3\n' > "$FAKEDIR/build-scoped-config.sh"
chmod +x "$FAKEDIR"/*.sh
R=$(make_repo repo-emptylist "contract_id: $CID
required: true
")
RC=$(cd "$R" && AWS_HARNESS_REAL_CLI="$TESTS_DIR/fakes/claude" \
  bash "$FAKEDIR/harness-launch.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "3" ] && ok "消毒リストが空なら起動を拒否する" \
  || bad "消毒リストが空なら起動を拒否する" "rc=$RC"
rm -rf "$FAKEDIR"

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
