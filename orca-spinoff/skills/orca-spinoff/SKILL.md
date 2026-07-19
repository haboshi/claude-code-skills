---
name: orca-spinoff
description: >-
  Use when the user says 「この課題スピンオフして」「切り出して別セッションで」
  「チケット切って別worktreeで進めて」「別worktreeでやらせて」「spin off this
  issue」, or asks to hand off a newly found issue to a separate Orca-managed
  session while continuing the main work. Also use when retiring a finished
  spinoff worktree（撤収・後片付け）. Requires the Orca desktop app and the
  `orca` CLI (orca-cli skill).
---

# Orca Spinoff

本流の作業中に見つけた課題を、チケットに残しつつ別 worktree の新セッションへ完全に手渡す(フルハンドオフ)。元セッションは本流の作業を続け、進捗は Orca のカードとチケットで見える状態にする。

コマンドの詳細規約(セレクタ構文・エラーリカバリ)は `orca-cli` スキルに従う。Linux では `orca` を `orca-ide` に読み替える。

## 0. 前提確認

```bash
command -v orca || command -v orca-ide
orca status --json
```

- CLI が無ければ「orca CLI が見つからない」と明言して止まる。ソース探索や代替実装をしない。
- Orca 未起動なら `orca open --json` → `orca status --json` で再確認。
- `orca worktree current --json` で現在の worktree を確認する(repo 推論と報告に使う)。

## 1. 課題の言語化

会話文脈から次の3点を抽出する。揃わない要素があるときだけ AskUserQuestion で **1 問だけ** 確認する(スピンオフはワンアクションであることが価値。質問を重ねない):

- **何が起きたか / 何を見つけたか**(1〜3文)
- **該当ファイル・再現手順**(分かる範囲で。パスは repo 相対)
- **完了定義**(何をもって解決とするか。1〜2行)

**設計凍結チェック**: 解決アプローチに複数案があり選定が済んでいない、またはユーザー決裁が絡む見込みがあるなら、**実装をスピンオフしない**。チケットに「実装方針は判断待ち。着手ブロック」と明記して起票のみ行うか、スピンオフのブリーフを「判断材料の整理まで」に限定する(設計が揺れたまま実装を渡すと、方針転換で成果物が丸ごと破棄になる)。

## 2. チケット起票(承認必須)

起票先の決定順:

1. ユーザーが明示した先
2. プロジェクトの CLAUDE.md / docs に記載の課題管理先(Backlog プロジェクトキー等)
3. `gh repo view --json nameWithOwner` が通れば GitHub Issues
4. それでも不明なら AskUserQuestion で確認

**投稿前に AskUserQuestion でタイトル・本文の承認を得る**(外向き操作)。本文には課題の言語化3点をそのまま書く。

- GitHub: `gh issue create --title "<title>" --body "<body>"`
- Backlog: `backlog-api` スキルに委譲(そのスキルの投稿前確認フローに従う)

起票に失敗したらスピンオフを中止して報告する。チケット無しで worktree 起動に進むのは、ユーザーが「チケットは要らない」と明示したときだけ。

## 3. ブリーフ作成

スピンオフ先エージェントへの初期プロンプトを組む。含めるもの:

```
[課題] <1〜3文の要約> (チケット: <URL または キー>)
[再現/該当箇所] <ファイル・手順>
[完了定義] <解決条件>
[文脈] <現ブランチ由来の情報が必要なら文章で渡す。worktree は repo 既定 base から切られる>
[報告規約] 着手時・PR 作成時・完了時・ブロック時はチケットにコメントする(進捗の観測点はチケット。
  worktree comment は補助)。方針に迷ったら実装せずチケットに質問を書く
[品質ゲート] <プロジェクトの完了定義(typecheck/lint/build 等)> + PR 前に /code-review で自己レビュー
  し CRITICAL/HIGH を修正(--fix 適用可)。視覚変更はスクショ実証を PR に添付
[完了時] チケットを更新し、PR を作る場合はチケットにリンクする
```

**エージェント別の読み替え**: `/code-review`・`/evaluator-gate`・`/evaluate` は Claude Code のコマンド。`--agent` が claude 以外(codex 等)のときはブリーフに書かず、「PR 前に差分を自己レビューし CRITICAL/HIGH 相当を修正する」等の同等指示に読み替える。

