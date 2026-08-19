# コンポーネントカタログ（伝達目的で引く）

このカタログは「目的 → 表現の選択肢」の辞書であり、文書の章立て・順序を規定しない。
構成は毎回 Phase 0 の目的・読者から設計する。各ブロックには「なぜこのブロックが
目的・読者に効くか」(outline の why) が書けること。書けないブロックは置かない。
同じ目的でも表現は複数ある — 直前の文書と同じ表現に安易に収束させないこと。

## 数値表記のルール

数値（KPI・実績・比較値）を含むブロックには、必ず出典を `<p class="src">※ 出典: ...</p>` の形で
併記する。出典が「社内試算」のような概算値であっても省略しない。出典行はブロックの直後に置き、
複数の数値ブロックが同じ出典でもまとめて1箇所に書かず、各ブロックに明記する（後で数値だけが
切り離されて独り歩きするのを防ぐため）。

## 文書の骨格（参考・目的キーではない）

`.cover`（表紙相当）と `.exec-summary`（結論先出し）と `.conclusion`（終端の結論パネル — ダーク地。
exec-summary の各項を1行ずつ回収して環を閉じる）は特定の伝達目的ではなく文書の骨格に属するため、
下表には含めない。使い方は bizdoc スキル（skills/bizdoc/SKILL.md）の Phase 2/3 で扱う。

v2 では骨格・見出し回りに `.kicker`（表紙の細字ラベル）・`.sec-lede`（セクション見出し直下のリード文）・
`.cols-2`（2カラムの汎用グリッド）・`.card`（`.tag` 付きのカード単位）が加わり、`figure` の枠とキャプション
採番（「図N｜」）は自動で付く。下表の各表現もこれらのクラスを組み合わせて使ってよい。

以下、伝達目的ごとに表現を列挙する。SVG を使う表現は `svg-patterns/` の完全なスニペットを直接埋め込む
（`<img src>` は `:root` の CSS 変数を解決できないため使わない）。

注: 本カタログ内の SVG スニペット（timeline / matrix-2x2 / architecture / process-flow / funnel /
relation の6件）は `svg-patterns/*.md` の原本の逐語コピー。パターンファイルを編集したら本カタログの
対応スニペットも必ず同期すること（空白正規化後 diff 一致が受け入れ基準）。

---

## 比較させる

複数案を横に並べ、違いを目で追わせて選ばせたいときに使う。

### 表現1: `<table>`（`tr.pick` で推し行）

比較軸が4つ以上あり、数値中心で厳密に比較したいときに効く（行を横断して数値を読み比べられる）。

```html
<table>
  <thead>
    <tr><th>案</th><th>費用</th><th>導入期間</th><th>備考</th></tr>
  </thead>
  <tbody>
    <tr><td>A案: 一括導入</td><td>月額80万円</td><td>1ヶ月</td><td>初期費用なし</td></tr>
    <tr class="pick"><td>B案: 段階導入</td><td>月額50万円</td><td>2ヶ月</td><td>推奨</td></tr>
    <tr><td>C案: 自社開発</td><td>初期800万円</td><td>6ヶ月</td><td>保守体制が別途必要</td></tr>
  </tbody>
</table>
<p class="src">※ 出典: 社内見積り比較（2026年7月時点）</p>
```

### 表現2: `.compare-cols`（2カラム対比・`.pick`）

案が2つで、それぞれの背景や特徴を文章で説明したいときに効く（表よりも各案の文脈を語れる）。

```html
<div class="compare-cols">
  <div class="col">
    <h3>現行ツール継続</h3>
    <p>追加コストなし。ただし機能拡張は見込めない。</p>
  </div>
  <div class="col pick">
    <h3>新ツールへ移行</h3>
    <p>月額コストは増えるが、API連携で今後の拡張がしやすい（推奨）。</p>
  </div>
</div>
```

### 表現3: スコアカード表（◎○△×）

定性評価（コスト・スピード・拡張性など）を一覧化し、直感的に優劣を掴ませたいときに効く。

```html
<table>
  <thead><tr><th>評価軸</th><th>A案</th><th>B案</th><th>C案</th></tr></thead>
  <tbody>
    <tr><td>コスト</td><td>○</td><td>◎</td><td>△</td></tr>
    <tr><td>導入スピード</td><td>◎</td><td>○</td><td>×</td></tr>
    <tr><td>拡張性</td><td>△</td><td>○</td><td>◎</td></tr>
  </tbody>
</table>
```

