動画が文書より頭に入りやすい理由を、学習科学の一次資料から洗い出します。まず調査手順と既存成果物を確認し、並行で文献検索を始めます。既存の調査メモを確認しつつ、認知負荷・二重符号化・物語没入・静的媒体の再現技法を並行で検索します。一次資料を深掘りします。Mayer の分節・モダリティ、物語没入、スクロール駆動とコマ割り、読者の迷子化まで並行で取ります。一次資料を読みます。Mayer の論文、コマ割り、物語没入、スクロール駆動、迷子化の古典まで並行で取得します。一次資料は揃いました。境界条件（動画が常に有利ではない）を明示したうえで、原理→静的HTMLへの転用→7原則に落とします。調査結果をワークスペースに残しつつ、報告書本体を組み立てます。動画が頭に入りやすい主因は「動画だから」ではない。よくできた説明動画が、作業記憶の制約に合わせて **時間的に切る・視線を代行する・言葉と映像を同時に届ける・ペースを学習者に渡す・予告して回収する** を同時に実装しているからだ。静的な1枚 HTML は、時間軸をスクロール空間に翻訳すればこの束を再現できる。文書は消えないので、動画の弱点（一過性情報効果）を逆に取れる。

境界条件も先に置く。長くて止められない動画、字幕とナレーションの三重提示、装飾過多は文書より負荷が高い。読みの方が深い理解に勝る報告もある。狙うべきは「動画っぽさ」ではなく、動画が偶然うまくやっている認知設計の移植である。

---

## 0. 原理の地図（なぜ動画が低負荷に見えるか）

Mayer の認知的マルチメディア学習理論（CTML）は3つの前提に立つ。**(a) 二重チャネル**（視覚と聴覚は別系統）、**(b) 各チャネルの容量は小さい**、**(c) 学習は選択・組織化・統合の能動処理で起きる**。原則はこの3つから導かれる（15原則、200超の実験比較。第3版 2021、理論レビュー 2024）。

| 動画がやっていること | 対応する原則 | 文書が壊れやすい点 |
|---|---|---|
| 1カット=1変化 | Segmenting | 1画面に前提・本論・例外が同居 |
| ナレーション＋映像 | Dual coding / Modality | 図と本文が別ページ／別カラム |
| 矢印・ズーム・ハイライト | Signaling | 視線誘導がなく、読者が自分で探す |
| 一時停止・速度 | Learner pacing | 固定速度はないが、戻るコストが高い |
| 「これから3つ」→回収 | Pre-training / Advance organizer | 先が見えず、終わりも見えない |

出典: Mayer, *The Past, Present, and Future of the Cognitive Theory of Multimedia Learning*, *Educational Psychology Review* (2024)  
https://link.springer.com/article/10.1007/s10648-023-09842-1

15原則の実務要約: https://www.devlinpeck.com/content/mayers-principles-of-multimedia-learning

---

## 1. 動画が低負荷な理由（項目別）

### 1.1 時間的分節（Segmenting）

**出典**
- Mayer & Pilegard / Cambridge Handbook: 学習者ペースの断片提示が連続提示に勝る  
  https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/principles-for-managing-essential-processing-in-multimedia-learning/A9E77D0172F905AC957689D1771E2888
- Mayer & Moreno (2003) *Nine Ways to Reduce Cognitive Load in Multimedia Learning*  
  https://swcarpentry.github.io/swc-releases/2017.02/instructor-training/files/papers/mayer-reduce-cognitive-load-2003.pdf

**要点**  
分節は「短く切る」だけではない。核心は **Continue ボタン**、つまり次が来る前に処理を完了させる権利を学習者に渡すこと。複雑な本質的負荷（intrinsic load）は削除できないので、一度に処理する要素数を作業記憶の上限以下に落とす。動画のチャプター、一時停止、ナレーターの間は、この Continue の実装である。