**evaluator-gate は worktree に継承されない**: ゲートの有効判定は worktree 自身の絶対パス×config 照合
(`git rev-parse --show-toplevel`)のため、**親リポジトリで有効でもスピンオフ先では素通りになる**。
実装スピンオフでゲートを効かせたい場合はブリーフに「着手前に `/evaluator-gate on` でこの worktree を
登録」を含める(過去に worktree 単位で個別登録した運用実績あり)。軽微な課題では省略可(毎 Stop の
外部評価はコストがかかる)。advisory の外部所見が欲しいだけなら完了前の `/evaluate` 一発で足りる。

**真実源はチケット側に置く**: 設計・受け入れ基準など長い内容はチケット本文に書き、ブリーフには要約+チケット参照を渡す。ブリーフに全文を複製しない(後述の方針変更時に古い指示が残る)。

## 4. worktree 起動

二重スピンオフ検知: `orca worktree ps --json` で同じ課題・同名の worktree が既に無いか確認する。あれば起動せず、その worktree を報告する。

```bash
orca worktree create --name <slug> --parent-worktree active --agent <agent> --prompt "<ブリーフ>" --json
```

- `--parent-worktree active` は Orca のカード階層(lineage)の紐づけのみで、Git base には影響しない。スピンオフは現作業から派生した課題なので、カード上は子として見せる。ユーザーが「独立した作業として」と明示したときだけ `--no-parent` にする。フルハンドオフ方針(lifecycle 監視をしない)は lineage とは無関係に維持する。
- `--base-branch` は渡さない(repo 既定 base を使う)。現在のブランチを base にするのは、ユーザーが stacked 作業を明示したときだけ。
- `<slug>` はチケットキー/番号を含む短い英数字(例: `fix-123-login-css`)。
- `<agent>` はユーザー指定 > そのプロジェクトの直近の慣行 > `claude`。
- 旧 CLI が `--agent`/`--prompt` を拒否した場合のフォールバック: `worktree create` → `orca terminal create --worktree id:<id> --command "<agent>" --json` → `orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json` → `orca terminal send --terminal <handle> --text "<ブリーフ>" --enter --json`

## 5. カード設定(best-effort)

`worktree create` の応答から id を取り:

```bash
orca worktree set --worktree id:<newId> --comment "spun off: <チケット参照>" --workspace-status in-progress --json
```

失敗してもスピンオフ自体は成立している。警告として報告に含めるだけでよい。

## 6. 報告して本流へ復帰

1 ブロックで報告し、元の作業に戻る:

- チケット: URL / キー
- worktree: 名前と id
- 様子を見る: `orca worktree ps --json` / `orca terminal read --terminal <handle> --json`

以後、元セッションはこの課題の lifecycle を監視しない(フルハンドオフ)。完了検知・検収はカードとチケットの更新で人が判断する。

### 追加指示・方針変更の作法

スピンオフ後に方針が変わったら、**先にチケット本文を更新**し、send では要旨と再読指示だけを送る:

```bash
orca terminal send --terminal <handle> --text "【方針更新】<変更の要旨1〜2文>。チケット <キー> の最新本文を再読してから続行。着手済みの旧方針差分は破棄すること" --enter --json
```

send に変更内容の全文を書かない(チケットとの二重管理になり、古い指示が残って事故る)。エージェントは処理中でも入力をキューするので、割り込みはそのまま送ってよい。

## 7. 撤収(検収後の後片付け)

チケットが解決・検収済みになったら:

```bash
# 0. worktreePath を取得
orca worktree show --worktree id:<id> --json   # 応答の path を <worktreePath> に使う

# 1. そのworktreeのブランチに未コミット・未pushが無いことを確認(必須)
git -C <worktreePath> status --porcelain
git -C <worktreePath> log --oneline @{u}..HEAD 2>/dev/null   # upstream 無しなら origin/<base>..HEAD

# 2. 完了マークして削除
orca worktree set --worktree id:<id> --workspace-status completed --json
orca terminal stop --worktree id:<id> --json
orca worktree rm --worktree id:<id> --force --json
```

- 未 push の確認は**そのworktreeのブランチに限定**する。`git log --branches --not --remotes` はリポジトリ全体を見るため、**他の worktree で進行中の作業まで拾って混同する**(現在チェックアウト中のブランチ + upstream 比較で判定する)。
- 未 push コミットが見つかったら削除を中止してユーザーに報告する。

## やらないこと

- `orca orchestration dispatch --inject` / `worker_done` の待ち受け — フルハンドオフのため。監督付きディスパッチが必要な場面では `orchestration` スキルを使う。
- チケットのクローズ — スピンオフ先セッションの責務。
- 計画分解・並列ディスパッチ — 将来の拡張(その際も DAG/dispatch 機構は `orchestration` スキルをそのまま使い、本スキルは計画→タスク仕様への分割だけを足す)。