---

## 時系列・計画を示す

いつ・何が起きるかを時間軸で追わせたいときに使う。

### 表現1: SVG タイムライン（`svg-patterns/timeline.md`）

マイルストーンが3〜6個程度で、日付と項目名だけで十分なときに効く（ガントより余白が多く読みやすい）。

```html
<figure>
  <svg viewBox="0 0 760 210" role="img">
    <title>導入スケジュール（4マイルストーン）</title>
    <line x1="40" y1="80" x2="720" y2="80" stroke="var(--line)" stroke-width="3"/>
    <g text-anchor="middle" font-size="14.5">
      <circle cx="120" cy="80" r="9" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <text x="120" y="55" fill="var(--ink-2)">8月</text>
      <text x="120" y="112" font-size="15" fill="var(--ink)">試験導入</text>
      <text x="120" y="132" fill="var(--ink-2)">対象:情シス部</text>

      <circle cx="300" cy="80" r="9" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <text x="300" y="55" fill="var(--ink-2)">9月上旬</text>
      <text x="300" y="112" font-size="15" fill="var(--ink)">利用者研修</text>
      <text x="300" y="132" fill="var(--ink-2)">全部門・半日</text>

      <circle cx="480" cy="80" r="9" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <text x="480" y="55" fill="var(--ink-2)">10月</text>
      <text x="480" y="112" font-size="15" fill="var(--ink)">全社展開</text>
      <text x="480" y="132" fill="var(--ink-2)">全社一斉移行</text>

      <circle cx="660" cy="80" r="10" fill="var(--accent)" stroke="var(--accent)" stroke-width="2"/>
      <text x="660" y="55" fill="var(--ink-2)">12月末</text>
      <text x="660" y="112" font-size="15" fill="var(--ink)">効果測定</text>
      <text x="660" y="132" fill="var(--ink-2)">KPI検証・報告</text>
    </g>
    <g font-size="14.5" fill="var(--ink-2)">
      <rect x="40" y="160" width="7" height="7" fill="var(--accent)"/>
      <text x="56" y="169">各マイルストーンの遅延は次工程着手前に必ず共有する</text>
      <rect x="40" y="184" width="7" height="7" fill="var(--accent)"/>
      <text x="56" y="193">最終マイルストーンのみ強調し、達成基準を明記する</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/timeline.md を参照</figcaption>
</figure>
```

### 表現2: `.steps` 番号付きリスト

日付よりも「順番」自体を強調したいとき、または時期がまだ確定していないときに効く。

```html
<ol class="steps">
  <li>要件整理</li>
  <li>試験導入</li>
  <li>全社展開</li>
  <li>定着運用</li>
</ol>
```

### 表現3: ガントに準ずる SVG（timeline の変形）

タスクの並行・重なりを見せたいとき（timeline は1点＝1マイルストーンなのでこの用途には向かない）。

```html
<figure>
  <svg viewBox="0 0 760 175" role="img">
    <title>導入スケジュール（ガント形式・3タスク）</title>
    <g font-size="15" fill="var(--ink)">
      <text x="20" y="50">要件整理</text>
      <text x="20" y="90">試験導入</text>
      <text x="20" y="130">全社展開</text>
    </g>
    <rect x="100" y="30" width="128" height="30" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="228" y="70" width="256" height="30" rx="6" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <rect x="484" y="110" width="256" height="30" rx="6" fill="var(--accent)" stroke="var(--accent)"/>
    <line x1="100" y1="145" x2="740" y2="145" stroke="var(--line)" stroke-width="2"/>
    <g stroke="var(--ink-2)" stroke-width="1">
      <line x1="100" y1="142" x2="100" y2="148"/>
      <line x1="228" y1="142" x2="228" y2="148"/>
      <line x1="356" y1="142" x2="356" y2="148"/>
      <line x1="484" y1="142" x2="484" y2="148"/>
      <line x1="612" y1="142" x2="612" y2="148"/>
      <line x1="740" y1="142" x2="740" y2="148"/>
    </g>
    <g font-size="14.5" fill="var(--ink-2)" text-anchor="middle">
      <text x="164" y="163">8月</text>
      <text x="292" y="163">9月</text>
      <text x="420" y="163">10月</text>
      <text x="548" y="163">11月</text>
      <text x="676" y="163">12月</text>
    </g>
  </svg>
  <figcaption>タスクの並行区間をバーで示したガント変形（timeline パターンの応用）</figcaption>
</figure>
```

