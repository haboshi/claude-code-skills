---
name: deep-research
description: This skill should be used when the user asks to "深く調べて", "詳しくリサーチして", "deep research", "包括的に調査して", "徹底調査", "多角的に分析して", "市場調査して", "技術調査", "比較分析", "アイデア出し", "企画リサーチ", "異業種調査", or needs comprehensive multi-source research producing a consolidated report. Use for topics requiring 3+ independent sub-topics investigated in parallel. NOT for single-topic quick lookups (use brave-research instead).
allowed-tools: Agent, Bash, Read, Write, WebSearch, AskUserQuestion, mcp__plugin_context7_context7__resolve-library-id, mcp__plugin_context7_context7__query-docs
---

# Deep Research v4 - マルチエージェント調査スキル

トピックをサブテーマに分解し、**情報ドメイン別の専門エージェント**で並列調査、統合レポートを生成する。

## brave-research との棲み分け

```
調査リクエスト
├─ 単一トピック・速報性重視 → brave-research
├─ 特定の事実確認 → brave-research
├─ 多角的分析（3+サブトピック） → deep-research
├─ 学術含む徹底調査 → deep-research
└─ 企画・アイデア出し（異業種着想） → deep-research（Creative モード）
```

---

## Critical Rules

1. **オーケストレーターは WebSearch を実行しない** — 調査はすべてサブエージェントに委譲（Phase 0 の PREFLIGHT と Phase 1.5 の ENRICH は例外）
2. **サブエージェントは必ず並列起動する** — 1つの応答で複数の Agent ツールを呼ぶ
3. **計画はユーザー承認を得てから実行する** — AskUserQuestion で確認
4. **出力ディレクトリは Bash で事前に作成する** — `mkdir -p /tmp/deep-research/{slug}/`
5. **最終レポートは日本語で作成する** — ソースが英語でも日本語で統合
6. **引用は検証する** — 統合後に引用URLの実在を確認

---

## エージェント体系（6種類）

トピックに応じて以下の6種から **3〜5種を選択** する。全部使う必要はない。

| エージェント | 調査ドメイン | 典型的ソース | 使用判断 |
|---|---|---|---|
| **Technical** | 技術設計・実装・性能 | 公式docs、GitHub、arXiv、カンファレンス | 技術的な仕組み・性能を理解したい |
| **Market** | 市場規模・競合・資金調達 | Gartner、TechCrunch、Crunchbase、IR資料 | ビジネス・市場の全体像を把握したい |
| **User** | ユーザー体験・採用率・満足度 | SO Survey、RedMonk、G2、Reddit | 実際の利用状況・評判を知りたい |
| **Academic** | 学術研究・理論・未解決課題 | arXiv、Semantic Scholar、IEEE、ACM | 研究動向・理論的基盤を調べたい |
| **Policy** | 規制・政策・標準化・倫理 | 官公庁、ISO/IEEE、法律事務所レポート | 法規制・コンプライアンスに関わる |
| **Creative** | アナロジー・異業種着想・トレンド交差 | HBR、IDEO、異業種事例、スタートアップ | 新規アイデア・差別化戦略が必要 |

### 選択ガイド

```
トピック分析
├─ 技術的な仕組みを問う → Technical
├─ 市場・ビジネスを問う → Market
├─ ユーザー・現場の声を問う → User
├─ 学術的・理論的な背景を問う → Academic
├─ 法規制・政策を問う → Policy
├─ 新規アイデア・差別化を問う → Creative
├─ 異業種からの着想が欲しい → Creative
└─ 複数該当 → 該当する全エージェントを選択
```

---

## ワークフロー概要

