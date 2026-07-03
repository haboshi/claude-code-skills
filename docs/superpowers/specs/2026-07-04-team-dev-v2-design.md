# team-dev v2 設計: Fable 5 フォールバックとエバリエーターゲート

- 日付: 2026-07-04
- 対象: `~/.claude/commands/team-dev.md`（主）、`~/.claude/agents/team-guardian.md`（軽微）
- 設計基盤: 本リポジトリ `docs/harness-research/`（特に `03-loop-engineering-deep-dive.md` と `design/01〜06`）
- ステータス: ユーザー承認済み（設計）

## 背景・目的

team-dev（自律型開発チーム編成コマンド）を v2 にアップグレードする。狙いは3つ。

1. **Fable 5 対応の堅牢化**: Fable 5 は利用上限・プラン・ZDR 環境・コンテンツ classifier により使えない場合がある。不可用時に Opus へフォールバックする機構を設計する。
2. **エバリエーターゲートの導入**: harness-research の「証拠生成ループ」「Maker–Checker 分離」「cheap-frequent → expensive-rare カスケード」の原則に基づき、企画段階（Gate P）と完了報告前（Gate F)の2箇所に考慮漏れ・抜け漏れを判定するエバリエーターゲートを置き、不備があれば修正ループを回す。
3. **Claude + Codex の二軸レビュー**: 両ゲートで Claude 系エバリエーターと Codex（別モデル系統）の二軸で指摘を生成し、判定の盲点相関を下げる。

## 確定した設計判断

| 論点 | 決定 | 根拠 |
|---|---|---|
| フォールバック検知方式 | ハイブリッド（起動時プローブ + spawn 後セルフレポート + settings 推奨） | 公式仕様上、モデル不可用の spawn はエラーにならずサイレント降格するため、「実行して確認」が唯一の正規手段 |
| 修正ループ上限 | 同一ゲート2回 revise で人間へ escalate。no-progress（同一指摘の再出現）は即 escalate | ループ暴走とトークン浪費の防止（turn/budget/no-progress cap の原則） |
| 二軸の判定統合 | 指摘の生成は二軸・採否と差し戻し判定は Lead | 現行 team-dev の「生成と承認の分離」と一貫。片軸誤検知での空転を防ぎ、Codex 未導入環境でも単軸で成立 |
| 実装形態 | 案A: team-dev.md にゲートを組み込み、評価者は既存資産（oh-my-claudecode:critic / verifier）を Task 起動、Codex 軸は codex exec | 新規保守ファイルなし。fresh context 起動で blind 評価を実現 |

## 前提となる公式仕様（2026-07-04 調査）

- **サブエージェントのモデル指定が組織の `availableModels` 許可リスト外の場合、spawn は失敗せず親セッションの継承モデルでサイレント実行される**（高確度・公式 docs）。よって「spawn 失敗のキャッチ」というリアクティブ検知は成立しない。
- **`fallbackModel` チェーン**（settings / CLI `--fallback-model`）が公式に存在し、overloaded / unavailable / サーバーエラー時に最大3モデルを順に試行する（確認済み）。
- **Fable 5 固有のコンテンツベース降格**: セキュリティ/バイオ領域の classifier がフラグを立てると Fable→Opus に自動切替され、transcript に通知が出る（確認済み）。
- **可用性の事前検証 API は存在しない**（記載なし）。プローブは「小さく実行して稼働モデルを確認する」方式が正規手段。
- プラン別の Fable 5 利用可否・上限の詳細は公式ドキュメントに記載なし（未確認）。

## 設計1: モデルフォールバック（三段構え）

### 1-1. 起動時マイクロプローブ（Preflight 末尾に追加）

Preflight Check の最終ステップとして、`Task(model: fable)` で極小プロンプト「あなたの稼働モデルIDを1語で報告せよ」を1発起動する（数百トークン規模）。

- 報告が fable → 「Fable 可用」。モデル戦略表を既定のまま確定。
- 報告が fable 以外（サイレント降格の検出）または null（エラー）→ **セッション降格表「fable→opus」を適用**。以降このセッションでは、品質優先モード・タスク属性ルーティング・差し戻しラダーの fable 指定をすべて opus に読み替える。ユーザーに降格を明示通知する。

Task プローブを採用する理由: 後で実際に使う spawn 経路（Agent tool の model パラメータ + allowlist チェック）そのものを検証できる。headless `claude -p` プローブは経路が異なるため採らない。

