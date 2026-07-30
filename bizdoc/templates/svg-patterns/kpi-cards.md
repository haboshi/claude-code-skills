# kpi-cards — 数値カード（委譲ページ・SVG を使わない）

用途: KPI・実績数値をカード状に並べて見せる。**この用途は SVG で描かない**。

数値カードは HTML の `.kpi-grid` / `.kpi` を使う。理由:

- ブラウザ内テキスト検索・コピー&ペーストができる（SVG の `<text>` は選択できるが検索性が劣る）
- 印刷・拡大時にレイアウト崩れが起きにくい（`.kpi-grid` は `repeat(auto-fit, minmax(...))` でカード数に応じて自動折返しする）
- 数値の出典（`.src`）をカード内に構造化して持てる

## 使い方（tokens.css の実クラス）

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
  <div class="kpi">
    <div class="value">60件</div>
    <div class="label">月間受注件数</div>
    <p class="src">※ 出典: 社内試算（2026年7月時点）</p>
  </div>
</div>
```

調整ポイント:
- カード数は 3〜4 枚が読みやすい。5枚を超えるなら KPI を絞るか、優先度の高い順に並べて折返しに任せる
- `.value` は短い数値・単位のみ（長い文章を入れない）。補足説明は `.label` または本文側に出す
- 出典（`.src`）は必ず添える。出典が同じカードが並ぶ場合でも省略せず各カードに明記する（1箇所にまとめて後で切り離されると数値だけが独り歩きするため）
- 数値を目立たせたい・カード間の大小比較を視覚的に強調したい場合でも、棒グラフ的な SVG 化はしない。比較を見せたいなら「比較させる」目的（components.md）の表現を使う
