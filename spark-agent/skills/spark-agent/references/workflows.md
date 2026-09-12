# spark-agent ワークフロー手順

`CTX` は本スキルの `scripts/spark-ctx.sh` を指す。以下はすべて現在アカウントが設定済みの前提
（未設定なら Unified 横断になる。`CTX show` で確認）。コマンドの詳細仕様は use-spark を読む。

## 0. 開始時の共通手順

```bash
bash scripts/spark-doctor.sh          # NG があれば作業せず案内を返す
bash scripts/spark-ctx.sh show        # 現在アカウントと access level
```

ユーザーが会社名や通称でアカウントを指したら alias を引く（`alias list`）。無ければ `spark accounts` の
一覧を見せて選んでもらい、`alias set` で次回から引けるようにする。

## 1. メール確認

順序は Priority → People → 返信待ち。件数が多いときは `--page-size` を絞る。

```bash
CTX run emails --filter "category:priority is:unread"
CTX run emails --filter "category:personal is:unread newer_than:3d"
CTX run search --filter "is:unreplied newer_than:7d"
CTX run search "<話題>"                              # 本文込みの意味検索（最大 20 通）
CTX run thread <MESSAGE_ID>                          # 全文
```

報告は「緊急 / 今日対応 / 今週対応 / 情報のみ」の 4 区分で、各行に message ID を添える。
Spark の Priority は送信者単位の設定（`contact-action markContactAsPrimary`）で育つ。誤分類を見つけたら
ユーザーに確認してから `contact-action changeCategory*` で固定する。

## 2. 返信下書き

```bash
CTX run thread <MESSAGE_ID>                          # 最新メッセージの ID を確認
CTX run draft --reply-to <LATEST_ID> --body "<本文（Markdown）>"
# 複数宛先の会話なら --reply-all
```

- 既存の会話への返信は必ず `--reply-to` / `--reply-all`（無いと新規スレッドになる）。
- 本文に署名や結びを書かない（Spark が署名を付ける。`draft signatures` で確認可）。
- 出力の `Link:` を Markdown リンクでユーザーに渡す。送信はしない。
- 新規メールだけ `--account` が注入される（返信はスレッドのアカウントを継承）。

## 3. カレンダー確認

```bash
CTX run events                                       # 今日の残り
CTX run events --tomorrow
CTX run events --week
CTX run availability --tomorrow --attendees a@example.com,b@example.com
```

`availability` は平日 08:00〜20:00 の枠だけを返す（use-spark の仕様）。

## 4. カレンダー更新（send 権限が必要）

`event` はすべて send 権限で、参加者付きの操作は招待・更新・取消メールを発生させる。
手順は「参加者なしで作る → ユーザー確認 → 必要なら `--add`」。

```bash
# ユーザーの明示承認を得てから --confirm を付ける
CTX run --confirm event create --title "<件名>" --start 2026-09-15T10:00 --end 2026-09-15T10:30
CTX run --confirm event update <EVENT_ID> --title "<新件名>"
CTX run --confirm event update <EVENT_ID> --add a@example.com        # ここで招待メールが出る
CTX run --confirm event delete <EVENT_ID>
CTX run --confirm event rsvp <INVITE_MESSAGE_ID> accept              # 招待メールの ID でも可
```

`--confirm` 無しで実行すると spark-ctx が exit 3 で止める。これは「承認を得たか」を機械的に思い出させる
仕組みで、承認そのものはユーザーとの会話で得る。

## 5. 送信（原則ユーザーが Spark で行う）

Send 権限のアカウントでも、CLI からの送信はユーザーが「送って」と明示した場合だけ:

```bash
CTX run --confirm action send <DRAFT_ID>
CTX run --confirm action send <DRAFT_ID> --date 2026-09-15T09:00   # Send Later
```

`action unschedule` は新しい draft ID を発行し、元の ID は無効になる（再一覧が必要）。
