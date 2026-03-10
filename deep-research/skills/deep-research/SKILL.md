---
name: deep-research
description: This skill should be used when the user asks to "深く調べて", "詳しくリサーチして", "deep research", "包括的に調査して", "徹底調査", "多角的に分析して", "市場調査して", "技術調査", "比較分析", "比較して", "AとBの違い", "vs", "どっちがいい", "アイデア出し", "企画リサーチ", "異業種調査", or needs comprehensive multi-source research producing a consolidated report. Use for topics requiring 3+ independent sub-topics investigated in parallel OR comparison of 2+ alternatives. NOT for single-topic quick lookups (use brave-research instead).
allowed-tools: Agent, Bash, Read, Write, WebSearch, AskUserQuestion, mcp__fetch__fetch, mcp__plugin_context7_context7__resolve-library-id, mcp__plugin_context7_context7__query-docs
---

# Deep Research v5.0 - マルチエージェント調査スキル

## 設計思想

> **掘るのは安いモデル、磨くのは強いモデル。深さよりもまず終わること。**
> **Claude 系はデフォルト常用せず、タスクに最適なモデルをポリシーで選択する。**

- 検索エージェント（Phase 2）: 軽量モデル（デフォルト: GLM-5）— 高速・低コストで情報収集
- 統合（Phase 3）: 主力モデル（デフォルト: GPT-5.4）— 高品質な分析・統合
- 高品質統合: Opus — ユーザー明示指定時のみ
- 2つのモード: **compare-lite**（速く鋭く）と **deep-full**（必要時だけ重く）

---

## brave-research との棲み分け

```
調査リクエスト
├─ 単一トピック・速報性重視 → brave-research
├─ 特定の事実確認 → brave-research
├─ 2つ以上の対象の比較 → deep-research (compare-lite)
├─ 多角的分析（3+サブトピック） → deep-research (deep-full)
├─ 学術含む徹底調査 → deep-research (deep-full)
└─ 企画・アイデア出し → deep-research (deep-full + Creative)
```

---

## Critical Rules

1. **オーケストレーターは調査しない** — WebSearch はサブエージェントに委譲（PREFLIGHT・ENRICH は例外）
2. **サブエージェントは必ず並列起動** — 1つの応答で全 Agent ツールを同時に呼ぶ
3. **計画はユーザー承認後に実行** — AskUserQuestion で確認
4. **出力ディレクトリは事前作成** — `mkdir -p /tmp/deep-research/{slug}/`
5. **最終レポートは日本語** — ソースが英語でも日本語で統合
6. **停止条件を厳守** — 予算超過時は即停止し、収集済み情報で統合
7. **最終レポート後に次アクション提示** — AskUserQuestion を省略しない

---

## タスクモード

### モード自動判定

| ユーザーの意図 | キーワード | モード |
|---|---|---|
| 2つ以上の比較 | "比較", "vs", "違い", "どっちが", "compare" | **compare-lite** |
| 技術選定 | "どれを使うべき", "選定", "which should" | **compare-lite** |
| 包括的な調査 | "深く調べて", "徹底調査", "市場調査" | **deep-full** |
| 企画・アイデア | "アイデア", "企画", "異業種", "ブレスト" | **deep-full** (Creative) |
| 判断困難 | — | AskUserQuestion で確認 |

### compare-lite（比較・速度重視）

| 項目 | 値 |
|------|-----|
| 目標時間 | 5〜8分 |
| エージェント数 | 2〜3体 |
| エージェントモデル | **Search モデル**（モデルポリシー参照） |
| ラウンド数 | **2ラウンド（固定）** |
| WebSearch/エージェント | 最大6回 |
| WebSearch 合計予算 | 最大18回 |
| ENRICH | なし（PREFLIGHT の結果を seed に流用） |
| GAP ANALYSIS | なし |
| 出力形式 | **比較マトリクス + 結論** |

### deep-full（徹底調査）

| 項目 | 値 |
|------|-----|
| 目標時間 | 10〜20分 |
| エージェント数 | 3〜5体 |
| エージェントモデル | **Search モデル**（モデルポリシー参照） |
| ラウンド数 | **最大3ラウンド（適応型）** |
| WebSearch/エージェント | 最大10回 |
| WebSearch 合計予算 | 最大40回 |
| ENRICH | フル（Seed + 条件付き Context7/URL/Market） |
| GAP ANALYSIS | 条件付き（最大1体追加） |
| 出力形式 | 構造化レポート |

