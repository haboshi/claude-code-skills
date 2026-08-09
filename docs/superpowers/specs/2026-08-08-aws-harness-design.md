# aws-harness P1 設計書 v2 — Execution Contract による AWS Identity の起動前固定

- 日付: 2026-08-08（v2。v1 は敵対的レビューで要改訂となり全面改訂）
- ステータス: レビュー待ち
- 対象 Phase: P1

## この設計が主張すること・しないこと

**主張する**: 人間・Agent いずれによる **Identity の誤選択を防ぐ**。契約のある
プロジェクトでは、起動した瞬間から SDK・CLI が契約の Account 以外を名前で解決できない。

**主張しない**: prompt injection や悪意ある依存コードに対するセキュリティ境界。
同一 OS ユーザーで動く以上、ファイルシステムを直接読む能動的な認証情報の窃取は防げない。
それは P2（credential broker）と P3（runtime isolation）の担当であり、P1 の看板ではない。

この区別は v1 のレビューで最も強く指摘された点で、設計の主張を実力に合わせて限定している。

## 確認済み前提（実測・公式ドキュメントで裏取り済み）

| 前提 | 確認方法 |
|---|---|
| Operator Harness は Agent CLI を `--dangerously-skip-permissions` 付きで起動する | 親プロセスツリーの実測 |
| シェル設定に Agent CLI のフルパス alias があり、対話ログインシェルでは PATH 探索が起きない | `whence -v` を対話/非対話で比較 |
| Agent CLI の実行パスは symlink で、auto-update が更新のたびに張り替える | バージョンディレクトリと symlink の更新時刻 |
| `AWS_CONFIG_FILE` の差し替えで、SDK が名前解決できる profile を契約の 1 つに限定できる | boto3 の `available_profiles` が 10 → 1 |
| Operator Harness は任意コマンドでのターミナル起動と、リポジトリ既定ターミナルの設定に対応する | Operator Harness の CLI ヘルプとスキルガイド |
| フックの exit code 2 のみがブロックし、exit 1 は非ブロッキング | 公式 hooks ドキュメント |
| SessionStart はブロックできない（stderr 表示のみ）。PreToolUse と UserPromptSubmit はブロックできる | 同上 |
| 追跡ファイルは worktree に伝播し、gitignored ファイルは伝播しない | git の仕様 |

## スコープ / 非スコープ

**P1**: 契約スキーマと中央ストア / 合流点 shim / ambient 認証ソースの遮断 /
enforcement フック / 最小権限ロール / パイロット1案件での DoD 検証

**非スコープ**: credential broker（P2）、runtime isolation（P3）、
権限昇格フローの自動化、Identity Broker / Policy Control Plane（長期）

## 公開 / 非公開の分割

本リポジトリは公開されているため、成果物を分割する。

| 区分 | 置き場所 | 内容 |
|---|---|---|
| 公開（プラグイン） | `aws-harness/` | スキーマ・shim・フック・テンプレート・テスト。すべてプレースホルダ |
| 追跡（各リポジトリ） | `<repo>/.aws-harness` | 不透明な契約 ID のみ。実名・Account を含まない |
| 非公開（ローカル） | `~/.claude/aws-harness/` | 実 Account ID・Role ARN・profile 名を含む契約実体 |

コミット禁止: Account ID、Role ARN、実プロジェクト名・顧客名、SSO start URL、
ユーザディレクトリの絶対パス。コミット前 grep をテストに含める。

marketplace 登録は本リポジトリの規約に従い、ルートと `.claude-plugin/` の
両マニフェストに追記する（`skills` フィールドは付けない）。

## アーキテクチャ

```
【公開】aws-harness/
├── .claude-plugin/plugin.json
├── skills/aws-harness/SKILL.md
├── scripts/
│   ├── harness-launch.sh            # 合流点 shim 本体（bash 3.2 互換）
│   ├── resolve-contract.sh          # .aws-harness の契約 ID → 契約実体
│   ├── verify-identity.sh           # STS 照合
│   ├── build-scoped-config.sh       # 契約専用の最小 AWS config を生成
│   └── hooks/
│       ├── guard-bash.sh            # PreToolUse(Bash)
│       ├── guard-files.sh           # PreToolUse(Read/Edit/Write)
│       └── guard-prompt.sh          # UserPromptSubmit（enforcement）
├── templates/
│   ├── contract.example.yaml
│   ├── aws-harness.example          # 追跡マーカーの例
│   └── iam-policy.example.json      # 最小権限ポリシーの雛形
└── tests/

【非公開】~/.claude/aws-harness/
├── bin/claude                       # shim への symlink（安定パス）
├── contracts/<contract-id>.yaml
└── runtime/<contract-id>/config     # 生成される最小 config（起動ごとに再生成）
```

## 契約の解決 — 不透明 ID による追跡マーカー

