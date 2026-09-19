# 見出し設計と認知負荷 — Grok 調査の生出力（2026-09-08）

> bizdoc v0.12「役割ラベル — 主張句」見出しの設計に使った一次調査。`omc ask grok` で X 検索と Web 検索を併用させた生出力を、
> 冒頭の作業実況だけ除いてそのまま残す（要約・採否は docs/heading-form-v012.md）。
> X 投稿 37 件・Web 20 件。うち X 4 件（@masato_ka／@shin_yoshimura0／@rsensui／@fujikururi）は
> `cdn.syndication.twimg.com/tweet-result` で投稿の実在とハンドル・日付を確認済み（@fujikururi は本文が画像のため要旨は未確認）。
> 残りの投稿・URL は未確認。数値・引用を規範に転記するときは個別に裏取りすること。

# 長文業務文書における見出し設計とセクション構造が認知負荷に与える影響
**調査期間:** 2025年9月〜2026年9月（実験文献は基礎として 2001–2023 も参照）  
**対象:** 1枚 HTML の提案書・報告書・手順書・技術解説を含む長文業務文書  
**確信度の凡例:** 【確認済み】実験・公式文書／【観察】実務者の一致／【推測】直接証拠が薄い推論

---

## 結論（5行）

1. **支持されているのは「見出しが文書のアウトライン＝要旨になる」こと**であり、見出しの有無そのものは理解・メタ認知・探索コストを下げる。【確認済み】
2. **否定されているのは「ラベルだけの見出し（背景・課題・まとめ）」を主張の代替にすること**と、「疑問文だけで答えを隠す見出し」を専門読者向けの本文構造に使うこと。【確認済み＋観察】
3. **実務で最も再現されている折衷は二段構え**（短い役割語／トピック＋その下またはダッシュ後の主張文）であり、完全な主張文型は「1画面1メッセージ」と相性が良いが、見出し単体が2行超えると負荷が戻る。【観察】
4. **2025–2026 の構造トレンドは、人間のスキムと LLM の抽出を同時に満たすこと**（BLUF／ピラミッド、Diátaxis、progressive disclosure、llms.txt、見出し直下の自己完結アンサー）。【確認済み】
5. **未決なのは、日本語長文 HTML で (b) 複合型と (c) 完全主張文のどちらが負荷を下げるか**の対照実験。体言止めは「ラベルとしては有効、主張としては曖昧」で意見が割れており、資料ジャンルで最適解が変わる。【観察／未決】

---

## 見出し形式 (a)〜(d) の比較表

