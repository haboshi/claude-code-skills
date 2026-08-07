# aws-harness P1 設計書 — Execution Contract による AWS Identity の起動前固定

- 日付: 2026-08-08
- ステータス: レビュー待ち
- 対象 Phase: P1（Execution Contract + launcher shim + 多層防御フック）

## 背景と目的

Claude Code を含む Coding Agent の運用では、「どの AWS Account / Role で動くか」を
Agent の推論（LLM による profile 選択）に委ねると、誤 Account 操作・Identity confusion の
リスクが構造的に残る。本設計は次の原則を実装する。

> Identity は Meta Harness が選ぶ。Authority は IAM が制限する。
> Agent は与えられた一つの世界の中だけで推論する。

### 確認済み前提（設計時に実測した事実）

- Operator Harness（Orca）は Claude Code を `--dangerously-skip-permissions` 付きで
  起動する（親プロセスツリーで実測）。permission prompt に依存する防御は効かない前提で設計する。
- PreToolUse フックは permission mode と独立に発火する（Claude Code 公式仕様）。
  したがってフックは skip-permissions 下でも防衛線として機能する。
- `claude` 実体は `~/.local/bin/claude`（symlink）であり、Operator Harness はログインシェル
  経由で起動する。PATH 前段の shim で起動を横取りできる。
- git worktree に gitignored ファイルは伝播しない。worktree ベースの並列運用では
  リポジトリ内 gitignored 設定ファイルは新規 worktree で欠落する。
- 既存の credential 運用は aws-vault（Keychain 保管）+ IAM Identity Center 併用。
  既存 profile 群に readonly ロールは存在しないため、パイロットでは AgentReadOnly ロールの
  新設が前提となる。

## スコープ / 非スコープ

**P1 スコープ**:
- Execution Contract スキーマ（v1）と中央ストア
- 透過 launcher shim（contract 解決 → credential 取得 → STS 照合 → fail-closed → exec）
- PreToolUse deny フック + SessionStart 照合フック
- パイロット1案件での DoD 検証

**非スコープ（P2 以降 / 対象外）**:
- AWS Operator Subagent + single-profile AWS MCP（P2）
- Operator Harness の runtime isolation 見直し（P3）
- Identity Broker / Policy Control Plane（長期構想）
- 権限昇格（write elevation）フローの自動化（P1 は read-only 固定のみ）

## 公開 / 非公開の分割（プライバシー境界）

本リポジトリは公開リポジトリであるため、成果物を次の2つに分割する。

| 区分 | 置き場所 | 内容 |
|---|---|---|
| 公開（本プラグイン） | `aws-harness/` | スキーマ・shim スクリプト・フック・テンプレート・ドキュメント。すべてプレースホルダ表記 |
| 非公開（ローカル実体） | `~/.claude/aws-harness/` | 実際の Account ID・Role ARN・profile 名を含む contract 群。コミット対象外 |

コミット禁止対象: AWS Account ID、Role ARN、実プロジェクト名・顧客名、
SSO start URL、作業者のユーザディレクトリ絶対パス（rules/path-privacy 準拠）。

## アーキテクチャ

```
【公開】aws-harness/ プラグイン
├── .claude-plugin/plugin.json
├── skills/aws-harness/SKILL.md      # セットアップ・contract 書式・運用ガイド
├── scripts/
│   ├── claude-shim.sh               # 透過ラッパー本体（bash 3.2 互換）
│   ├── resolve-contract.sh          # git remote URL → contract 解決
│   ├── verify-identity.sh           # sts get-caller-identity 照合
│   └── hooks/
│       ├── deny-profile-switch.sh   # PreToolUse: profile 切替系 deny
│       └── session-verify.sh        # SessionStart: STS 再照合 + 通知
├── templates/contract.example.yaml  # プレースホルダのみ
└── tests/                           # fake aws / aws-vault による決定論テスト

【非公開】~/.claude/aws-harness/
├── bin/claude                       # shim への symlink（PATH 最前段に配置）
└── contracts/
    └── <project-slug>.yaml          # 実体 contract（1案件1ファイル）
```

### コンポーネントの責務

| コンポーネント | 責務 | 依存 |
|---|---|---|
| claude-shim.sh | 起動横取り・素通し判定・credential 取得・exec | resolve/verify、aws-vault、aws CLI |
| resolve-contract.sh | git remote URL から contract を一意解決 | git |
| verify-identity.sh | STS 実測値と contract 期待値の照合 | aws CLI |
| deny-profile-switch.sh | contract セッション内の Identity 変更操作を deny | jq（フック入力の解析） |
| session-verify.sh | セッション開始時の再照合と additionalContext 通知 | aws CLI |

## Execution Contract スキーマ（v1）

```yaml
version: 1
project: <project-slug>
match:
  remotes:
    - "git@github.com:<org>/<repo>.git"
    - "https://github.com/<org>/<repo>.git"
aws:
  account_id: "<12桁数字>"
  region: <region>
  credential:
    provider: aws-vault          # v1 の実装は aws-vault のみ。sso はスキーマ予約（P1 スコープ外）
    profile: <profile名>
  expected_principal:
    arn_pattern: "arn:aws:sts::<12桁数字>:assumed-role/<AgentRole>/*"
authority:
  mode: read-only               # v1 は read-only のみサポート
verification:
  fail_closed: true             # false は許可しない（スキーマ上は将来拡張用）
```

- contract に secret 値は一切入れない。「期待する Identity と Authority」のみを宣言する。
- `match.remotes` の URL 正規化: `.git` サフィックスと `git@`/`https://` 形式の差は
  解決時に正規化して同一視する。