このガント変形は独立パターンファイルを持たない（timeline の応用のため）。marker を使わないので id 衝突の
心配はないが、他パターンと同一文書に置くときは軸のラベル位置が重ならないか確認する。

---

## 判断を促す

複数の選択肢から意思決定してもらいたいときに使う。

### 表現1: `.callout` 推奨ボックス + 選択肢表

推奨案とその理由を一言で言い切り、選択肢の一覧を添えたいときに効く。

```html
<div class="callout">
  <strong>推奨: B案（段階導入）</strong> — 初期投資を抑えつつ2ヶ月で効果を検証できるため。
</div>
<table>
  <thead><tr><th>選択肢</th><th>概要</th></tr></thead>
  <tbody>
    <tr><td>A案</td><td>一括導入</td></tr>
    <tr class="pick"><td>B案</td><td>段階導入</td></tr>
    <tr><td>C案</td><td>現状維持</td></tr>
  </tbody>
</table>
```

### 表現2: SVG 2x2マトリクス（`svg-patterns/matrix-2x2.md`）

「効果」「難易度」のように2軸で選択肢を分類し、優先順位を視覚的に納得させたいときに効く。

```html
<figure>
  <svg viewBox="0 0 760 600" role="img">
    <title>施策の優先度マトリクス（効果 × 実現難易度）</title>
    <rect x="150" y="60" width="460" height="420" fill="none" stroke="var(--line)" stroke-width="2"/>
    <rect x="150" y="60" width="230" height="210" fill="var(--accent-soft)"/>
    <rect x="380" y="60" width="230" height="210" fill="var(--bg-soft)"/>
    <rect x="150" y="270" width="230" height="210" fill="var(--bg-soft)"/>
    <rect x="380" y="270" width="230" height="210" fill="var(--bg-soft)"/>
    <line x1="380" y1="60" x2="380" y2="480" stroke="var(--line)" stroke-width="2"/>
    <line x1="150" y1="270" x2="610" y2="270" stroke="var(--line)" stroke-width="2"/>

    <g font-size="14.5" fill="var(--ink-2)">
      <text x="265" y="505" text-anchor="middle">低い</text>
      <text x="495" y="505" text-anchor="middle">高い</text>
      <text x="380" y="530" text-anchor="middle">実現難易度</text>
      <text x="130" y="165" text-anchor="end">高い</text>
      <text x="130" y="375" text-anchor="end">低い</text>
      <text x="60" y="270" text-anchor="middle" transform="rotate(-90 60 270)">効果</text>
    </g>

    <g font-size="14.5" fill="var(--ink)">
      <text x="165" y="90" font-size="15" font-weight="bold">即着手</text>
      <text x="165" y="118">受発注自動化</text>
      <text x="165" y="142">帳票電子化</text>

      <text x="395" y="90" font-size="15" font-weight="bold">計画実施</text>
      <text x="395" y="118">基幹刷新</text>
      <text x="395" y="142">API連携基盤</text>

      <text x="165" y="300" font-size="15" font-weight="bold">小規模改善</text>
      <text x="165" y="328">画面表示改善</text>

      <text x="395" y="300" font-size="15" font-weight="bold">見送り候補</text>
      <text x="395" y="328">旧基盤再構築</text>
    </g>

    <g font-size="14.5" fill="var(--ink-2)">
      <rect x="150" y="552" width="7" height="7" fill="var(--accent)"/>
      <text x="166" y="561">即着手の象限から優先的に着手し、四半期ごとに再評価する</text>
      <rect x="150" y="576" width="7" height="7" fill="var(--accent)"/>
      <text x="166" y="585">見送り候補は要件が固まるまで再検討を保留する</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/matrix-2x2.md を参照</figcaption>
</figure>
```

### 表現3: ゲート/対比カード（`.cols-2` + `.card` + `.tag`）

通過条件（GO）と保留条件をカードで並べ、次フェーズに進めるかを一目で判断させたいときに効く
（`.callout` + 表よりも、条件を主語ごとにカード分けして読ませられる）。

