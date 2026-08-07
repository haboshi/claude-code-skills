# aws-harness P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 契約のあるリポジトリで Agent CLI を起動したとき、契約の AWS Account 以外を
SDK・CLI が名前解決できない状態に固定し、契約が壊れているときは起動を拒否する。

**Architecture:** リポジトリに追跡ファイル `.aws-harness`（不透明な契約 ID のみ）を置き、
契約実体はローカルの契約ディレクトリに置く。合流点 shim が起動時に契約を解決し、
環境を消毒し、契約専用の最小 AWS config に固定し、STS で実 Identity を照合してから
実 CLI を exec する。enforcement はブロック可能なフック（PreToolUse / UserPromptSubmit）に置く。

**Tech Stack:** bash（macOS 標準 bash 3.2 互換）、jq、git、aws CLI、aws-vault。
テストは fake コマンドによる決定論テスト（実 AWS 呼び出しなし）。

## この計画が依拠する前提（すべて裏取り済み）

| 前提 | 裏取り |
|---|---|
| `aws-vault` は `AWS_CONFIG_FILE` を尊重し、そこに書かれた profile だけを認識する | 実測（差し替えで認識 profile が 10 → 1） |
| SDK も `AWS_CONFIG_FILE` の差し替えで名前解決できる profile が絞られる | 実測（boto3 の `available_profiles` が 10 → 1） |
| フックの `matcher` は `Edit\|Write` 形式の完全一致リストとして評価される | 公式 hooks ドキュメント |
| `UserPromptSubmit` は matcher 非対応（配線に matcher を書かない） | 同上 |
| ブロックは `exit 2` のみ。`exit 1` は非ブロッキングで素通りする | 同上 |
| `${CLAUDE_PLUGIN_ROOT}` はプラグインの hooks.json で使える公式の変数 | 同上 + 既存プラグインでの実績 |

**ロールバック手段**: プラグインは追加のみで既存ファイルを書き換えない。
問題があれば (1) shim を向けた起動元を元に戻す、(2) `.aws-harness` を削除する、
(3) プラグインを無効化する、のいずれでも従来の挙動に戻る。契約セッション判定
（`AWS_HARNESS_CONTRACT_ID`）が立たないため、フックも自動的に無効になる。

## Global Constraints

- **bash 3.2 互換**: 連想配列（`declare -A`）、`${var^^}`、`mapfile` を使わない。
- **公開リポジトリ**: コミットするファイルに実 Account ID・Role ARN・実プロジェクト名・
  顧客名・SSO start URL・ユーザディレクトリの絶対パスを書かない。例示 Account ID は
  `000000000000`、例示 UUID は `a3f1c9d2-7b64-4e0a-9c15-2d8ef60b71a4` を使う。
- **フックの exit code**: ブロックしたいときは必ず `exit 2`。解析不能・依存不在・
  想定外入力もすべて `exit 2` に変換する。`exit 1` は非ブロッキングとして素通りする。
- **保護対象の判定**: フックは「作業ディレクトリに `.aws-harness` があるか」で判定する。
  無ければ何もせず `exit 0`（依存が欠けていても素通しする）。環境変数の継承に依存しないため、
  shim を経ない起動でもフックは作動する。作業ディレクトリは `CLAUDE_PROJECT_DIR` →
  フック入力の `cwd` → `$PWD` の順に解決する。
- **shim バイパスの検出**: 保護対象なのに `AWS_HARNESS_CONTRACT_ID` が立っていなければ、
  shim を経ていない起動として `UserPromptSubmit` で止める。
- **secret を出力しない**: credential 値・トークンを stdout / stderr / ログに出さない。
  Account ID をエラー表示するときは末尾4桁のみ（`****7890` 形式）。
- **テストは実 AWS を呼ばない**: `aws` / `aws-vault` は `tests/fakes/` の fake を PATH 前段に置く。
- **プラグイン名**: `aws-harness`。スクリプトは `${CLAUDE_PLUGIN_ROOT}/scripts/` から参照する。

## File Structure

| ファイル | 責務 |
|---|---|
| `scripts/harness-lib.sh` | 共通関数（契約ホーム解決・ログ・Account ID マスク） |
| `scripts/resolve-contract.sh` | 追跡マーカー → 契約ディレクトリの解決と三分岐判定 |
| `scripts/build-scoped-config.sh` | 環境消毒リストの提供と契約専用 config の配置 |
| `scripts/verify-identity.sh` | STS 実測値と契約期待値の照合 |
| `scripts/harness-launch.sh` | 合流点 shim（上記を統合して実 CLI を exec） |
| `scripts/hooks/guard-bash.sh` | PreToolUse(Bash) の deny |
| `scripts/hooks/guard-files.sh` | PreToolUse(Read/Edit/Write) の deny |
| `scripts/hooks/guard-prompt.sh` | UserPromptSubmit の enforcement |
| `hooks/hooks.json` | フック配線 |
| `skills/aws-harness/SKILL.md` | セットアップと運用ガイド |
| `templates/` | 追跡マーカー・契約・IAM ポリシーの雛形 |
| `tests/run-tests.sh` | 決定論テスト一式 |
| `tests/fakes/{aws,aws-vault,claude}` | fake コマンド |

### 契約の実体（ディレクトリ形式）