**静的 HTML への適用形**
- 1セクションの高さをおおよそ1ビューポートに揃え、余白で「カットの切れ目」を作る（スクロール＝Continue）。
- `<details>` や段階開示は、次の本質情報を隠す用途に限る（装飾の折りたたみに使わない）。
- 自動再生・scrolljacking は分節の権利を奪うので使わない。スクロールは学習者ペースのままにする。

---

### 1.2 二重チャネル（Dual coding）とモダリティ効果

**出典**
- Paivio, Dual Coding Theory（言語系と非言語・イメージ系は独立だが相互接続）  
  解説: https://www.structural-learning.com/post/dual-coding-a-teachers-guide
- Moreno & Mayer (1999) アニメ＋ナレーションがアニメ＋画面テキストに勝つ（モダリティ効果の初期実証）  
  https://www.davidlewisphd.com/courses/EDD8121/readings/1999-MorenoMayer.pdf
- Ginns (2005) メタ分析: モダリティ効果の加重平均 **d = 0.72**（複雑・システムペースで大きく、自己ペース・単純材料では縮小）  
  https://www.sciencedirect.com/science/article/abs/pii/S0959475205000459
- 境界: 専門用語が多い、非母語、学習者が再読できるときは画面テキストが有利になりうる（Çeken & Taşkın 2022 の系統的レビューでも modality が最多研究）  
  https://slejournal.springeropen.com/articles/10.1186/s40561-022-00200-2

**要点**  
Dual coding は「絵があればよい」ではない。言語コードとイメージコードが **対応づけられて統合** されることが条件。Modality はさらに厳しい: 図を画面テキストで説明すると視覚チャネルが二重占有され、ナレーションなら聴覚に逃がせる。動画の「語り＋動き」が楽なのはこの分流による。

**静的 HTML への適用形（ここが最大の転用ギャップ）**  
無音の静的 HTML では **モダリティ効果を文字どおり再現できない**。聴覚チャネルがない。転用は近似に限る。

1. 図の説明を図の外の長文に置かない（視覚の二重占有を、空間統合で緩和する）。
2. キャプションは「ナレーションの1文」長さにし、図の直後・図中ラベルにする。
3. 任意の短い音声トラックは opt-in（強制ナレーション＋全文表示は redundancy 違反）。
4. コマ割りで「今この瞬間の1文」だけを隣に置く（時間的分流の空間化）。

---

### 1.3 視線誘導（Signaling / Cueing）

**出典**
- van Gog, *The Signaling (or Cueing) Principle in Multimedia Learning* (Cambridge Handbook, 2014/2021)  
  https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/signaling-or-cueing-principle-in-multimedia-learning/3972D4ACC628D5B53F7B2B4785DB2B06
- Schneider et al. (2018) メタ分析: 関連箇所・構造をハイライトする手がかりは学習を助ける  
  https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581
- 実務定義: 矢印、ハイライト、見出し、声の強調。全部を合図すると合図が消える  
  https://www.devlinpeck.com/content/mayers-principles-of-multimedia-learning

**要点**  
動画のズーム・ポインタ・ナレーターの「ここを見て」は、選択（selecting）を外注している。読者は「どこが重要か」を自分で計算しなくてよい。合図がない文書では、視覚探索そのものが外生的負荷になる。

**静的 HTML への適用形**
- 図中の今の主題だけを accent 色／番号／矢印で1点示す。同時に3点以上光らせない。
- スクロールで同じ図を再利用するなら、前の強調を消し、次の強調だけ残す（scrollytelling の定石）。
- 見出しはトピック名ではなく「今見るべき主張」にする（signaling の言語版）。
- 製品ツアーのスポットライト（周囲を暗くし1要素だけ残す）を、図の不要部分の低コントラスト化で真似る。

---

### 1.4 ペーシング（学習者制御 vs 一過性）

**出典**
- Segmenting の「learner-paced」定義（上掲 Devlin Peck / Cambridge）
- Transient information effect: 消える情報（発話・動画）は、残る情報（文字・静的図）より理解を落とすことがある  
  Wong, Leahy, Marcus & Sweller (2012)  
  https://eric.ed.gov/?id=EJ978021  
  Lin et al. (2022) PMC  
  https://pmc.ncbi.nlm.nih.gov/articles/PMC9610327/  
  Cambridge Handbook 章  
  https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/transient-information-principle-in-multimedia-learning/670D96C3B9520320CE558AA855A49EE9