```html
<div class="cols-2">
  <div class="card pick">
    <h3>次フェーズへ進む <span class="tag">GO</span></h3>
    <ul>
      <li>一次回答時間: 6.0時間→1.5時間に短縮</li>
      <li>利用部門から重大な障害報告なし</li>
      <li>追加予算は既存枠内で確保済み</li>
    </ul>
  </div>
  <div class="card">
    <h3>保留条件</h3>
    <ul>
      <li>試験期間中にエラー率が5%を超えた場合</li>
      <li>対象部門の利用率が50%を下回る場合</li>
    </ul>
  </div>
</div>
```

---

## 根拠・数値を示す

主張の裏付けとなる数値を見せ、信頼させたいときに使う。

### 表現1: `.kpi-grid`（`.src` で出典必須）

数値を大きく見せて印象づけたいとき、KPIが3〜4個程度で並列に並ぶときに効く。

```html
<div class="kpi-grid">
  <div class="kpi">
    <div class="value">42%</div>
    <div class="label">問い合わせ削減率</div>
    <p class="src">※ 出典: 社内試算（2026年7月時点）</p>
  </div>
  <div class="kpi">
    <div class="value">1.5h</div>
    <div class="label">一次回答時間</div>
    <p class="src">※ 出典: 社内試算（2026年7月時点）</p>
  </div>
</div>
```

### 表現2: 出典付き `<table>`

導入前後の比較など、数値どうしの対応関係を正確に読ませたいときに効く。

```html
<table>
  <thead><tr><th>指標</th><th>導入前</th><th>導入後</th></tr></thead>
  <tbody>
    <tr><td>一次回答時間</td><td>6.0時間</td><td>1.5時間</td></tr>
    <tr><td>問い合わせ件数</td><td>320件/月</td><td>310件/月</td></tr>
  </tbody>
</table>
<p class="src">※ 出典: 社内試算（2026年7月時点）</p>
```

---

## 全体像を掴ませる

詳細に入る前に、読者に地図を渡したいときに使う。

### 表現1: SVG 構成図（`svg-patterns/architecture.md`）

システムや組織を層構造で見せ、要素間の連携を含めて俯瞰させたいときに効く。

```html
<figure>
  <svg viewBox="0 0 780 446" role="img">
    <title>システム構成（3層）</title>
    <defs>
      <marker id="ar-arch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/>
      </marker>
    </defs>
    <g font-size="14.5">
      <rect x="20" y="18" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
      <text x="36" y="42" fill="var(--ink-2)" font-weight="700">画面層</text>
      <rect x="160" y="54" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="270" y="75" text-anchor="middle" fill="var(--ink)" font-size="15">Web ブラウザ</text>
      <text x="270" y="95" text-anchor="middle" fill="var(--ink-2)">社内ポータル経由</text>
      <rect x="400" y="54" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="510" y="75" text-anchor="middle" fill="var(--ink)" font-size="15">モバイル</text>
      <text x="510" y="95" text-anchor="middle" fill="var(--ink-2)">現場端末</text>
      <path d="M390 122 v26" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar-arch)"/>
      <text x="404" y="140" fill="var(--ink-2)">HTTPS</text>
      <rect x="20" y="152" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
      <text x="36" y="176" fill="var(--ink-2)" font-weight="700">業務ロジック層</text>
      <rect x="70" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="170" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">API 連携</text>
      <text x="170" y="229" text-anchor="middle" fill="var(--ink-2)">外部 SaaS 接続</text>
      <rect x="290" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="390" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">認証処理</text>
      <text x="390" y="229" text-anchor="middle" fill="var(--ink-2)">SSO・権限判定</text>
      <rect x="510" y="188" width="200" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="610" y="209" text-anchor="middle" fill="var(--ink)" font-size="15">業務ルール</text>
      <text x="610" y="229" text-anchor="middle" fill="var(--ink-2)">承認フロー</text>
      <path d="M390 256 v26" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar-arch)"/>
      <text x="404" y="274" fill="var(--ink-2)">SQL</text>
      <rect x="20" y="286" width="740" height="104" rx="10" fill="var(--bg-soft)" stroke="var(--line-strong)"/>
      <text x="36" y="310" fill="var(--ink-2)" font-weight="700">データ層</text>
      <rect x="160" y="322" width="220" height="52" rx="8" fill="var(--accent)" stroke="var(--accent)"/>
      <text x="270" y="343" text-anchor="middle" fill="#ffffff" font-size="15">基幹 DB</text>
      <text x="270" y="363" text-anchor="middle" fill="#ffffff">データの実体</text>
      <rect x="400" y="322" width="220" height="52" rx="8" fill="var(--bg)" stroke="var(--accent)"/>
      <text x="510" y="343" text-anchor="middle" fill="var(--ink)" font-size="15">外部連携</text>
      <text x="510" y="363" text-anchor="middle" fill="var(--ink-2)">日次ファイル連携</text>
      <rect x="20" y="408" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="417" fill="var(--ink-2)">全経路が認証処理（SSO）を経由する — 直接 DB へ到達する経路はない</text>
      <rect x="20" y="432" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="441" fill="var(--ink-2)">バックアップは日次・別リージョン保管</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/architecture.md を参照</figcaption>
</figure>
```