```
~/.claude/aws-harness/contracts/<contract-id>/
├── contract.json     # 期待する Identity と Authority（secret を含まない）
└── aws-config        # そのまま AWS_CONFIG_FILE になる最小 config
```

契約を JSON にするのは jq で扱うため。`aws-config` を別ファイルにするのは、
生成ロジックを「コピーして権限を絞る」だけに単純化するため。

---

### Task 1: 契約の解決と三分岐判定

**Files:**
- Create: `scripts/harness-lib.sh`
- Create: `scripts/resolve-contract.sh`
- Create: `tests/run-tests.sh`
- Create: `tests/fakes/.gitkeep`

**Interfaces:**
- Produces: `resolve-contract.sh <repo-dir>` — stdout に `PASSTHROUGH` または
  `RESOLVED <契約ディレクトリの絶対パス>` を出力。exit 0 = 続行可、exit 3 = 起動拒否。
- Produces: `harness_home()` — 契約ホームの絶対パス（`$AWS_HARNESS_HOME` があればそれ、
  なければ `$HOME/.claude/aws-harness`）。
- Produces: `mask_account()` — 12桁の Account ID を `****7890` 形式にする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/run-tests.sh` を新規作成する。

```bash
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（`scripts/resolve-contract.sh` が存在しないため全ケース失敗）

- [ ] **Step 3: 共通ライブラリを実装**

`scripts/harness-lib.sh`:

```bash
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
```

- [ ] **Step 4: 契約解決を実装**

`scripts/resolve-contract.sh`:

```bash
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
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS（6ケースすべて）、`FAIL=0`

- [ ] **Step 6: コミット**

```bash
chmod +x scripts/resolve-contract.sh tests/run-tests.sh
git add scripts/harness-lib.sh scripts/resolve-contract.sh tests/run-tests.sh tests/fakes/.gitkeep
git commit -m "feat(aws-harness): 契約解決の三分岐（素通し／解決／拒否）を実装"
```

---

### Task 2: 環境消毒と契約専用 config の配置

**Files:**
- Create: `scripts/build-scoped-config.sh`
- Modify: `tests/run-tests.sh`（Task 1 のテストの後ろに追記）

**Interfaces:**
- Consumes: `harness_home()`（Task 1）
- Produces: `scoped_env_unset_list()` — 消毒すべき環境変数名を1行1件で出力。
- Produces: `build-scoped-config.sh <contract-dir> <contract-id>` — 契約の `aws-config` を
  `<harness_home>/runtime/<contract-id>/config` に権限 600 で配置し、そのパスを stdout に出力。

- [ ] **Step 1: 失敗するテストを書く**

`tests/run-tests.sh` の `echo "----"` の直前に追記する。

```bash
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

# パストラバーサル: 不正な contract ID で runtime の外に書けないこと
ESCAPE="$WORK/escaped-marker"
RC=$(bash "$PLUG/scripts/build-scoped-config.sh" "$CDIR" "../../../../${ESCAPE#/}" >/dev/null 2>&1; echo $?)
[ "$RC" = "3" ] && ok "不正な contract ID は拒否される(exit 3)" \
  || bad "不正な contract ID は拒否される(exit 3)" "rc=$RC"
[ ! -e "$ESCAPE" ] && ok "runtime の外にファイルが作られない" \
  || bad "runtime の外にファイルが作られない" "$ESCAPE が作られた"

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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（`build-scoped-config.sh` が存在しない）

- [ ] **Step 3: 実装**

`scripts/build-scoped-config.sh`:

```bash
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

# 契約 ID をパスに展開する前に必ず検証する（runtime ディレクトリの外へ書かせない）
valid_contract_id "$cid" || { harness_err "contract_id の形式が不正です"; exit 3; }

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
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS、`FAIL=0`

- [ ] **Step 5: コミット**

```bash
chmod +x scripts/build-scoped-config.sh
git add scripts/build-scoped-config.sh tests/run-tests.sh
git commit -m "feat(aws-harness): 環境消毒リストと契約専用 config の配置を実装"
```

---

### Task 3: STS による Identity 照合

**Files:**
- Create: `scripts/verify-identity.sh`
- Create: `tests/fakes/aws`
- Modify: `tests/run-tests.sh`

**Interfaces:**
- Consumes: `mask_account()`（Task 1）
- Produces: `verify-identity.sh <contract-dir>` — exit 0 = 照合一致、exit 3 = 不一致・取得失敗。
  照合は Account の完全一致と ARN の前方一致の両方。

- [ ] **Step 1: fake aws と失敗するテストを書く**

`tests/fakes/aws`:

```bash
#!/usr/bin/env bash
# fake aws — sts get-caller-identity だけを模擬する
# FAKE_AWS_ACCOUNT / FAKE_AWS_ARN で応答を制御。FAKE_AWS_FAIL=1 で失敗させる。
if [ "${FAKE_AWS_FAIL:-0}" = "1" ]; then
  echo "fake aws: credential error" >&2
  exit 255
fi
if [ "${1:-}" = "sts" ] && [ "${2:-}" = "get-caller-identity" ]; then
  printf '{"UserId":"AROAEXAMPLE:session","Account":"%s","Arn":"%s"}\n' \
    "${FAKE_AWS_ACCOUNT:-000000000000}" \
    "${FAKE_AWS_ARN:-arn:aws:sts::000000000000:assumed-role/ExampleAgentReadOnly/session}"
  exit 0
