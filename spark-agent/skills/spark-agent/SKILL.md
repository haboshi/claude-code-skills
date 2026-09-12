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

1. **送信しない**。`draft` は保存だけで外に出ない。`action send` と `event create/update/delete/rsvp` は
   ユーザーがこのターンで明示的に承認したときだけ `run --confirm` を付けて実行する。`--confirm` 無しは
   spark-ctx が exit 3 で止める。
2. 既存の会話への返信は必ず `--reply-to` / `--reply-all`。本文に署名や結びを書かない（Spark が付ける）。
3. `draft --delete` は Trash が無く取り消せない。依頼されたときだけ実行し、その旨を伝える。
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

読み取り系（`spark accounts|emails|search|thread|events|availability` 等と `spark-ctx run <読み取り>`）は
サンドボックス外で無確認実行、書き込み・送信系（`draft|comment|action|contact-action|event`、`run --confirm`）は
実行前に確認、になる。spark-doctor は rules 未導入を WARN で知らせる。`codex exec` で rules を使わない場合は
`-s danger-full-access` が必要（read-only / workspace-write では失敗する）。

## 7. 版の整合

`spark --version` が use-spark の `metadata.version` より新しいとき、spark-doctor が WARN を出す。
`spark skill > ~/.agents/skills/use-spark/SKILL.md` で更新してから作業する。