- Ginns (2005): モダリティ効果は **システムペースで大きく、自己ペースでは縮小**

**要点**  
短い動画が楽なのは、良いペーシングのときだけ。長い連続動画は、今の文を保持したまま次が上書きされる。これが一過性情報効果。一時停止・速度変更・チャプターはこの弱点の応急処置。文書は原理的に「永続媒体」なので、ここは HTML の方が強い。ただし、画面から消えた前セクションは実質一過性になる（スクロールで見失う）。

**静的 HTML への適用形**
- 今必要な図は sticky で残し、本文だけ流す（図が一過性にならない）。
- 前の結論は1行の sticky 要約／「いまの位置」バーで残す。
- 自動アニメで情報を消さない。変化はスクロール位置に紐づけ、巻き戻し可能にする。
- 動画を埋め込むなら、短く切って手動再生。長い一本は置かない。

---

### 1.5 予告と回収（Pre-training / Advance organizer）

**出典**
- Pre-training principle: 主要概念の名前と特性を先に知っていると、本編の本質的負荷が下がる  
  https://www.devlinpeck.com/content/mayers-principles-of-multimedia-learning
- Ausubel の advance organizer: 本編より抽象度の高い導入で、既知スキーマと新情報を橋渡しする（単なるアジェンダ列挙ではない）  
  https://www.structural-learning.com/post/ausubels-meaningful-learning-theory-teachers-guide  
  https://ofe.ecu.edu/udlmodules/multiple-means-of-engagement/advance-organizers-preparing-students-for-learning/
- 動画の「今日は3つ話します」→各章で回収→最後に3つを並べ直す、は予告／回収の通俗形

**要点**  
作業記憶が新しい用語の復号とプロセス理解を同時にやれない。動画は導入30秒で語彙を渡し、本編で「さっきのXがこう動く」と回収する。文書は用語を本文の途中で突然出しがちで、読者は辞書引きと論証を同時にやらされる。

**静的 HTML への適用形**
- 表紙直後に、登場する3〜5概念のラベル付き図（用語の地図）。これは目次ではない。
- 各ビートの冒頭で「いま回収する予告」を1行（「先に出したBが、ここで効く」）。
- セクション末に、予告した項目のチェックリスト的回収（未回収を残さない）。
- 専門用語の初出は図中ラベルと同時。本文だけで定義しない。

---

### 1.6 近接（Spatial / Temporal contiguity）と分割注意

**出典**
- Split-attention effect: 図と対応テキストが離れていると、心的統合が外生的負荷になる（Chandler & Sweller 1991/1992）  
  https://en.wikipedia.org/wiki/Split_attention_effect
- Ginns (2006) メタ分析: 空間的・時間的近接の加重平均 **d = 0.85**（N=2375, 50効果）  
  https://www.sciencedirect.com/science/article/abs/pii/S0959475206000806
- Ayres & Sweller, Cambridge Handbook の split-attention 章  
  https://www.cambridge.org/core/books/cambridge-handbook-of-multimedia-learning/splitattention-principle-in-multimedia-learning/194CBCD1A3C911116CCB5F403AC7E415

**要点**  
動画が強い最大の物理理由は、ナレーターが「今動いている箇所」を同時に語ること（時間的近接）。文書の「図は上、説明は3画面下」「注釈は巻末」は、分割注意の典型。読者は図を作業記憶に保持したまま本文を読み、対応箇所を探しに戻る。

**静的 HTML への適用形**
- 図と1文キャプションを同じ `<figure>` に入れ、画面内で同時に見える幅に収める。
- 凡例を図の下にまとめず、線のそばに直接ラベルする。
- 「詳細は後述」を原則禁止。後述するなら、その場に1行のプレースホルダとアンカーを残す。
- 横スクロール表や別タブ参照を、本筋の理解に必須にしない。