fi
echo "fake aws: unsupported command: $*" >&2
exit 64
```

`tests/run-tests.sh` に追記（`echo "----"` の直前）:

```bash
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

# ARN 境界: 末尾 / を欠く契約は拒否し、接頭辞を共有する別ロールも通さない
BADC="$AWS_HARNESS_HOME/contracts/cccccccc-dddd-eeee-ffff-000011112222"
mkdir -p "$BADC"
jq -n --arg acct "$ACCT" \
  '{schema:1, aws:{account_id:$acct, region:"ap-northeast-1",
    credential:{provider:"aws-vault", profile:"example-agent"},
    expected_principal:{arn_prefix:("arn:aws:sts::"+$acct+":assumed-role/ExampleAgentReadOnly")}},
    authority:{mode:"read-only"}}' > "$BADC/contract.json"
printf '[profile example-agent]\n' > "$BADC/aws-config"
RC=$(FAKE_AWS_ACCOUNT="$ACCT" FAKE_AWS_ARN="$OKARN" \
  bash "$PLUG/scripts/verify-identity.sh" "$BADC" >/dev/null 2>&1; echo $?)
[ "$RC" = "3" ] && ok "arn_prefix が / で終わらない契約は拒否" \
  || bad "arn_prefix が / で終わらない契約は拒否" "rc=$RC"

SIBLING="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnlyAdmin/session"
[ "$(FAKE_AWS_ACCOUNT="$ACCT" FAKE_AWS_ARN="$SIBLING" verify)" = "3" ] \
  && ok "接頭辞を共有する別ロールは拒否" || bad "接頭辞を共有する別ロールは拒否" "rc != 3"

# Account ID が生のまま出ないこと
ERRTXT=$(FAKE_AWS_ACCOUNT=000000000001 bash "$PLUG/scripts/verify-identity.sh" \
  "$AWS_HARNESS_HOME/contracts/$CID" 2>&1 >/dev/null)
echo "$ERRTXT" | grep -q "000000000001" \
  && bad "エラー出力に Account ID を出さない" "生の ID が出力された" \
  || ok "エラー出力に Account ID を出さない"
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（`verify-identity.sh` が存在しない）

- [ ] **Step 3: 実装**

`scripts/verify-identity.sh`:

```bash
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

# arn_prefix は必ずロール名の直後の / まで含める。末尾 / を欠くと
# 接頭辞を共有する別ロール（ExampleAgentReadOnlyAdmin 等）を通してしまう
case "$want_arn" in
  */) : ;;
  *) harness_err "契約の arn_prefix は / で終わる必要があります"; exit 3 ;;
esac

ident=$(aws sts get-caller-identity --output json 2>/dev/null) || {
  harness_err "AWS の認証情報を取得できません（再認証が必要です）"
  exit 3
}

got_acct=$(printf '%s' "$ident" | jq -r '.Account // empty' 2>/dev/null)
got_arn=$(printf '%s' "$ident" | jq -r '.Arn // empty' 2>/dev/null)

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
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS、`FAIL=0`

- [ ] **Step 5: コミット**

```bash
chmod +x scripts/verify-identity.sh tests/fakes/aws
git add scripts/verify-identity.sh tests/fakes/aws tests/run-tests.sh
git commit -m "feat(aws-harness): STS による Account/ロール照合を実装"
```

---

### Task 4: 合流点 shim

**Files:**
- Create: `scripts/harness-launch.sh`
- Create: `tests/fakes/aws-vault`
- Create: `tests/fakes/claude`
- Modify: `tests/run-tests.sh`

**Interfaces:**
- Consumes: `resolve-contract.sh`（Task 1）、`build-scoped-config.sh`（Task 2）、
  `verify-identity.sh`（Task 3）
- Produces: `harness-launch.sh [引数...]` — 実 Agent CLI を exec する。
  実 CLI のパスは `$AWS_HARNESS_REAL_CLI`（未設定時は `$HOME/.local/bin/claude`）。
  契約セッションでは `AWS_HARNESS_CONTRACT_ID` と `AWS_HARNESS_LAUNCHED=1` を export する。

- [ ] **Step 1: fake と失敗するテストを書く**

`tests/fakes/aws-vault`:

```bash
#!/usr/bin/env bash
# fake aws-vault — exec <profile> -- <cmd...> だけを模擬する
# FAKE_VAULT_FAIL=1 で credential 取得失敗を模擬。
if [ "${FAKE_VAULT_FAIL:-0}" = "1" ]; then
  echo "fake aws-vault: no credentials" >&2
  exit 1
fi
if [ "${1:-}" = "exec" ]; then
  shift
  profile="${1:-}"; shift
  [ "${1:-}" = "--" ] && shift
  export FAKE_VAULT_PROFILE="$profile"
  exec "$@"