```
Phase 0: PREFLIGHT（パーミッション確認）
  │
Phase 1: PLAN（計画 → ユーザー承認）
  ├─ Step 1.0: 調査モード判定（Analytical / Creative / Hybrid）
  ├─ Step 1.1: トピック分解とエージェント選択
  └─ Step 1.2: 計画提示と承認
  │
Phase 1.5: ENRICH（条件付き: Technical Agent + OSS/FW時のみ）
  ├─ Step 1.5.1: Context7 ドキュメント取得
  └─ Step 1.5.2: Technical Agent プロンプトへの注入
  │
Phase 2: RESEARCH（並列調査）
  ├─ Step 2.1: 出力ディレクトリ作成
  ├─ Step 2.2: サブエージェント並列起動
  └─ Step 2.3: 完了待機
  │
Phase 2.5: GAP ANALYSIS（条件付き: ギャップ検出時のみ）
  ├─ Step 2.5.1: 出力の予備読み込みとギャップ評価
  └─ Step 2.5.2: 追加エージェント起動（最大2体）
  │
Phase 3: SYNTHESIZE（統合 → 引用検証）
  ├─ Step 3.1: レポート読み込み
  ├─ Step 3.2: 矛盾検出と統合（Standard / Creative Synthesis）
  ├─ Step 3.3: 引用検証
  ├─ Step 3.4: 最終レポート生成
  └─ Step 3.5: 次アクション提示
```

---

## ワークフロー詳細

### Phase 0: PREFLIGHT（パーミッション確認）

サブエージェントはバックグラウンドで動作し、ユーザーに確認プロンプトを出せない。

**起動前にフォアグラウンドで WebSearch を1回実行する。**

```
WebSearch: "{ユーザーのトピック} overview" で検索
```

| 結果 | 次のアクション |
|------|---------------|
| 成功 | → Phase 1 に進む（並列エージェント方式） |
| 拒否 | → フォールバックモードに切り替え（後述） |

### Phase 1: PLAN（計画 → ユーザー承認）

#### Step 1.0: 調査モード判定

ユーザーのリクエストから調査モードを判定する:

| キーワード・意図 | 調査モード | Creative Agent |
|----------------|-----------|---------------|
| "市場調査", "技術比較", "規制調査", "調べて" | **Analytical**（分析型） | 不使用 |
| "新規事業", "差別化", "アイデア", "企画", "ブレスト", "異業種" | **Creative**（創造型） | 使用 |
| "総合的に", "全方位", "包括的に" | **Hybrid**（混合型） | 使用 |
| 判断困難 | AskUserQuestion で確認 | ユーザー選択 |

#### Step 1.1: トピック分解とエージェント選択

ユーザーのリクエストを分析し、**3〜5個の独立したサブトピック**に分解する。

各サブトピックに以下を定義:
- **調査質問** — 具体的な質問を3個
- **担当エージェント** — 6種（Technical / Market / User / Academic / Policy / Creative）から選択
- **出力ファイル名** — `{slug}_{domain}.md`

#### Step 1.2: 計画提示と承認

`AskUserQuestion` でユーザーに計画を提示する:

```
質問: 以下の調査計画で進めてよいですか？

  調査モード: {Analytical / Creative / Hybrid}

  1. [サブトピック名] → Technical Agent
     - Q1: ...  Q2: ...  Q3: ...

  2. [サブトピック名] → Market Agent
     ...

  3. [サブトピック名] → User Agent
     ...

  推定時間: 3〜5分
  出力先: /tmp/deep-research/{slug}/

選択肢:
  - "この計画で進める"
  - "サブトピックを調整したい"
```

### Phase 1.5: ENRICH（技術トピック時のドキュメント事前取得）

**Technical Agent が選択されている場合のみ実行する。**

#### Step 1.5.1: Context7 によるドキュメント取得

調査対象がOSSライブラリ・フレームワーク・APIの場合:

1. `mcp__plugin_context7_context7__resolve-library-id` でライブラリIDを解決
2. `mcp__plugin_context7_context7__query-docs` で関連ドキュメントを取得
3. 取得結果を `/tmp/deep-research/{slug}/context7_docs.md` に保存

#### Step 1.5.2: Technical Agent プロンプトへの注入

