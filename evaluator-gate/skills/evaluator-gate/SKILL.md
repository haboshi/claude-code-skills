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
Stop 発火
 ├─ bypass / 実行モードフラグ(ultrawork等) / 非git / OFF → 無音通過（LLM なし）
 ├─ diff ハッシュが前回と同一
 │   ├─ 前回 ALLOW or 初回 → 無音通過（LLM なし）
 │   └─ 前回 BLOCK → 前回指摘を再提示して再ブロック（LLM なし・素通り防止）
 │        └─ 差し戻し3回目以降 → 警告つき許可に縮退（additionalContext）
 └─ diff が変化 → Codex + Grok を並列評価（各240秒）
      ├─ 根拠つき BLOCK が1つでも → {"decision":"block"} で差し戻し
      ├─ ALLOW → 無音通過
      └─ 両方利用不可 → fail-open（stderr に注記）
```

- 証拠の範囲: working tree が dirty なら HEAD 基準の diff + untracked。**ターン内でコミットまで済ませてクリーンになった場合**は、前回評価時点の HEAD からのコミット範囲 diff（`last_head..HEAD`）を評価する（コミットによる素通りを防止）。範囲が取れない場合（セッション初回のクリーン状態・branch checkout 等）は評価対象なしとして通過する。

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

- **外部送信**: ゲートを有効にすると、ビルダーの完了主張（last_assistant_message）と git 差分の抜粋が **OpenAI（Codex）と xAI（Grok）に送信される**。機密性の高いリポジトリでは有効化の前にこの点を判断すること。
- **secret の防波堤**: 機微パス（`.env*` / `*.pem` / `*.key` / `*.p12` / `*.pfx` / `*id_rsa*` / `*secret*` / `*credential*`）の**内容**は evidence から除外される（ファイル名は変更一覧に載る）。評価者の作業ディレクトリは evidence ディレクトリに限定し、リポジトリ本体は読ませない。ただし機微情報を上記パターン外のファイルに置いている場合は防げない。
- **自己免除は紳士協定**: 実行モードフラグ（~/.omc/state/*-active.flag）や `/evaluator-gate off` は、ビルダー自身が技術的には操作できてしまう（Stop フックというアーキテクチャの本質的限界）。スキップ時は stderr に理由を記録するので、transcript から事後検証は可能。
- **history 書き換えの縁**: `commit --amend` / rebase で前回 HEAD が到達不能になった場合、そのターンのコミット済み変更は範囲評価できず通過する（エッジケースとして許容）。
- **プロンプト注入耐性**: ビルダーのメッセージと diff は「信頼しないデータ」としてセンチネルで囲み、内部の指示への追従を禁止・検出時は BLOCK 対象と評価者に指示している。完全な防御ではない。

## トラブルシュート

- **Grok が常に unavailable**: `grok login` を実行（grok.com サブスクのブラウザ認証。トークンは7日で失効）。`/evaluator-gate status` が auth の経過日数を表示する。
- **Codex が常に unavailable**: `codex login status` で ChatGPT ログインを確認。
- **ブロックが不当だと思ったら**: `/evaluate` で advisory の所見を取り、人間が判断する。緊急脱出は環境変数 `EVALUATOR_GATE_BYPASS=1`（人間専用）。
- **state をリセットしたい**: `rm ~/.claude/evaluator-gate/state/<session_id>.json`。
- **評価が遅い**: `EVALUATOR_GATE_EVAL_TIMEOUT`（秒、既定240）と `EVALUATOR_GATE_CODEX_EFFORT`（既定 medium）で調整。モデルは `EVALUATOR_GATE_CODEX_MODEL` / `EVALUATOR_GATE_GROK_MODEL`（既定 grok-4.5）で上書き可能。

## 不変条件

- ビルダー（Claude 本体）が評価回避の目的で `/evaluator-gate off` や `EVALUATOR_GATE_BYPASS=1` を使ってはならない。これらは人間専用。
- 評価者の生出力を改変して報告しない。
- SubagentStop には登録しない（サブエージェント停止まで外部評価すると多重発火する）。
- 既存の codex 公式プラグインの stop-time review gate（`/codex:setup --enable-review-gate`）と**同時に有効化しない**（Stop フックの二重発火になる）。