fi
echo "fake aws-vault: unsupported: $*" >&2
exit 64
```

`tests/fakes/claude`:

```bash
#!/usr/bin/env bash
# fake claude — 起動時の環境を JSON で書き出して終了する
out="${FAKE_CLI_ENV_OUT:-/dev/stdout}"
{
  printf '{'
  printf '"contract_id":"%s",' "${AWS_HARNESS_CONTRACT_ID:-}"
  printf '"launched":"%s",' "${AWS_HARNESS_LAUNCHED:-}"
  printf '"config_file":"%s",' "${AWS_CONFIG_FILE:-}"
  printf '"creds_file":"%s",' "${AWS_SHARED_CREDENTIALS_FILE:-}"
  printf '"profile":"%s",' "${AWS_PROFILE:-}"
  printf '"endpoint":"%s",' "${AWS_ENDPOINT_URL:-}"
  printf '"vault_profile":"%s",' "${FAKE_VAULT_PROFILE:-}"
  printf '"args":"%s"' "$*"
  printf '}\n'
} > "$out"
exit 0
```

`tests/run-tests.sh` に追記:

```bash
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
RC=$(cd "$R" && FAKE_CLI_ENV_OUT="$WORK/env.json" \
  FAKE_AWS_ACCOUNT="$ACCT" \
  FAKE_AWS_ARN="arn:aws:sts::$ACCT:assumed-role/ExampleAgentReadOnly/session" \
  AWS_PROFILE=leaked AWS_ENDPOINT_URL=http://evil.example \
  bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1; echo $?)
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
[ "$(envget vault_profile)" = "example-agent" ] && ok "契約の profile で credential を取る" \
  || bad "契約の profile で credential を取る" "p=$(envget vault_profile)"

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

RC=$(cd "$R" && FAKE_CLI_ENV_OUT="$WORK/env2.json" AWS_HARNESS_LAUNCHED=1 \
  bash "$PLUG/scripts/harness-launch.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "0" ] && ok "既に shim 経由なら再検証せず素通しする（再帰防止）" \
  || bad "既に shim 経由なら再検証せず素通しする（再帰防止）" "rc=$RC"
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（`harness-launch.sh` が存在しない）

- [ ] **Step 3: 実装**

`scripts/harness-launch.sh`:

```bash
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
for v in $("$SCRIPT_DIR/build-scoped-config.sh" --list-unset); do
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

# credential を先に取れるか確かめる。exec してしまうと aws-vault 自身の終了コードが
# そのまま漏れ、「拒否は exit 3」の契約が破れるため（aws-vault はセッションを
# キャッシュするので、続く exec で再認証が二度求められることは通常ない）
aws-vault exec "$profile" -- true \
  || { harness_err "credential を取得できません（aws-vault）"; exit 3; }

exec aws-vault exec "$profile" -- "$SCRIPT_DIR/harness-verify-then-exec.sh" "$@"
```

`scripts/harness-verify-then-exec.sh`（aws-vault の内側で走る）:

```bash
#!/usr/bin/env bash
# aws-vault exec の内側で照合し、通れば実 CLI を exec する
set -u

SCRIPT_DIR="${AWS_HARNESS_SCRIPT_DIR:?}"
. "$SCRIPT_DIR/harness-lib.sh"

"$SCRIPT_DIR/verify-identity.sh" "${AWS_HARNESS_CONTRACT_DIR:?}" || exit 3

real_cli="${AWS_HARNESS_REAL_CLI:?}"
[ -x "$real_cli" ] || { harness_err "Agent CLI が見つかりません: $real_cli"; exit 3; }
exec "$real_cli" "$@"
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS、`FAIL=0`

- [ ] **Step 5: コミット**

```bash
chmod +x scripts/harness-launch.sh scripts/harness-verify-then-exec.sh \
         tests/fakes/aws-vault tests/fakes/claude
git add scripts/harness-launch.sh scripts/harness-verify-then-exec.sh \
        tests/fakes/aws-vault tests/fakes/claude tests/run-tests.sh
git commit -m "feat(aws-harness): 合流点 shim（消毒・config固定・STS照合・exec）を実装"
```

---

### Task 5: PreToolUse(Bash) の deny フック

**Files:**
- Create: `scripts/hooks/guard-bash.sh`
- Modify: `tests/run-tests.sh`

**Interfaces:**
- Produces: `guard-bash.sh` — フック入力 JSON を stdin から読む。
  契約セッションで禁止コマンドを検出したら `exit 2`、それ以外は `exit 0`。
  **jq 不在・JSON 破損・想定外入力もすべて `exit 2`**（exit 1 は素通りするため）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/run-tests.sh` に追記:

```bash
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（`guard-bash.sh` が存在しない）

- [ ] **Step 3: 実装**

`scripts/hooks/guard-bash.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse(Bash): 保護対象リポジトリでの Identity 変更操作を deny する
# 検出であって境界ではない（境界は IAM と実行環境の隔離が担う）
#
# 保護対象かどうかは「cwd に .aws-harness があるか」で判定する。
# shim が export する環境変数に依存しないため、shim を経ない起動でも作動する。
set -u

deny() { printf 'aws-harness: %s\n' "$1" >&2; exit 2; }

# 標準入力の読み取りに外部コマンド（cat）を使わない。PATH が壊れた環境でも
# 「保護対象でなければ素通しする」を成立させるため
input=""
IFS= read -r -d '' input
# 0バイト入力は「どのプロジェクトか判定できない」状態なので deny に倒す
# （jq は空入力に rc=0 を返すため、後段の終了コード検査では捕まえられない）
[ -n "$input" ] || deny "フック入力が空です"

# 作業ディレクトリの決定（jq を使わずに済む経路を先に試す）
proj="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$proj" ] && command -v jq >/dev/null 2>&1; then
  # cwd 欠落（空文字）は $PWD へフォールバックしてよいが、JSON 自体が壊れていて
  # jq が解釈できない場合はフォールバックせず deny する（$PWD を信用しない）
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
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS、`FAIL=0`