Context7 で取得したドキュメントの要点（最大2000トークン）を Technical Agent のプロンプトに `## 公式ドキュメント（事前取得済み）` セクションとして注入する。

#### スキップ条件

以下の場合は Phase 1.5 をスキップする:
- Technical Agent が選択されていない
- 調査対象がOSSライブラリ・フレームワークではない（概念的なトピック等）
- Context7 でライブラリIDが解決できなかった
- Context7 MCP が環境に設定されていない

### Phase 2: RESEARCH（並列調査）

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
| `model` | `"sonnet"` |
| `run_in_background` | `true` |
| `prompt` | エージェント種別に応じたテンプレートから構築 |
| `description` | `"Research: {サブトピック名}"` (5語以内) |

**重複排除**: 各エージェントのプロンプト末尾に以下を追加する:

```
## 他エージェントの調査範囲（重複回避）
以下のトピックは他のエージェントが担当している。
重複する情報は簡潔に触れるに留め、あなたの専門領域に集中すること。
- {エージェント種別1}: {サブトピック1}
- {エージェント種別2}: {サブトピック2}
```

#### Step 2.3: 完了待機

バックグラウンドエージェントは完了時に自動通知される。全通知を受信後、各出力ファイルの存在を Read で確認し、Phase 2.5 に進む。

### Phase 2.5: GAP ANALYSIS（条件付き）

全バックグラウンドエージェントの完了後、最終統合の前にギャップ分析を行う。

#### Step 2.5.1: 出力ファイルの予備読み込み

各エージェントの出力を Read で読み込み、以下を評価する:

| 観点 | 評価 |
|------|------|
| 調査質問への回答充足度 | 各質問に対して十分な回答があるか |
| エージェント間の矛盾 | 重要な矛盾があり追加調査で解決可能か |
| 情報ギャップ | 計画したサブトピックで全く情報が取れなかった領域があるか |

#### Step 2.5.2: 追加エージェント起動（条件付き）

以下の**いずれか**に該当する場合のみ、追加エージェント（最大2体）を起動する:

1. **重大なギャップ**: サブトピック全体の情報が欠落（エージェント失敗、出力が空）
2. **重要な矛盾**: 2つ以上のエージェントで数値・事実が矛盾し、追加ソースで解決見込みあり
3. **ユーザー指定の重点領域で情報不足**: 計画時にユーザーが重要と指定した領域の情報が不十分

追加エージェントのプロンプトには、既存エージェントの調査結果の要約を含め、「以下の未解決点に集中して調査すること」と明示する。

#### スキップ条件

以下の場合は Phase 2.5 をスキップし、直接 Phase 3 に進む:
- 全エージェントが正常完了し、明白なギャップがない
- 全質問に対して最低限の回答が得られている

### Phase 3: SYNTHESIZE（統合 → 引用検証）

#### Step 3.1: レポート読み込み
各サブエージェントの出力ファイルを Read で読み込む。

#### Step 3.2: 矛盾検出と統合

**モード判定**: Creative Agent が使用されている場合、Creative Synthesis モードで統合する。

**Standard モード**（Creative Agent 不使用時）:
- **一致する知見** — 複数ソースで裏付けられた情報として強調
- **矛盾する知見** — **最新のエビデンスを優先採用**し、出典（URL・日付）を明記する。古い情報は「{年}時点の情報」として併記
- **単一ソースの知見** — 「単一ソースによる情報」と明記

**Creative Synthesis モード**（Creative Agent 使用時）:
上記 Standard モードの処理に加えて、以下を追加する:

1. **クロスドメイン・インサイト**: 異なるエージェントの知見を組み合わせて新たな示唆を導出
   - 例: Technical の技術トレンド + Creative のアナロジー → 具体的な応用アイデア
   - 例: Market の未充足ニーズ + Creative の異業種事例 → 差別化戦略
2. **機会マトリクス**: 「実現可能性 x インパクト」の2軸で機会を整理
3. **アクション提案**: 短期（3ヶ月）・中期（1年）・長期（3年）のアクションアイテム