---

## モデルポリシー（Flexible Model Selection）

### 設計原則

> **固定モデルではなく、ポリシーで選択する。Claude 系はデフォルト常用せず、タスク特性・ユーザー指定に応じて最適モデルを選択。**

### ロール定義

| ロール | 目的 | デフォルト推奨 |
|--------|------|----------------|
| **Search** | 情報収集・WebSearch 実行（Phase 2 エージェント） | GLM-5（軽量・低コスト） |
| **Synthesis** | 統合・最終レポート生成（Phase 3） | GPT-5.4（高品質推論） |
| **Premium** | 最高品質の統合・分析 | Opus（明示指定時のみ） |

### モード別デフォルト

| モード | Search モデル | Synthesis モデル |
|--------|---------------|-----------------|
| **compare-lite** | GLM-5 | GPT-5.4 |
| **deep-full** | GLM-5 | GPT-5.4 |
| **premium** | GPT-5.4 | Opus |

### ユーザー指定による上書き

| ユーザーの指示 | Search | Synthesis | 意図 |
|--------------|--------|-----------|------|
| （指定なし） | GLM-5 | GPT-5.4 | コスト最適のデフォルト |
| "安く" / "コスト重視" | GLM-5 | GLM-5 | 全工程を最安モデルで |
| "速く" / "急いで" | GLM-5 | GLM-5 | 速度最優先 |
| "高品質で" / "プレミアム" | GPT-5.4 | Opus | 品質最優先 |
| "Opus で" | sonnet | opus | Opus 指定 |
| "GLM で" | GLM-5 | GLM-5 | GLM 固定 |
| "GPT で" / "GPT-5.4 で" | GPT-5.4 | GPT-5.4 | GPT 固定 |
| "Claude で" | haiku | sonnet | Claude 系指定 |

### Claude Code 実行時のマッピング

Agent ツールの `model` パラメータは `haiku` / `sonnet` / `opus` のみ対応。
ポリシーモデルを以下のようにマッピングする:

| ポリシーモデル | Agent `model` | 備考 |
|--------------|--------------|------|
| GLM-5 | `haiku` | 最軽量・最安 |
| GPT-5.4 | `sonnet` | バランス型 |
| Opus | `opus` | 最高品質 |

**将来拡張**: 外部モデル API（Codex MCP 等）が利用可能であれば、Agent ツール以外の経路で直接 GLM-5 / GPT-5.4 を呼び出すことも可能。その場合はマッピングを経由せずポリシーモデルを直接使用する。

---

## 停止条件

### エージェントレベル

| 条件 | compare-lite | deep-full |
|------|-------------|-----------|
| ラウンド上限 | **2（固定）** | **3（絶対上限）** |
| WebSearch 上限 | 6回 | 10回 |
| Round 2 で全質問「十分」 | → レポート作成へ | → 即停止、Round 3 不要 |
| Round 2 で「不足」あり | → 得られた情報で作成 | → Round 3 実行後に停止 |
| Round 3 以降 | **実行禁止** | Round 4 以降 **実行禁止** |

### グローバルレベル

| 条件 | compare-lite | deep-full |
|------|-------------|-----------|
| 全エージェント完了後 | → 即 Phase 3 | → Phase 2.5 評価 |
| GAP 追加エージェント | なし | 最大1体 |
| Phase 1.5 WebSearch | なし | 最大4回 |
| Phase 1.5 mcp_fetch | なし | 最大2回 |

### 強制終了
- WebSearch 合計予算を超過 → 即停止、収集済み情報で統合
- エージェントが出力なし → スキップして他エージェントの結果で統合

---

## エージェント体系（6種類）

| エージェント | 調査ドメイン | 典型的ソース | compare-lite |
|---|---|---|---|
| **Technical** | 技術設計・実装・性能 | 公式docs, GitHub, arXiv | ○ |
| **Market** | 市場規模・競合・資金調達 | Gartner, TechCrunch, IR資料 | ○ |
| **User** | ユーザー体験・採用率 | SO Survey, G2, Reddit | ○ |
| **Academic** | 学術研究・理論 | arXiv, Semantic Scholar | deep-full のみ |
| **Policy** | 規制・政策・標準化 | 官公庁, ISO/IEEE | deep-full のみ |
| **Creative** | アナロジー・異業種着想 | HBR, IDEO, スタートアップ | deep-full のみ |