- 同一 remote に複数 contract がマッチした場合はエラー終了（曖昧さを許さない）。

## Shim の動作フロー

```
claude 起動（人間・Operator Harness いずれ経由でも）
  │
  ├─ git リポジトリ外 / remote なし ──────────→ 素通し: 実 claude を exec
  ├─ contract 未登録 ────────────────────────→ 素通し: 実 claude を exec
  │
  └─ contract あり
       ├─ aws-vault exec <profile> -- （内側で以下を実行）
       │    ├─ aws sts get-caller-identity
       │    ├─ Account 不一致 or ARN pattern 不一致 → fail-closed（起動しない）
       │    └─ 一致 → AWS_REGION / AWS_DEFAULT_REGION 固定
       │             AWS_HARNESS_CONTRACT=<path> を export
       │             実 claude を exec
       └─ credential 取得失敗（セッション失効等）→ 対話 MFA → 失敗なら fail-closed
```

設計上の要点:
- **素通し既定**: contract がなければ従来と完全に同一挙動。非 AWS プロジェクトへの
  影響はゼロで、shim の不具合が全セッションを壊す事故を構造的に避ける。
- **プロセススコープの Identity**: credential は `aws-vault exec` の子プロセス環境にのみ
  存在する。セッション内から他 profile の credential には原理的に到達しない
  （Keychain 直接参照等の残余リスクはフックと P3 の runtime isolation で扱う）。
- **fail-closed**: 照合不一致・取得失敗・contract 解析エラーはすべて起動拒否。
  期待値と実測値（Account / ARN）を stderr に表示して終了する。

## 多層防御フック（contract セッション時のみ発動）

フックは `AWS_HARNESS_CONTRACT` 環境変数の有無で発動を判定する。
非 contract セッションでは一切干渉しない。

### PreToolUse（Bash）: deny-profile-switch.sh

以下のパターンを deny する（既存の secret 系ガードとは独立に同居）:

- `aws --profile <他profile>` / `AWS_PROFILE=` の設定
- `aws configure`（credential 書き換え）
- `aws sso login`（別 Identity の取得）
- `aws-vault` の呼び出し（別 context の起動）
- `~/.aws` 配下への書き込み（リダイレクト・cp・mv 等）

文字列 matching の限界（alias・subshell・SDK 直叩き）は既知の残余リスクとして受容し、
最終境界は IAM（read-only role）に置く。

### SessionStart: session-verify.sh

- `aws sts get-caller-identity` を再実行し contract と照合（compaction 後の再開や
  長時間セッションでの credential 差し替わりを検知）
- additionalContext で「このセッションは `<project>` の read-only Identity に固定されている。
  profile 切替・credential 変更操作は行わないこと」をモデルに通知する

## エラーハンドリング

| 事象 | 挙動 |
|---|---|
| contract YAML 解析エラー | fail-closed（エラー箇所を表示） |
| 同一 remote に複数 contract | fail-closed（候補一覧を表示） |
| aws-vault セッション失効 | 対話 MFA プロンプト → 失敗で fail-closed |
| STS 照合不一致 | fail-closed（期待/実測の Account・ARN を表示） |
| aws CLI / aws-vault 不在 | fail-closed（セットアップ手順を案内） |
| git 外・remote なし・contract なし | 素通し（正常系） |

## テスト戦略

- **決定論テスト**（コミットゲート対象）: `aws` / `aws-vault` / `git` を fake する
  bash テスト。実 AWS 呼び出しなし。カバーするケース:
  素通し3系（git外 / remote なし / contract なし）、照合一致、Account 不一致、
  ARN pattern 不一致、YAML 破損、複数マッチ、credential 取得失敗
- **フックテスト**: フック入力 JSON を与えて deny / allow の判定を検証
  （deny パターン網羅 + `$VAR` 参照など許可すべきケースの誤検知防止）
- **実機 DoD 検証**（パイロット案件、手動）:
  1. shim 経由で起動し、STS 照合パスを確認
  2. 誤 Account を指す contract で fail-closed を確認
  3. 書込系 AWS コマンドが IAM レベルで AccessDenied になることを確認
  4. profile 切替コマンドがフックで deny されることを確認

## パイロット導入手順（実体はローカル管理・本書はプレースホルダ）

1. 対象 Account に `AgentReadOnly` IAM ロールを作成
   （`ReadOnlyAccess` 管理ポリシー、trust は既存 IAM ユーザー）
   — AWS 側変更のため実行直前に承認を得る
2. `~/.aws/config` に assume-role 用 profile（`role_arn` + `source_profile`）を追加
3. `~/.claude/aws-harness/contracts/<project-slug>.yaml` を作成
4. `~/.claude/aws-harness/bin` を PATH 最前段に追加（shell rc に1行）
5. DoD 4項目を実機確認

## P2 / P3 概要（着手時に個別設計）

- **P2**: `aws-operator` subagent を定義し、single-profile AWS MCP を subagent の
  `mcpServers` に閉じ込める。main context に AWS MCP の tool schema を常載しない。
- **P3**: Operator Harness の起動フラグ方針（skip-permissions の扱い）、
  per-workspace environment recipe の調査、isolated $HOME の検討。

## 代替案と不採用理由

| 案 | 不採用理由 |
|---|---|
| 明示 launcher コマンド（opt-in） | Operator Harness が `claude` を直接起動するため主経路が素通りになる |
| フックのみ（起動前固定なし） | credential がセッションに常在し「起動時に世界を固定する」原則を満たさない |
| リポジトリ内 gitignored contract | 新規 worktree に伝播せず worktree 並列運用と相性が悪い |
| AWS MCP multi-profile | Identity 選択が LLM の推論に移り Project Context Boundary が弱まる |
