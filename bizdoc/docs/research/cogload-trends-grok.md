2024〜2026年の認知負荷設計を、出典付きで横断調査します。まずスキルと検索方針を確認し、領域ごとに一次情報を集めます。調査範囲は明確なので、領域ごとに一次情報を並行検索します。一次検索は当たったので、実務応用と開発者ドキュメント側を深掘りします。重要ソースを全文取得して、要点と適用形を裏取りします。調査の結論はこうです。2024〜2026年に「新しい理論」が出たというより、**古い実験知見が実務で再適用され、AI が供給を増やしたことで読者帯域の制約が表面化した**、というのが現況です。白基調1枚 HTML 業務文書では、scrollytelling より **結論先出し・削除・図と主張の隣接・段階開示** の方が効きます。

確信度: 中核理論は**確認済み**（実験・公式文書）。開発者ドキュメントの「なぜ効くか」は**高確度の観察＋推論**。1枚 HTML への適用形は、出典からの**推論**です。

---

# 認知負荷を下げる情報設計（2024–2026）調査報告

*調査日: 2026-08-20 | 対象期間の中心: 2024–2026 | ソース: 学術・公式・実務ドキュメント約 30 件*

## いま起きていること（要約）

1. **CLT の現在形**は「3種類の負荷を足し算する」から、「外在負荷を削り、内在負荷を分割し、空いた作業記憶をスキーマ構築に使う」へ寄っている。germane を別枠で「足す」設計は古い。
2. **Mayer** は 12 原理（2009）から 15 原理（2021）へ。実務で一番効くのは **coherence / signaling / segmenting / spatial contiguity**。文書（無音声）では modality・redundancy の重要度は下がる。
3. **BLUF / ピラミッド**は低抵抗・低複雑の意思決定文書で最適。洞察の発見・抵抗が高いときはナラティブが勝る、という使い分けが 2026 年に明示された。
4. **Progressive disclosure** は今も正典。scrollytelling は NYT / The Pudding で現役だが、1枚業務文書には過剰になりやすい。Distill は 2021 から休刊。
5. **Assertion-Evidence** はスライド実験が文書の図解設計にほぼそのまま転用できる。
6. **開発者ドキュメント**の勝ち筋は Stripe の「ジョブ順・三列・図とコードの隣接」と Diátaxis の「認知モードを混ぜない」。
7. **AI 時代の新課題**は、生成コストがほぼゼロなのに読者の作業記憶は 4 チャンク程度のまま、という非対称。2025 年時点で新規サイトの約 35% が AI 生成/補助と推定される。

---

## 1. 認知負荷理論（Sweller）の実務現在形