### 表現2: 3カラムサマリ（`.compare-cols` 3列変形）

背景・取り組み・効果のように時系列でない3点を並列に要約したいときに効く。`.compare-cols` は既定で
2カラムなので、`style` で列数だけ上書きする（tokens.css 自体は変更しない）。

```html
<div class="compare-cols" style="grid-template-columns: repeat(3, 1fr);">
  <div class="col">
    <h3>背景</h3>
    <p>問い合わせ対応の一次回答に平均6時間かかっていた。</p>
  </div>
  <div class="col">
    <h3>取り組み</h3>
    <p>FAQ検索とテンプレート返信をAIが提案するツールを試験導入した。</p>
  </div>
  <div class="col pick">
    <h3>効果</h3>
    <p>一次回答までの時間を平均1.5時間に短縮した（推奨継続）。</p>
    <p class="src">※ 出典: 社内試算（2026年7月時点）</p>
  </div>
</div>
```

---

## 手順を追わせる

作業を一歩ずつ実行させたい、または実行済みの手順を追体験させたいときに使う。

### 表現1: `.steps`

手順が本文中に自然に埋め込まれ、図として独立させるほどではないときに効く。

```html
<ol class="steps">
  <li>要件整理</li>
  <li>試験導入</li>
  <li>全社展開</li>
  <li>定着運用</li>
</ol>
```

### 表現2: SVG プロセスフロー（`svg-patterns/process-flow.md`）

手順そのものを図として独立させ、視認性を高めたいとき、または資料の顔として見せたいときに効く。

```html
<figure>
  <svg viewBox="0 0 780 172" role="img">
    <title>導入プロセス（4ステップ）</title>
    <defs>
      <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/>
      </marker>
    </defs>
    <g font-size="14.5">
      <circle cx="98" cy="44" r="22" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="98" y="50" text-anchor="middle" fill="var(--accent)" font-weight="700" font-size="15">1</text>
      <circle cx="293" cy="44" r="22" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="293" y="50" text-anchor="middle" fill="var(--accent)" font-weight="700" font-size="15">2</text>
      <circle cx="488" cy="44" r="22" fill="var(--accent-soft)" stroke="var(--accent)"/>
      <text x="488" y="50" text-anchor="middle" fill="var(--accent)" font-weight="700" font-size="15">3</text>
      <circle cx="683" cy="44" r="22" fill="var(--accent)" stroke="var(--accent)"/>
      <text x="683" y="50" text-anchor="middle" fill="#ffffff" font-weight="700" font-size="15">4</text>
      <path d="M126 44 h134" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar)"/>
      <path d="M321 44 h134" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar)"/>
      <path d="M516 44 h134" stroke="var(--ink-2)" stroke-width="1.6" fill="none" marker-end="url(#ar)"/>
      <text x="98" y="92" text-anchor="middle" fill="var(--ink)" font-size="15">要件整理</text>
      <text x="293" y="92" text-anchor="middle" fill="var(--ink)" font-size="15">試験導入</text>
      <text x="488" y="92" text-anchor="middle" fill="var(--ink)" font-size="15">全社展開</text>
      <text x="683" y="92" text-anchor="middle" fill="var(--ink)" font-size="15">定着運用</text>
      <rect x="23" y="108" width="150" height="30" rx="6" fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="98" y="128" text-anchor="middle" fill="var(--ink-2)">要求一覧</text>
      <rect x="218" y="108" width="150" height="30" rx="6" fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="293" y="128" text-anchor="middle" fill="var(--ink-2)">1部門・2週間</text>
      <rect x="413" y="108" width="150" height="30" rx="6" fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="488" y="128" text-anchor="middle" fill="var(--ink-2)">全部門</text>
      <rect x="608" y="108" width="150" height="30" rx="6" fill="var(--bg-soft)" stroke="var(--line)"/>
      <text x="683" y="128" text-anchor="middle" fill="var(--ink-2)">定例レビュー</text>
      <rect x="23" y="152" width="7" height="7" fill="var(--accent)"/>
      <text x="39" y="161" fill="var(--ink-2)">移行期間中は旧手順と並行運用し、問題があれば1ステップ戻す</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/process-flow.md を参照</figcaption>
</figure>
```