### 1-2. spawn 後セルフレポート検証（常時・全メンバー）

Spawn チェックリストに必須項目を追加: 「**初回報告に自分の稼働モデルIDを含めること**」。

- Lead は各メンバーの初回報告で指定モデルとの一致を確認する。
- 不一致（セッション途中の上限到達等によるサイレント降格）を検出したら: 該当メンバーに shutdown を送り、**opus を明示指定して再 spawn** する。未統合の worktree 変更があれば、Lead が先に統合または破棄を判断してから再 spawn する（既存の差し戻しラダー2回目と同じ手順）。
- プローブ通過後でもセッション途中の不可用化はあり得るため、この層が実行中の保険となる。

### 1-3. settings による自動チェーン（推奨事項）

team-dev.md に推奨節を追記: settings.json の `fallbackModel` 配列（例: `["opus"]`）の設定を推奨。また Fable→Opus のコンテンツベース降格通知を Lead が観測した場合も、当該セッションでは降格表を適用する。

### 降格表

**fable → opus の1段のみ。** opus も不可用の場合はユーザーへ escalate する。sonnet への自動降格は行わない（品質優先モードの意図を壊すため。コストを下げたい場合はユーザーがコスト優先モードを選ぶ）。

## 設計2: Gate P — 企画エバリエーターゲート（Wave 0→1 に挿入）

mission-brief.md 完成後・Wave 1 実装者 spawn 前に発火する。手戻りコストが最も高い上流での考慮漏れを止める。

### 評価対象と blind 規律

- 渡すもの: **mission-brief.md + ユーザーの元要件のみ**。
- 渡さないもの: Lead の検討過程・会話履歴・弁明。評価が「作った理由への同意」に流れるのを防ぐ（Maker–Checker 分離）。

### 二軸の構成

| 軸 | 起動方法 | 備考 |
|---|---|---|
| Claude 軸 | `Task(subagent_type: oh-my-claudecode:critic, model: opus)` を fresh context で起動 | 計画レビュー専門エージェントの流用 |
| Codex 軸 | `codex exec -s read-only -o /tmp/codex-gate-p.json "<rubric + verdict スキーマ指示>" \|\| true` | CLI 未導入・パース失敗時は Claude 単軸に自動縮退。モデル・effort は `~/.codex/config.toml` 既定に従う（固定モデル名のハードコード禁止、既存規律を維持） |

### rubric（考慮漏れ観点）

1. 元要件のカバレッジ — 全要求がタスク一覧に落ちているか
2. 受け入れ基準の検証可能性 — 各基準が「何を実行すれば証明されるか」（proof）に落ちるか
3. インターフェース契約の完全性 — エラー形・境界値・共有型を含むか
4. リスク・エッジケースの見落とし
5. ファイル境界の整合 — 並列実装の競合の芽がないか
6. 過剰スコープ（YAGNI）— 要求にない作り込みが混入していないか

### verdict 契約（両軸共通・構造化 JSON）

```json
{
  "status": "pass | revise | escalate",
  "defects": [{ "severity": "CRITICAL|HIGH|MEDIUM", "point": "指摘", "basis": "根拠" }],
  "next_directive": "revise 時に次に直すべきことを具体的に1つ"
}
```

### 統合と分岐

- 二軸一致の指摘: 原則採用（高信頼）。
- 単独指摘: Lead が根拠を見て採否判定。
- revise → Lead が mission-brief を修正（複雑なら oh-my-claudecode:analyst に再委譲）→ 再ゲート。
- **2回 revise しても pass しなければ AskUserQuestion でユーザーへ escalate**。
- pass して初めて Wave 1 の実装者を spawn する。

## 設計3: Gate F — 完了エバリエーターゲート（最終報告前）

既存の Gate 2→3（決定論チェック）を前段に残し、後段に LLM 評価を追加する二段カスケード。決定論で落ちるものを LLM に回さない。

### 前段（決定論・既存のまま）

統合マージ後の build 成功 / `npx tsc --noEmit` 通過 / 全テスト通過 / Guardian・Tester の CRITICAL・HIGH 指摘 0 件。ここを通過して初めて後段へ進む。

### 後段（LLM 二軸・blind）

| 軸 | 起動方法 | 判定内容 |
|---|---|---|
| Claude 軸 | `Task(subagent_type: oh-my-claudecode:verifier)` を fresh context で起動。渡すのは mission-brief の受け入れ基準 + 統合後 diff + テスト実行結果の証拠のみ | 各受け入れ基準が**証拠付きで**達成されているか / 要件の抜け漏れ / スコープ逸脱 |
| Codex 軸 | `codex exec review`（統合後の最終状態に対して）`\|\| true` | 同上 + コード品質の最終確認 |

