---
name: deep-research
description: This skill should be used when the user asks to "深く調べて", "詳しくリサーチして", "deep research", "包括的に調査して", "徹底調査", "多角的に分析して", "市場調査して", "技術調査", "比較分析", or needs comprehensive multi-source research producing a consolidated report. Use for topics requiring 3+ independent sub-topics investigated in parallel. NOT for single-topic quick lookups (use brave-research instead).
allowed-tools: Agent, Bash, Read, Write, WebSearch, AskUserQuestion
---

# Deep Research v3 - マルチエージェント調査スキル

トピックをサブテーマに分解し、**情報ドメイン別の専門エージェント**で並列調査、統合レポートを生成する。

## brave-research との棲み分け

```
調査リクエスト
├─ 単一トピック・速報性重視 → brave-research
├─ 特定の事実確認 → brave-research
├─ 多角的分析（3+サブトピック） → deep-research
└─ 学術含む徹底調査 → deep-research
```

---

## Critical Rules

1. **オーケストレーターは WebSearch を実行しない** — 調査はすべてサブエージェントに委譲
2. **サブエージェントは必ず並列起動する** — 1つの応答で複数の Agent ツールを呼ぶ
3. **計画はユーザー承認を得てから実行する** — AskUserQuestion で確認
4. **出力ディレクトリは Bash で事前に作成する** — `mkdir -p /tmp/deep-research/{slug}/`
5. **最終レポートは日本語で作成する** — ソースが英語でも日本語で統合
6. **引用は検証する** — 統合後に引用URLの実在を確認

---

## エージェント体系（5種類）

トピックに応じて以下の5種から **3〜5種を選択** する。全部使う必要はない。

| エージェント | 調査ドメイン | 典型的ソース | 使用判断 |
|---|---|---|---|
| **Technical** | 技術設計・実装・性能 | 公式docs、GitHub、arXiv、カンファレンス | 技術的な仕組み・性能を理解したい |
| **Market** | 市場規模・競合・資金調達 | Gartner、TechCrunch、Crunchbase、IR資料 | ビジネス・市場の全体像を把握したい |
| **User** | ユーザー体験・採用率・満足度 | SO Survey、RedMonk、G2、Reddit | 実際の利用状況・評判を知りたい |
| **Academic** | 学術研究・理論・未解決課題 | arXiv、Semantic Scholar、IEEE、ACM | 研究動向・理論的基盤を調べたい |
| **Policy** | 規制・政策・標準化・倫理 | 官公庁、ISO/IEEE、法律事務所レポート | 法規制・コンプライアンスに関わる |

### 選択ガイド

```
トピック分析
├─ 技術的な仕組みを問う → Technical
├─ 市場・ビジネスを問う → Market
├─ ユーザー・現場の声を問う → User
├─ 学術的・理論的な背景を問う → Academic
├─ 法規制・政策を問う → Policy
└─ 複数該当 → 該当する全エージェントを選択
```

---

## ワークフロー

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

#### Step 1.1: トピック分解とエージェント選択

ユーザーのリクエストを分析し、**3〜5個の独立したサブトピック**に分解する。

各サブトピックに以下を定義:
- **調査質問** — 具体的な質問を3個
- **担当エージェント** — 5種（Technical / Market / User / Academic / Policy）から選択
- **出力ファイル名** — `{slug}_{domain}.md`

#### Step 1.2: 計画提示と承認

`AskUserQuestion` でユーザーに計画を提示する:

```
質問: 以下の調査計画で進めてよいですか？

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

バックグラウンドエージェントは完了時に自動通知される。全通知を受信後、各出力ファイルの存在を Read で確認し、Phase 3 に進む。

### Phase 3: SYNTHESIZE（統合 → 引用検証）

#### Step 3.1: レポート読み込み
各サブエージェントの出力ファイルを Read で読み込む。

#### Step 3.2: 矛盾検出と統合
- **一致する知見** — 複数ソースで裏付けられた情報として強調
- **矛盾する知見** — 両論併記し、どちらが信頼性が高いか根拠を示す
- **単一ソースの知見** — 「単一ソースによる情報」と明記

#### Step 3.3: 引用検証
- 各URLが実在するか（架空URLの除去）
- 検証できなかった引用は「未検証」と明記

#### Step 3.4: 最終レポート生成

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

---

## サブエージェント プロンプトテンプレート

各エージェントは **ReActループ（3ラウンド）** で調査する。WebSearch スニペットを最大活用する設計。

### 共通ヘッダー

全テンプレートの冒頭に以下を挿入する（`{共通ヘッダー}` で参照）:

```
## 調査方法: ReAct 3ラウンド

以下の3ラウンドで段階的に調査を深める。各ラウンドで WebSearch を3〜4回実行する。

**Round 1（広域探索）**: 全体像を把握。主要プレイヤー・概念・トレンドを特定。
**Round 2（深掘り）**: Round 1 で発見した重要テーマを個別に深掘り。具体データ・事例を収集。
**Round 3（検証・補完）**: 反証・限界・ギャップを探す。主要な主張を別ソースで裏付け。

各ラウンドの間に「Think」ステップを入れ、次のラウンドで何を調べるべきか計画すること。

## WebSearch 活用ルール
- WebFetch は使わない（バックグラウンド実行のため常にブロックされる）
- WebSearch のスニペット情報のみで調査する
- 同じ情報を異なるクエリで検索し、クロスバリデーションする
- 日本語クエリと英語クエリの両方を使用する

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
## 性能と比較
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

## エラーハンドリングとフォールバック

| 状況 | 対応 |
|------|------|
| サブエージェント1件失敗 | 成功レポートのみで統合。失敗トピックを「調査未完了」と明記 |
| 全エージェント失敗 | ユーザーに報告し、トピック修正を提案 |
| 出力ファイルが空 | 該当サブトピックをスキップし明記 |
| WebSearch 結果が不十分 | ReActループの次ラウンドでクエリを変形して再試行 |
| ペイウォール論文 | アブストラクトのみで要約。「全文未確認」と明記 |
| WebSearch 拒否 | 下記フォールバックモードに切り替え |

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
- [ ] 矛盾する知見が両論併記されている
- [ ] 制限事項セクションが含まれている

---

## Anti-Patterns

| Anti-Pattern | なぜ悪いか | 正しいアプローチ |
|-------------|----------|----------------|
| 単一トピックに5エージェント投入 | 過剰 | 3+サブトピックに分解できる場合のみ使用 |
| プレースホルダーを残す | `{変数}` が未展開で失敗 | 全変数を実際の値で置換 |
| 計画段階をスキップ | ユーザーの意図とずれる | AskUserQuestion で承認を得る |
| 引用検証をスキップ | ハルシネーションURLが残る | Phase 3.3 を省略しない |
| 全レポートを丸ごとコピペ | 冗長で読みにくい | 要点を抽出し再構成する |
| 結果を無条件に信頼 | 矛盾・誤情報が混入 | 矛盾検出ステップを実行 |
| WebFetch をプロンプトに含める | バックグラウンドでは常にブロック | WebSearch スニペットのみで設計 |
| 全エージェントに同じクエリ | 情報重複・検索予算の浪費 | 重複排除セクションで調査範囲を通知 |
| シングルパス検索 | 表層情報のみで深度不足 | ReAct 3ラウンドで段階的に深掘り |