---

## 2. Narrative transportation（物語没入）と説明文書への転用

**出典**
- Green & Brock (2000) *The Role of Transportation in the Persuasiveness of Public Narratives*, JPSP  
  https://pubmed.ncbi.nlm.nih.gov/11079236/  
  doi: https://doi.org/10.1037/0022-3514.79.5.701
- Gerrig (1993) *Experiencing Narrative Worlds*（「旅人」としての読者）
- van Laer, de Ruyter, Visconti & Wetzels (2014) Extended Transportation-Imagery Model メタ分析  
  https://www.jstor.org/stable/10.1086/673383  
  オープン版: https://openaccess.city.ac.uk/id/eprint/6755/1/SSRN-id2033192.pdf
- 概説: https://en.wikipedia.org/wiki/Transportation_theory_(psychology)
- Dahlstrom (2010/2012) 物語の因果が科学情報の受容を支える  
  https://journals.sagepub.com/doi/10.1177/0093650210362683
- 対抗仮説: 分析的説得（ELM）は論証の吟味、物語的説得は没入による態度変容。説明文書は両方を混ぜるとどちらも中途半端になる

**要点**  
Transportation は注意の収束＋感情＋心的イメージ＋現実からの一時離脱。測定は Green & Brock の15項目（後に短縮版）。没入すると反反論が減り、物語と一致する信念が残りやすい（sleeper effect の報告あり）。動画が強いのは、映像がイメージ生成を肩代わりし、因果の「次」が時間で強制されるから。

説明文書への転用で効くのは娯楽化ではない。効く部品は次の3つ。

1. **因果の鎖**（これが起きたから次が起きる）。羅列より「だから」。
2. **具体的な行為者**（パケット、リクエスト、現場の担当者）。抽象名詞のままではイメージが立たない。
3. **未解決の問いを先に置き、すぐ閉じない**（緊張→回収）。ただし「面白い余談」は coherence 原則（Harp & Mayer の seductive details）で学習を壊す。

**静的 HTML への適用形**
- 導入は結論のスローガンではなく、読者の世界で起きる1つの具体事件（インサイティング・インシデント）。
- 各セクションを「状況 → 障害 → 手段 → 結果」の4コマで組む。手段の図がそのセクションの唯一の図。
- 人称は you/we（personalization principle）。政策文の受動態は没入を殺す。
- 物語で説得し切らない。没入のあとに、検証可能な主張と出典を1ブロック置く（物語と論証を時間的に分ける）。
- 余談・エピソードは本筋の因果に接続できないなら切る（coherence）。

---

## 3. 静的媒体での再現技法

### 3.1 スクロール駆動の段階開示（Scrollytelling）

**出典**
- 定義（NZZ グラフィックスチーム）: スクロールしたとき、単なる文書移動以外が起きる形式  
  https://data.europa.eu/apps/data-visualisation-guide/scrollytelling-introduction
- 起源の実例: *New York Times* “Snow Fall” (2012)  
  http://www.nytimes.com/projects/2012/snow-fall/index.html
- 認知負荷の splain: 一度に3〜5チャンクしか持てないので「スプーンで渡す」。スクロールはビデオのスクラブに近く、全フレームが見える  
  https://nightingaledvs.com/the-past-present-and-future-of-scrollytelling/
- 批判: scrolljacking、アクセシビリティ、物語と形式の不一致（Kosara “Scrollytelling Scourge”）。離散ステップならタップ／1スワイプ1ステップの方が良い、という見解
- 5類型: graphic sequence / animated transition / pan-zoom / moviescroller / show-and-play（上掲 data.europa.eu）
- Segel & Heer (2010) *Narrative Visualization*: author-driven と reader-driven のスペクトル、Martini glass  
  https://pubmed.ncbi.nlm.nih.gov/20975152/  
  解説: https://data.europa.eu/apps/data-visualisation-guide/martini-glass-story-structure

