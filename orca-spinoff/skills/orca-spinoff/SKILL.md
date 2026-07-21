---
name: orca-spinoff
description: >-
  Use when the user says 「この課題スピンオフして」「切り出して別セッションで」
  「チケット切って別worktreeで進めて」「別worktreeでやらせて」「spin off this
  issue」, or asks to hand off a newly found issue to a separate Orca-managed
  session while continuing the main work — including supervised requests like
  「監視して」「完遂まで見て」「終わったらマージして続けて」「supervise the
  spinoff」. Also use when retiring a finished spinoff worktree（撤収・後片付け）.
  Requires the Orca desktop app and the `orca` CLI (orca-cli skill).
---

# Orca Spinoff

本流の作業中に見つけた課題を、チケットに残しつつ別 worktree の新セッションへ手渡す。手渡し方は2モード:

- **フルハンドオフ(既定)**: 起動して報告したら手離れ。進捗はカードとチケットで人が見る。
- **監督モード(opt-in)**: 親セッションが完遂まで監視し、子からの質問に応答し、検収・撤収・キャッチアップ報告まで閉じる。

コマンドの詳細規約(セレクタ構文・エラーリカバリ)は `orca-cli` スキル、orchestration コマンドの詳細規約(メッセージ種別・待機ルール)は `orchestration` スキルに従う。Linux では `orca` を `orca-ide` に読み替える。

## 0. 前提確認

```bash
command -v orca || command -v orca-ide
orca status --json
```

- CLI が無ければ「orca CLI が見つからない」と明言して止まる。ソース探索や代替実装をしない。
- Orca 未起動なら `orca open --json` → `orca status --json` で再確認。
- `orca worktree current --json` で現在の worktree を確認する(repo 推論と報告に使う)。

## 1. モード選択

**既定はフルハンドオフ**。監督モードは、ユーザーが完遂までの監視・応答・取り込みを明示したときだけ選ぶ(例:「監視して」「完遂まで見て」「終わったらマージして続けて」「終わり次第取り込んで」)。明示が無ければ質問せずフルハンドオフにする(スピンオフはワンアクションであることが価値)。

| | フルハンドオフ | 監督モード |
|---|---|---|
| 向く課題 | 本流と独立・急がない | 本流が完了に依存・すぐ検収まで必要 |
| 親のコスト | ゼロ(手離れ) | 待機ターン+セッション拘束 |
| 完了検知・検収 | 人がカード/チケットで判断 | 親が worker_done 受領 → 検収 → 撤収 |

監督モードを選んだら、orchestration が使えることを先に確認する:

```bash
orca orchestration task-list --json
```

失敗したら(experimental 未有効等)その旨を報告し、フルハンドオフに縮退する(勝手に Settings を変更しない)。

## 2. 課題の言語化

会話文脈から次の3点を抽出する。揃わない要素があるときだけ AskUserQuestion で **1 問だけ** 確認する(スピンオフはワンアクションであることが価値。質問を重ねない):

- **何が起きたか / 何を見つけたか**(1〜3文)
- **該当ファイル・再現手順**(分かる範囲で。パスは repo 相対)
- **完了定義**(何をもって解決とするか。1〜2行)

**設計凍結チェック**: 解決アプローチに複数案があり選定が済んでいない、またはユーザー決裁が絡む見込みがあるなら、**実装をスピンオフしない**。チケットに「実装方針は判断待ち。着手ブロック」と明記して起票のみ行うか、スピンオフのブリーフを「判断材料の整理まで」に限定する(設計が揺れたまま実装を渡すと、方針転換で成果物が丸ごと破棄になる)。

## 3. チケット起票(承認必須)

起票先の決定順:

1. ユーザーが明示した先
2. プロジェクトの CLAUDE.md / docs に記載の課題管理先(Backlog プロジェクトキー等)
3. `gh repo view --json nameWithOwner` が通れば GitHub Issues
4. それでも不明なら AskUserQuestion で確認

**投稿前に AskUserQuestion でタイトル・本文の承認を得る**(外向き操作)。本文には課題の言語化3点をそのまま書く。

- GitHub: `gh issue create --title "<title>" --body "<body>"`
- Backlog: `backlog-api` スキルに委譲(そのスキルの投稿前確認フローに従う)

起票に失敗したらスピンオフを中止して報告する。チケット無しで worktree 起動に進むのは、ユーザーが「チケットは要らない」と明示したときだけ。