Guardian の Wave 2 の Codex レビューは「実装中の中間検査」として維持し、Gate F は「統合後の最終検査」として役割を分ける（team-guardian.md に位置づけを明記）。

### fail 時のループ

1. Lead が二軸の指摘を採否判定（生成と承認の分離）。
2. 採用した指摘は既存の**品質差し戻しラダー**に接続: 1回目は同一実装者へ修正指示、2回目はモデル1段昇格で再 spawn。
3. 修正後、前段（決定論）から再実行 → 後段再ゲート。
4. **ゲート再実行は2回まで。3回目はユーザーへ escalate**。
5. **no-progress 検知**: 前回と同一指摘が再出現したら回数を待たず即 escalate（空回りループの防止）。

### 評価記録

各ゲートの verdict（二軸の一致/不一致を含む）を最終報告に「エバリエーター判定サマリー」として含める。将来のメタ評価（judge 精度の監査）の素地とする。

## 構成別の縮退形

- **Full / Medium**: 上記のとおり。Gate P / Gate F とも Lead がゲート実行を主導。
- **Small**: チームメイトを増やさず、Lead が critic / verifier を直接 Task 起動する（既存の Small 構成の代替パターンと同形）。Gate P / Gate F は規模に関わらず必須。
- **Codex 未導入環境**: 両ゲートとも Claude 単軸で成立（`|| true` 縮退）。縮退したことを最終報告に明記する。

## 設計原則との対応（harness-research 準拠）

- **Maker–Checker 分離 / blind 評価**: 評価者は fresh context で起動し、成果物と目的（rubric）だけを見せる。改善履歴・弁明は渡さない。
- **カスケード**: 決定論（build/tsc/test）→ LLM 評価の順。高頻度層は安く、節目だけ重く。
- **verdict の機械可読化**: status を enum に固定し、next_directive を次ターンの指令に変換する（評価が No を返すこと自体が次の指令になる）。
- **停止条件**: 2回 revise cap + no-progress cap + 人間 escalate。単一指標での自動停止はしない（metric monoculture 回避）。
- **モデル多様性**: 二軸の効果の源泉は「2回見ること」でなく「別系統のモデルで見ること」。AND ゲートにせず Lead 採否とすることで、片軸誤検知の空転を防ぐ。

## 変更ファイル一覧

| ファイル | 変更内容 |
|---|---|
| `~/.claude/commands/team-dev.md` | Preflight にマイクロプローブ追加 / モデル戦略にフォールバック節（降格表・セルフレポート・fallbackModel 推奨）/ Wave 0→1 に Gate P 挿入 / Gate 2→3 を Gate F に拡張 / Spawn チェックリストにモデル自己報告 / 構成別縮退形 |
| `~/.claude/agents/team-guardian.md` | Codex レビューを「実装中の中間検査」と明記し Gate F との役割分担を追記（軽微） |
| `~/.claude/agents/team-frontend.md` / `team-backend.md` | 変更なし（自己報告は spawn プロンプト側で指示） |

## 非対象（今回やらないこと）

- hooks による強制ゲート化（案C）: 今回は規約ベース。ゲートのすり抜けが観測されたら次サイクルでフック化を検討する。
- メタ評価の自動化（judge 一致率の集計基盤）: 評価記録の出力までを今回の範囲とし、集計は将来課題。
- sonnet への多段フォールバック: 行わない（品質モードの意図を保持）。
- Codex を常駐チームメイトにすること: 都度 `codex exec` 起動で足りる（常駐コストを避ける）。

## リスクと対応

| リスク | 対応 |
|---|---|
| プローブ自体の誤判定（一時的エラーで不可用と誤認） | プローブ null 時は1回だけ再試行してから降格を確定する |
| ゲート追加によるコスト・時間の増加 | Gate P は read-only テキストレビューで軽量。Gate F は決定論前段の通過後のみ発火。ループ cap 2回で上限を固定 |
| Codex 出力のパース失敗 | JSON スキーマを明示指示しつつ、失敗時は単軸縮退（ゲート自体は止めない） |
| 評価者の過剰指摘（false positive）でループ空転 | 採否は Lead 判定。no-progress 検知で即 escalate |