**要点**  
Scrollytelling の学習科学的中身は、segmenting + signaling + temporal contiguity のセットである。図を固定し、キャプションを1〜2文ずつ流し、図の強調だけを更新する。読者は「今見るべき1点」以外を処理しなくてよい。Martini glass は、最初は作者が道を決め、理解が立ってから探索を渡す。

**静的 HTML への適用形（JS を最小にするなら）**
- 同一図をセクションごとに複製せず、sticky 図＋短いキャプション列。CSS `position: sticky` で足りることが多い。
- 1スクロール停止 = 図の1変化（色・注釈・1要素の追加）。2変化以上を同時にしない。
- 動きが作れない静的印刷相当でも、**コマの並び**（次項）で同等の分節ができる。動かす必然がないなら動かさない（coherence / immersion 原則: 臨場感は学習を保証しない）。
- 探索UI（フィルタ等）は理解の後。冒頭に置かない（Martini glass の脚→ボウル）。

---

### 3.2 コマ割り（Comic strips / Data comics / Coding strips）

**出典**
- Biermann & Cole (1999) *Comic Strips for Algorithm Visualization*（BST / splay tree をフレーム列で見せ、2フレーム同時表示で差分を読む）  
  https://cs.nyu.edu/media/publications/TR1999-778.pdf
- Suh et al., *Coding Strip*: 抽象的な実行過程を漫画のコマで具体化。教科書の補資源としてデータ構造説明に使いたい、という学習者コメント  
  https://edithlaw.ca/papers/codingstrip_vlhcc.pdf  
  https://uwaterloo.ca/math/news/coding-strip-uses-comic-strip-teach-coding
- Bach ら Data Comics: パネル・順序・言葉＋絵という漫画の約束事を、インタラクションなしの静的媒体に載せる  
  https://aviz.fr/~bbach/homepage/topics/datacomics/  
  *Design Patterns for Data Comics*, CHI 2018  
  https://dl.acm.org/doi/abs/10.1145/3173574.3173612
- McCloud の sequential art（隣接コマの隙間＝closure を読者が埋める）が、生成的処理（統合）を強制する

**要点**  
コマは動画のフレームを **同時に並列展示** したものである。差分が見える（small multiples でもある）。一過性がない。学習者は前のコマに目を戻せる。アルゴリズム説明で強いのは、「状態の変化」が本質だから。漫画の吹き出しは、ナレーションを視覚チャネルに載せるが、図と空間的に統合されているので split-attention が小さい。

**静的 HTML への適用形**
- プロセス・プロトコル・状態機械は、長文→1枚の複雑図ではなく、3〜6コマの横／縦列。
- 各コマ: 図の変化1つ + 吹き出し1文（40字以内）。コマ番号を明示。
- 2コマを同時に視野に入れる幅にする（Biermann の「2フレーム窓」）。差分比較が学習そのもの。
- 最後のコマで「欠片」を残し、読者に次状態を予測させる（Suh の参加者提案 = 生成的活動）。

---

### 3.3 Guided tour パターン

**出典**
- Nielsen, *Progressive Disclosure* (2006): 最初は少数の重要操作、詳細は要求時  
  https://www.nngroup.com/articles/progressive-disclosure/
- 同稿の staged disclosure（ウィザード）: タスクを線形ステップに切る。相互依存ステップを分割すると失敗する
- 製品ツアー実務: 1ステップ1要素、スポットライト、すぐ終わる。情報を詰め込むと認知負荷が上がる  
  https://www.appcues.com/blog/build-effective-product-tours
- 2026 の HCI 報告: 段階開示は認知負荷を統制しても「分かった感」を上げる（Userpilot が引用する Anik & Bunt）  
  https://userpilot.com/blog/progressive-disclosure-examples/

**要点**  
ツアーは動画の「ナレーターが画面を指す」を、UI上の逐次スポットライトにしたもの。学習科学的には signaling + segmenting + pre-training。失敗モードは12ステップ強制ツアー（情報の消防ホース）。Nielsen は2段階を超える開示階層で迷子が増えると注意している。