### 選択ガイド

```
トピック分析
├─ 技術的な仕組みを問う → Technical
├─ 市場・ビジネスを問う → Market
├─ ユーザー・現場の声を問う → User
├─ 学術的・理論的な背景を問う → Academic
├─ 法規制・政策を問う → Policy
├─ 新規アイデア・差別化を問う → Creative
└─ 複数該当 → 該当する全エージェントを選択
```

---

## ワークフロー概要

### compare-lite

```
Phase 0: PREFLIGHT（1 WebSearch: 権限確認 + seed 取得）
  │
Phase 1: PLAN + MODE（compare-lite 判定 → ユーザー承認）
  │
Phase 2: SEARCH（2-3 Search agents, 2 rounds, 並列）
  │
Phase 3: SYNTHESIZE（比較マトリクス → 結論 → 次アクション）
```

### deep-full

```
Phase 0: PREFLIGHT（1 WebSearch: 権限確認）
  │
Phase 1: PLAN + MODE（deep-full 判定 → ユーザー承認）
  │
Phase 1.5: ENRICH（Seed Search + 条件付き Context7/URL/Market）
  │
Phase 2: SEARCH（3-5 Search agents, max 3 rounds, 並列）
  │
Phase 2.5: GAP ANALYSIS（条件付き: 重大ギャップ時のみ max 1体追加）
  │
Phase 3: SYNTHESIZE（構造化レポート → 引用検証 → 次アクション）
```

---

## ワークフロー詳細

### Phase 0: PREFLIGHT

WebSearch を1回実行し、パーミッション確認 + 初期コンテキスト取得。

```
WebSearch: "{ユーザーのトピック} overview" で検索
```

| 結果 | アクション |
|------|-----------|
| 成功 | → Phase 1 へ。compare-lite では検索結果を `seed_context` として保存 |
| 拒否 | → フォールバックモード（後述） |

### Phase 1: PLAN + MODE

#### Step 1.1: モード自動判定

上記「モード自動判定」表に従い判定。判断困難時は AskUserQuestion で確認。

#### Step 1.2: トピック分解とエージェント選択

**compare-lite**: 比較対象ごとに1エージェント（最大3体）。調査質問は各2〜3個。
**deep-full**: サブトピックごとに1エージェント（3〜5体）。調査質問は各3個。

#### Step 1.3: 計画提示と承認

```
質問: 以下の調査計画で進めてよいですか？

  モード: {compare-lite / deep-full}
  モデル: 検索={Search モデル}, 統合={Synthesis モデル}
  （例: 検索=GLM-5, 統合=GPT-5.4）

  1. [{対象/サブトピック}] → {Agent種別}
     - Q1: ...  Q2: ...

  2. [{対象/サブトピック}] → {Agent種別}
     ...

  推定時間: {5-8分 / 10-20分}
  出力先: /tmp/deep-research/{slug}/

選択肢:
  - "この計画で進める"（推奨）
  - "サブトピックを調整したい"
  - "deep-full に変更"（compare-lite 時のみ）
  - "compare-lite に変更"（deep-full 時のみ）
```

### Phase 1.5: ENRICH（deep-full のみ）

**compare-lite はこのフェーズを完全にスキップする。** PREFLIGHT の結果を seed_context として使用。

**実行制約**: Phase 1.5 全体で WebSearch **最大4回**、mcp_fetch **最大2回**。

#### Step 1.5.1: Seed Search ENRICH（常時実行）

**WebSearch: 2回**
1. `"{トピック} overview {現在の年}"`（`{現在の年}` は実行時の西暦年）
2. `"{トピック} {最重要サブトピック} latest"`
3. 上位3-5件のタイトル+スニペットを `seed_context` に格納（約1,000文字）
4. **注入先**: 全エージェント共通

#### Step 1.5.2: Context7 ENRICH（条件付き: Technical + OSS/FW 時のみ）