| 形式 | 支持する根拠 | 反対する根拠 | 向く場面 | 出典 |
|---|---|---|---|---|
| **(a) トピックラベル型**「背景」「課題」「まとめ」 | 章の種類が即座に分かり、スキーマ（報告書の型）に乗る。W3C は「見出し構造が文書全体の abstract になる」ことを求め、familiar なラベルで再認を記憶に頼らせない。【確認済み】技術文書では概念節に名詞句を推奨。【確認済み】日本語では体言止めラベルが短くスキャンしやすい。【観察】 | 中身の主張がゼロなので、スキムしても要旨が再構成できない。テクニカルライティングでは機能見出しより内容記述見出しを勧める。【確認済み】コンサル実務では「戦略を策定」が時制・意思を隠すと批判される。【観察】AI 引用でも "Overview" のような短すぎる見出しはマッチが弱い。【観察】 | 目次・進捗・ジャンルの看板（「手順」「参考」「解説」）。Diátaxis の四象限ラベル。読者が型を知っている定型報告書の骨格。 | W3C Cognitive Accessibility（ページ構造）; Google Developer Docs Style Guide（Headings）; Last, *Technical Writing Essentials* 3.2; 医知創造ラボ 2025-11; MUB「ヘッドラインの作り方」; Kevin Indig 2026（20字未満は弱い） |
| **(b) 役割ラベル＋主張の複合型**「01 出発点 — 1通話に最大9回の解析、そして届いていない成果」 | 役割語が「どの種類の節か」を渡し、ダッシュ後が緊張＝読む理由を残す。Mautone & Mayer は短いラベルより精緻化した見出し（「Air Flow: Air Moves Faster…」）を学習支援の例に挙げる。【確認済み】日本語コンサルの「タイトル（体言）＋メッセージライン（文）」は、ページ上部で Topic と Fact を分業する実務解。【観察】336枚調査では、タイトルは名詞型のまま直下に独立メッセージを置く二段が戦略資料で多い。【観察】 | 長い複合句はスキャンを遅らせ、AI 引用では 60 字超で citation が落ちる報告がある。【観察】ダッシュ後が煽り・体言止めの飾りになると「キャッチーだが中身が薄い」と読まれる。【観察】番号＋役割＋主張の三重は、作業記憶のチャンクを消費する。【推測】 | 提案書・報告書の本編（読者が「今どこにいるか」と「何を受け取れ」の両方を要する）。1枚 HTML の中見出し。稟議で1枚だけ抜き出される資料。 | Mautone & Mayer 2001（Prinz-Weiß 2023 が引用）; 富士フイルム Future CLIP「スライドタイトルとスライドメッセージ」; @fujikururi 336枚分析（2026-08）; @shin_yoshimura0（2026-09）; Australian Style Manual（70字以内、キーワード先頭） |
| **(c) 完全な主張文型**「本番を動かす操作は push の1回だけで、触るのは main の一時 worktree だけ」 | Assertion-Evidence: 見出しを完全文の主張にし、本文を証拠にする。学習実験でトピック＋箇条書きより理解が深い。【確認済み】法律書面の point heading も「完全な文法的文で結論＋理由」。【確認済み】資料設計者は「結論を見出しに」「見出しだけで意味が通る」を現場ルールにしている。【観察】疑問文見出しにイラッとし「そのあと続くメッセージを書いてほしい」という技術者の声。【観察】 | Alley 自身が「見出しは2行以内」と制限。長い用言文は音韻ループを埋め、1画面1メッセージと衝突する。【確認済み】日本語では見出しの体言止めが慣習で、文にすると「文字が多い」印象。【観察】Google はタスク見出しを原形動詞、概念は名詞句とし、文の見出しを標準にしない。【確認済み】 | 意思決定文書、1画面1メッセージの提案、スライド、手順の「やってはいけないこと／やることはこれ」節。LLM に要旨抽出させたいが、疑問より答えを載せたい節。 | Alley, Assertion-Evidence（Penn State）; Garner & Alley スライド構造実験; 法律 point headings（Persuasive Writing）; @shin_yoshimura0 2026-09-07; @masato_ka 2026-09-05; Google style headings |
| **(d) 疑問文型**「なぜ反映しただけでは足りないのか」 | 学習実験では質問形式の見出しが深処理を狙って使われた。【確認済み】2026 の大規模サブ見出し分析では、疑問見出しが ChatGPT fanout と 1.5 倍アラインし、20–39 字が citation 最高。【観察】AI 検索向け実務は「H2 をユーザーの質問そのものにし、直下に 2–3 文の答え」を推奨。【観察】 | Dunleavy: 「疑問は答えではない」。専門家は問いを既に知っており、答え見出しを求める。【確認済み】日本語技術者は「なぜ○○なのか？」を章題にされること自体に負荷を感じる。【観察】SEO 系の「疑問見出し推奨」は検索・引用最適化であり、業務文書の読解負荷低減とは別指標。【確認済み：目的の違い】 | FAQ、トラブルシュート、説明（Diátaxis の *why*）、AI に引用されたい公開ドキュメント。本文の導入フック。本文の骨格そのものには不向き。 | Prinz-Weiß et al. 2023; Dunleavy *Authoring a PhD*（interrogative headings 批判）; Kevin Indig 2026; Five Blocks 2026-09; @masato_ka 2026-09-05; Diátaxis（Explanation = Why） |

**日本語特有の事情（横断）【観察】**