---

## 注意を促す

見落とすとまずいこと・確認が必要なことを目立たせたいときに使う。

### 表現1: `.callout-warn`

短い注意事項を本文の流れの中で目立たせたいときに効く。

```html
<div class="callout-warn">
  <strong>注意:</strong> 全社展開の前にログイン権限の棚卸しが未完了。情報システム部の確認が必要。
</div>
```

### 表現2: リスク表（発生可能性 × 影響）

複数のリスクを列挙し、優先して対処すべきものを一覧で判断させたいときに効く。

```html
<table>
  <thead><tr><th>リスク</th><th>発生可能性</th><th>影響</th></tr></thead>
  <tbody>
    <tr><td>権限設定の不備</td><td>中</td><td>大</td></tr>
    <tr><td>利用者の定着遅れ</td><td>高</td><td>中</td></tr>
  </tbody>
</table>
```

---

## 規模感・絞り込みを示す

母数からどれだけ絞り込まれるか、規模の縮小・拡大を直感的に見せたいときに使う。

### 表現1: SVG ファネル（`svg-patterns/funnel.md`）

段階を経て件数が絞り込まれていく様子を模式図として見せたいときに効く（正確な比率は表で補う）。

```html
<figure>
  <svg viewBox="0 0 760 380" role="img">
    <title>商談ファネル（問い合わせから受注まで）</title>
    <g stroke="var(--accent)" stroke-width="2">
      <rect x="20" y="20" width="520" height="64" fill="var(--accent-soft)"/>
      <rect x="75" y="94" width="410" height="64" fill="var(--accent-soft)"/>
      <rect x="117" y="168" width="326" height="64" fill="var(--accent-soft)"/>
      <rect x="150" y="242" width="260" height="64" fill="var(--accent)"/>
    </g>
    <g font-size="15" fill="var(--ink)">
      <text x="560" y="46">問い合わせ</text>
      <text x="560" y="120">商談</text>
      <text x="560" y="194">提案</text>
      <text x="560" y="268">受注</text>
    </g>
    <g font-size="14.5" fill="var(--ink-2)">
      <text x="560" y="68">1,200件</text>
      <text x="560" y="142">450件</text>
      <text x="560" y="216">180件</text>
      <text x="560" y="290">60件</text>
    </g>
    <g font-size="14.5" fill="var(--ink-2)">
      <rect x="20" y="326" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="335">段の幅は件数比ではなく等比の模式表現である</text>
      <rect x="20" y="350" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="359">正確な歩留まり率は隣接する段階表で確認する</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/funnel.md を参照</figcaption>
</figure>
```

### 表現2: 段階表

正確な歩留まり率（%）まで含めて数値で読ませたいときに効く。SVG ファネルと併用してもよい。

```html
<table>
  <thead><tr><th>段階</th><th>件数</th><th>歩留まり</th></tr></thead>
  <tbody>
    <tr><td>問い合わせ</td><td>1,200件</td><td>100%</td></tr>
    <tr><td>商談</td><td>450件</td><td>38%</td></tr>
    <tr><td>提案</td><td>180件</td><td>15%</td></tr>
    <tr class="pick"><td>受注</td><td>60件</td><td>5%</td></tr>
  </tbody>
</table>
<p class="src">※ 出典: 社内試算（2026年7月時点）</p>
```

---

## 関係・体制を示す