- [ ] **Step 5: コミット**

```bash
chmod +x scripts/hooks/guard-bash.sh
git add scripts/hooks/guard-bash.sh tests/run-tests.sh
git commit -m "feat(aws-harness): PreToolUse(Bash) の deny フックを実装（解析不能は deny）"
```

---

### Task 6: フック共通ライブラリの抽出とフック2本の実装

**Files:**
- Create: `scripts/hooks/hook-lib.sh`
- Modify: `scripts/hooks/guard-bash.sh`（共通ライブラリへ移行）
- Create: `scripts/hooks/guard-files.sh`
- Create: `scripts/hooks/guard-prompt.sh`
- Modify: `tests/run-tests.sh`

**Interfaces:**
- Produces: `hook-lib.sh` — 3フックが共有する関数。`deny()` / `hook_read_input()` /
  `hook_project_dir()` / `hook_require_jq()`
- Produces: `guard-files.sh` — PreToolUse(Read/Edit/Write) 用。`tool_input.file_path` が
  AWS 認証設定・契約・shim・フック自身を指していたら `exit 2`。
- Produces: `guard-prompt.sh` — UserPromptSubmit 用。保護対象で shim を経ていない、
  または STS 照合が通らなければ `exit 2`（プロンプトを止める）。

**なぜ共通ライブラリを先に作るのか**: 入力の読み取り・保護対象の判定・deny への
倒し方は3フックで完全に同じで、しかも fail-closed の要になる。Task 5 の実装中に
この共通部分のバグ（`cat` への PATH 依存 / jq のパース失敗の未検査 / 0バイト入力の
素通し）が3回見つかり、そのたびに全フックへ同じ修正を配る必要があった。
1箇所に集約すれば、次の修正が1回で済み、フック間の挙動のずれも起きない。

- [ ] **Step 0: 共通ライブラリを抽出し、guard-bash.sh を移行する**

`scripts/hooks/guard-bash.sh` の実装から、次の共通部分を `scripts/hooks/hook-lib.sh`
へ切り出す（**Task 5 で実証済みの挙動を変えないこと**）。

- `deny()` — メッセージを stderr に出して `exit 2`
- `hook_read_input()` — 外部コマンドに依存せず stdin を読む。0バイトなら deny
- `hook_project_dir()` — `CLAUDE_PROJECT_DIR` → 入力の `cwd` → `$PWD` の順で解決。
  jq が入力を解釈できない場合は deny（`$PWD` へフォールバックしない）
- `hook_require_jq()` — jq が無ければ deny

**関数は結果をグローバル変数に代入する（標準出力に返さない）。**
`input=$(hook_read_input)` の形にすると、関数内の `exit 2` がサブシェルを終えるだけで
親スクリプトは続行してしまい、**deny がすべて無効化される**。この落とし穴を避けるため、
`hook_read_input` は `HOOK_INPUT` に、`hook_project_dir` は `HOOK_PROJECT_DIR` に代入し、
呼び出し側は代入後の変数を読む。

`guard-bash.sh` をこのライブラリを使う形に書き換え、**既存78ケースがそのまま通ること**を
確認してから次へ進む。ここでテストが1件でも落ちたら、挙動を変えてしまっている。

- [ ] **Step 1: 失敗するテストを書く**

`tests/run-tests.sh` に追記:

```bash
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

RC=$(printf 'not json' | CLAUDE_PROJECT_DIR="$GUARDED" \
  bash "$PLUG/scripts/hooks/guard-files.sh" >/dev/null 2>&1; echo $?)
[ "$RC" = "2" ] && ok "ファイルフックの JSON 破損は deny" || bad "ファイルフックの JSON 破損は deny" "rc=$RC"

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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（2つのフックが存在しない）

- [ ] **Step 3: ファイル deny フックを実装**

`scripts/hooks/guard-files.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse(Read/Edit/Write): AWS 認証設定・契約・ハーネス自身への直接アクセスを deny する
# 入力の読み取り・保護対象の判定は hook-lib.sh に集約（3フックで共通）
set -u