1. `resolve-library-id` → `query-docs`
2. 取得結果を Technical Agent に注入（約1,500文字）

**スキップ条件**: Technical 未選択 / 対象が OSS/FW でない / 解決失敗 / Context7 未設定

#### Step 1.5.3: URL ENRICH（条件付き: ユーザーが参考URL提供時のみ）

1. `mcp__fetch__fetch` で最大2件取得（max_length: 5000）
2. 関連エージェントに注入（約700文字/URL）

**フォールバック**: mcp_fetch 利用不可 → `site:{ドメイン}` で WebSearch し代替

#### Step 1.5.4: Market ENRICH（条件付き: Market Agent 選択時のみ）

1. WebSearch 1回で市場レポートURL特定
2. `mcp__fetch__fetch` で1件取得
3. Market Agent に注入（約1,000文字）

#### Step 1.5.5: 注入ルール

| 注入セクション | 目安 | 注入先 |
|---|---|---|
| `## 基礎コンテキスト` | 約1,000文字 | 全エージェント |
| `## 公式ドキュメント` | 約1,500文字 | Technical のみ |
| `## 参考資料` | 約700文字 x URL数 | 関連エージェント |
| `## 市場データ` | 約1,000文字 | Market のみ |

**合計上限**: 約5,000文字。超過時は情報密度の低いセクションから圧縮。
**空値セクション**: 値がない場合はセクションヘッダーごと省略。

### Phase 2: SEARCH（並列調査）

#### Step 2.1: 出力ディレクトリ作成

```bash
mkdir -p /tmp/deep-research/{topic_slug}
```

#### Step 2.2: サブエージェント並列起動

**1つの応答で全エージェントを同時に起動する。**

| パラメータ | 値 |
|-----------|-----|
| `subagent_type` | `"general-purpose"` |
| `mode` | `"bypassPermissions"` |
| `model` | Search モデルの Claude Code マッピング値（デフォルト: `"haiku"`, premium: `"sonnet"`, Opus指定: `"sonnet"`) |
| `run_in_background` | `true` |
| `prompt` | エージェント種別 × モードに応じたテンプレートから構築 |
| `description` | `"Research: {サブトピック名}"` (5語以内) |

**重複排除**: 各エージェントのプロンプト末尾に他エージェントの調査範囲を追加:

```
## 他エージェントの調査範囲（重複回避）
以下は他のエージェントが担当している。重複する情報は触れず、あなたの領域に集中すること。
- {Agent種別1}: {サブトピック1}
- {Agent種別2}: {サブトピック2}
```

#### Step 2.3: 完了待機とリカバリ

全通知受信後:
1. 各出力ファイルの存在を Read で確認
2. ファイル不在 → 通知テキストからレポート抽出し Write で保存
3. 全ファイル確保後、次フェーズへ

### Phase 2.5: GAP ANALYSIS（deep-full のみ）

**compare-lite は直接 Phase 3 に進む。**

#### Step 2.5.1: ギャップ評価

各出力を Read で読み込み:

| 観点 | 判定 |
|------|------|
| 調査質問への回答充足度 | 充足 / 欠落 |
| エージェント間の矛盾 | なし / 重大 |
| 重点領域の情報量 | 十分 / 不足 |

**追加調査の判定**:
- 「欠落」または「重大」が1つ以上 → 追加エージェント（最大1体、Search モデル）起動
- 全て「充足」→ Phase 3 へ直行

### Phase 3: SYNTHESIZE（統合）

#### Step 3.1: レポート読み込み

各サブエージェントの出力を Read で読み込む。

#### Step 3.2: 統合

**compare-lite**: 比較マトリクス形式で統合。一致・差異を明確化。

**deep-full (Standard)**: 矛盾検出 → 統合:
- 一致する知見 → 複数ソース裏付けとして強調
- 矛盾する知見 → 最新エビデンス優先、出典を明記
- 数値不整合 → 一次ソース優先、なければ範囲表記で併記
- 不確実性マーカー → そのまま保持（「未確認」「推計」等）
- 単一ソース → 「単一ソースによる情報」と明記

**deep-full (Creative)**: Standard に加えて:
- クロスドメイン・インサイト（異エージェント知見の組合せ）
- 機会マトリクス（実現可能性 × インパクト）
- アクション提案（短期/中期/長期）