#### Step 3.3: 引用検証
- 各URLが実在するか（架空URLの除去）
- 検証できなかった引用は「未検証」と明記

#### Step 3.4: 最終レポート生成

**Standard モード時**:

```markdown
# {トピック名} - Deep Research Report

## エグゼクティブサマリー
[全体を3〜5文で要約]

## 1. {サブトピック1}
### 主要な知見
### データと統計

## 2. {サブトピック2}
...

## 結論と提言
[横断的分析。矛盾点の解説]

## 調査の制限事項
[未完了のサブトピック、アクセスできなかったソース]

## 参考文献
1. [✓] [タイトル](URL)
2. [?] [タイトル](URL) - 未検証
```

**Creative Synthesis モード時** — 上記に加えて以下のセクションを追加:

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

#### Step 3.5: 次アクション提示

最終レポート生成後、`AskUserQuestion` で次のアクションを提示する:

```
質問: 最終レポートが完成しました。次のアクションを選んでください。

選択肢:
  - "PDFでダウンロードディレクトリに出力"（推奨）
  - "レポート内容を確認・要約"
  - "追加調査が必要"
  - "このまま終了"
```

**PDF出力時**: `pdf-creator-jp` スキルを使用。`--toc` はユーザーが明示的に指定した場合のみ付与。デフォルトは `--style business`、出力先は `~/Downloads/`。

---

## サブエージェント プロンプトテンプレート

各エージェントは **ReAct 適応型ラウンド（2〜5回）** で調査する。WebSearch + MCP Fetch で情報を取得する設計。

### 共通ヘッダー

全テンプレートの冒頭に以下を挿入する（`{共通ヘッダー}` で参照）:

```
## 調査方法: ReAct 適応型ラウンド（2〜5回）

以下のラウンドで段階的に調査を深める。各ラウンドで WebSearch を3〜4回実行する。
**最低2ラウンド、最大5ラウンド**を実行する。ラウンド数はあなたが判断する。

**Round 1（広域探索）**: 全体像を把握。主要プレイヤー・概念・トレンドを特定。
**Round 2（深掘り）**: Round 1 で発見した重要テーマを個別に深掘り。具体データ・事例を収集。

--- Round 2 完了後に自己評価を実行 ---

### 自己評価基準

| 質問 | 情報充足度 | 判定 |
|------|-----------|------|
| Q1 | 十分 / 部分的 / 不足 | |
| Q2 | 十分 / 部分的 / 不足 | |
| Q3 | 十分 / 部分的 / 不足 | |

**終了判定**: 全質問が「十分」→ Round 3（検証）で終了
**継続判定**: 1つ以上が「不足」→ 追加ラウンドで補完（最大 Round 5 まで）

**Round 3（検証・補完）**: 反証・限界・ギャップを探す。主要な主張を別ソースで裏付け。
**Round 4-5（追加深掘り）**: 自己評価で「不足」と判定した質問に集中。必要な場合のみ実行。

各ラウンドの間に「Think」ステップを入れ、次のラウンドで何を調べるべきか計画すること。

## 情報取得ツール

### WebSearch（主要ツール）
- 同じ情報を異なるクエリで検索し、クロスバリデーションする
- 日本語クエリと英語クエリの両方を使用する

### MCP Fetch（補完ツール）
重要な URL を発見した場合、mcp__fetch__fetch ツールでページ全文を取得できる。
- **高価値なページのみ**に使用: 公式ドキュメント、技術仕様、導入事例、IR資料
- max_length: 5000（デフォルト）。長い文書は start_index で分割読み
- 全 URL に使わない。WebSearch スニペットで十分な情報は fetch 不要
- **1ラウンドあたり最大2回**まで（コンテキスト節約）
- mcp__fetch__fetch が利用できない場合は WebSearch スニペットのみで調査を続行

## 出力ルール
- ファイルパス: {出力ファイルパス}
- 言語: 日本語（英語ソースも日本語で要約）
- 各知見に出典URLを付記
- 推測や未確認情報は「未確認」と明記
- 情報の日付を記載し、古い情報（2年以上前）は明示
- **重要**: Write でファイル保存できない場合、レポート全文をそのまま返答に含めること
```