# dirname は外部コマンドなので使わない。PATH が壊れた環境で解決に失敗すると
# ライブラリを読み込めず、bash の exit 1（非ブロッキング）に退化して素通りする
case "$0" in
  */*) HOOK_DIR=$(cd "${0%/*}" && pwd) ;;
  *)   HOOK_DIR=$(pwd) ;;
esac
. "$HOOK_DIR/hook-lib.sh"

hook_read_input                 # HOOK_INPUT に代入（サブシェルにしない）
hook_project_dir                # HOOK_PROJECT_DIR に代入

[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

hook_require_jq "ファイル操作の検査"

printf '%s' "$HOOK_INPUT" | jq -e . >/dev/null 2>&1 || deny "フック入力が JSON ではありません"
path=$(printf '%s' "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) \
  || deny "フック入力を解析できません"

[ -n "$path" ] || exit 0

harness_root="${AWS_HARNESS_HOME:-$HOME/.claude/aws-harness}"
plugin_root="${AWS_HARNESS_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-}}"

case "$path" in
  "$HOME/.aws/"*|*"/.aws/"*)  deny "AWS 認証設定への直接アクセスを禁止しています" ;;
  "$harness_root"/*)          deny "契約およびハーネスの内部ファイルへのアクセスを禁止しています" ;;
esac

if [ -n "$plugin_root" ]; then
  case "$path" in
    "$plugin_root"/scripts/*) deny "ハーネス自身のスクリプトへのアクセスを禁止しています" ;;
  esac
fi

exit 0
```

- [ ] **Step 4: プロンプト enforcement フックを実装**

`scripts/hooks/guard-prompt.sh`:

```bash
#!/usr/bin/env bash
# UserPromptSubmit: 保護対象で Identity が契約と食い違っていたらプロンプトを止める
# SessionStart はブロックできないため、実効的な停止はここで行う
#
# 2つのことを検出する:
#   1. shim を経ずに起動された（保護対象なのに契約 ID が立っていない）
#   2. セッション中に Identity が契約と食い違った
set -u

# dirname は外部コマンドなので使わない。PATH が壊れた環境で解決に失敗すると
# ライブラリを読み込めず、bash の exit 1（非ブロッキング）に退化して素通りする
case "$0" in
  */*) HOOK_DIR=$(cd "${0%/*}" && pwd) ;;
  *)   HOOK_DIR=$(pwd) ;;
esac
. "$HOOK_DIR/hook-lib.sh"

hook_read_input                 # HOOK_INPUT に代入（サブシェルにしない）
hook_project_dir                # HOOK_PROJECT_DIR に代入

# 保護対象でなければ干渉しない
[ -f "$HOOK_PROJECT_DIR/.aws-harness" ] || exit 0

# 検出1: 保護対象なのに shim を経ていない
[ -n "${AWS_HARNESS_CONTRACT_ID:-}" ] \
  || deny "このリポジトリは契約を必須としていますが、aws-harness の shim を経ずに起動されています。セッションを終了し、shim 経由で起動し直してください"

# 検出2: Identity が契約と食い違っていないか
script_dir="${AWS_HARNESS_SCRIPT_DIR:-}"
[ -n "$script_dir" ] || script_dir="${CLAUDE_PLUGIN_ROOT:-}/scripts"
cdir="${AWS_HARNESS_CONTRACT_DIR:-}"

[ -n "$cdir" ] || deny "契約の場所が分かりません（セッションを終了して起動し直してください）"
[ -x "$script_dir/verify-identity.sh" ] || deny "照合スクリプトが見つかりません"

"$script_dir/verify-identity.sh" "$cdir" >/dev/null 2>&1 \
  || deny "現在の AWS Identity が契約と一致しません。セッションを終了して起動し直してください"

exit 0
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS、`FAIL=0`

- [ ] **Step 6: コミット**

```bash
chmod +x scripts/hooks/guard-files.sh scripts/hooks/guard-prompt.sh
git add scripts/hooks/guard-files.sh scripts/hooks/guard-prompt.sh tests/run-tests.sh
git commit -m "feat(aws-harness): ファイル deny と UserPromptSubmit の enforcement を実装"
```

---

### Task 7: プラグイン配線・テンプレート・ドキュメント

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `hooks/hooks.json`
- Create: `skills/aws-harness/SKILL.md`
- Create: `templates/aws-harness.example`
- Create: `templates/contract.example.json`
- Create: `templates/aws-config.example`
- Create: `templates/iam-policy.example.json`
- Modify: `marketplace.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `tests/run-tests.sh`

**Interfaces:**
- Consumes: 全スクリプト（Task 1〜6）
- Produces: プラグインとして配布可能な状態

- [ ] **Step 1: 失敗するテストを書く**

`tests/run-tests.sh` に追記:

```bash
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
LEAK=$(grep -rEn '(/Users/|/home/[^/]+/|[a-z0-9-]+\.awsapps\.com)' \
  "$PLUG/scripts" "$PLUG/templates" "$PLUG/skills" "$PLUG/tests" 2>/dev/null \
  | grep -v '\$HOME' | head -5)
[ -z "$LEAK" ] && ok "個人パス・SSO URL がコミット対象に無い" \
  || bad "個人パス・SSO URL がコミット対象に無い" "$LEAK"

ACCTLEAK=$(grep -rEn '(^|[^0-9a-zA-Z-])[0-9]{12}([^0-9a-zA-Z-]|$)' \
  "$PLUG/scripts" "$PLUG/templates" "$PLUG/skills" 2>/dev/null \
  | grep -v '000000000000' | head -5)
[ -z "$ACCTLEAK" ] && ok "例示以外の Account ID がコミット対象に無い" \
  || bad "例示以外の Account ID がコミット対象に無い" "$ACCTLEAK"
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `bash tests/run-tests.sh`
Expected: FAIL（マニフェスト・hooks.json が存在しない）

- [ ] **Step 3: マニフェストとフック配線を作る**

`.claude-plugin/plugin.json`:

```json
{
  "name": "aws-harness",
  "version": "0.1.0",
  "description": "契約のあるリポジトリで Agent CLI を起動したとき、AWS の Identity を起動前に固定する。追跡ファイルの不透明な契約 ID からローカル契約を解決し、環境を消毒し、契約専用の最小 AWS config に固定し、STS で実 Identity を照合してから起動する。契約が壊れているときは起動を拒否する（fail-closed）。Identity の誤選択を防ぐことが目的であり、prompt injection に対するセキュリティ境界ではない。",
  "author": {
    "name": "haboshi",
    "email": "haboshi@allambitious.co.jp"
  }
}
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'AWS_HARNESS_PLUGIN_ROOT=\"${CLAUDE_PLUGIN_ROOT}\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/guard-bash.sh\"'",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "Read|Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'AWS_HARNESS_PLUGIN_ROOT=\"${CLAUDE_PLUGIN_ROOT}\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/guard-files.sh\"'",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash -c 'AWS_HARNESS_PLUGIN_ROOT=\"${CLAUDE_PLUGIN_ROOT}\" \"${CLAUDE_PLUGIN_ROOT}/scripts/hooks/guard-prompt.sh\"'",
            "timeout": 15
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: テンプレートを作る**

`templates/aws-harness.example`（リポジトリの `.aws-harness` の雛形）:

```
contract_id: a3f1c9d2-7b64-4e0a-9c15-2d8ef60b71a4
required: true
```

`templates/contract.example.json`:

```json
{
  "schema": 1,
  "contract_id": "a3f1c9d2-7b64-4e0a-9c15-2d8ef60b71a4",
  "project": "example-project",
  "aws": {
    "account_id": "000000000000",
    "region": "ap-northeast-1",
    "credential": {
      "provider": "aws-vault",
      "profile": "example-agent"
    },
    "expected_principal": {
      "arn_prefix": "arn:aws:sts::000000000000:assumed-role/ExampleAgentReadOnly/"
    }
  },
  "authority": {
    "mode": "read-only"
  }
}
```

`templates/aws-config.example`:

```
[profile example-agent]
region = ap-northeast-1
role_arn = arn:aws:iam::000000000000:role/ExampleAgentReadOnly
source_profile = example-agent-base

[profile example-agent-base]
region = ap-northeast-1
```

`templates/iam-policy.example.json`（最小権限。管理ポリシーを使わない）:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadOnlyInvestigation",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:Describe*",
        "cloudwatch:Get*",
        "cloudwatch:List*",
        "logs:Describe*",
        "logs:Get*",
        "logs:FilterLogEvents",
        "ecs:Describe*",
        "ecs:List*",
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyCredentialExposure",
      "Effect": "Deny",
      "Action": [
        "iam:CreateAccessKey",
        "iam:UpdateAccessKey",
        "secretsmanager:GetSecretValue",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "sts:AssumeRole"
      ],
      "Resource": "*"
    }
  ]
}
```

- [ ] **Step 5: SKILL.md を書く**

`skills/aws-harness/SKILL.md`:

```markdown
---
name: aws-harness
description: プロジェクトごとに AWS の Identity を Agent CLI の起動前に固定する。契約の作成・追跡マーカーの配置・起動元の切り替え・拒否されたときの復旧を扱う。Use when setting up per-project AWS identity pinning, when a session is refused with an aws-harness message, when adding a new project to the harness, or when an AWS operation is denied by the harness guards. Triggers — "aws-harness", "契約", "Identity 固定", "起動が拒否される", "profile を切り替えたい", "誤アカウント".
---

# aws-harness

契約のあるリポジトリで Agent CLI を起動すると、契約の AWS Account 以外を
SDK・CLI が名前で解決できない状態になる。契約が壊れていれば起動しない。

**この仕組みが防ぐもの**: 人間・Agent いずれによる Identity の誤選択。
**防がないもの**: prompt injection や悪意あるコードによる能動的な認証情報の窃取。
同一 OS ユーザーで動く以上、ファイルを直接読む経路は塞げない。

## 新しいプロジェクトを保護下に置く

1. 対象アカウントに読み取り専用ロールを作る（`templates/iam-policy.example.json` を出発点にする）。
   AWS 管理ポリシーは使わない — AWS 側で更新され権限が予告なく広がるため。
2. 契約 ID を生成する: `uuidgen | tr 'A-Z' 'a-z'`
3. 契約ディレクトリを作る:
   `~/.claude/aws-harness/contracts/<contract-id>/` に
   `contract.json`（`templates/contract.example.json` を編集）と
   `aws-config`（`templates/aws-config.example` を編集）を置く。
4. リポジトリに `.aws-harness` を追加してコミットする（`templates/aws-harness.example` 参照）。
   このファイルは契約 ID だけを含み、Account 名も実名も含まない。
5. 起動元を shim に向ける（下記）。

## 起動元を shim に向ける

shim は `~/.claude/aws-harness/bin/claude` に置く（プラグインの
`scripts/harness-launch.sh` への symlink）。起動経路は3つあり、すべて向ける。

- **Operator Harness**: リポジトリの既定ターミナル設定の起動コマンドを shim パスにする
- **対話シェルの alias**: alias の指す先を shim パスに変更する
- **PATH**: shim のディレクトリを PATH 前段に置く（補助）

## 起動が拒否されたとき

| メッセージ | 意味 | 対処 |
|---|---|---|
| 契約が見つかりません | `.aws-harness` はあるが契約実体がない | 契約ディレクトリを作る（新しい端末では未配布） |
| contract_id の形式が不正です | マーカーが壊れている | `.aws-harness` を修正する |
| AWS の認証情報を取得できません | credential の失効 | 再認証してから起動し直す |
| Account が契約と一致しません | 契約の期待値と実 Identity の食い違い | 契約か profile 設定を見直す |
| 現在の AWS Identity が契約と一致しません | セッション中に Identity が変わった | セッションを終了して再起動する |

## 制限

- credential は起動時に解決し、走行中は再取得しない。失効したセッションは再起動する。
- フックの文字列検査は検出であって境界ではない（難読化・SDK 直叩きで回避できる）。
  境界は IAM の権限と、将来の credential broker / 実行環境の隔離が担う。
```