#### Step 3.3: 引用検証（deep-full のみ）

- 3〜5件をランダム抽出し WebSearch で実在確認
- 架空URL発見 → 除去、同エージェントの他URLも追加検証
- **compare-lite はスキップ**（速度優先）

#### Step 3.4: 最終レポート生成

出力フォーマットセクション参照。Write ツールで `/tmp/deep-research/{slug}/report.md` に保存。

#### Step 3.5: 次アクション提示

```
質問: レポートが完成しました。次のアクションを選んでください。

選択肢:
  - "PDFでダウンロードに出力"（推奨）
  - "deep-full で再調査"（compare-lite 時のみ）
  - "追加調査が必要"
  - "このまま終了"
```

PDF出力時: `pdf-creator-jp` スキル使用。`--style business`、出力先 `~/Downloads/`。

---

## サブエージェント プロンプトテンプレート

### 共通ヘッダー（compare-lite）

全 compare-lite エージェントの冒頭に挿入する。`{変数}` は実際の値で展開し、空値セクションは省略する。

```
## 調査方法: 2ラウンド集中検索

WebSearch を **最大6回**（2ラウンド）実行し、必要な情報を収集する。

**Round 1（広域探索）**: WebSearch 3回。基本情報・比較データ・評判を収集。
1. "{対象} overview {現在の年}" — 基本情報
2. "{対象} {比較観点} benchmark OR comparison" — 比較データ
3. "{対象} review OR 評判 OR experience" — ユーザー評価

**Round 2（深掘り・検証）**: WebSearch 2-3回。Round 1 の知見を深掘りし、反証・制約を探す。
4. "{対象} limitations OR problems OR 課題 {現在の年}" — 制約・批判
5. Round 1 で発見した重要テーマを個別に深掘り
6. (任意) 反証・代替視点の検索

**Round 3 以降は実行しない。** 6回の WebSearch で得た情報でレポートを作成する。

## 基礎コンテキスト（事前取得済み）
{seed_context_or_empty}

## 出力ルール
- **Write ツール**で {出力ファイルパス} に保存
- 言語: 日本語
- 各知見に出典URLを付記
- レポート目安: **60〜100行**（簡潔・データ密度重視）
- Write 失敗時はレポート全文を返答に含める
```

### 共通ヘッダー（deep-full）

全 deep-full エージェントの冒頭に挿入する。`{変数}` は実際の値で展開し、空値セクションは省略する。

```
## 調査方法: 適応型ラウンド（最大3回）

**Round 1（広域探索）**: WebSearch 3-4回。全体像を把握、主要概念・プレイヤーを特定。
**Round 2（深掘り）**: WebSearch 3-4回。Round 1 で発見した重要テーマを深掘り。

--- Round 2 完了後に停止判定を実行 ---

### 停止判定

| 質問 | 充足度 | 判定 |
|------|--------|------|
| Q1 | 十分 / 不足 | |
| Q2 | 十分 / 不足 | |
| Q3 | 十分 / 不足 | |

**停止**: 全質問「十分」→ レポート作成へ進む
**継続**: 1つ以上「不足」→ Round 3（最終）で補完（WebSearch 2-3回）
**絶対停止**: Round 3 終了で必ず停止。**Round 4 は実行禁止。**

**WebSearch 合計目安**: 全ラウンドで **8〜10回**

## 基礎コンテキスト（事前取得済み）
{seed_context_or_empty}

## 情報取得ツール

### WebSearch（主要ツール）
- 日本語・英語の両方でクエリ実行
- 同一情報を異なるクエリでクロスバリデーション
- 詳細が必要なページは `site:{ドメイン} {キーワード}` で検索

### 注意
- mcp__fetch__fetch はバックグラウンドでは権限制約により利用不可
- 重要URLの情報は Phase 1.5 で事前取得し、上記セクションに注入済み

## 出力ルール
- **Write ツール**で {出力ファイルパス} に保存（Bash ではなく Write を使うこと）
- 言語: 日本語（英語ソースも日本語で要約）
- 各知見に出典URLを付記
- 推測や未確認情報は「未確認」と明記
- 情報の日付を記載し、古い情報（2年以上前）は明示
- レポート目安: **100〜150行**
- Write 失敗時はレポート全文を返答に含める

## 他エージェントの調査範囲（重複回避）
以下は他エージェントが担当。重複情報は触れず、あなたの領域に集中すること。
{other_agents_scope}
```

