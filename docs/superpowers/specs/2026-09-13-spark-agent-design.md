# spark-agent 設計書（2026-09-13）

Spark Desktop を複数メールアカウント・カレンダーの統合層にし、Claude Code と Codex の両方から
「メール確認・返信下書き・カレンダー確認と更新・アカウント切り替え」を同じスキルで行えるようにする。

## 1. 目的と完了定義

| 要件 | 完了定義 |
|---|---|
| 両エージェントで利用 | `~/.agents/skills/spark-agent` に置いた 1 つの SKILL.md を Claude Code（symlink 経由）と Codex（`~/.agents/skills` 直読）が同じ内容で読み、同じ手順で同じ結果を出す |
| メール確認 | 現在アカウントの未読・Priority・返信待ちを一覧し、スレッド全文を読める |
| 下書き | 既存スレッドへの返信下書きを `--reply-to` 付きで作り、deep link を返す。送信はしない |
| カレンダー確認 | 今日・明日・今週の予定と空き時間を現在アカウントで出す |
| カレンダー更新 | 参加者なしのイベントを作成・変更・削除できる（send 権限を持つ個人アカウント 1 つで実機確認） |
| アカウント切り替え | `use <email|alias>` で現在アカウントを保存し、以後のコマンドが自動でそのアカウントにスコープされる |
| 評価で合格 | 4 層: (1) 偽 spark の bash テスト全 PASS (2) 実機 read/draft/calendar スモーク PASS (3) Codex から同スキルで実走して同結果 (4) /evaluate（Codex+Grok）で PASS |

## 2. 作らないもの（確認済み前提）

- コマンドリファレンス。正典は公式 `use-spark`（readdle/spark-cli-skills、metadata.version 1.3.1）と実機の
  `spark skill` 出力。`npx skills add` で `~/.agents/skills/use-spark` に導入し、本スキルは `requires.skills: use-spark` で依存を宣言する。
- OAuth・資格情報の管理。Spark CLI は Spark Desktop への IPC 薄クライアントで資格情報を持たない（SKILL.md L25 で確認）。
- ヘッドレス実行。CLI は Desktop セッション必須（同上）。cron/CI は対象外。
- 公式レシピ（morning-standup 等）の再実装。必要なら `npx skills add` で個別導入する。

## 3. 構成

```
spark-agent/                                  # プラグイン（このリポの規約どおり）
├── .claude-plugin/plugin.json
├── README.md
├── skills/spark-agent/
│   ├── SKILL.md                              # 日本語の運用規約（両エージェント共通）
│   ├── references/workflows.md               # 4 ワークフローの手順とプロンプト雛形
│   └── scripts/
│       ├── spark-ctx.sh                      # アカウント切り替えと自動スコープ
│       └── spark-doctor.sh                   # 環境診断
└── tests/
    ├── run-tests.sh                          # bash 3.2 互換・偽 spark で決定論
    └── fakes/spark
```

scripts/ を skills/spark-agent/ 配下に置くのは、skill ディレクトリ 1 つを `~/.agents/skills` に symlink すれば
両エージェントから scripts も見えるようにするため（Codex の progressive disclosure はスキルディレクトリ単位）。

### 3.1 spark-ctx.sh（アカウント切り替え）

状態は `${SPARK_AGENT_HOME:-$HOME/.config/spark-agent}/` の平文 2 ファイル（`context`: `account=<email>`、
`aliases`: `<name>=<email>` 行）。jq 等に依存しない。

| サブコマンド | 動作 |
|---|---|
| `use <email\|alias>` | `spark accounts` の出力に存在するアカウントだけ受理して保存。無ければ候補を列挙して exit 1 |
| `show` | 現在アカウントと、その access level（`spark accounts` から抽出） |
| `clear` | 文脈を消す（以後は Unified 横断） |
| `alias set <name> <email>` / `alias list` / `alias rm <name>` | 別名管理 |
| `run <spark subcommand> [args]` | 現在アカウントを注入して `spark` を実行（下表） |

