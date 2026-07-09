---
description: 実装済みのプロバイダ統合コードから新パターン/アンチパターン/catalog更新点をMaker/Checker分離で抽出し、ドメインスキルへの提案diffとして報告する知見還流コマンド
argument-hint: "[project-path] [--domain <name>] [--dry-run]"
---

`/provider-harvest` は、provider-harness の harvest-protocol（`skills/provider-harness/references/harvest-protocol.md`）に定めた
Maker/Checker 分離ループを実行し、実装から学んだ知見を**提案 diff として報告するだけ**のコマンドです。スキル本体は書き換えません。

引数: `$ARGUMENTS`

## 実行モードの意味論（先に確認する）

- **通常実行**（`--dry-run` なし）: Step 1〜5 で提案 diff を生成し、Step 6 で pending キューから対象プロジェクトのエントリを消化する（「処理済み」として記録を消す）。**この場合も `skills/` 配下のファイルは一切編集しない**（下記「不変条件」参照）。キュー消化はあくまで「知見抽出のフローを一度回し終えた」という記録更新であり、スキルへの反映（採否判断・コミット）とは完全に別物である。
- **`--dry-run`**: Step 1〜5 の提案生成のみで止める試し実行。**pending キューは消化しない**ため、次回セッション開始時も `harvest-nudge.sh` による督促が継続する。まだ本格的に harvest を回す準備ができていない時の下見・確認用途に使う。

## 入力解釈

`$ARGUMENTS` を以下のルールで解釈する。

- 第1引数（`--` で始まらない最初のトークン）: 対象プロジェクトの絶対/相対パス。省略時は現在の作業ディレクトリ（cwd）を対象にする。
- `--domain <name>`: 対象ドメインスキル名を明示指定する（例: `provider-image-gen`）。省略時は Step 1 のスキャン結果から自動判定する（Step 2）。
- `--dry-run`: 上記「実行モードの意味論」の通り、提案生成のみで止め、Step 6 の pending キュー消化は行わない。

## Step 1: 決定論スキャン（LLM 判断を混ぜない）

対象プロジェクトに対して Grep/Glob のみで事実を集める。この段階では評価・要約を行わず、事実の列挙にとどめる。

- プロバイダ SDK の import/require 文: `openai`, `@google/genai`, `@google-cloud/*`, `deepgram`, `assemblyai`, `elevenlabs` など
- モデルIDらしき文字列リテラル（例: `gpt-`, `gemini-`, `claude-`, `-latest`, `-preview` を含むリテラル）
- retry / timeout の定数・設定値
- プロバイダ関連の環境変数名（`process.env.*`, `os.environ*` 等での参照箇所）
- interface と実装の分離（ポート/アダプタ境界）の有無 — 抽象型定義ファイルと実装ファイルが分かれているか
- エラー分類のマッピング実装 — プロバイダ固有エラーから正準8分類（rate_limited / quota_exhausted / auth / invalid_input / content_blocked / timeout / transient / unsupported。メタスキル references/error-taxonomy.md 参照）への対応表の有無と内容

## Step 2: ドメイン特定

Step 1 で検出したプロバイダから、対象ドメインスキルを決定する。

- `--domain` 指定があればそれを優先する
- 省略時は検出プロバイダから自動判定する（例: 画像生成呼び出しが主であれば `provider-image-gen`）
- `skills/provider-harness/SKILL.md` の「ドメインスキル・レジストリ」を参照する。該当ドメインが「予約（未実装）」の場合は「新ドメインスキル候補」としてレポート（Step 5）に記録し、Step 3 以降はスキップする

## Step 3: Maker（blind 抽出）

Task ツールで fresh-context の subagent を1体起動する。

- 渡す情報: Step 1 で収集した実装抜粋（**secret は必ずマスクしてから渡す**）と、現行ドメインスキルの該当部（port 定義・model-catalog・templates 等）のみ
- 渡さない情報: 改善履歴、過去の harvest 結果（blind 抽出を維持するため）
- 指示: 「新パターン / アンチパターン / catalog で更新すべき事実 / 新しい escape hatch / 不足している契約テストを、対象ファイルパス・提案編集テキスト・confidence(0-1)・priority を添えて返せ。裏が取れない推測は confidence を下げよ」

## Step 4: Checker（反証検証）

Maker とは別レーンの subagent を起動し、Step 3 の提案を敵対的に検証する。

- 採用バー: 「プロジェクトの実コードと現行ドメインスキルの型との具体的な乖離」を引用できない提案は却下する
- 抽象的な「もっとこうした方が良い」は通さない
- 却下した提案には却下理由（引用できなかった具体的な乖離）を残す

## Step 5: レポート出力

以下を会話内に人間向けにまとめて出力する（ファイルへの書き込みは行わない）。

(a) **サマリ**: 対象プロジェクト・検出プロバイダ・何を harvest したか
(b) **生き残った提案の diff 一覧**: 対象ファイル・unified diff・confidence・根拠となる grounded fact への参照（Step 1 で収集した具体的なファイル/行）・非ポータブルな注意点（このプロジェクト固有で他プロジェクトへ一般化できない事情があれば明記）
(c) **適用手順**: 採否は必ず人間が判断する。採用する場合は harvest 実行と同一コンテキストで直接コミットせず、別タスクとして起票 → reviewer 承認 → コミットの順に従う（`references/harvest-protocol.md` 参照）。semver は変更の性質で決める:
  - 事実の修正（誤った記述の訂正） → patch
  - 新しい型・パターンの追加 → minor
  - 既存原則の破壊的変更 → major

## Step 6: pending キューの消化

`--dry-run` のときはこのステップを実行しない（Step 5 の提案生成のみで終了する）。

`--dry-run` でない場合:

1. `~/.claude/provider-harness/pending.jsonl` を読む
2. 対象プロジェクト（絶対パス一致）に該当するエントリを取り除く
3. 該当プロジェクト以外のエントリはそのまま残し、ファイル全体を書き戻す

## 不変条件

- このコマンドは `skills/` 配下のファイルを一切編集しない。常に提案 diff の提示に留める。
- スキルの自動書き換えは行わない。採否は必ず人間が行う。
- `--dry-run` 時は pending キューの消化を行わない。