---

### 1. Technical Analysis Agent

**compare-lite プロンプト:**

```
あなたは技術分析エージェントです。{対象}の技術的特徴を調査します。

{compare-lite 共通ヘッダー}

## 調査対象: {対象名}

## 収集する情報
1. アーキテクチャと設計思想
2. 性能特性（ベンチマーク、スケーラビリティ）
3. 技術的制約と課題

## 出力フォーマット
# {対象名} - 技術概要
## 基本情報
## アーキテクチャ
## 性能
## 制約・課題
## 参考文献
```

**deep-full プロンプト:**

```
あなたは技術分析エージェントです。技術的な設計・実装・性能を調査し、構造化レポートを生成します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## 公式ドキュメント（事前取得済み）
{context7_docs_or_empty}

## Round別検索戦略
### Round 1: "{topic} architecture overview" / "{topic} technical comparison"
### Round 2: "{specific_tech} benchmark performance" / "{specific_tech} design tradeoffs"
### Round 3: "{topic} limitations problems" / "{claim} evidence data"

## ソース優先順位
1. 公式ドキュメント → 2. arXiv・論文 → 3. 技術ブログ → 4. メディア → 5. GitHub Issues

## 出力フォーマット
# {サブトピック名} - 技術分析レポート
## 概要（3-5文）
## アーキテクチャと設計
## 実装パターンとベストプラクティス
## 性能と比較
## 技術的課題と限界
## 今後の技術動向
## 参考文献
```

---

### 2. Market & Business Agent

**compare-lite プロンプト:**

```
あなたは市場分析エージェントです。{対象}の市場・ビジネス面を調査します。

{compare-lite 共通ヘッダー}

## 調査対象: {対象名}

## 収集する情報
1. 市場シェア・競合ポジション
2. 価格・ビジネスモデル
3. 資金調達・成長性

## 出力フォーマット
# {対象名} - 市場概要
## 基本情報
## 市場ポジション
## 価格戦略
## 成長性
## 参考文献
```

**deep-full プロンプト:**

```
あなたは市場分析エージェントです。市場規模・競合状況・ビジネスモデルを調査します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## 市場データ（事前取得済み）
{market_data_or_empty}

## Round別検索戦略
### Round 1: "{industry} market size forecast" / "{industry} top companies"
### Round 2: "{company} revenue funding" / "{industry} pricing business model"
### Round 3: "{industry} challenges risks" / "{market_claim} verification"

## ソース優先順位
1. 調査会社（Gartner, IDC）→ 2. IR資料 → 3. VC情報 → 4. 業界メディア

## 出力フォーマット
# {サブトピック名} - 市場分析レポート
## 概要
## 市場規模と成長率
## 主要プレイヤー比較
## ビジネスモデルと価格戦略
## SWOT分析
## 参考文献
```

---

### 3. User & Adoption Agent

**compare-lite プロンプト:**

```
あなたはユーザー体験分析エージェントです。{対象}のユーザー視点での評価を調査します。

{compare-lite 共通ヘッダー}

## 調査対象: {対象名}

## 収集する情報
1. 採用率・利用動向
2. ユーザー満足度・評判
3. 主な課題・不満点

## 出力フォーマット
# {対象名} - ユーザー評価
## 基本情報
## 採用状況
## 満足度と評判
## 課題・不満
## 参考文献
```

**deep-full プロンプト:**

```
あなたはユーザー体験・採用分析エージェントです。利用状況・満足度・導入事例を調査します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## Round別検索戦略
### Round 1: "{topic} adoption rate statistics" / "{topic} developer survey"
### Round 2: "{survey} methodology" / "{topic} case study enterprise"
### Round 3: "{topic} criticism negative" / "{claim} counter evidence"

## ソース優先順位
1. 大規模調査（SO Survey等）→ 2. 学術研究 → 3. アナリスト → 4. 導入事例 → 5. コミュニティ

## 出力フォーマット
# {サブトピック名} - ユーザー体験レポート
## 概要
## 採用率と利用動向
## 生産性への影響
## ユーザー満足度と課題
## 導入事例
## 参考文献
```