`run` の注入規則（既に同種の引数があれば注入しない）:

| サブコマンド | 注入 |
|---|---|
| `emails` | 第 1 位置引数が無ければ `<acct>`、裸のフォルダ名（`Archive` 等）なら `<acct>:<folder>` |
| `folders` | 位置引数が無ければ `<acct>` |
| `search` | `--in` が無ければ `--in <acct>` |
| `draft` | `--account` が無く、かつ `--reply-to/--reply-all/--forward/--edit` も無ければ `--account <acct>` |
| `events` | `--in` が無ければ `--in <acct>` |
| `event create` | `--calendar` が無ければ `--calendar <acct>` |
| それ以外 | 素通し |

文脈が未設定なら注入せず素通しし、stderr に「Unified で実行」と 1 行出す。

安全ゲート: `run` で `action send`、`event create/update/delete/rsvp`、`draft --delete`（取り消し不能）は
`--confirm` を `run` の直後に付けたときだけ実行する。無ければ実行せず exit 3 と理由を出す。対象の動詞は
spark-ctx.sh の `GATED_*` が唯一の定義で、引数のどの位置にあっても検出する。`--confirm` は「このターンでユーザーが明示承認した」ときだけ付ける規約を SKILL.md に書く。
`SPARK_BIN` で実行バイナリを差し替えられる（テスト用）。

### 3.2 spark-doctor.sh（環境診断）

順に確認し、各行を `OK:` / `NG:` / `WARN:` で出す。NG が 1 つでもあれば exit 1。

1. OS が macOS または Windows
2. `spark` が PATH にある（無ければ `/usr/local/bin/spark` の有無と、Spark Desktop の Settings → AI Agents → Setup CLI を案内）
3. Spark Desktop プロセスが起動している（`pgrep -x "Spark Desktop"`。テスト用に `SPARK_AGENT_DESKTOP_CHECK=running|stopped|skip`）
4. `spark --version` と `use-spark/SKILL.md` の `metadata.version` の比較。CLI が新しければ `spark skill` での更新手順を WARN
5. `spark accounts` が通り、アカウントごとの access level を表示。`send` のアカウントは WARN で強調
6. 現在の文脈（spark-ctx show）

### 3.3 SKILL.md（運用規約）

frontmatter: `name: spark-agent`、日本語トリガーを含む description、`metadata.requires.skills: [use-spark]`、`metadata.requires.bins: [spark]`。
本文は次の順で短く:

1. 前提: 最初に `scripts/spark-doctor.sh`。NG なら作業せず案内を返す。コマンド詳細は use-spark を読む。
2. アカウント切り替え: `spark-ctx use` / `show`。ユーザーが会社名で言ったら alias を引く。
3. ワークフロー 4 本（references/workflows.md に手順）: メール確認（category:priority → personal → is:unreplied の順）、返信下書き（`thread` で最新 message ID を取り `--reply-to`、署名を書かない、deep link を返す）、カレンダー確認（`events` と `availability`）、カレンダー更新（参加者なしで `event create` → 確認 → 必要なら `--add`）。
4. 安全規約: 送信・event 変更は同ターンの明示承認後に `--confirm`。承認なしに送らない。`draft --delete` は依頼時のみ。クラウド LLM に本文が渡ることを扱うアカウントの規程で確認する。
5. 出力規約: 日本語、結論先出し、message ID と deep link を必ず添える。

### 3.4 配布

- リポ: `spark-agent/` をトップレベルに追加し、`marketplace.json` と `.claude-plugin/marketplace.json` の両方に登録（`skills` フィールド禁止）。
- 両エージェント: `ln -s <repo>/spark-agent/skills/spark-agent ~/.agents/skills/spark-agent`、`ln -s ../../.agents/skills/spark-agent ~/.claude/skills/spark-agent`。
  GitHub 公開後は `npx skills add` に切替可能。

