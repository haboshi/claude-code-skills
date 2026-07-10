---
name: evaluator-gate
description: Stop フックの完了ゲート evaluator-gate の運用ドキュメント兼評価ルーブリックの解説。ビルダー（Claude 本体）の「完了しました」を外部モデル評価者（Codex/Grok、サブスク認証・API 従量課金なし）が git 差分と突き合わせて検証し、根拠つきで差し戻す。「完了ゲート」「評価ゲート」「エバリュエーター」「差し戻しの仕組み」「evaluator gate」「/evaluate の使い方」「/evaluator-gate」「ゲートが誤ブロックする」「grok の認証が切れた」「ゲートを一時停止したい」などで参照する。
---

# evaluator-gate — 外部モデルによる完了ゲート

セッション内側の品質ゲート。ビルダー（Claude 本体）がターンを「完了」として終えようとしたとき、Stop フックが git 差分と完了主張を外部評価者（Codex / Grok）に渡し、主張と実態が乖離していれば根拠つきで差し戻す。

## 設計原則

1. **ビルダー≠評価者**: 評価者は変更履歴を知らない fresh instance・別モデル系統（Codex = OpenAI / Grok = xAI）。ビルダーの自己申告を信用しない（self-improvement-integrity R2/R7 準拠）。
2. **評価者は指摘の生成に徹する**: 修正はビルダー側が行う。評価者はファイルを変更できない（read-only 実行）。
3. **決定論を LLM の前段に置く**: 変更のないターン（会話・調査のみ）は bash の diff ハッシュ比較で無音通過。LLM は「前回評価から差分が変わったとき」しか起動しない（サブスククォータ保護）。
4. **fail-open**: ゲート自身の故障（CLI 不在・認証切れ・タイムアウト・jq 不在）で作業を止めない。ブロックするのは評価者が根拠を引用して BLOCK と判定したときのみ。
5. **サブスク枠のみ使用**: Codex は `env -u OPENAI_API_KEY`（ChatGPT ログイン経路の強制）、Grok は公式 Grok Build CLI の grok.com ログイン。API 従量課金には落とさない。

## 仕組み（Stop フックの状態遷移）

```
SessionStart → baseline_head（セッション開始時の HEAD）を記録

Stop 発火
 ├─ bypass / OMC実行モード / 非git / OFF / 不正session_id / 多重Stop → 無音通過（LLM なし）
 ├─ diff ハッシュが前回と同一
 │   ├─ 前回 ALLOW or 初回 → 無音通過。ただし完了主張が差し替わっていれば再評価
 │   ├─ 前回 BLOCK → 前回指摘を再提示して再ブロック（LLM なし・素通り防止）
 │   │    └─ 同一変更のまま3回で警告つき許可に縮退（変更すれば上限は回復）
 │   └─ 前回 UNAVAILABLE → 10分クールダウン後に再評価（復旧の自動検知）
 ├─ クリーン & 評価すべき範囲なし → 無音通過
 └─ 変化あり → Codex + Grok を並列評価（各240秒・上限270秒）
      ├─ 根拠つき BLOCK が1つでも → {"decision":"block"} で差し戻し
      ├─ ALLOW → 無音通過（eval_base 前進・停滞カウンタをリセット）
      └─ 両方利用不可 → fail-open（UNAVAILABLE 記録・eval_base 据え置き）
```

**評価範囲の決め方（eval_base 方式）**

`eval_base` は「評価者が受理した最後の地点」。`git diff <eval_base>` は eval_base から**現在の作業ツリー**までを出すため、そのターンのコミット済み変更と未コミット変更が1つの証拠に入る。

- `eval_base` は **ALLOW のときだけ** 現在の HEAD へ前進する。BLOCK / UNAVAILABLE では据え置くので、未検証のコミットが取り残されない（コミットしてから停止しても素通りできない）。
- 初期値は SessionStart フックが記録する `baseline_head`。コミットが1つも無いリポジトリで始まった場合は空ツリーを起点に root commit を評価する。
- **HEAD の移動が「作業」か「移動」かは HEAD の reflog で見分ける**。直近のエントリが `checkout:` / `reset:` / `rebase` / `merge` なら移動とみなし、ベースラインを現在地へ引き直す（未コミットの変更があればそれは実作業なので評価する）。直近が `commit:` なら作業なので通常どおり評価する。したがって `git checkout -b feature` してから実装・コミットしたターンは**きちんと評価される**（ブランチ名の比較だけだと、これを「切替」と誤認して無評価で受理してしまう）。
  - `reflog -1` は「最後の HEAD 更新」であって「今ターンの操作」ではないため、**HEAD かブランチが実際に動いたときだけ** navigation と判定する。そうしないと数ターン前の checkout に引きずられ、毎ターン差し戻し状態と停滞カウンタが消える。
  - reflog が無効な環境（`core.logAllRefUpdates=false` 等）ではブランチ名の変化のみを移動とみなす。