---

### 4. Academic Research Agent（deep-full のみ）

```
あなたは学術文献調査エージェントです。学術論文・プレプリントを調査し、研究動向と未解決課題を分析します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## Round別検索戦略
### Round 1: "site:arxiv.org {topic} survey" / "{topic} state of the art"
### Round 2: "{author} {topic}" / "{method} evaluation results"
### Round 3: "{topic} limitations open problems" / "{approach} criticism"

## ソース優先順位
1. 査読済み論文（ICLR, NeurIPS等）→ 2. ジャーナル → 3. arXiv（「未査読」明記）→ 4. サーベイ

## 論文記録ルール
- 著者名・年・出典・URLを正確に記載
- ペイウォール → アブストラクトで要約（「全文未確認」明記）
- arXiv → 「未査読」明記

## 出力フォーマット
# {サブトピック名} - 学術文献レポート
## 概要（研究分野の概況3-5文）
## 主要論文
### 1. {論文タイトル}
- 著者・年・出典・URL・査読状況
- 概要・手法・主要結果
## 研究動向
## 未解決の課題
## 参考文献
```

---

### 5. Policy & Regulation Agent（deep-full のみ）

```
あなたは政策・規制調査エージェントです。法規制・標準化・倫理ガイドラインを調査します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## Round別検索戦略
### Round 1: "{topic} regulation law" / "{topic} 規制 ガイドライン"
### Round 2: "{regulation} requirements" / "{topic} compliance checklist"
### Round 3: "{topic} enforcement penalty" / "{regulation} criticism"

## ソース優先順位
1. 政府機関 → 2. 標準化団体（ISO, NIST）→ 3. 法律事務所 → 4. 業界団体 → 5. メディア

## 出力フォーマット
# {サブトピック名} - 政策・規制レポート
## 概要
## 現行規制の概要
## 標準化の状況
## コンプライアンス要件
## 今後の規制動向
## 参考文献
```

---

### 6. Creative & Analogy Agent（deep-full のみ）

```
あなたは創造的アナロジー発見エージェントです。対象トピックと異なる業界からの着想を探し、イノベーション機会を発見します。

{deep-full 共通ヘッダー}

## 調査トピック: {サブトピック名}
## 調査質問
1. {質問1}  2. {質問2}  3. {質問3}

## あなたの役割は「発散」
他のエージェントは事実を集める。あなたは:
1. **アナロジー発見**: 他業界の解決策の転用可能性
2. **トレンド交差**: メガトレンドが交差する地点
3. **逆転の発想**: 業界常識を疑う
4. **隣接可能性**: 未開拓の機会

## Round別検索戦略
### Round 1: "{課題} solved in {異業種}" / "what {異業種} can teach {対象}"
### Round 2: "{trend_A} AND {trend_B} opportunity" / "{分野} disruption case study"
### Round 3: "{常識} contrarian view" / "reverse innovation {分野}"

## ソース優先順位
1. HBR, MIT Sloan → 2. 異業種事例 → 3. デザイン思考文献 → 4. スタートアップ事例

## 出力フォーマット
# {サブトピック名} - 創造的分析レポート
## 概要（主要アナロジーと機会3-5文）
## 異業種アナロジー
### 1. {業界名} からの着想
## トレンド交差マップ
## 逆説的アプローチ
## アイデアスケッチ（3案）
## 参考文献
```

---

## 出力フォーマット

### compare-lite 出力

```markdown
# {A} vs {B} 比較レポート

## エグゼクティブサマリー
[結論を1-2文。推奨がある場合は明示]

## 比較マトリクス

| 観点 | {A} | {B} | 判定 |
|------|-----|-----|------|
| 概要 | ... | ... | — |
| 性能 | ... | ... | A優位 / B優位 / 同等 |
| コスト | ... | ... | |
| エコシステム | ... | ... | |
| 学習コスト | ... | ... | |
| 将来性 | ... | ... | |
| 総合 | — | — | **{推奨}** |

## 主要な違い
### 1. {最大の差異}
### 2. {次に重要な差異}

## 用途別推奨
- {用途X} → **{A}** が適切。理由: ...
- {用途Y} → **{B}** が適切。理由: ...

## 調査の制限事項

## 参考文献
```