## 4. ブリーフ作成

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

**監督モードの読み替え**: ブリーフは `--prompt` でなく `task-create --spec` に渡す(§5)。`dispatch --inject` が worker_done / ask の報告規約を preamble として自動注入するため、[報告規約] の「方針に迷ったらチケットに質問」は「`ask` で親に質問(チケットにも要点を残す)」に読み替える。チケットコメント(着手時・PR 作成時・完了時)は人間の観測点としてそのまま維持する。

## 5. worktree 起動

二重スピンオフ検知(両モード共通): `orca worktree ps --json` で同じ課題・同名の worktree が既に無いか確認する。あれば起動せず、その worktree を報告する。

### フルハンドオフの起動

```bash
orca worktree create --name <slug> --parent-worktree active --agent <agent> --prompt "<ブリーフ>" --json
```

- `--parent-worktree active` は Orca のカード階層(lineage)の紐づけのみで、Git base には影響しない。スピンオフは現作業から派生した課題なので、カード上は子として見せる。ユーザーが「独立した作業として」と明示したときだけ `--no-parent` にする。フルハンドオフ方針(lifecycle 監視をしない)は lineage とは無関係に維持する。
- `--base-branch` は渡さない(repo 既定 base を使う)。現在のブランチを base にするのは、ユーザーが stacked 作業を明示したときだけ。
- `<slug>` はチケットキー/番号を含む短い英数字(例: `fix-123-login-css`)。
- `<agent>` はユーザー指定 > そのプロジェクトの直近の慣行 > `claude`。
- 旧 CLI が `--agent`/`--prompt` を拒否した場合のフォールバック: `worktree create` → `orca terminal create --worktree id:<id> --command "<agent>" --json` → `orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json` → `orca terminal send --terminal <handle> --text "<ブリーフ>" --enter --json`

### 監督モードの起動

`--prompt` でブリーフを渡す代わりに task を作って dispatch する(worker_done / ask を返せる preamble が注入される)。`--parent-worktree` / `--base-branch` / `<slug>` / `<agent>` の規約はフルハンドオフと同じ:

```bash
orca orchestration task-create --spec "<ブリーフ>" --json
orca worktree create --name <slug> --parent-worktree active --agent <agent> --json
orca terminal list --worktree id:<newId> --json          # エージェントの terminal handle を取る
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task_id> --to <handle> --inject --json
```

パーミッションモードを都度注入する場合は次節の「都度」経路に従う(最後のブリーフ注入だけ `terminal send` でなく `dispatch --inject` になる)。

### パーミッションモード(Claude スピンオフ時)

スピンオフ先は無人セッションのため、`default`/`manual` のままだと最初の許可プロンプトで停止する(誰もそのターミナルを見ていないと待ち続ける)。Claude を起動する場合は `--permission-mode auto` を推奨する(確認済み: `claude --help` の choices に存在、`claude auto-mode defaults` の分類器は「読み取り・プロジェクト内ローカル操作・宣言済み依存・origin への push 等を allow / 破壊的操作・本番・secret・認証情報漏洩・レビューなしマージ等を soft_deny / データ持ち出しを hard_deny」)。`acceptEdits` は bash で結局止まり、`bypassPermissions` は安全弁を全部外すため、無人用途では `auto` が最適。**このフラグは Claude Code 専用**で、`--agent codex` 等には付けない。

これは監督モードでも同じ(ツール許可プロンプトは orchestration メッセージに乗らず TUI 側で止まるため、監視していても応答できない)。

注入経路(`--agent` プリセットはその場限りのフラグを受けないため、いずれか):

- **恒久(推奨)**: Orca の Settings → Agents で起動コマンドが `claude --permission-mode auto` のカスタムエージェントを定義し、`--agent <そのID>` を使う。上の 1 行起動フローをそのまま保てる。
- **都度**: `--agent` を付けずに `orca worktree create --name <slug> --parent-worktree active --json` → `orca terminal create --worktree id:<newId> --command "claude --permission-mode auto" --json` → `orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json` → ブリーフ注入(フルハンドオフは `terminal send`、監督モードは `dispatch --inject`)。

これは worktree に継承されない `settings.local.json` の許可蓄積を補う意味もある(スピンオフ先は蓄積済み許可を持たないため、モードで姿勢を与える)。ユーザーが姿勢を明示したらそれに従う。