v1 の git remote URL マッチは、fork・複数 remote・URL 形式差に脆く、
worktree 伝播も保証されなかった。v2 では**リポジトリに追跡ファイルを置く**。

```
# <repo>/.aws-harness （コミットされる。実名も Account も含まない）
contract_id: a3f1c9d2-7b64-4e0a-9c15-2d8ef60b71a4
required: true
```

これで3つの問題が同時に解ける。追跡ファイルなので worktree に伝播し、
URL 正規化が不要になり、公開リポジトリに実名が出ない。

### 三分岐（fail-closed の成立）

| 状態 | 挙動 |
|---|---|
| `.aws-harness` なし | 素通し（AWS を使わないプロジェクト） |
| `.aws-harness` あり + 契約解決成功 + STS 照合一致 | 固定して起動 |
| `.aws-harness` あり + 契約なし・不正・照合不一致 | **起動拒否** |

v1 の「契約がなければ素通し」は、保護対象で契約が欠落したときに無防備で起動する
fail-open だった。マーカーの有無で「保護不要」と「保護が壊れている」を区別することで、
後者を拒否できる。

## 合流点 shim

PATH による横取りは alias とフルパス起動で成立しない。auto-update が張り替える
symlink も置き場所にできない。したがって **shim を安定パスに置き、起動元をそこに向ける**。

起動元は3経路あり、すべてを shim に向ける。

| 経路 | 向け方 |
|---|---|
| Operator Harness（主経路） | リポジトリ既定ターミナルの起動コマンドを shim パスにする |
| 対話シェルの alias | alias の指す先を shim パスに変更する |
| PATH 解決（非対話・スクリプト） | PATH 前段に shim を置く（補助） |

shim 自身は auto-update の影響を受けない安定パスに置き、実体の起動には
更新に追随する symlink パスを exec する。

### 起動フロー

```
harness-launch.sh
  ├─ .aws-harness なし ──────────────→ 素通し: 実 CLI を exec
  └─ .aws-harness あり
       ├─ 契約解決（ID → 契約ファイル）… 失敗なら拒否
       ├─ 環境の消毒（下記）
       ├─ 契約専用の最小 config を生成（契約の profile 1 つだけ）
       ├─ credential 取得（aws-vault / SSO）… 失敗なら拒否
       ├─ sts get-caller-identity で Account と ARN を照合… 不一致なら拒否
       └─ AWS_HARNESS_CONTRACT_ID を export して実 CLI を exec
```

無限再帰の防止: shim は `AWS_HARNESS_LAUNCHED=1` を立て、既に立っていれば
検証を再実行せず素通しする。

## ambient 認証ソースの遮断

契約セッションでは、SDK・CLI が契約以外の Account を**名前で解決できない**状態にする。

1. `AWS_CONFIG_FILE` を契約専用の最小 config（契約 profile 1 つのみ）に固定
2. `AWS_SHARED_CREDENTIALS_FILE` を空ファイルに固定
3. 危険な環境変数を unset: `AWS_PROFILE` / `AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_STS` /
   `AWS_CA_BUNDLE` / web identity・container credential 系
4. 契約の一時 credential は環境変数として保持（aws-vault が注入する）

3 は STS 照合そのものを偽装される経路を塞ぐためで、消毒は照合の**前**に行う。

**残余リスク（明記して受容する）**: 共有 config や SSO キャッシュをファイルパスで
直接読み、認証 API を自前で叩く経路は塞げない。これは誤選択ではなく能動的な窃取であり、
P2 / P3 の担当である。P1 は「事故を構造的に防ぐ」までを引き受ける。

## enforcement

ブロックできるフックにのみ enforcement を置く。すべて `AWS_HARNESS_CONTRACT_ID` が
立っているセッションでのみ発動し、それ以外には干渉しない。

| フック | 役割 | ブロック可否 |
|---|---|---|
| PreToolUse(Bash) | profile 切替・credential 変更・`~/.aws` 書き込み・shim を経ない CLI 起動を deny | 可 |
| PreToolUse(Read/Edit/Write) | `~/.aws`・契約ファイル・shim・フック自身への読み書きを deny | 可 |
| UserPromptSubmit | 契約と実 Identity の不整合を検知したらプロンプトを止める | 可 |
| SessionStart | 固定状態をモデルに通知するのみ（**enforcement には数えない**） | 不可 |

### フック実装の必須要件

- **解析不能・依存不在・想定外入力は必ず deny（exit 2）に変換する。** exit 1 は
  非ブロッキングとして扱われ素通りするため、`set -e` に任せてはならない。
- 文字列マッチには既知の限界（難読化・別インタプリタ・SDK 直叩き）がある。
  これは検出であって境界ではないと設計書に明記し、境界は IAM と P2/P3 に置く。

## 権限（Authority）