3者以上の比較時は列を追加。観点はトピックに応じて適宜変更する。

### deep-full 出力（Standard）

```markdown
# {トピック名} - Deep Research Report

## エグゼクティブサマリー
[3-5文: (1) 結論、(2) 主要定量データ1-2点、(3) 最大のリスクまたは機会]

## 1. {サブトピック1}
### 主要な知見
### データと統計

## 2. {サブトピック2}
...

## 結論と提言

## 調査の制限事項

## 参考文献
1. [✓] [タイトル](URL)
2. [?] [タイトル](URL) - 未検証
```

### deep-full 出力（Creative）

Standard に加えて:

```markdown
## 創造的示唆
### 異業種アナロジーからの着想
### トレンド交差の機会

## 機会マトリクス
| 機会 | 実現可能性 | インパクト | 推奨アクション |
|------|-----------|-----------|--------------|

## 推奨アクションプラン
### 短期（3ヶ月）
### 中期（1年）
### 長期（3年）
```

---

## エラーハンドリング

| 状況 | 対応 |
|------|------|
| エージェント1件失敗 | 成功分のみで統合。失敗を「調査未完了」と明記 |
| 全エージェント失敗 | ユーザーに報告、トピック修正を提案 |
| 出力ファイルが空 | 通知テキストから抽出、不可ならスキップ |
| WebSearch 予算超過 | 即停止、収集済み情報で統合 |
| WebSearch 拒否 | フォールバックモード |
| mcp_fetch 利用不可 | WebSearch スニペットで代替 |
| Context7 失敗 | スキップ、WebSearch のみで続行 |
| ENRICH 呼出上限到達 | 未完了ステップをスキップ、完了分のみで注入 |

### フォールバックモード（パーミッション問題時）

Phase 0 で WebSearch 拒否時:
1. オーケストレーター自身が順次調査（ユーザーが各回承認）
2. 結果を統合し Phase 3 に進む

```
「WebSearch のパーミッションが自動許可されていないため、フォールバックモードで実行します。
並列エージェント方式を使用するには、設定で WebSearch を allowedTools に追加してください。」
```

---

## 品質ゲート

### 共通
- [ ] 計画した全トピックが統合されている（または未完了が明記）
- [ ] 停止条件の予算内で完了している
- [ ] 最終レポートが日本語で記述されている

### compare-lite 追加
- [ ] 比較マトリクスが全観点を網羅している
- [ ] 用途別推奨が含まれている
- [ ] Round 2 で制約・反証が収集されている
- [ ] 60〜120行以内に収まっている

### deep-full 追加
- [ ] 各トピックに最低3つの知見がある
- [ ] 引用検証（3-5件サンプリング）が完了している
- [ ] 矛盾がエビデンス優先で解決されている
- [ ] ENRICH 情報がエージェントの深掘りに活用されている

### Creative 追加
- [ ] アナロジーが2+異業種から抽出されている
- [ ] 機会マトリクスが整理されている
- [ ] アイデアが事実データに裏付けられている

---

## Anti-Patterns

| Anti-Pattern | 正しいアプローチ |
|-------------|----------------|
| 比較タスクに deep-full を使用 | compare-lite で速く完了 |
| 全エージェントを高コストモデルで起動 | **Search モデル（GLM-5相当）で検索、Synthesis のみ主力モデル** |
| Round 4-5 まで実行 | **Round 3 で絶対停止** |
| compare-lite で Round 3 実行 | **2ラウンドで停止** |
| compare-lite で ENRICH 実行 | PREFLIGHT 結果を seed に流用 |
| compare-lite で GAP ANALYSIS | 直接 Phase 3 へ |
| 単一トピックに5エージェント | 比較なら対象数分、調査なら3-5分割 |
| 全エージェントに同じクエリ | 重複排除セクションで範囲を通知 |
| ENRICH 結果を最終レポートに転記 | エージェントの深掘り結果を使用 |
| プレミアムモードを常用 | GLM-5 + GPT-5.4 で十分 |
| Claude 系をデフォルト使用 | ポリシーに従い GLM-5 / GPT-5.4 を優先 |
| 全リサーチに Creative Agent 投入 | 企画・アイデア系のみ |
| 引用検証で全URL確認 | 3-5件サンプリング |