誰と誰がどう関わっているか、体制・役割分担を1枚で示したいときに使う。

### 表現1: SVG 関係図（`svg-patterns/relation.md`）

中心（事務局等）と周辺関係者のつながりを、線とラベルで視覚的に見せたいときに効く。

```html
<figure>
  <svg viewBox="0 0 760 510" role="img">
    <title>推進体制図（事務局中心の関係）</title>
    <g stroke="var(--ink-2)" stroke-width="2">
      <line x1="380" y1="250" x2="380" y2="65"/>
      <line x1="380" y1="250" x2="556" y2="193"/>
      <line x1="380" y1="250" x2="489" y2="400"/>
      <line x1="380" y1="250" x2="271" y2="400"/>
      <line x1="380" y1="250" x2="204" y2="193"/>
    </g>

    <g>
      <rect x="360" y="147" width="40" height="22" rx="5" fill="var(--bg)" stroke="var(--line)"/>
      <rect x="448" y="211" width="40" height="22" rx="5" fill="var(--bg)" stroke="var(--line)"/>
      <rect x="415" y="314" width="40" height="22" rx="5" fill="var(--bg)" stroke="var(--line)"/>
      <rect x="306" y="314" width="40" height="22" rx="5" fill="var(--bg)" stroke="var(--line)"/>
      <rect x="272" y="211" width="40" height="22" rx="5" fill="var(--bg)" stroke="var(--line)"/>
    </g>
    <g font-size="14.5" text-anchor="middle" fill="var(--ink-2)">
      <text x="380" y="163">報告</text>
      <text x="468" y="227">要望</text>
      <text x="435" y="330">連携</text>
      <text x="326" y="330">委託</text>
      <text x="292" y="227">支援</text>
    </g>

    <circle cx="380" cy="250" r="56" fill="var(--accent)"/>
    <g text-anchor="middle" fill="#ffffff">
      <text x="380" y="246" font-size="15">推進事務局</text>
      <text x="380" y="264" font-size="14.5">全体進行管理</text>
    </g>

    <g>
      <circle cx="380" cy="65" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <circle cx="556" cy="193" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <circle cx="489" cy="400" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <circle cx="271" cy="400" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
      <circle cx="204" cy="193" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    </g>
    <g text-anchor="middle">
      <text x="380" y="61" font-size="15" fill="var(--ink)">経営層</text>
      <text x="380" y="79" font-size="14.5" fill="var(--ink-2)">投資判断</text>
      <text x="556" y="189" font-size="15" fill="var(--ink)">利用部門</text>
      <text x="556" y="207" font-size="14.5" fill="var(--ink-2)">現場適用</text>
      <text x="489" y="396" font-size="15" fill="var(--ink)">情シス部</text>
      <text x="489" y="414" font-size="14.5" fill="var(--ink-2)">運用管理</text>
      <text x="271" y="396" font-size="15" fill="var(--ink)">外部ベンダー</text>
      <text x="271" y="414" font-size="14.5" fill="var(--ink-2)">開発支援</text>
      <text x="204" y="189" font-size="15" fill="var(--ink)">監査部門</text>
      <text x="204" y="207" font-size="14.5" fill="var(--ink-2)">統制確認</text>
    </g>

    <g font-size="14.5" fill="var(--ink-2)">
      <rect x="20" y="456" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="465">推進事務局が窓口となり、部門間の直接のやり取りを整理する</text>
      <rect x="20" y="480" width="7" height="7" fill="var(--accent)"/>
      <text x="36" y="489">エッジラベルは関係の種類を表し、実務上の指示系統ではない</text>
    </g>
  </svg>
  <figcaption>ラベル上限・調整方法は svg-patterns/relation.md を参照</figcaption>
</figure>
```

### 表現2: 役割分担表

図にするほど関係が複雑でない、または責務の文言を正確に書き分けたいときに効く。

```html
<table>
  <thead><tr><th>役割</th><th>担当</th><th>責務</th></tr></thead>
  <tbody>
    <tr><td>推進事務局</td><td>情報システム部</td><td>全体調整・進捗管理</td></tr>
    <tr><td>意思決定</td><td>経営層</td><td>投資判断・優先度決定</td></tr>
    <tr><td>利用促進</td><td>利用部門</td><td>現場定着・研修</td></tr>
  </tbody>
</table>
```
