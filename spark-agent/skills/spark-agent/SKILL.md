---
name: spark-agent
description: >-
  Spark Desktop に登録済みの複数メールアカウント・カレンダーを、Claude Code と Codex の
  どちらからも同じ手順で扱うための運用スキル。メール確認（未読・Priority・返信待ち）、
  返信下書き、カレンダー確認と更新、アカウント切り替え（spark-ctx）、環境診断（spark-doctor）。
  「メール確認して」「未読を見て」「返信の下書きを作って」「今日の予定」「空き時間」「予定を入れて」
  「アカウントを切り替えて」「会社のメールで」「Spark」で発動。コマンド仕様の正典は use-spark。
metadata:
  version: 0.1.0
  requires:
    bins:
      - spark
    skills:
      - use-spark
---

# spark-agent

`spark` CLI は起動中の Spark Desktop に IPC で繋ぐ薄いクライアントで、資格情報を持たない。
本スキルは公式 `use-spark`（コマンド正典）の上に、アカウント切り替え・環境診断・承認ゲート・
日本語の運用規約を足す。コマンドの引数やフィルタの詳細は use-spark を読む。

スクリプトは本ファイルと同じディレクトリの `scripts/` にある。以下 `CTX` = `bash <このディレクトリ>/scripts/spark-ctx.sh`。

## 1. 最初にやること

```bash
bash scripts/spark-doctor.sh
```

`RESULT: OK` 以外なら作業に入らず、NG 行の案内をそのままユーザーに返す（Spark Desktop の起動、
CLI セットアップ、アカウント追加は GUI 側の作業で、CLI からはできない）。

## 2. アカウント切り替え

CLI は無状態で、毎コマンドにアカウントを書く設計になっている。`spark-ctx` が現在アカウントを
`~/.config/spark-agent/context` に保存し、`run` で自動注入する。

```bash
CTX show                                  # 現在アカウントと access level
CTX use work@example.com                  # メールアドレスで切り替え
CTX use kaisha                            # alias で切り替え
CTX alias set kaisha work@example.com     # 会社名などの alias を登録
CTX clear                                 # Unified（全アカウント横断）に戻す
```

- ユーザーが「会社の」「個人の」「A 社の」と言ったら alias を引く。無ければ `spark accounts` の一覧を
  見せて選んでもらい、alias を登録する。
- `run` の注入規則: `emails` / `folders` は位置引数、`search` / `events` は `--in`、新規 `draft` は
  `--account`、`event create` は `--calendar`。返信（`--reply-to` 等）はスレッドのアカウントを継承する
  ので注入しない。既に同種の引数があれば触らない。
- 文脈が未設定のときは注入せず Unified で実行し、stderr にその旨を出す。

## 3. ワークフロー

手順とコマンド列は `references/workflows.md`。要点:

| 作業 | 入口 | 権限 |
|---|---|---|
| メール確認 | `CTX run emails --filter "category:priority is:unread"` → personal → `is:unreplied` | read-only |
| 返信下書き | `CTX run thread <ID>` で最新 ID → `CTX run draft --reply-to <ID> --body "..."` | triage |
| カレンダー確認 | `CTX run events [--tomorrow|--week]`、`CTX run availability --attendees ...` | read-only |
| カレンダー更新 | `CTX run --confirm event create ...`（参加者なし → 確認 → `--add`） | send |

## 4. 安全規約（両エージェント共通）

1. **送信しない**。`draft` は保存だけで外に出ない。`action send`、`event create/update/delete/rsvp`、
   `draft --delete` は、ユーザーがこのターンで明示的に承認したときだけ `run --confirm` を付けて実行する。
   `--confirm` 無しは spark-ctx が exit 3 で止める。**これらを素の `spark` で直接叩かない**（ゲートは
   `spark-ctx run` 経由でしか効かない。迂回は規約違反）。
2. 既存の会話への返信は必ず `--reply-to` / `--reply-all`。本文に署名や結びを書かない（Spark が付ける）。
3. `draft --delete` は Trash が無く取り消せない。依頼されたときだけ `--confirm` 付きで実行し、その旨を伝える。
4. 参加者付きの `event` 操作は招待・更新・取消メールを相手に送る。参加者なしで作ってから確認し、
   `--add` は別コマンドで承認後に行う。
5. 業務アカウントの本文をクラウド LLM に読ませてよいかは、そのアカウントの規程に従う。迷ったら要約ではなく
   件名・送信者・日時だけを扱う。
6. 権限不足のエラー（read-only で draft 等）は、Spark Desktop の 設定 → AIエージェント で上げてもらう案内を返す。

## 5. 出力規約

- 日本語、結論先出し。各メールに message ID を添える。下書き・イベントは `Link:` の deep link を
  Markdown リンクで返す（ユーザーが Spark で開いて確認・送信できる）。
- 一覧は「緊急 / 今日対応 / 今週対応 / 情報のみ」の 4 区分。

## 6. Codex から使うとき

Codex は `~/.agents/skills/spark-agent` からこのファイルを読む。`spark` は Desktop への IPC 接続で、
Codex の read-only / workspace-write サンドボックス内では `Error: Spark CLI can't access your Spark Desktop
application` になる（`spark --version` だけは通るので誤診しやすい）。対処は Codex の rules:

```bash
bash scripts/install-codex-rules.sh      # ~/.codex/rules/spark-agent.rules を生成
```

生成前に内容の要約が出るので、ユーザーに示して承認を得てから `--yes` を付ける（Codex の承認設定を書き換える
操作なので、エージェントが黙って実行しない）。既定では**絶対パスの** `/usr/local/bin/spark <読み取り>` だけが
サンドボックス外で無確認実行（bare `spark` は PATH 差し替えで別バイナリになり得るため `prompt`。spark-ctx は
既定で絶対パスを使う）、`spark` の書き込み・送信系と `bash scripts/spark-ctx.sh ...` は実行前に確認（`prompt`）になる。スクリプトを
`allow` にしない理由は、作業ツリー内で書き換え可能なスクリプトの無確認実行がサンドボックス脱出の経路になるため
（`--allow-scripts` で明示的に緩められる）。spark-doctor は rules 未導入を WARN で知らせる。

実測（Codex 0.154.0、2026-09-13）:
- `allow` 規則のコマンド（絶対パスの `spark` の読み取り、`--allow-scripts` 時の `spark-ctx`）は
  `codex exec -s read-only` から通り、Claude Code と同じ件数を返した。初期実測は bare `spark` を allow に
  した版で行い、その後 PATH 差し替え対策として絶対パス固定に変更している（bare は `prompt`）。
- `prompt` 規則のコマンドは、非対話の `codex exec` では承認者がいないため応答待ちのまま止まる（300 秒超）。
  `--dangerously-bypass-approvals-and-sandbox` を付けても承認ポリシー Never として拒否され、実行されない。
  つまり書き込み系（下書き・`draft --delete`・イベント変更・送信）は**対話セッションの Codex で承認して実行する**。
  `codex exec` からは読み取りだけを扱う。
- `--allow-scripts` を付けないと `spark-ctx` 経由の読み取りも `prompt` になり、`codex exec` では止まる。
  Codex から自動で使う運用では `--allow-scripts` を付ける（作業ツリー内でスクリプトを書き換えられる
  セッションでは脱出経路になることを理解した上で）。
- rules を使わない場合は `-s danger-full-access` が必要（read-only / workspace-write では IPC で失敗する）。

## 7. 版の整合

`spark --version` が use-spark の `metadata.version` より新しいとき、spark-doctor が WARN を出す。
`spark skill > ~/.agents/skills/use-spark/SKILL.md` で更新してから作業する。