### 出典
- Sweller の枠組みの実務整理: [The Decision Lab — Cognitive Load Theory](https://thedecisionlab.com/reference-guide/psychology/cognitive-load-theory)
- 三分類の現代的注意（germane は第三の山ではない）: [Structural Learning](https://www.structural-learning.com/post/cognitive-load-theory-a-teachers-guide)
- 2025 年の理論再評価: [Kim, *Educational Philosophy and Theory*](https://www.tandfonline.com/doi/full/10.1080/00131857.2024.2441389)
- 2025 年応用レビュー（栄養コミュニケーション）: [Baxter et al., PMC12246501](https://pmc.ncbi.nlm.nih.gov/articles/PMC12246501/)
- 2025 年批判: [Gkintoni et al., *Brain Sciences*](https://pmc.ncbi.nlm.nih.gov/articles/PMC11852728/)
- 2025 特集号: [Ouwehand et al., *Education Sciences* 15(4)](https://www.mdpi.com/2227-7102/15/4/458)（MDPI 本体は今回 403。書誌は検索で確認）

### 要点（出典付き事実）
作業記憶は有限。Decision Lab は Cowan 以降の更新として **同時処理は約 4 チャンク** と書く（旧 Miller 7±2 ではない）。

三分類:

| 種類 | 中身 | 設計でできること |
|---|---|---|
| Intrinsic | 題材そのものの要素間相互作用 | 分割・事前用語・例示で管理。削除はできない |
| Extraneous | 提示のまずさ（分裂注意、装飾、冗長） | **削減が第一目標** |
| Germane | スキーマ構築に使う作業記憶 | 「足す」対象ではない。空いた容量がこれになる |

**2024–2026 の実務形:** germane を独立した第三負荷として加算するモデルは、Sweller 系の後年の記述では後退している。Kim（2025）は germane を「内在負荷を扱うために必要な作業記憶資源」と書く。実務の合意は「外在を削る → 内在を順序化する → 余った容量で理解が起きる」。

批判側（Gkintoni 2025）: CLT は教師中心・探索学習を過小評価し、「負荷を下げすぎると熟達に必要な生産的困難まで消す」と指摘。**確認済みの境界条件:** 熟達者では簡略提示がかえって効かない（expertise reversal。Mayer 側でも繰り返し確認）。

### 1枚 HTML への適用形（推論）
- 1枚に「背景・経緯・全オプション・全例外」を平置きしない。それは外在負荷。
- 内在負荷（論点が本当に難しい）は、用語定義を先に置き、図を1論点1つにする。
- 「理解を深めるアクティビティ」を足して germane を増やす、はしない。余白と見出し階層で足りる。
- 読者の事前知識で二層化する: 経営向けは結論と図、担当者向けは `<details>` に根拠。

---

## 2. Mayer のマルチメディア学習原理の文書応用

### 出典
- 原理の実験基盤と 15 原理への拡張: [Devlin Peck, 2026 更新](https://www.devlinpeck.com/content/mayers-principles-of-multimedia-learning)（Mayer *Multimedia Learning* 3rd ed. 2021; Mayer 2024 *Educational Psychology Review* を引用）
- 12 原理の実務要約: [Digital Learning Institute](https://www.digitallearninginstitute.com/blog/mayers-principles-multimedia-learning)
- 2022 系統的レビュー（136 本）: [Smart Learning Environments](https://slejournal.springeropen.com/articles/10.1186/s40561-022-00200-2)
- 2025 年の原理再掲: [Al-Khalifi, *JICC*](https://immi.se/index.php/intercultural/article/view/10.36923.jicc.v25i3.1215)

### 要点（出典付き事実）
三仮定: 二重チャネル / 容量制限 / 能動的統合。

2009 年版 12 原理。2021 年第3版で **embodiment / immersion / generative activity** を足して 15。Mayer（2024）は全原理を三目標に再配置する:

1. 外在処理を減らす: coherence, signaling, redundancy, spatial/temporal contiguity
2. 本質処理を管理する: segmenting, pre-training, modality
3. 生成処理を促す: multimedia, personalization, voice, image（＋後年の3つ）

SLE 2022 の研究密度: **modality が最多、次に redundancy / multimedia / signaling / coherence**。voice と pre-training は薄い。熟達者では効果は縮小〜消失（境界条件は確認済み）。

**文書（黙読・静止画）で効く順（ここから推論、ただし原理の定義に沿う）:**

| 原理 | 文書での意味 | 音声教材との差 |
|---|---|---|
| Coherence | 飾り・余談・背景パターンを消す | そのまま最強 |
| Signaling | 見出し・番号・強調で「見る場所」を指定 | そのまま最強 |
| Spatial contiguity | キャプションを図の横に置く | そのまま最強 |
| Segmenting | 節を短く、読者ペース | そのまま |
| Multimedia | 関連図は文章より理解を助ける | そのまま |
| Personalization | 「です・ます」より「あなたが決めること」 | そのまま |
| Redundancy / Modality / Temporal | ナレーション前提 | **黙読文書では二次** |

DLI も実務家が優先するのは coherence / signaling / segmenting だと書く。

### 1枚 HTML への適用形（推論）
- 白基調そのものが coherence: 装飾ストック写真・グラデーション・アイコン羅列は切る。
- 各 SVG の**直後（または図中）**に、その図が主張する1文を置く。凡例をページ下に置かない。
- 節は「見出し = シグナル」。装飾線やカードの量産はシグナルを殺す。
- 音声がないので redundancy は「同じことをリードと本文と図キャプションで三回書く」問題になる。1回だけ書く。

---

## 3. BLUF / ミント・ピラミッド vs ナラティブ

### 出典
- BLUF 定義・陸軍 AR 25-50: [Wikipedia: BLUF (communication)](https://en.wikipedia.org/wiki/BLUF_(communication))（文体注意あり。一次は [AR 25-50](https://web.archive.org/web/20250317140055/https://home.army.mil/wood/application/files/3015/5751/8343/AR_25_50_Army_Correspondence.pdf)）
- ビジネスコミュでの再流行: [Jeff Gothelf, 2025-02-17](https://jeffgothelf.com/blog/effective-storytelling-bottom-line-up-front-explained/)
- メール精度: [Sehgal, HBR 2016](https://hbr.org/2016/11/how-to-write-email-with-military-precision)
- BLUF vs Pyramid の範囲差: [Nate Bal, 2026-03](https://natebal.com/bottom-line-up-front-method/)
- **使い分けの本論（2026-07）:** [Brent Dykes — Why The Pyramid Principle Is Not A Data Storytelling Framework](https://www.effectivedatastorytelling.com/post/why-the-pyramid-principle-is-not-a-data-storytelling-framework)
- ピラミッド原典の実務要約: [StrategyU](https://strategyu.co/pyramid-principle-partone/)

### 要点（出典付き事実）
三手法は似て非なる:

| | BLUF | ミント・ピラミッド | ナラティブ / データストーリー |
|---|---|---|---|
| 起点 | 結論・依頼・判断を1文〜3文 | 答え → グルーピングされた根拠（MECE） | 状況・証拠 → 洞察の発見 |
| 目的 | スキャンと意思決定速度 | 複雑な提案の論理圧縮 | 理解と納得（conviction） |
| 向く相手 | 時間のない決裁者 | 信頼済みの経営層 | 抵抗が高い / 論点が難しい相手 |

Minto 自身が例外を二つ書いていた（Dykes が 2026 に再提示）:

1. 結論に強く反対する相手には、先に受容の準備が要る
2. 行動を理解できない相手には、先に推論が要る

Dykes の 2×2: **低抵抗かつ低複雑の1象限だけがピラミッド最適**。他3象限はストーリーの方が効く、というのが 2026 年の実務議論の中心。SCQA（Situation–Complication–Question–Answer）はピラミッドの前にフックを足すが、答えを先に出す方向は変わらない。

Gothelf（2025）は BLUF を「状況・障害・提案を冒頭2–3文」とし、その後に深掘り可能、と教える。これはピラミッドの短縮版に近い。

**推測と区別:** 「BLUF が常に正しい」は事実ではない。軍事・メール・決裁メモでは確認された慣行。変革提案・データ洞察・合意形成では、Minto 自身の例外がむしろ本則になりつつある（Dykes の主張。実験RCTではなく実務論）。

### 1枚 HTML への適用形（推論）
- **提案書・決裁・手順:** 先頭 80 字で「何を決めてほしいか / 結論は何か」。続けて3根拠。これが BLUF+浅いピラミッド。
- **調査報告・対立案件:** 冒頭は「何が分かったか」まで。推奨は、読者が図を見た後に出す（ナラティブ側）。ただし1枚なので「謎解き」は短く、3画面以内で洞察に着地。
- リードを abstract にしない。abstract は要約、BLUF は**判断文**。

---

## 4. Progressive disclosure / scrollytelling / data storytelling

### 出典
- Progressive disclosure 正典: [Nielsen Norman Group, 2006（原則は2026も通用）](https://www.nngroup.com/articles/progressive-disclosure/)
- 定義更新: [IxDF, updated 2026](https://ixdf.org/literature/topics/progressive-disclosure)
- NYT 年次: [2024 Year in Graphics](https://www.nytimes.com/interactive/2024/12/20/us/2024-year-in-graphics.html) / [2025 Year in Graphics](https://www.nytimes.com/interactive/2025/12/22/us/2025-year-in-graphics.html)
- The Pudding: [pudding.cool](https://pudding.cool/)
- Distill 理念: [distill.pub/about](https://distill.pub/about/)
- Distill 休刊: [Distill Hiatus, 2021-07-02](https://distill.pub/2021/distill-hiatus/)
- scrollytelling が負荷を下げた例（プライバシーポリシー, 2026）: [ACM CHI EA 2026](https://dl.acm.org/doi/10.1145/3772318.3790704)
- 欧州データ可視化ガイド: [data.europa.eu — Scrollytelling](https://data.europa.eu/apps/data-visualisation-guide/scrollytelling-introduction)

### 要点（出典付き事実）
**Progressive disclosure（NN/g）:** 最初は少数の重要選択肢だけ見せ、高度・稀なものは要求時に出す。学習容易性・効率・エラー率の3つが上がる。失敗条件は (1) 一次/二次の分割ミス (2) 次へ進む導線の不明瞭。3階層以上は迷う。staged disclosure（ウィザード）とは別物。

**NYT / The Pudding（2024–2025）:** 年次グラフィック特集は継続。題材は選挙・AI・気象・戦争。The Pudding は 2025 も visual essay（例: musical motifs, loneliness video）を出している。形式はスクロール連動図＋短い主張文。

**Distill:** 2016–2021。「PDFでは不可能な反応図で研究負債（research debt）を返す」が理念。2021-07 に無期限 hiatus。理由は理論の敗北というより、**制作コストと編集負荷が持続不能**だったこと。テンプレートは残し、後継は自前サイト / Observable / VISxAI。

**scrollytelling と負荷:** 壁テキストより scrollytelling の方が負荷が下がった、という 2026 のプライバシーポリシー実験がある（ACM）。一方で、装飾アニメや「スクロールしないと結論が出ない」設計は外在負荷になる、というのが CLT/Mayer からの**推論**（NYT 自身も 2024–25 は単純チャートの Upshot 系を並行）。

### 1枚 HTML への適用形（推論）
- スクロール連動アニメは**原則使わない**。印刷・配布・会議投影と相性が悪い。
- 代わりに NN/g の開示: 本編は結論・3根拠・1図。例外・手法・生データは `<details>` / 脚注 / 別セクション。
- 図は Distill 的に「操作して理解」ではなく、「1図 = 1主張」（Assertion-Evidence へ接続）。
- どうしても物語が要るなら、3〜4ブロックの縦積み（状況 → 証拠図 → 洞察 → 推奨）に止める。これが業務文書向けの scrollytelling 圧縮版。

---

## 5. Assertion-Evidence の文書転用

### 出典
- 公式: [assertion-evidence.com](https://www.assertion-evidence.com/) / [assertion-evidence.org](https://www.assertion-evidence.org/)
- 実験: [Garner, Alley et al., 2013](https://pure.psu.edu/en/publications/how-the-design-of-presentation-slides-affects-audience-comprehens/)（工学学生 110 人）
- ASEE 2011 先行: [peer.asee.org](https://peer.asee.org/assertion-evidence-slides-appear-to-lead-to-better-comprehension-and-recall-of-more-complex-concepts)
- 2023 再現: [Alzayed, JER](https://kuwaitjournals.org/jer/index.php/JER/article/view/16963/3301)
- 2026 年も教材として存続: Language Neuroscience Podcast（公式サイト告知, 2026-06-12）

### 要点（出典付き事実）
PowerPoint 既定（名詞見出し + 箇条書き）は (1) テイクアウェイを言わない (2) 文字過多で視線が迷う。

AE の3原則:
1. トピックではなく**メッセージ（主張文）**で組む
2. 箇条書きではなく**視覚的証拠**（図・表・写真）で支える
3. 証拠の説明は口頭でその場で文にする（スライド文書化では「短い本文」に置換）

Garner et al. 2013: AE 群は理解が高く、誤解が少なく、**主観的認知負荷が低く**、遅延テストの再生が強い。Alzayed 2023 も理解・誤解減少・保持を報告。サンプルは主に理工系学生で、一般ビジネス文書への外挿は**高確度だが実験そのものではない**。

### 1枚 HTML への適用形（推論）
- 図のキャプションを「図1: 売上推移」にしない。「図1: 値引き後もリピート率は上がっていない」。
- 箇条書きの壁を、主張見出し + SVG 1枚に置換する。これが AE の文書版。
- セクション見出しも名詞（「市場環境」）ではなく文（「競合3社は価格で揃い、差別化は納期だけ」）。

---

## 6. 開発者ドキュメントの認知負荷対策（Stripe, Linear, Notion ほか）

### 出典
- Stripe DX 分解（2026）: [Moesif teardown](https://www.moesif.com/blog/best-practices/api-product-management/the-stripe-developer-experience-and-docs-teardown/)
- Stripe 4原則: [Raw.Studio, 2026-05](https://raw.studio/blog/how-stripe-uses-4-developer-first-ux-principles-to-drive-massive-adoption/)
- Stripe Docs: [docs.stripe.com](https://docs.stripe.com/)
- Diátaxis: [diataxis.fr](https://diataxis.fr/)（Cloudflare / Gatsby が採用を明言）
- Linear Method: [linear.app/method](https://linear.app/method) / [Write issues not user stories](https://linear.app/method/write-issues-not-user-stories) / [Principles: 短い spec](https://linear.app/method/introduction)
- Notion はドキュメント製品そのものが柔軟すぎる（認知負荷をユーザーに外注しうる）。公式コネクタ例: [Notion AI × Linear](https://www.notion.com/help/notion-ai-connector-for-linear)

### 要点（出典付き事実）
**Stripe**
- ドキュメントをサポートではなく製品として書く。
- 情報アーキテクチャは社内製品階層ではなく**ジョブ**（支払いを受け取る、定期課金、webhook を試す）。
- 三列: ナビ | 本文 | 実コード。本文ホバーで対応コードがハイライト = **spatial contiguity の実装**。
- Markdoc（2022 OSS）。コードは実行可能。テストモードで docs 内試行。
- 2026 の新層: 読み手は人間だけでなくエージェント。`operationId` / `description` をコピーとして扱う。llms.txt 的な機械可読索引。

**Diátaxis（広く採用、2024–26 も技術文書の標準語彙）**
四象限を混ぜない: Tutorial / How-to / Reference / Explanation。Reddit 2026 でも「認知負荷を下げるために Diátaxis を入れる」が実務話題。混ぜると読者は「今は手順なのか概念なのか」を自分で判定する外在負荷を負う。

**Linear**
- ドキュメントサイトというより、**書く量を減らす製品思想**。
- Method: 「Aim for brevity. Short specs are more likely to be read。」issue はユーザーストーリーではなく短いタスク文。タイトルは動詞ではっきり。
- これは CLT の coherence + segmenting を、ツール制約として実装した形。

**Notion**
- ページを無限に Nest できるので、組織が IA を持たないと**外在負荷の発生装置**になる（観察に基づく推論。Stripe ほど「読みの順序」を製品が強制しない）。
- 勝ちパターンはテンプレートと短いページ。負けパターンは長い wiki の一枚岩。

### 1枚 HTML への適用形（推論）
- 左ナビは不要。代わりに先頭の目次3項目 = Stripe 左列の圧縮。
- 本文の横に「対応する図 / 対応する次アクション」を置く = 三列の二次元版。
- 1枚の中で Tutorial（手順）と Explanation（なぜ）を交互にしない。手順文書なら手順だけ。解説が要るなら別ブロックを明示。
- Linear 流: spec は Why / What / How を短く。読まれない長さは書かない。

---

## 7. AI 生成ドキュメント時代の新しい課題

### 出典
- 生成速度 vs 人間の処理: [Planorama, 2024-08-12](https://planorama.design/blog/avoiding-information-overload-from-ai)
- ウェブ全体の AI テキスト比率: [Dolezal et al., arXiv:2604.26965, 2026-04](https://arxiv.org/html/2604.26965v1)（Internet Archive 標本 + Pangram v3）
- 追加データが意思決定を劣化させうる、という警告の引用: [Small Wars Journal, 2026-04-21](https://smallwarsjournal.com/2026/04/21/drowning-in-data-solving-the-data-overload-problem-in-osint/)（Gartner の分析麻痺言及を含む二次）
- LLM の既知の失敗: hallucination / sycophancy / **verbosity**（同上 arXiv が列挙）
- 認知オフロード vs 過負荷: [Frontiers in Psychology, 2025](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2025.1699320/full)

### 要点（出典付き事実）
非対称が本質。AI はテキストをほぼ無料で増やせる。作業記憶は増えない。Planorama: 「人間の脳は AI が生成する速度でも量でも処理できない。過多は意思決定麻痺になる」。

arXiv:2604.26965（2026-04、確認済みの大規模推定）:

| 仮説 | 一般の信じ方 | ウェブ実測 |
|---|---|---|
| 新規サイトの AI 比率 | — | **2025 年前半で約 35% が AI 生成または補助**（ChatGPT 前はほぼ 0） |
| 意味の収縮（多様性が減る） | 60.9% が同意 | **確認**（ρ=0.47, p=0.004）。AI 文書同士の意味類似は非 AI より 33% 高い |
| 過度なポジティブ | 72% が同意 | **確認**（ρ=0.56）。ポジティブ感情スコアは約 2 倍 |
| 事実の崩壊 | 75.1% が同意 | **有意差なし** |
| 文章が長く中身が薄い | 60.7% が同意 | **有意差なし** |
| 文体の単一化 | 83% が同意 | **有意差なし** |

含意（論文の議論 + 文書設計への推論）: 最大のリスクは「嘘の爆発」より、**同じような無難な長文が帯域を埋めること**。読者は検証コストを払わず「正しそう」と受け取る（Planorama の bias overload）。verbosity は LLM の既知特性なので、生成文書は放っておくと coherence 原則に反する。

### 1枚 HTML への適用形（推論）
- 生成後の編集目標は「足す」ではなく**削る**。分量上限を先に決める（例: 画面3枚、図2つ、推奨は1つ）。
- 主張には出典リンクを必須にする。AI はリンク密度を自然には増やさない（論文の Hyp.4 は有意でないが、検証可能性は人間側の設計）。
- トーンの過ポジティブを校正する。「できます」「革新的」を削り、制約と不確実性を残す。
- 人間の仕事はフィルタ・検証・文脈・物語化（Planorama の4役割）。1枚 HTML はその4つの出力であり、モデルの生ログではない。

---

## 最も効く上位5原則（根拠つき選定）

選定基準: (a) 実験または大規模観測がある (b) 黙読の静止1枚 HTML に直接写る (c) AI が増やした「量」問題を叩く。scrollytelling や modality は (b) で落ちる。

### 1. 外在負荷を削る（Coherence）
**根拠:** Mayer 系で最も実務家が優先し、SLE 2022 でも研究密度が高い部類。Sweller の第一目標と一致。AI の verbosity / 意味収縮（arXiv 2026）への直接対抗。  
**1枚 HTML:** 飾り、繰り返し、経緯の全部載せ、ストック図を捨てる。残すのは判断に必要な要素だけ。

### 2. 結論（または洞察）を作業記憶の先頭に置く（BLUF / 浅いピラミッド）
**根拠:** AR 25-50 が「効果のない文書の最大の弱点は、焦点のあるメッセージをすぐ送れないこと」と明記。読者は結論探索にチャンクを使ってしまう。Gothelf 2025 も時間貧困オーディエンス向けに再定式化。  
**境界:** 抵抗・複雑が高いときは結論を少し遅らせる（Minto の例外、Dykes 2026）。  
**1枚 HTML:** 最初のブロックが「決めてほしいこと / 分かったこと」。摘要ではなく判断文。

### 3. 見る場所を指定し、言葉を図の隣に置く（Signaling + Spatial contiguity）
**根拠:** Mayer の外在処理削減グループ。Stripe の本文↔コード同期は、この原理の産業実装として観察できる（実験ではなく高確度の構造的一致）。Garner 2013 の「箇条書きはどこを見ればいいか分からない」と同一メカニズム。  
**1枚 HTML:** 見出しは文。図のキャプションは図の直下。ページ末凡例を禁止。

### 4. 一度に一つの認知ジョブ（Segmenting + Progressive disclosure + Diátaxis）
**根拠:** Segmenting は学習者ペースのチャンクが連続提示に勝つ。NN/g は一次画面にコアだけ。Diátaxis は「手順と解説を混ぜると読者がモード判定コストを払う」と数百プロジェクトで採用。Linear は短い spec が読まれると明記。  
**1枚 HTML:** 本編は1ジョブ（決裁 / 手順 / 説明のどれか）。他は `<details>`。節は短く、読者が途中で降りられる。

### 5. 名詞見出し＋箇条書きを、主張文＋視覚証拠に替える（Assertion-Evidence）
**根拠:** Garner et al. 2013（n=110）で理解↑・誤解↓・主観負荷↓・遅延再生↑。2023 再現あり。白基調 SVG 文書の図解文法に最も写る。  
**1枚 HTML:** 各図のタイトルが主張。箇条書きの壁は図1枚に圧縮。セクションも主張で立てる。

---

## 採らなかったが重要な境界

- **Scrollytelling を上位に入れない理由:** 制作コストが高く（Distill が持続不能と結論）、会議・印刷・1枚配布と衝突する。負荷低減の証拠は特定ドメイン（プライバシーポリシー）に限定。
- **Modality / 音声:** 黙読文書では使わない。
- **「 germane を増やす活動」:** 現行 CLT では推奨されない古い読み。
- **完全なナラティブ:** 業務の既定ではない。抵抗が高いときだけ。

---

## 方法と限界

- 検索は 2024–2026 を優先しつつ、正典（NN/g 2006、Garner 2013、AR 25-50、Mayer 2009/2021）は現行実務が参照し続けているため残した。
- PMC / MDPI の一部はボット遮断で本文未読。書誌と二次要約で扱った箇所は「高確度だが本文未確認」とする（Baxter 2025、Ouwehand 2025 特集）。
- Stripe / Linear の「認知負荷対策」は各社が CLT を名乗っているわけではなく、観察可能な IA・文体からの対応づけ（推論と明示）。
- arXiv:2604.26965 は検出器依存。著者も検出限界を認める。比率 35% は「分類器の推定」であり地面真値ではない。

必要なら、この5原則を bizdoc の生成チェックリスト（見出し文法・図キャプション・`<details>` 分割・分量上限）に落としてよい。