---

### 1. Technical Analysis Agent

```
あなたは技術分析エージェントです。技術的な設計・実装・性能を調査し、構造化レポートを生成します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## 公式ドキュメント（事前取得済み）
{context7_docs_or_empty}

上記のドキュメントが提供されている場合:
- WebSearch の結果よりも公式ドキュメントの情報を優先する
- ドキュメントに記載されている具体的なAPI仕様・設定パラメータ・コード例を積極的に引用する
- ドキュメントでカバーされていない情報のみ WebSearch で補完する

## Round 別の検索戦略
### Round 1（広域探索）
- "{topic} architecture overview"
- "{topic} how it works internally"
- "{topic} technical comparison"
- "{topic} アーキテクチャ 解説"

### Round 2（深掘り）— Round 1 の発見に基づき調整
- "{specific_tech} benchmark performance"
- "{specific_tech} design decisions tradeoffs"
- "{specific_tech} vs {alternative}"
- "{specific_tech} source code GitHub"

### 技術詳細の深掘り戦略
WebSearch だけでは取得困難な以下の情報を意識的に探す:
- **実装パターン**: "{topic} implementation example code" / "{topic} 実装例"
- **アンチパターン**: "{topic} anti-pattern common mistakes pitfalls"
- **設定・チューニング**: "{topic} configuration tuning best practices"
- **内部アーキテクチャ**: "{topic} internals source code walkthrough"
- **マイグレーション**: "{topic} migration guide upgrade path"
重要な公式ドキュメントや技術ブログの URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（検証・補完）
- "{topic} limitations problems"
- "{topic} scalability challenges"
- "{specific_claim} evidence data"

## ソース優先順位
1. 公式ドキュメント・API リファレンス・ホワイトペーパー
2. arXiv・カンファレンス論文（ICLR, NeurIPS, ICSE等）
3. 開発者本人のブログ・カンファレンス講演
4. 技術メディア（InfoQ, The New Stack, Ars Technica）
5. 補助: GitHub Issues, HackerNews（事実確認必須）

## 出力フォーマット
# {サブトピック名} - 技術分析レポート

## 概要
[3〜5文で要約]

## アーキテクチャと設計
## 実装パターンとベストプラクティス
## 性能と比較
## アンチパターンと注意点
## 技術的課題と限界
## 今後の技術動向
## データと統計
## 参考文献
```

---

### 2. Market & Business Agent

```
あなたは市場分析エージェントです。市場規模・競合状況・ビジネスモデルを調査し、構造化レポートを生成します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## Round 別の検索戦略
### Round 1（広域探索）
- "{industry} market size forecast"
- "{industry} 市場規模 成長率"
- "{industry} top companies market share"
- "{industry} industry overview"

### Round 2（深掘り）— Round 1 で特定した主要プレイヤーについて
- "{company} revenue ARR funding"
- "{company} vs {competitor} comparison"
- "{industry} recent acquisition merger"
- "{industry} pricing business model"
重要なIR資料・プレスリリースの URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（検証・補完）
- "{industry} challenges risks barriers"
- "{market_size_claim} source verification"
- "{industry} SWOT analysis"

## ソース優先順位
1. 調査会社レポート（Gartner, IDC, Forrester, Mordor Intelligence）
2. 企業の IR 資料・プレスリリース
3. VC・資金調達情報（TechCrunch, Crunchbase, PitchBook）
4. 業界メディア（VentureBeat, The Information, Bloomberg）
5. ユーザーレビュー（G2, Capterra）— バイアスに注意

## 出力フォーマット
# {サブトピック名} - 市場分析レポート

## 概要
## 市場規模と成長率
## 主要プレイヤー比較
## 資金調達・M&A動向
## ビジネスモデルと価格戦略
## SWOT分析
## データと統計
## 参考文献
```