- **体言止め:** 新聞・ビジネスで密度と断言感を出す装置。一方で動詞省略・受け身体言止めは意味が取れず、ニュース見出しですら「英語を見て初めて分かった」という報告がある。
- **漢語圧縮:** 「対応方針の策定」は短いが時制・行為者が消える（MUB の So What? 批判）。
- **コンサルの二段構え:** 上段は短いトピック（体言）、下段はメッセージライン（文）。「良い見出しは結論を書け」対「タイトルは主張するな」の対立は、実は層が違う（タイトル vs 実効見出し）。
- **AI 生成の副作用:** 見出しの過剰な体言止め・読点過多・キャッチーさが「AI slop」として認知負荷を上げる、という 2026 夏〜秋の日本語圏の一致した不満。

---

## 唐突さの要因

読者が見出しを「唐突」「読みにくい」と感じる要因は、実験では **トピック構造の信号不足**、実務では **役割・接続・長さの同時失敗** として現れる。

| 要因 | 根拠 | 打ち消す設計 |
|---|---|---|
| **見出しが長い一文である** | 作業記憶の純粋容量は約 3–5 チャンク（Cowan）。Alley は主張見出しを2行以内。Kevin Indig は 60 字超で citation −6pt。Australian Style Manual は 70 字以内。【確認済み／観察】 | 主張は残しつつ、役割語を短く先置き。(b) の「短い役割 — 主張」。1見出し1命題。 |
| **どの種類の節か分からない** | 機能見出し（Introduction）は中身を告げないが、ジャンル手がかりにはなる。W3C は領域の目的を見出しと視覚手がかりで示せ、と書く。Diátaxis は種類の混線こそドキュメント失敗の中心とする。【確認済み】 | 番号＋役割ラベル（01 出発点／手順／根拠）。目次を種類で色分け。ページ内進捗。 |
| **前節との接続が見えない** | 見出しはトピック文の処理を楽にし、回顧（look-back）を減らす（Hyönä & Lorch）。接続詞や preview 文がないと、節境界で再推論が要る。【確認済み】 | 見出し先頭をキーワードで揃え（同一主語）。「前節の帰結 → 本節の問い」を1行の bridge。SCQA の Complication を次見出しの主語にする。 |
| **番号や役割の手がかりがない** | 技術報告書はアラビア数字の階層を許容。W3C はアウトラインが abstract になることを求める。番号なしの同型体言止めは、位置記憶に頼らせる。【確認済み／観察】 | `2.3` や `Step 3/7`。左レール目次。現在地ハイライト。 |
| **ラベルが空（「背景」だけ）** | Last: 機能より内容を書け。Dunleavy: 形式的見出しは議論の線を合図しない。【確認済み】 | 「背景」をやめ「現行運用では push のたびに9回解析している」にするか、(b) で役割を残して主張を足す。 |
| **疑問のまま閉じる** | Dunleavy; @masato_ka。【確認済み／観察】 | 疑問は H2 に置いてよいが、直下2文で答えを書く（Five Blocks）。見出し自体を答えにするなら (c)。 |
| **視覚階層が平坦** | 余白ゼロ・見出しと本文のジャンプ不足は、中身の前に閉じられる。【観察】W3C はフラットデザインでチャンク境界が消えると chunking の利益が失われると警告。【確認済み】 | 見出し上の余白＞下。見出し用／本文用の2フォント。1.3 行間。 |
| **AI 要約経由で読む前提を無視** | 2026 年、docs は `.md` と `llms.txt` のサイドチャネルを持つ。見出しがラベルだけだと、エージェントも人間のスキムも要旨を組み立てられない。【確認済み】 | 見出しだけ順に読むと論理が通るか検査（@shin_yoshimura0）。各 H2 直下に自己完結の結論文。 |

---

## 構造設計トレンド 2025–2026

### BLUF / ピラミッド / SCQA
意思決定文書は「結論を文頭に置き、3–4 個の理由、その下に証拠」。SCQA は導入だけ緊張を作り、本体はピラミッドに戻す、という使い分けが 2025 年の実務メモで再掲されている。【確認済み：型の定義】【観察：2025–26 の再利用】  
出典: Shauchenka, *Managing Up and Across*（2025-10）; Minto Pyramid; 米軍 BLUF（AR 25-50 を実務者が AI 出力制約に転用、2026-08）。