**静的 HTML への適用形**
- 文書全体をツアーにしない。複雑な1図だけを「ステップ 1/4」で順に注釈する。
- 各ステップ: 図の該当箇所を残し、他を薄くする + 30字の指示。戻る／進むを同じ場所に固定。
- 本文の本線はツアーなしで読める（ツアーは opt-in）。印刷・読み上げでも成立するよう、同じ内容をコマ割りでも持たせる。
- 相互に行き来が必要な比較（料金×条件など）は1画面に同居させる。ウィザードに切らない（Nielsen のホテル予約の教訓）。

---

### 3.4 図と本文の交互リズム

**出典**
- Multimedia principle: 言葉＋関連する絵は言葉だけより深い学習（CTML の出発点）
- Spatial contiguity / split-attention（§1.6）
- 教科書研究の定石: 図の直後に「図が言っていること」を1文。図だけが情報を持つ状態を作らない
- Tufte の small multiples: 同じ枠で1変数だけ変えると、読者は探索コストなしで差分を読む

**要点**  
悪い文書は「本文壁 → 図がどんと → また本文壁」。視線が往復し、統合が読者持ち。良い動画は、常に映像が主、言葉が従、でリズムが一定。交互リズムとは、**ビートごとに「図が先、1文が後」** を繰り返すこと。図は装飾ではなく、そのビートの主張の担い手。

**静的 HTML への適用形**
- スクロール900px前後に視覚要素を1つ（図・表・カード）。ベタ段落だけの区間を作らない。
- 順序は「問い → 図 → 1文の読み方 → 次の問い」。図の前に長い前置きを置かない。
- 図にしかない情報を作らない（検索・読み上げ不能）。逆に、図と同じことを本文で全文反復しない（redundancy）。
- 比較は文章の「一方／他方」より、2カラムまたは2コマ。

---

## 4. 「1画面 = 1ビート」と question chaining

### 4.1 1画面 = 1ビート

**出典（隣接領域の合成。単一の「1画面=1ビート」論文は見当たらない）**
- Segmenting（1チャンクずつ）+ Signaling（今の1点）+ Scrollytelling の「チャートは固定、文は1〜2文」
- 映画の beat: 状況が1つ変わる最小単位。画面に2変化があると、どちらが物語か分からない
- モバイルUXの「1画面1主行動」
- 確認済み: 上掲の Mayer segmenting、Nightingale の NYT コロナ比較（1本の線を順に強調）、NZZ の graphic sequence

**要点**  
ビートは「情報量」ではなく **変化の単位**。1画面で新しい用語と新しい因果と例外を同時に出すと、読者はどれがビートか分からない。動画編集はこれをカットで強制する。文書は見出しの粒度でしか切れないので、意図的に画面単位まで落とす必要がある。

**静的 HTML への適用形**
- セクションの完了条件を1つ書く（「この画面を読んだら、XがYを引き起こすと言える」）。2つ言えるなら分割。
- sticky 図を使うなら、キャプション1つにつき図の変更は1箇所。
- 例外・注記は次ビート。同一画面の脚注に逃がして本線を濁さない。
- 進捗は「3/7 ビート」のように、残量が感覚できる表示（動画のスクラブバー相当）。

---

### 4.2 質問→回答の連鎖（Question chaining）

**出典**
- Rothkopf の adjunct questions / mathemagenic activities: 本文中に挿入した質問が、標的情報の記憶を上げ、関連する非標的の吸収にも波及することがある  
  概説: https://steve.psy.gla.ac.uk/mathemagenic.html  
  Andy Matuschak のノート: https://notes.andymatuschak.org/z4m9Gat7zi9YUmZzQRR7pwt
- Chi の self-explanation effect: 学習中に自分へ説明する発話が、提示を超える推論を生成し理解を深める  
  Cambridge *Learning as a Generative Activity* ch.7  
  https://www.cambridge.org/core/books/learning-as-a-generative-activity/learning-by-selfexplaining/53D84D98390BE4C5C96C50371961018C