- [ ] **Step 6: 両マニフェストに登録する**

両方の `marketplace.json` の `plugins` 配列に、以下を**同一内容で**追加する
（`skills` フィールドは付けない）。

```json
{
  "name": "aws-harness",
  "description": "プロジェクトごとに AWS Identity を Agent CLI の起動前に固定し、契約が壊れているときは起動を拒否する",
  "source": "./aws-harness",
  "strict": false,
  "version": "0.1.0",
  "category": "development-tools",
  "keywords": [
    "aws",
    "identity",
    "execution-contract",
    "fail-closed",
    "hooks",
    "harness",
    "認証",
    "アカウント固定",
    "誤操作防止"
  ]
}
```

- [ ] **Step 7: テストを実行して通過を確認**

Run: `bash tests/run-tests.sh`
Expected: PASS（全ケース）、`FAIL=0`

- [ ] **Step 8: コミット**

```bash
git add .claude-plugin/plugin.json hooks/hooks.json skills/aws-harness/SKILL.md \
        templates/ tests/run-tests.sh ../marketplace.json ../.claude-plugin/marketplace.json
git commit -m "feat(aws-harness): プラグイン配線・テンプレート・スキル文書を追加し marketplace に登録"
```

---

## パイロット導入（手動・承認が必要）

自動実行しない。実施前に個別に承認を得る。

**承認が必要な操作:**
1. 対象アカウントへの読み取り専用ロールの作成（AWS 側の変更）
2. Operator Harness の既定ターミナル設定の変更
3. シェル alias の変更

**DoD（8項目・すべて実機で確認する）:**

- [ ] shim 経由で起動し STS 照合が通る
- [ ] 誤 Account を指す契約に差し替えると拒否される
- [ ] `.aws-harness` に対応する契約を一時退避すると起動が拒否される（fail-closed の実証）
- [ ] セッション内で SDK から契約以外の profile が名前解決できない
  （`python3 -c "import boto3;print(boto3.Session().available_profiles)"` が契約の1件のみ）
- [ ] フックの依存（jq）を PATH から外すと deny 側に倒れる（fail-open しない）
- [ ] shim を経ない Agent CLI の起動がフックで deny される
- [ ] 書込系の AWS 操作が IAM で拒否される
- [ ] profile 切替コマンドがフックで deny される

## 自己レビュー結果

**仕様カバレッジ**: 設計書 v2 の各節に対応するタスクを確認した。
契約スキーマ = Task 1 / 環境消毒 = Task 2 / STS 照合 = Task 3 / 合流点 shim = Task 4 /
enforcement = Task 5・6 / 公開非公開分割と marketplace 登録 = Task 7 /
最小権限ポリシー = Task 7 のテンプレート / DoD 8項目 = パイロット節。

**設計書との差分（意図的な変更）**: 契約実体を YAML から JSON に変更した。
既存プラグインが jq に依存済みで、bash から YAML を安全に解析する追加依存
（yq）を避けるため。追跡マーカーは1行の `key: value` なので awk で読む。

**着手前スキャンで直した欠陥（2026-08-08）**:

1. Task 3 のテストに構文エラー（行継続の直後にセミコロン）があったので書き直した。
2. フックの保護対象判定を `AWS_HARNESS_CONTRACT_ID` の有無から `.aws-harness` の有無に
   変更した。フックが shim の環境変数を継承する保証がなく、継承されない場合に
   フックが黙って無効化される（fail-open）ため。この変更で副次的に
   **shim を経ない起動を検出して止められる**ようになった（`UserPromptSubmit`）。
3. `PATH` を潰す依存不在テストで `bash` 自体が起動できなくなっていたので、
   絶対パスの `/bin/bash` に変えた。あわせて「非保護対象は依存不在でも素通しする」
   ケースを追加した（jq の無い環境で無関係なプロジェクトを巻き込まないため）。
4. `hooks.json` で `CLAUDE_PLUGIN_ROOT` を環境変数として明示的に渡すようにした。
   公式仕様ではコマンド文字列のプレースホルダであり、スクリプト内で環境変数として
   参照できる保証がないため。

**型・名前の整合**: `harness_home()` / `mask_account()` / `valid_contract_id()`（Task 1 定義）が
Task 2・3 で同名で使われること、`AWS_HARNESS_CONTRACT_ID` / `AWS_HARNESS_LAUNCHED` /
`AWS_HARNESS_CONTRACT_DIR` / `AWS_HARNESS_SCRIPT_DIR` / `AWS_HARNESS_REAL_CLI` /
`AWS_HARNESS_HOME` / `AWS_HARNESS_PLUGIN_ROOT` の綴りが Task 4・5・6 で一致することを確認した。
`resolve-contract.sh` の出力形式（`PASSTHROUGH` / `RESOLVED <dir>`）は Task 1 で定義し
Task 4 で消費する。