## 4. テスト

`tests/run-tests.sh`（evaluator-gate と同型）。`tests/fakes/spark` は argv を `FAKE_CALL_LOG_DIR/spark-calls.log` に追記し、
`accounts` / `--version` / `skill` / その他に固定出力を返す。検証項目:

- ctx: 未知アカウントの拒否、alias 解決、show の level 抽出、clear
- run: 上表の注入 7 パターンと「既にある引数は二重注入しない」、文脈なしの素通し
- 安全ゲート: `action send` と `event create` が `--confirm` なしで exit 3、ありで実行される
- doctor: 全 OK、Desktop 停止で NG、版ずれで WARN、spark 不在で NG

## 5. 評価手順（合格 4 層）

1. `bash spark-agent/tests/run-tests.sh` が全 PASS
2. 実機（Spark Desktop + CLI 有効化後）: doctor OK → `spark-ctx use <個人>` → メール一覧 → 返信下書き（送信しない）→ events/availability → 参加者なし event create → update → delete
3. Codex: `codex exec` に「spark-agent スキルで <同じタスク>」を依頼し、実行コマンドと結果が Claude 側と一致することを確認。加えて SKILL.md への second opinion を取り込む
4. `/evaluate`（Codex + Grok の所見評価）で PASS

## 5.1 実装で確定した差分（2026-09-13 実機・Codex 0.154.0）

- `spark accounts` の実形式は `Email Account: a@x.com "a@x.com" (Access: triage)` に `├── Calendar: ...` `├── Alias: ...`
  がぶら下がる木構造。カレンダー行に他アカウントのアドレスと `read-only` が現れるため、level は `Access:` を含む行
  だけから取り、Alias は直前のアカウントの level を継承する（fake spark も同形式に更新）。
- `spark --version` は版番号のみ。`spark skill` の出力は GitHub の 1.3.1 と完全一致。
- Codex の read-only / workspace-write サンドボックスでは Spark の IPC が塞がれる（`spark --version` だけ通る）。
  公式の rules（`prefix_rule` の `decision="allow"` = サンドボックス外で無確認実行）で解決し、
  `scripts/install-codex-rules.sh --yes` が `~/.codex/rules/spark-agent.rules` を生成する。既定は bare `spark <読み取り>`
  のみ allow、スクリプト起動は prompt（作業ツリー内で書き換え可能なスクリプトの無確認実行を避ける。`--allow-scripts` で緩和）。
- 非対話の `codex exec` では prompt 規則のコマンドは応答待ちで止まり（read-only）、
  `--dangerously-bypass-approvals-and-sandbox` でも承認ポリシー Never として拒否される。Codex からの書き込み系は
  対話セッションで承認して実行する運用に確定。読み取りの自動化には `--allow-scripts` が要る。
- 設計 3.1 の `--delete` は単独オプションのため `--account` を注入しない（Codex コミットレビューの指摘で追加）。
  また `draft --delete` は取り消せないため --confirm ゲートの対象に加えた（セキュリティレビューの指摘で
  ゲート対象の動詞は spark-ctx.sh の `GATED_*` に一元化し、全トークン走査に変更）。
- 検証結果（2026-09-13）: 決定論テスト 53 件 PASS。実機（個人 Gmail = send、他 5 アカウント = triage）で
  doctor OK・alias 切替・Priority/未読一覧・thread・自分宛下書きの作成と削除・events/availability・
  参加者なし予定の作成→変更→削除→消失確認まで PASS。Codex 実走（read-only + rules）は Claude と同じ件数
  （今日 2 / Priority 未読 0 / 今週 51）。

## 6. 環境構築（GUI）

Spark Desktop を起動し、Orca computer-use で Settings → AI Agents → Setup CLI を進め、個人アカウント 1 つを send、
業務アカウントを triage（または read-only）に設定する。画面ごとに確認を挟む。完了判定は `spark accounts` が通ること。