- Mayer 2021 の generative activity principle: 要約・自己説明・描画・教え返し
- Socratic questioning: 教師が答えを先に置かず、次の問いが前の答えから出る  
  https://tilt.colostate.edu/the-socratic-method/

**要点**  
動画の牽引は「次が気になる」構造、つまり未解決の問い。説明文書が退屈なのは、答えを先に積み、問いが事後についてくるから。Question chaining は、各ビートを **問い（予測）→ 図（証拠）→ 短い答え → 次の問い** にする。挿入質問は受動読みを mathemagenic な活動に変える。ただし質問が本文の復唱だと浅い。推論・統合を問う。

**静的 HTML への適用形**
- 各セクション見出しを疑問文にする（「なぜ字幕つき動画は逆に疲れるのか」）。答えは図の直後1文。
- 図の直前に、読者が1秒で予測できるプロンプト（「このとき作業記憶は何を保持しているか」）。直後に正解を出す。遅らせすぎない（動画のテンポ）。
- 3ビートに1回、自己説明欄（任意の1行入力、または頭の中で言わせる指示）。採点不要。生成的活動が目的。
- チェーンは分岐させすぎない。ハイパーリンクの脇道は本線のあとに置く（次節）。

---

## 5. 読者が迷子になる原因と対策

Conklin (1987) はハイパーテキストの2大病理を **disorientation（いまどこか分からない）** と **cognitive overhead（本文理解と経路計画の二重負荷）** と呼んだ。

**出典**
- Conklin, *Hypertext: An Introduction and Survey*, IEEE Computer (1987)  
  http://www.cognexus.org/Hypertext-_An_Introduction_and_Survey_%281987%29.pdf
- Amadieu et al. (2009): 非線形電子文書は高負荷・方向感覚喪失を起こしうる。事前知識と概観図が緩和  
  https://pmc.ncbi.nlm.nih.gov/articles/PMC7126386/
- Zumbach & Mohraz (2008): cognitive overhead をテキスト理解と CLT で再定義  
  https://www.sciencedirect.com/science/article/abs/pii/S074756320700060X
- グラフィカル・オーバービューが低空間能力・低事前知識の迷子を減らす系統の研究（Müller-Kalthoff & Möller など）
- Split-attention / 空間的近接（§1.6）: 「参照の往復」の認知的実体
- 動画との対比: 動画は「残り時間」と「今この瞬間」が常に見える。文書は全体の長さと現在地が見えないことが多い

### 5.1 コンテキスト喪失

**要点**  
作業記憶は直前の前提を保持できない。スクロールで導入が画面外に出た瞬間、読者は「何の話だったか」を失う。動画は画面下のスクラブと、ナレーターの再掲でこれを防ぐ。ハイパーテキストは経路計画がさらに枠を食う。

**HTML 対策**
- 画面上部に常時「いまの主張」1行（sticky kicker）。
- 長い文書ほど、Martini glass の脚＝線形の作者主導を長くする。途中の分岐リンクは減らす。
- セクション開始時に、直前ビートの結論を8〜12字で繰り返す（動画の「さて、さっきのX」）。

### 5.2 参照の往復

**要点**  
「図3を見よ」「注12」「別紙の表」。視線と作業記憶が往復するたびに統合が落ちる（split-attention, d≈0.85 の近接効果の裏返し）。

**HTML 対策**
- 参照先をその場に持ってくる。図は本文の該当ビートにインライン。
- どうしても離すなら、クリックでその場に展開（progressive disclosure）。別ページ遷移にしない。
- 用語は初出時に図中定義。用語集へ飛ばさない。

### 5.3 先の見えなさ

**要点**  
動画は残り時間が分かる。文書は「まだ本体なのか、もう応用なのか」が分からず、投資対効果の計算ができない。途中離脱と浅読みを招く。Advance organizer がないと、新情報を既存スキーマに接続する場所も分からない。

**HTML 対策**
- 冒頭で全体地図（3〜7ノード）と「いまここ」。進捗バーかステップ点。
- 各章の所要の感覚を「スクロール3画面」など物理量で示す（時間ではなく画面数。端末差が小さい）。
- 予告した回収ポイントを地図上でチェック済みにする。
- 詳細への扉は「読まなくても本線は閉じる」と明示する（Nielsen の secondary features）。