---

### 3. User & Adoption Agent

```
あなたはユーザー体験・採用分析エージェントです。利用状況・ユーザー満足度・導入事例を調査し、構造化レポートを生成します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## Round 別の検索戦略
### Round 1（広域探索）
- "{topic} adoption rate statistics"
- "{topic} developer survey results"
- "{topic} 利用率 調査"
- "{topic} user experience review"

### Round 2（深掘り）— Round 1 で特定した調査・統計について
- "{specific_survey} methodology sample size"
- "{topic} case study enterprise"
- "{topic} productivity impact measurement"
- "{topic} user satisfaction pain points"
導入事例・レビュー記事の URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（検証・補完）
- "{topic} criticism negative experience"
- "{topic} adoption barriers challenges"
- "site:reddit.com {topic} experience"
- "{productivity_claim} counter evidence"

## ソース優先順位
1. 大規模開発者調査（Stack Overflow Survey, JetBrains State of Developer Ecosystem）
2. 学術的 RCT・生産性研究（METR, Microsoft Research）
3. 業界アナリスト（RedMonk, ThoughtWorks Tech Radar）
4. 企業導入事例・ROIレポート
5. コミュニティの声（Reddit, HackerNews）— 母集団バイアスに注意

## 出力フォーマット
# {サブトピック名} - ユーザー体験・採用レポート

## 概要
## 採用率と利用動向
## 生産性への影響
## ユーザー満足度と課題
## 導入事例
## データと統計
## 参考文献
```

---

### 4. Academic Research Agent

```
あなたは学術文献調査エージェントです。学術論文・プレプリントを調査し、研究動向と未解決課題を分析します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## Round 別の検索戦略
### Round 1（広域探索）
- "site:arxiv.org {topic} survey"
- "site:semanticscholar.org {topic} review"
- "{topic} survey OR review paper"
- "{topic} state of the art"

### Round 2（深掘り）— Round 1 で特定した主要研究について
- "{author_name} {topic} {year}"
- "{specific_method} evaluation results"
- "{paper_title} citations follow-up"
- "{topic} benchmark dataset"
論文のアブストラクトや概要ページの URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（検証・補完）
- "{topic} limitations open problems"
- "{topic} reproducibility concerns"
- "{dominant_approach} criticism alternative"

## ソース優先順位
1. 査読済みカンファレンス論文（ICLR, NeurIPS, ICML, ACL, ICSE, FSE）
2. 査読済みジャーナル（TPAMI, TOSEM, TSE）
3. arXiv プレプリント（「未査読」と明記）
4. Semantic Scholar で引用数の多い論文
5. サーベイ・チュートリアル資料

## 論文記録ルール
- 著者名・年・出典を正確に記載
- ペイウォール論文はアブストラクトで要約（「全文未確認」と明記）
- arXiv は「未査読」と明記
- 引用数が確認できる場合は記載

## 出力フォーマット
# {サブトピック名} - 学術文献レポート

## 概要
[研究分野の概況を3〜5文で要約]

## 主要論文
### 1. {論文タイトル} ({原題})
- 著者・年・出典・URL・査読状況
- 概要・手法・主要結果

## 研究動向
## 未解決の課題
## データと統計
## 参考文献
```

---

### 5. Policy & Regulation Agent