パイロットでも **AWS 管理ポリシーを使わず、最小権限のカスタマー管理ポリシー**を作る。

理由は2つ。AWS 管理ポリシーは AWS 側で更新され、付与済みのロールに自動適用される
（権限範囲が予告なく広がる）。また汎用の読み取り専用ポリシーは全サービスの
データ閲覧を許すため、調査に必要な範囲を大きく超える。

パイロットでは対象サービスを列挙した読み取り専用ポリシーから始め、
不足が出たら追加する（広く始めて絞るのではなく、狭く始めて広げる）。

## エラーハンドリング

| 事象 | 挙動 |
|---|---|
| `.aws-harness` なし | 素通し |
| 契約 ID が解決できない / YAML 破損 | 拒否 |
| credential 取得失敗・再認証失敗 | 拒否（TTY 非検出時は待たずに拒否） |
| STS 照合不一致 | 拒否（期待と実測の Account・ARN を表示。ID は末尾のみ） |
| 依存コマンド不在 | 拒否（セットアップ手順を案内） |
| フックの解析エラー | deny（exit 2） |

credential の失効は「起動時に解決し、走行中は再取得しない」モデルとする。
失効したセッションは拒否して再起動を促す。

## テスト戦略

**決定論テスト**（実 AWS 呼び出しなし。`aws` / `aws-vault` / `git` を fake する）:

- 素通し2系（マーカーなし / 既に shim 経由）
- 拒否6系: 契約なし・ID 不整合・YAML 破損・STS 不一致・credential 取得失敗・依存不在
- 消毒: 危険な環境変数が exec 前に消えていること
- スコープ config: 生成された config に契約の profile しか含まれないこと
- フック: deny パターン網羅、許可すべきケースの誤検知なし、**解析エラーが exit 2 になること**
- コミット前 grep: テンプレート・fixture に Account ID・SSO URL 形式が混入していないこと

**実機 DoD**（パイロット、手動。レビュー指摘を反映して v1 から4項目追加）:

1. shim 経由で起動し STS 照合が通る
2. 誤 Account を指す契約で拒否される
3. **契約ファイルを削除すると起動が拒否される**（fail-closed の実証）
4. **SDK から契約以外の profile が名前解決できない**
5. **フックの依存を壊すと deny 側に倒れる**（fail-open しない）
6. **shim を経ない CLI 起動が deny される**
7. 書込系 AWS 操作が IAM で拒否される
8. profile 切替コマンドがフックで deny される

## パイロット導入手順

1. 対象 Account に最小権限の読み取り専用ロールを作成（**AWS 側変更のため実行前に承認**）
2. assume-role 用 profile を追加
3. `~/.claude/aws-harness/contracts/<uuid>.yaml` を作成
4. 対象リポジトリに `.aws-harness` を追加してコミット
5. 起動元3経路を shim に向ける（**Operator Harness の既定ターミナル設定変更は実行前に承認**）
6. DoD 8項目を実機確認

## P2 / P3（着手時に個別設計）

- **P2 — credential broker**: single-profile の構造化アダプタを、単なるコンテキスト整理では
  なく **credential 境界**として設計する。Agent 本体に AWS の credential を渡さず、
  許可された読み取り操作だけを別プロセスが署名・実行する。P1 の残余リスク
  （ファイル直読みによる窃取）はここで初めて構造的に塞がる。
- **P3 — runtime isolation**: Operator Harness の per-workspace 使い捨てランタイム機能を
  評価する。自作せずに製品機能へ載せられる可能性があるため、まず実現可能性を確認する。

## 改訂履歴

### v1 → v2（2026-08-08）

敵対的レビュー（サブエージェント）と外部モデル評価（Codex）で、v1 が依拠していた
7つの前提が反証された。主なものは次のとおり。

| v1 の前提 | 反証 |
|---|---|
| PATH shim で起動を横取りできる | alias のフルパス指定と Operator Harness のフルパス起動で発火しない |
| symlink パスを横取り点にできる | auto-update が張り替える |
| credential は子プロセスに閉じ、他 profile に到達できない | 同一 OS ユーザーから ambient な認証ソースに到達できる |
| SessionStart 再照合で不整合を止められる | 公式仕様上ブロックできない |
| 契約がなければ素通しでよい | 保護対象で契約が壊れたときに無防備になる（fail-open） |
| 文字列 deny の限界は残余リスクとして受容できる | exit 1 が非ブロッキングのためフック故障自体が fail-open |
| 最終境界は読み取り専用ロール | 到達しうる全ロールが読み取り専用でなければ境界にならない |

v2 はこれらを、合流点 shim・不透明 ID の追跡マーカー・三分岐の fail-closed・
ambient 遮断・ブロック可能フックへの enforcement 集約・最小権限ポリシー・
主張範囲の限定で解消している。