- `commit --amend` / rebase で起点が到達不能になった場合は、黙って受理せず**警告つき許可**（`systemMessage`）でその旨を可視化し、ベースラインを引き直す。
- 起点から HEAD までのコミット数が上限（既定50、`EVALUATOR_GATE_MAX_COMMITS`）を超える場合は、このターンの作業ではない履歴を巻き込んでいる可能性が高いため、評価せず警告つき許可にする。
- セッション途中でプラグインを導入した等でベースラインが無く、作業ツリーもクリーンな場合は「評価対象なし」として通過する（**無関係な過去コミットを評価して誤ブロックするより安全側**に倒す。時刻ヒューリスティックは使わない）。

**その他の不変条件**

- 差し戻し上限（既定3、`EVALUATOR_GATE_MAX_BLOCKS`）は「**同一の変更のまま停滞した回数**」で、diff が変わればリセットされる（セッション累積上限ではない）。最終バックストップは Claude Code 組み込みの Stop ブロック上限（既定8回）。
- **同一 diff のまま完了主張だけを差し替えた場合**（「WIP です」→「全部完了・テスト通過」）は再評価する。完了を主張しない文面の差し替えでは再評価しない（クォータ保護）。
- 根拠のない BLOCK（`file:line` 参照も `—` 区切りの指摘行も無い）と、1行目以外に現れた BLOCK 行は**採用しない**（幻覚由来の差し戻しを防ぐ。いずれも fail-open 方向）。
- OMC 実行モード（ultrawork / ralph / autopilot / team / ultrapilot / swarm / pipeline / ultraqa）中は多重ゲートを避けるためスキップする。検出は **project-local / session-scoped** の `.omc/state/<mode>-state.json` の `.active == true` のみ（グローバル state は「他プロジェクトの1フラグで全ゲートが死ぬ」ため見ない）。12時間より古い state は stale として無視する。
- 同一セッションの多重 Stop はロックで直列化し、取得できなければ通過する。

- 判定プロトコル: 評価者出力の1行目が `ALLOW: <理由>` / `BLOCK: <理由>`。BLOCK 時は `file:line — 問題 — 期待される状態` の指摘を続ける。
- ループ防止は二段: プラグイン独自の差し戻し上限（既定3回、`EVALUATOR_GATE_MAX_BLOCKS`）→ Claude Code 組み込みの Stop ブロック上限（既定8回）。
- 評価ルーブリックの正（SSOT）は `prompts/stop-gate.md` の `<decision_policy>`。本ファイルは解説であり、観点を変えるときはプロンプト側を改訂する（二重管理しない）。

### 評価観点（decision_policy の要旨）

1. 主張と diff の一致（「テストを追加した」のにテストファイルが diff にない等）
2. テスト実行主張の妥当性
3. 未完了の痕跡（新規 TODO / FIXME / 空実装）
4. 残置デバッグ（console.log / print / 大きなコメントアウト）
5. 片肺実装（caller だけ更新・migration なしのスキーマ変更・存在しないファイルへの import）

曖昧な「改善余地」・スタイルの好み・些細な変更へのテスト不足単独では BLOCK しない。TRUNCATED された diff の見えない部分を根拠にした BLOCK も禁止。

## 使い方

- `/evaluator-gate on` — カレント git リポジトリで有効化（既定 OFF の opt-in）
- `/evaluator-gate off` — 無効化（**人間の指示があるときのみ**）
- `/evaluator-gate status` — 有効状態・セッション state・Codex/Grok の利用可否
- `/evaluate [焦点]` — ゲートとは独立のオンデマンド詳細評価（advisory・差し戻しなし）

状態ファイル: `~/.claude/evaluator-gate/`（config.json / state/<session_id>.json / tmp/）。7日より古い state/tmp は自動 GC。

## 縮退動作一覧