## 6. カード設定(best-effort)

`worktree create` の応答から id を取り:

```bash
orca worktree set --worktree id:<newId> --comment "spun off: <チケット参照>" --workspace-status in-progress --json
```

失敗してもスピンオフ自体は成立している。警告として報告に含めるだけでよい。

## 7. フルハンドオフ: 報告して本流へ復帰

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

## 8. 監督モード: 監視と完遂

dispatch 後、ローリング待機で子からのメッセージを受ける:

```bash
orca orchestration check --wait --types worker_done,escalation,decision_gate --timeout-ms 540000 --json
```

- タイムアウトや `{count:0}` は**チェックポイントであって失敗ではない**。`terminal read` / `task-list` で生存確認し、待機を続ける(コーディング課題は 15〜60 分が普通。heartbeat や画面の動きは「生きている」であって「完了」ではない。止めない・再起動しない)。
- 待機は `run_in_background` で回してよい。その間に本流作業を進めて構わないが、スピンオフ先と同一ファイルは編集しない。
- **decision_gate / ask への応答**: チケットに書いた完了定義の範囲内の技術判断は親が即 `reply` する。設計変更・スコープ変更・破壊的/外向き操作に踏み込む判断は AskUserQuestion でユーザーに確認してから返す。
- **escalation**: 内容を確認し、親で解決できるものは対処して返答、できないものはユーザーへ。
- 途中の方針変更は §7 の「追加指示・方針変更の作法」と同じ(チケット先更新 → send で要旨)。

### worker_done 受領 → 検収

自己申告を信用せず、現物で確認する:

```bash
orca worktree show --worktree id:<id> --json             # 応答の path を <worktreePath> に使う
git -C <worktreePath> log --oneline origin/<base>..HEAD  # 差分の実在
git -C <worktreePath> status --porcelain                 # 未コミットの残り
gh pr view <n>                                           # PR を作らせた場合は実在確認
```

あわせてチケットの完了コメントと、ブリーフで課した品質ゲートの証跡を確認する。

- **検収 OK**: `orca orchestration task-update --id <task_id> --status completed --json` → §9 撤収へ。
- **取り込みを明示されていた場合**(「終わったらマージして続けて」「終わり次第取り込んで」等): 検収 OK 後・撤収前に PR のマージまたは base への取り込みを行う。マージは外向き操作のため、対象 PR の実在と CI 状態を確認したうえで AskUserQuestion で最終承認を得てから実行する(スピンオフ時の包括指示だけで無承認マージしない)。
- **検収 NG**: チケットに差し戻し理由を書いてから、**同一 task を再 dispatch する**: `orca orchestration dispatch --task <task_id> --to <handle> --inject --json`。worker_done は dispatch 1 回につき 1 度きりのため、send の差し戻しでは次の完了通知が来ない — 再 dispatch で preamble が再注入され完了検知が再び成立する。その後待機に戻る。**差し戻しは 2 回まで**。それでも NG なら AskUserQuestion でユーザーに判断を仰ぐ(親が引き取る / 続行 / 中止)。

### 異常系

- 同一 task で 3 連続 dispatch 失敗すると circuit-break で task が failed になる → 状況をまとめてユーザーに報告する。
- terminal が exit・消滅した → `terminal list` / `worktree ps` で確認し、成果物の状態(git 差分)を添えてユーザーに報告する。**勝手に再起動して同じブリーフを再投入しない**(二重実装の温床)。

### キャッチアップ報告

撤収まで終えたら 1 ブロックで報告する: 達成内容(完了定義に対して)/ コミット・PR / チケット最終状態 / 残課題・申し送り。

## 9. 撤収(検収後の後片付け)

監督モードでは検収 OK の直後に親がここまで実施する。フルハンドオフでは、チケットが解決・検収済みになったことを人が確認してから実施する:

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

- **(既定のフルハンドオフ時)** `orca orchestration dispatch --inject` / `worker_done` の待ち受け。監督モードはユーザーが明示 opt-in したときだけ(§1)。
- チケットのクローズ — スピンオフ先セッションの責務(監督モードでも親は検収・撤収まで。クローズされたかの確認はする)。
- 複数課題の計画分解・並列ディスパッチ — 監督モードは**単一スピンオフの監督のみ**。DAG・並列・複数 worker の束ねは `orchestration` スキルをそのまま使う。