### 5.4 実例（確認済み）

| 実例 | 何を防いでいるか |
|---|---|
| NYT コロナ比較チャート（Nightingale が分析） | 1図を固定し、強調だけ更新。往復もコンテキスト喪失も起きない |
| Snow Fall | 章が映像的チャプター。ただし演出過多は coherence のリスク |
| FiveThirtyEight 銃死亡の12ステップ + 最後に探索（Martini glass） | 先が見える（12中の5）→理解後に自由 |
| Coding strip / algorithm comic | 状態をコマに残すので一過性も往復もない |
| 印刷ダイアログの「詳細設定」（Nielsen） | 本線を単純に保ち、迷子の階層を2段に制限 |
| グラフィカル・オーバービュー付きハイパーテキスト | 低事前知識の方向感覚喪失を減らす |

---

## 6. 設計原則（動画的理解を文書で作る7箇条）

1. **時間を空間に訳す。1画面の変化は1つ。**  
   カットの代わりにビューポートを使う。スクロールは Continue ボタンである。同時に用語・因果・例外を載せない。

2. **視線を代行する。今見る1点以外を消せ。**  
   矢印・番号・スポットライト・見出しの主張文。合図は稀少資源で、3点同時点灯は合図の自殺。

3. **言葉は図のとなりに置け。聴覚がないなら近接で代用する。**  
   無音 HTML はモダリティ効果を持てない。分割注意を殺すこと（図中ラベル、同一画面、キャプション1文）が正規の近似。離れ参照は往復コストそのもの。

4. **消すな。残して、戻せるようにせよ。**  
   文書の強みは永続性。sticky な図と「いまの結論」1行で、動画の一過性を裏返す。自動で情報を消すアニメは動画の弱点を輸入する。

5. **先に地図、あとに本編、終わりに回収。**  
   用語と全体像の pre-training、本編での因果、予告のチェックリスト。アジェンダの箇条書きは地図ではない。抽象度の高い橋（advance organizer）が要る。

6. **問いが次の画面を引っ張る。答えの山を先に積まない。**  
   見出しは疑問、図は証拠、1文が答え、次の問いがフック。時々、自己説明を1回挟む。物語の因果は使う。余談の物語は切る。

7. **いまどこか、あと何画面か、戻れるかを常に見せる。**  
   迷子の本体は内容の難しさではなく、経路計画が本文理解を食うこと。線形の本線、2段以上の階層を増やさない、探索は理解のあと（Martini glass）。

---

## 使ってはいけない転用（短い注意）

- **装飾的モーション / 背景音楽 / トーキングヘッド**: coherence / image 原則。学習を助けない。
- **ナレーション全文の画面表示**: redundancy。キャプションは opt-in。
- **scrolljacking**: 学習者ペースを奪い、一過性を再導入する。
- **12ステップ強制ツアー**: 分節の名を借りたホース。
- **seductive details**: 面白いが無関係な挿話は保持を下げる（Harp & Mayer）。
- **「動画の方が常に勝つ」という前提**: 一過性効果、画面読みの浅さ、自己ペース文書の再読可能性。MIT ILI の比較では読みと動画の正答率がほぼ並ぶ例もある  
  https://mitili.mit.edu/news/compared-reading-how-much-does-video-improve-learning-outcomes

---

## 方法

Web 検索を観点別に約20クエリ。Mayer CTML、Ginns メタ分析、Green & Brock、Conklin、scrollytelling、comic visualization、progressive disclosure、adjunct questions を優先してページ本文またはPDFを取得。効果量はメタ分析（Ginns 2005 d=0.72、Ginns 2006 d=0.85）のみ数値として採用。HTML への適用形は実験論文ではなく、原則からの設計推論である（確信度: 原理は確認済み、適用形は高確度の設計仮説）。単一ソースしかない主張（VTS、個別の製品ツアー事例）は一般化していない。