```
あなたは政策・規制調査エージェントです。法規制・標準化・倫理ガイドラインを調査し、コンプライアンス上の影響を分析します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## Round 別の検索戦略
### Round 1（広域探索）
- "{topic} regulation law"
- "{topic} 規制 法律 ガイドライン"
- "{topic} EU AI Act compliance"
- "{topic} industry standard ISO"

### Round 2（深掘り）— Round 1 で特定した規制・標準について
- "{specific_regulation} requirements summary"
- "{specific_regulation} compliance checklist"
- "{topic} legal risk liability"
- "{topic} government policy announcement"
規制文書・ガイドラインの URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（検証・補完）
- "{topic} enforcement action penalty"
- "{topic} ethical concerns debate"
- "{regulation} criticism opposition"
- "{topic} future regulatory outlook"

## ソース優先順位
1. 政府機関の公式発表（官報、省庁ウェブサイト）
2. 標準化団体（ISO, IEEE, NIST, W3C）
3. 法律事務所のクライアントアラート・解説
4. 業界団体のガイドライン・ポジションペーパー
5. メディア報道（Reuters, Bloomberg Law）

## 出力フォーマット
# {サブトピック名} - 政策・規制レポート

## 概要
## 現行規制の概要
## 標準化の状況
## コンプライアンス要件
## 倫理的考慮事項
## 今後の規制動向
## データと統計
## 参考文献
```

---

### 6. Creative & Analogy Agent

```
あなたは創造的アナロジー発見エージェントです。対象トピックと**異なる業界・分野**からの着想を探し、イノベーション機会を発見します。

{共通ヘッダー}

## 調査トピック
{サブトピック名}

## 調査質問
1. {質問1}
2. {質問2}
3. {質問3}

## あなたの役割は「発散」

他のエージェントは「対象トピックの事実」を集める。あなたの役割はそれとは根本的に異なる:

1. **アナロジー発見**: 対象トピックの課題を他の業界がどう解決しているか
2. **トレンド交差**: 複数のメガトレンドが交差する地点の特定
3. **逆転の発想**: 業界の常識・前提を疑い、逆のアプローチを探す
4. **隣接可能性**: 対象領域のすぐ隣にある未開拓の機会

## Round 別の検索戦略
### Round 1（異業種アナロジー探索）
- "{対象課題} solved in {異業種} industry"
- "{対象業界の課題} analogy different industry"
- "what {異業種} can teach {対象業界}"
- "{対象課題} unconventional approach"

### Round 2（トレンド交差・先行事例）
- "{trend_A} AND {trend_B} intersection opportunity"
- "{対象分野} disruption innovation case study"
- "{対象分野} 異業種参入 成功事例"
- "biomimicry OR cross-industry innovation {対象分野}"
イノベーション事例・ケーススタディの URL を発見した場合は mcp__fetch__fetch で全文を取得すること。

### Round 3（逆説・反主流の視点）
- "{業界の常識} contrarian view"
- "{dominant_approach} alternative radical"
- "{対象分野} failed assumptions lessons learned"
- "reverse innovation {対象分野}"

## ソース優先順位
1. イノベーション研究（Harvard Business Review, MIT Sloan, IDEO）
2. 異業種の成功事例・ケーススタディ
3. デザイン思考・サービスデザインの文献
4. スタートアップ・ディスラプターの事例（Y Combinator, a16z blog）
5. TED Talks・カンファレンス講演の要旨

## 出力フォーマット
# {サブトピック名} - 創造的分析レポート

## 概要
[発見した主要なアナロジーと機会を3〜5文で要約]

## 異業種アナロジー
### 1. {業界名} からの着想
- 課題の類似性
- 解決アプローチの転用可能性
- 適用時の注意点

## トレンド交差マップ
## 逆説的アプローチ
## 未開拓の機会
## アイデアスケッチ（3案）
## 参考文献
```

---

## エラーハンドリングとフォールバック