### Amazon 6-pager / PRFAQ
スライド禁止・6ページ叙述・会議冒頭の黙読は継続して参照される。2025 年も GeekWire が PRFAQ を戦略文書として解説し、Released / Auditless が Introduction → Goals → Tenets → State → Lessons → Priorities を再整理。箇条は Goals など限定箇所だけ、詳細は付録へ（progressive disclosure の文書版）。【確認済み】  
出典: GeekWire 2025-01; Released.so 2025-12; Erins, *I'm Learning to Love the 6-Pager*（2025-07）。

### 開発者向けドキュメント（Stripe / Linear / Vercel 系）と Diátaxis
Diátaxis（Tutorial / How-to / Reference / Explanation）は 2026 年も公式が更新され、X 上では docs 生成プロンプトの既定フレームになっている。種類を混ぜることが認知負荷の主因、という主張が中核。Stripe 系 docs は「マニュアルではなくプロダクト」：短く、スキャン可能、コードはインタラクティブ、周辺情報は脚注・別層へ。【確認済み】  
出典: [diataxis.fr](https://diataxis.fr/start-here/)（2026-08 更新）; Mintlify *How Stripe creates the best documentation*; @mattpocockuk（Effect docs と progressive disclosure、2026-09）; @gsemetfr（Diátaxis をコード同期の仕様として使う、2026-08）。

### Progressive disclosure / advance organizer / signposting / wayfinding
「最初の層は必須だけ、詳細は展開」。2026 年は UI だけでなく **エージェント用スキル文書** にも同じ語が使われる（ルートは薄く、詳細はリンク先）。見出し・プレビュー文は advance organizer としてトピック構造を先渡しし、プレビュー文より見出しの方がトピック記憶に効く（Lorch et al. 2013）。【確認済み】  
出典: arc42 Quality Model *Progressive Disclosure*（2026-09）; Lorch, Lemarié, Chen 2013; @Timur_Yessenov 2026-09; @i_mika_el 2026-09。

### Chunking と作業記憶（約4チャンク）
Miller の 7±2 はチャンク未統制。Cowan は純粋容量を約4（成人 3–5）。見出し階層を H4 以下まで増やすほど負荷が上がる、という 2026 のコンテンツ設計ガイドもこの枠に乗る。1節の並列は 3–4、リストは Alley でも 2–4 項目。【確認済み】  
出典: Cowan 2001 / 2010 PMC; SEOAuthori *Headings and Subheadings*（2026-05）。

### 「読者は AI 要約経由で読む」時代
llms.txt v2（Howard、2026-08 改訂）: サイトは人間用 HTML とエージェント用 Markdown の二層。見出し階層そのものが索引。Common Crawl は 2026-07 クロールで 58 万件超の llms.txt を分析。QuestDB は全 docs を `.md` と `llms.txt` で供給。「write for LLMs」の最短解として「clear headings」だけを挙げる投稿もある。一方、見出しを疑問文に寄せるのは **引用率** の最適化であり、社内提案書の負荷低減とは指標が違う。【確認済み】  
出典: [llmstxt.org](https://llmstxt.org/) v2; Common Crawl 2026-08-31; Five Blocks 2026-09; Kevin Indig 2026-04; @QuestDb 2026-09-07; @itsParthVader 2026-08-26。

### TL;DR / 1画面1メッセージ / ナビゲーション
日本語圏の資料作成は「1スライド1メッセージ」「結論を見出しに」を AI プロンプトの固定ルールにしている。同時に、相手組織が詰め込み文化なら形式を合わせる方が通りやすい、という逆説も 2026-09 に拡散。目次・番号・進捗は W3C の wayfinding 要件と一致。【観察＋確認済み】  
出典: @AI_note_sensei 2026-09; @eshimoka41700 2026-09; @tortar101 2026-09; W3C ページ構造パターン。

---

## X の声

URL は取得できた投稿のみ。宣伝・無関係ヒットは除外。日付は投稿タイムスタンプ。

### 日本語圏

| @ハンドル | 日付 | 要旨 | URL |
|---|---|---|---|
| @masato_ka | 2026-09-05 | 「なぜ○○なのか？」という章題にイラッとする。タイトルなら続くメッセージを書け。認知負荷。 | [投稿](https://x.com/masato_ka/status/2096188697796620625 ) |
| @ToBeFreeFromJob | 2026-09-06 | 資料ごとのルールの違いが認知負荷を上げる。迷う時間と判断回数をゼロにする仕組みが課題。 | [投稿](https://x.com/ToBeFreeFromJob/status/2096727644335141018 ) |
| @motomiyash | 2026-09-04 | 仕事のドキュメントを AI にまとめさせると、見た目は良いが変な認知負荷がかかる。 | [投稿](https://x.com/motomiyash/status/2095711926110376410 ) |
| @muka | 2026-09-04 | 調査資料を URL で渡す・Slack に長文 Markdown を貼るのは相手に認知負荷をかけ、読まれない。 | [投稿](https://x.com/muka/status/2095669658263474472 ) |
| @prismlaser | 2026-08-31 | AI slop な日本語ドキュメントは認知負荷だけ高く示唆がゼロか誤り、という方がイラストより腹が立つ。 | [投稿](https://x.com/prismlaser/status/2094421475793203267 ) |
| @kathy_komoike | 2026-08-31 | Claude に書かせたドキュメントは翻訳調で認知負荷が高い。GPT の方が自然。 | [投稿](https://x.com/kathy_komoike/status/2094553654443614226 ) |
| @kkasai | 2026-09-05 | 「受け身体言止め見出しを許さない市民の会。」 | [投稿](https://x.com/kkasai/status/2096107790964253084 ) |
| @9632_decoy | 2026-09-05 | 変な見出しになるので受け身体言止めはダメ、という整理部の実務。 | [投稿](https://x.com/9632_decoy/status/2096107287601619004 ) |
| @kuchita_el | 2026-09-02 | 日本語ニュース見出しは意味が取れず英語で把握。体言止めはよいが動詞の丸ごと省略はやめたい。 | [投稿](https://x.com/kuchita_el/status/2095286814898872794 ) |
| @pokanake | 2026-08-22 | AI 文のキャッチー見出し・うざい体言止め・薄い長文に吐き気。 | [投稿](https://x.com/pokanake/status/2091093070393823376 ) |
| @takahashifumiki | 2026-08-10 | 生成 AI は見出しで読点過多＋すぐ体言止め。 | [投稿](https://x.com/takahashifumiki/status/2086813575998554114 ) |
| @shin_yoshimura0 | 2026-09-07 | 見出しをお題で終わらせず結論を置け。数字の枚は体言止めにしない。見出しだけ順読みで筋が通るかが構成検査。 | [投稿](https://x.com/shin_yoshimura0/status/2097088330722840920 ) |
| @shin_yoshimura0 | 2026-09-01 | 文字を減らしても余白ゼロだと読みにくい。考える場所を先に取れ。 | [投稿](https://x.com/shin_yoshimura0/status/2094908162717462630 ) |
| @fujikururi | 2026-08-07 | 336枚調査。「タイトルに結論」は思考停止。戦略資料はタイトル＝トピック、直下メッセージ＝Fact の二段が多い。 | [投稿](https://x.com/fujikururi/status/2085649710124277766 ) |
| @AI_note_sensei | 2026-09-05 | パワポ骨子は「1枚1メッセージ」「結論を見出しに」を軸にする。 | [投稿](https://x.com/AI_note_sensei/status/2096221256433693131 ) |
| @eshimoka41700 | 2026-09-04 | 10分セミナー54枚。詰め込みをやめ 1スライド1メッセージにすると、読み上げから口頭説明に戻れた。 | [投稿](https://x.com/eshimoka41700/status/2095751146275266759 ) |
| @tortar101 | 2026-09-02 | 提案書は相手の資料文化（1枚1メッセージか詰め込みか）に合わせる。異物感が稟議を落とす。 | [投稿](https://x.com/tortar101/status/2095004036650983578 ) |
| @Tetsu_Katagiri | 2026-09-04 | 人事制度説明は専門用語と詰め込みが不信を生む。1スライド1メッセージで。 | [投稿](https://x.com/Tetsu_Katagiri/status/2095829236833825041 ) |
| @rsensui | 2026-08-26 | 資料を書き直したら「助詞直後の読点で言い切る見出し」70%→0%、「体言止め」20%→70%、重い指摘が消えた。 | [投稿](https://x.com/rsensui/status/2092459572468580570 ) |
| @d_suke178 | 2026-09-05 | 研修の資料構成に認知負荷理論。情報量と提示方法で理解が変わる。 | [投稿](https://x.com/d_suke178/status/2096161523013960065 ) |

### 英語圏

| @ハンドル | 日付 | 要旨 | URL |
|---|---|---|---|
| @mattpocockuk | 2026-09-01 | Effect の docs を「exemplary」と再評価。導入が良く、progressive disclosure が効いている。 | [投稿](https://x.com/mattpocockuk/status/2094787007184511082 ) |
| @i_mika_el | 2026-09-01 | 本当にできた progressive disclosure は稀。多くは1ページに全部載せて thorough と呼ぶ。 | [投稿](https://x.com/i_mika_el/status/2094804736092360792 ) |
| @Timur_Yessenov | 2026-09-05 | スキルのルートは薄く。progressive disclosure の平易版は「仕事が分かる前にマニュアル全文を読ませない」。 | [投稿](https://x.com/Timur_Yessenov/status/2096139948709794039 ) |
| @itsParthVader | 2026-08-26 | write for LLMs したければ clear headings を使え。複雑にしすぎ。 | [投稿](https://x.com/itsParthVader/status/2092514884970053789 ) |
| @QuestDb | 2026-09-07 | 全 docs ページは `.md` で取れ、`llms.txt` が索引。エージェントの drift を減らす。 | [投稿](https://x.com/QuestDb/status/2097020247538643230 ) |
| @iabdul_wasey | 2026-09-06 | Web にエージェント向けサイドチャネル（llms.txt、markdown ネゴシエーション）が増え、エージェント文脈の半分は人間が描画しない。 | [投稿](https://x.com/iabdul_wasey/status/2096616748443124115 ) |
| @giudegio | 2026-09-04 | Diátaxis を系統的なテクニカルドキュメンテーションの方法として共有。 | [投稿](https://x.com/giudegio/status/2095839543597363576 ) |
| @gsemetfr | 2026-08-27 | Diátaxis で軸を分け、コード同期の docs が要件仕様のように機能する。 | [投稿](https://x.com/gsemetfr/status/2092885807421952227 ) |
| @tonydotstyle | 2026-08-26 | 「write some docs」はゴミ。「use diataxis, realistic examples, avoid duplicates」ならまともになり得る。 | [投稿](https://x.com/tonydotstyle/status/2092637666151977458 ) |
| @chrisreedbates | 2026-08-08 | エージェントに米陸軍 AR 25-50（能動態・短文・BLUF）を守らせる。PR 番号だけでなくタイトルを出せ。 | [投稿](https://x.com/chrisreedbates/status/2086076703151923593 ) |
| @BrisbaneJohn87 | 2026-08-27 | McKinsey 流: BLUF、MECE、ピラミッド（結論→3論点→データ）。 | [投稿](https://x.com/BrisbaneJohn87/status/2092940867753636245 ) |
| @Ayomide0_ | 2026-09-02 | タイポ階層は見出しを大きくするだけではない。読む順・何が主メッセージかを決める。全部強調すると何も強調されない。 | [投稿](https://x.com/Ayomide0_/status/2095021400931365109 ) |
| @Sente_us | 2026-09-05 | 認知負荷理論は「過負荷への警告」だけでなく、作業記憶に収めつつ germane load で地図を広げる設計書。 | [投稿](https://x.com/Sente_us/status/2096089090404053086 ) |
| @onEnterFrame | 2026-05-27 | IA が壊れていると派手なモーダルは混乱を加速する。cognitive load 向けに流れを先に作れ。 | [投稿](https://x.com/onEnterFrame/status/2059651594908807612 ) |
| @Edyenayat | 2026-08-31 | Docs が動画に勝つのはスキムと戻りができるから。エージェント出力も skimmable かどうかで効く。 | [投稿](https://x.com/Edyenayat/status/2094413872254103759 ) |
| @heitor_lessa | 2026-08-20 | 認知負荷・IA・密度は考えるが、「既に苛立っている人」前提にはしていなかった。 | [投稿](https://x.com/heitor_lessa/status/2090363283916075154 ) |
| @ismailkestel | 2026-09-03 | 表と箇条で同じ情報を繰り返すと認知負荷。要素ごとに役割を一つに。 | [投稿](https://x.com/ismailkestel/status/2095460537148555423 ) |

**X で期間内に見つからなかったもの:** 「Assertion-Evidence」を明示した 2025-09 以降の投稿は、今回のキーワード検索では該当なし。理論側は Web 一次資料に依存。

---

## Web 一次資料

| タイトル | 発行元 | 年 | URL | 要点 |
|---|---|---|---|---|
| Caption it! The impact of headings on learning from texts | *Applied Cognitive Psychology*（Prinz-Weiß & König） | 2023 | https://onlinelibrary.wiley.com/doi/10.1002/acp.4076 | 見出しは理解と判断精度を上げ、認知負荷に影響。質問形式見出しを使用。見出しの文／疑問／長さの差は未分離。 |
| Effects of topic headings on text processing（eye tracking） | Hyönä & Lorch, *Learning and Instruction* | 2004 | https://www.sciencedirect.com/science/article/abs/pii/S0959475204000039 | 見出しがあるとトピック文の処理が楽になり、要約に出るトピックが増える。 |
| Signaling topic structure via headings or preview sentences | Lorch, Lemarié, Chen, *Psicología Educativa* | 2013 | https://www.sciencedirect.com/science/article/pii/S1135755X13700113 | 見出しとプレビュー文は同じ情報でも、見出しの方がトピックへ注意を引きやすい。 |
| The Magical Mystery Four | Cowan, *Curr Dir Psychol Sci* / PMC | 2010 | https://pmc.ncbi.nlm.nih.gov/articles/PMC2864034/ | 作業記憶の中核は約 3–5 チャンク。長い言語チャンクでは 3–4。 |
| Assertion-Evidence Slide Structure（checklist） | Penn State Engineering Communication（Alley） | 2013頃 | http://www.writing.engr.psu.edu/AE_checklist.pdf | 見出しは左揃えの完全文主張、2行以内。本文は視覚的証拠。 |
| Headings（Technical Writing Essentials 3.2） | Last / LibreTexts | 継続 | https://human.libretexts.org/Bookshelves/Composition/Technical_Composition/Technical_Writing_Essentials_(Last)/03%3A_DOCUMENT_DESIGN/3.02%3A_Headings | 機能見出しより内容記述。階層・余白・具体性。1ページ 2–4 見出しが目安。 |
| Use a Clear and Understandable Page Structure | W3C WAI Cognitive Accessibility | 2026更新 | https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p03-page-structure/ | 見出し構造は文書の abstract。チャンク境界が見えないと chunking の利益が消える。 |
| Start here — Diátaxis in five minutes | diataxis.fr（Procida） | 2026-08更新 | https://diataxis.fr/start-here/ | 四種類を混ぜると失敗する。Tutorial/How-to/Reference/Explanation で書き方を変える。 |
| The /llms.txt file, v2 | llmstxt.org（Jeremy Howard） | 2024提案、2026-08改訂 | https://llmstxt.org/ | エージェント用の見出し付き Markdown 索引。詳細はリンク先。人間用 HTML と分離。 |
| A Content Analysis of llms.txt Files | Common Crawl | 2026-08 | https://commoncrawl.org/blog/a-content-analysis-of-llms-txt-files-from-the-july-2026-crawl-archive | 58.4 万件。約半数が仕様の形（H1＋引用＋H2 リスト）。中身の注釈は 33%。 |
| Headings and titles | Google developer documentation style guide | 現行 | https://developers.google.com/style/headings | タスクは原形動詞、概念は名詞句。文頭キーワード。見出しレベルを飛ばさない。 |
| Headings | Australian Government Style Manual | 2026-09確認 | https://www.stylemanual.gov.au/structuring-content/headings | 短く具体。70 字以内。空の「More information」禁止。スキム用サインポスト。 |
| 学会発表スライドは「体言止め」か「文」か？ | 医知創造ラボ | 2025-11 | https://blog.ichisouzo-lab.com/entry/2025/11/17/031220 | 見出しは体言止め可、結論・Take home は文。ラベルと主張を場所で分ける。 |
| 「一人歩きする資料」：スライドタイトルとスライドメッセージ | 富士フイルム Future CLIP | （実務ガイド） | https://sp-jp.fujifilm.com/future-clip/document/vol5.html | タイトルは短く主張せず体言。メッセージラインが主張。日本語コンサルの二段の正典に近い。 |
| ヘッドラインの作り方（体言止め注意） | MUB | 2024（コンサル慣習の記述） | https://mub.co.jp/marketing/consultant-headline/ | キーメッセージに体言止めを使うと時制と意思が消える。経営者向けは文で So What? を言え。 |
| Structuring Content So AI Models Can Extract Answers | Five Blocks | 2026-09 | https://www.fiveblocks.com/knowledge/ai-search-chatbots/how-do-you-structure-content-so-ai-models-can-extract-clear-answers/ | H2 を質問にし、直下に 2–3 文の自己完結答え。1ページ1トピック。 |
| 6.8 million subheadings × ChatGPT citation | Kevin Indig / Growth Memo | 2026-04 | https://substack.com/@kevinindig/note/c-242612988 | 疑問見出しは declarative の 1.5 倍アライン。最適 20–39 字。60 字超は不利。 |
| Progressive Disclosure | arc42 Quality Model | 2026-09 | https://quality.arc42.org/approaches/progressive-disclosure | 初期層は必須のみ。詳細は明示操作で開示し、初期認知負荷を下げる。 |
| The documents that help Amazon think | GeekWire | 2025-01 | https://www.geekwire.com/2025/the-documents-that-help-amazon-think-inside-the-tech-giants-process-for-strategic-planning/ | PRFAQ/6-pager は顧客起点・短く一貫・真実探索の意思決定ツール。 |
| Authoring a PhD（章・節タイトルの失敗） | Dunleavy（Open access PDF） | 再配布 2021確認 | https://files.znu.edu.ua/files/Bibliobooks/Inshi66/0048356.pdf | 空の形式見出しと疑問見出しを止め、答え見出しに置換せよ。 |

---

## 1枚 HTML 業務文書への含意（短く）

長文の提案・報告・手順・解説を **1枚 HTML** にするなら、2025–2026 の証拠が揃う設計は次です。

1. **骨格は (a) でなく (b)。** 左に番号と役割（出発点／制約／手順／根拠／決定）、右またはダッシュ後に主張。目次は役割だけでも辿れる。
2. **各節の第一文は (c)。** 見出しがラベル寄りでも、直下に用言で終わる自己完結の結論を置く。これが人間のスキムと LLM 抽出の共通単位。
3. **(d) は FAQ・解説・トラブルに限定。** 疑問を見出しにしたら、答えを隠さず直下に書く。
4. **並列は 3–4。** 作業記憶の4チャンクとピラミッドの「理由は3つ」が一致する。
5. **種類を混ぜない。** 手順書の途中に長い Why を入れず、リンクか折りたたみ（progressive disclosure）。
6. **見出し列だけ読んで論理が通るか**を校正ゲートにする。通らなければ文ではなく構成を直す。

**未決として残すこと:** 日本語の1枚 HTML で、(b) のダッシュ複合と「短いラベル＋直下の主張文」の二段のどちらが視線・理解・「唐突さ」評定で勝るかの対照実験は、今回の期間・一次資料では見つからなかった。実務観察は後者（二段）に寄っている。