| 状況 | 検知 | 縮退動作 |
|---|---|---|
| Grok トークン失効（7日） | exit≠0 / auth エラー文言 | Codex 単独判定 + stderr で `grok login` 促し |
| Codex クォータ/レート制限 | exit≠0 / usage limit 文言 | Grok 単独判定 + stderr 注記 |
| 両評価者利用不可 | 両方 unavailable | fail-open（無音許可 + stderr 注記。ハッシュは記録し連打防止） |
| 評価者タイムアウト | 240 秒 watchdog | 当該評価者を unavailable 扱い・片肺継続 |
| 巨大 diff | 400行/32KB 閾値 | stat + 上位5ファイル抜粋 + TRUNCATED マーカー |
| 差し戻しループ | 独自カウンタ（既定3） | 警告つき許可に縮退。最終バックストップは組み込み上限8 |
| 無修正の再停止 | 同一ハッシュ + 前回 BLOCK | LLM なしで前回指摘を再ブロック（クォータ消費ゼロ） |
| 実行モード（ultrawork/ralph/autopilot/team） | ~/.omc/state/*-active.flag | 無音スキップ |
| 根拠なし BLOCK（理由20バイト未満） | parse_verdict | unavailable 扱い（採用しない） |

## データフローと既知の限界

- **外部送信**: ゲートを有効にすると、ビルダーの完了主張（last_assistant_message）と git 差分の抜粋が **OpenAI（Codex）と xAI（Grok）に送信される**。機密性の高いリポジトリでは有効化の前にこの点を判断すること。`/evaluate` はゲート OFF でも送信する。
- **secret の防波堤（多層）**:
  1. *名前ベースの除外* — 機微パス（`.env*` / `*.pem` / `*.key` / `*.p12` / `*.pfx` / `*.jks` / `*.keystore` / `*id_rsa*` / `*id_ed25519*` / `*id_ecdsa*` / `*secret*` / `*credential*` / `.npmrc` / `.netrc` / `*.tfvars` / `*.tfstate` / `service-account*.json`、大文字小文字不問）の**内容**は evidence から除外（ファイル名は変更一覧に載る）。パターンは `gate-lib.sh` の `SENSITIVE_GLOBS` が唯一の定義元で、tracked（git pathspec）と untracked（`is_sensitive_path`）の双方に適用される。**除外を追加するときはここだけを編集する**。
  2. *内容ベースの redact* — 通常名のファイル（`docker-compose.yml` 等）や**完了主張の本文**に埋まった高信号 secret（`sk-…` / `AKIA…` / `ASIA…` / `ghp_…` / `github_pat_…` / `npm_…` / `AIza…` / JWT / `xox…` / Bearer トークン / URL 埋込みパスワード / `password=` `secret=` `token=` `api_key=` `credential=` の右辺（引用符・JSON 形式を含む）/ PEM ブロック本体）を送信前にマスクする。正規表現なので **best-effort**（すべての secret は捕まえられない）。**redact に失敗したら外部送信せず評価をスキップする**（fail-closed）。
  3. *読取面の限定* — 評価者の作業ディレクトリは evidence ディレクトリに限定し、Grok は Read/Write/Edit/Bash を拒否、Codex は read-only サンドボックス。untracked の **symlink は参照先を読まない**。**注意: Codex の `read-only` は書き込みを禁じるだけでファイル読み取りは禁じない**ため、作業ディレクトリには「サニタイズ済みのファイルしか置かない」ことで担保する（生の完了主張 `last_msg_raw.txt` と生 diff `tracked.diff` は evidence 生成直後に削除する）。
  4. *痕跡を残さない* — evidence 一時ファイルは umask 077 で作成し**評価後に即削除**（`EVALUATOR_GATE_KEEP_TMP=1` でデバッグ保持）。
  5. *実行バイナリの検証* — 毎 Stop で起動する grok バイナリは、自分または root の所有かつ group/other 書込不可であることを確認してから実行する。

  5.5. *OS レベルの読取隔離（opt-in）* — `EVALUATOR_GATE_SANDBOX=1` を設定すると、macOS の `sandbox-exec` で評価者を包み、**リポジトリ本体と `$HOME` の機密（`~/.ssh` `~/.aws` `~/.gnupg` `~/.kube` `~/.docker` `~/.config/gcloud` `~/.npmrc` `~/.netrc` `~/.git-credentials`）の読取を OS レベルで遮断**する。実測で、sandbox なしでは Codex がリポジトリ内の秘密ファイルを読めたのに対し、sandbox ありでは `Operation not permitted` となることを確認済み。

  **それでも防げないもの**:
  - 上記パターンに合致しない形式の secret（独自形式のトークン、平文の顧客データ等）。
  - **既定では評価者の読取は OS レベルで封じられない**。Grok は `--deny Read` で拒否できるが、**Codex CLI の `-s read-only` は「書き込み禁止」であってファイル読取は許可される**。既定ではプロンプト指示・cwd=evidence・生ファイル削除で担保している。

  したがって **「無条件に全プロジェクトで有効化してよい」ものではない**。機密性の高いリポジトリではゲートを OFF のままにすること（既定 OFF）。
- **自己免除は紳士協定**: OMC モード state や `/evaluator-gate off`・`EVALUATOR_GATE_BYPASS` は、ビルダー自身が技術的には操作できてしまう（Stop フックというアーキテクチャの本質的限界。強制セキュリティコントロールではない）。スキップ時は stderr に理由を記録するので、transcript から事後検証は可能。
- **変更の破棄による回避**: 差し戻しを受けた状態で `git stash` / `git checkout -- .` すると作業ツリーがクリーンになり、評価対象が消えるため停止できる（＝指摘は解消されていないが、そのコードも存在しない）。未解消の差し戻しがあるまま HEAD が移動した場合は stderr に警告を残す。
- **history 書き換えの縁**: `commit --amend` / rebase で eval_base と baseline_head の両方が到達不能になった場合、そのターンのコミット済み変更は範囲評価できない。黙って受理せず警告つき許可で可視化するが、**そのターンは検証されない**。
- **同一ターン内での既存ブランチ切替 + コミット**: `git checkout existing-feature && git commit` を1ターンで行うと、reflog の直近が `commit:` になるため、そのブランチの既存コミットも今回の作業として評価されうる（コミット数上限50で頭打ち。超えると評価せず警告）。ターンを分ければ正しく扱われる。
- **セッション途中導入**: SessionStart フックを通っていないセッション（プラグインを途中でインストールした等）でクリーンな作業ツリーのまま停止した場合は評価しない。過去の無関係なコミットを評価して誤ブロックするより安全側に倒している。
- **並行実行**: 同一セッションの多重 Stop はロックで直列化するが、**別セッションが同じリポジトリを同時に編集している場合**、ハッシュ取得から evidence 生成までの間の変更が混ざりうる（評価の精度の問題であって、誤ブロックの原因にはなりにくい）。
- **プロンプト注入耐性**: ビルダーのメッセージと diff は「信頼しないデータ」としてセンチネルで囲み、データ側のセンチネル文字列は挿入前に除去（境界偽装防止）。評価者には内部指示への追従禁止・操作意図の指摘を指示している。完全な防御ではない。

## トラブルシュート

- **Grok が常に unavailable**: `grok login` を実行（grok.com サブスクのブラウザ認証。トークンは7日で失効）。`/evaluator-gate status` が auth の経過日数を表示する。
- **Codex が常に unavailable**: `codex login status` で ChatGPT ログインを確認。
- **ブロックが不当だと思ったら**: `/evaluate` で advisory の所見を取り、人間が判断する。緊急脱出は環境変数 `EVALUATOR_GATE_BYPASS=1`（人間専用）。
- **state をリセットしたい**: `rm ~/.claude/evaluator-gate/state/<session_id>.json`。
- **評価が遅い**: `EVALUATOR_GATE_EVAL_TIMEOUT`（秒、既定240）と `EVALUATOR_GATE_CODEX_EFFORT`（既定 medium）で調整。モデルは `EVALUATOR_GATE_CODEX_MODEL` / `EVALUATOR_GATE_GROK_MODEL`（既定 grok-4.5）で上書き可能。
- **OS レベル読取隔離を使いたい**: `EVALUATOR_GATE_SANDBOX=1`（macOS のみ）。有効時は評価者を `sandbox-exec` で包み、順次実行に切り替える（sandbox 下の Codex は並列起動で不安定なため）。
  **既知の問題**: sandbox 有効時、Stop フック経由で起動された Codex が `Error: Operation not permitted (os error 1)` で即座に落ちることがある（`run-evaluator.sh` を直接実行した場合は正常動作し、リポジトリ読取も正しく遮断される）。原因未特定。この場合は Grok 単独判定に縮退する（差し戻し機能自体は動作する）。両評価者を確実に使いたい場合は sandbox を無効（既定）のままにすること。

## 不変条件

- ビルダー（Claude 本体）が評価回避の目的で `/evaluator-gate off` や `EVALUATOR_GATE_BYPASS=1` を使ってはならない。これらは人間専用。
- 評価者の生出力を改変して報告しない。
- SubagentStop には登録しない（サブエージェント停止まで外部評価すると多重発火する）。
- 既存の codex 公式プラグインの stop-time review gate（`/codex:setup --enable-review-gate`）と**同時に有効化しない**（Stop フックの二重発火になる）。