| 状況 | 対応 |
|------|------|
| サブエージェント1件失敗 | 成功レポートのみで統合。失敗トピックを「調査未完了」と明記 |
| 全エージェント失敗 | ユーザーに報告し、トピック修正を提案 |
| 出力ファイルが空 | 該当サブトピックをスキップし明記 |
| WebSearch 結果が不十分 | 適応型ラウンドの追加ラウンドでクエリを変形して再試行 |
| mcp__fetch__fetch 利用不可 | WebSearch スニペットのみで調査を続行（v3 互換動作） |
| ペイウォール論文 | アブストラクトのみで要約。「全文未確認」と明記 |
| WebSearch 拒否 | 下記フォールバックモードに切り替え |
| Context7 ライブラリID解決失敗 | Phase 1.5 をスキップし、WebSearch のみで調査続行 |
| Context7 ドキュメント取得失敗 | 同上。エラー原因をログに記録 |
| Context7 未設定環境 | Phase 1.5 をスキップ |

### フォールバックモード（パーミッション問題時）

Phase 0 で WebSearch が拒否された場合:

1. **オーケストレーター自身が調査を実行する**（Critical Rule 1 の例外）
2. 各サブトピックを**順次** WebSearch で調査（ユーザーが各回承認可能）
3. 結果をそのまま統合し Phase 3 に進む

```
「WebSearch のパーミッションが自動許可されていないため、フォールバックモードで実行します。
並列エージェント方式を使用するには、設定で WebSearch を allowedTools に追加してください。」
```

---

## 品質ゲート（最終レポート提出前）

### カバレッジ
- [ ] 計画した全サブトピックが統合されている（または未完了が明記）
- [ ] 各サブトピックに最低3つの知見がある
- [ ] 複数ソースからの裏付けがある知見が50%以上

### 引用品質
- [ ] 全引用にURLが付いている
- [ ] 架空URL・架空論文が含まれていない
- [ ] プレプリント（未査読）が明示されている

### 構造
- [ ] エグゼクティブサマリーが3〜5文で全体を網羅
- [ ] 矛盾する知見が最新エビデンス優先で解決され、出典が明記されている
- [ ] 制限事項セクションが含まれている

### Context7 活用（Technical トピック時）
- [ ] Context7 ドキュメントが取得され、Technical Agent に注入されている（該当時）
- [ ] 公式ドキュメントの情報が WebSearch 結果より優先されている

### 創造的分析（Creative モード時）
- [ ] アナロジーが最低2つの異業種から抽出されている
- [ ] 機会マトリクスが「実現可能性 x インパクト」で整理されている
- [ ] アイデアが事実データに裏付けられている（根拠なき空想ではない）

### 適応型ラウンド
- [ ] 各エージェントが自己評価を実行し、ラウンド数を適切に判断している
- [ ] Gap Analysis が実行された場合、追加エージェントの根拠が明記されている

---

## Anti-Patterns

| Anti-Pattern | なぜ悪いか | 正しいアプローチ |
|-------------|----------|----------------|
| 単一トピックに6エージェント投入 | 過剰 | 3+サブトピックに分解できる場合のみ使用 |
| プレースホルダーを残す | `{変数}` が未展開で失敗 | 全変数を実際の値で置換 |
| 計画段階をスキップ | ユーザーの意図とずれる | AskUserQuestion で承認を得る |
| 引用検証をスキップ | ハルシネーションURLが残る | Phase 3.3 を省略しない |
| 全レポートを丸ごとコピペ | 冗長で読みにくい | 要点を抽出し再構成する |
| 結果を無条件に信頼 | 矛盾・誤情報が混入 | 矛盾検出ステップを実行 |
| 全 URL に mcp__fetch__fetch を使う | コンテキスト爆発 | 高価値ページのみ、1ラウンド最大2回 |
| 全エージェントに同じクエリ | 情報重複・検索予算の浪費 | 重複排除セクションで調査範囲を通知 |
| 全リサーチに Creative Agent を投入 | トークン浪費 | 企画・アイデア系のリクエスト時のみ使用 |
| Gap Analysis で常に追加エージェント起動 | 実行時間が2倍に | 明確なギャップがある場合のみ起動 |
| 自己評価で常に Round 5 まで実行 | 過剰調査 | Round 2 完了時の評価基準に従う |
| シングルパス検索 | 表層情報のみで深度不足 | 適応型ラウンドで段階的に深掘り |
