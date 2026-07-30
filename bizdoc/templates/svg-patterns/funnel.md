# funnel — 段階的な絞り込み・歩留まり

用途: 3〜5段階の絞り込み（例: リード→商談→受注）を示す。**段の幅は件数に比例させない**（等比で
狭めるだけの模式図）。正確な歩留まり率は隣接する表で示す。

| 要素 | 上限 |
|---|---|
| 段数 | 3〜5 |
| 段ラベル | 全角8文字 + 数値 |

```svg
<svg viewBox="0 0 760 340" role="img">
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
  <g font-size="14" fill="var(--ink-2)">
    <text x="560" y="68">1,200件</text>
    <text x="560" y="142">450件</text>
    <text x="560" y="216">180件</text>
    <text x="560" y="290">60件</text>
  </g>
</svg>
```

調整ポイント:
- 段を増減するときは、上段から幅を約 0.8 倍ずつ狭める（本例: 520→410→326→260）。件数比に合わせて幅を変えない
- 正確な歩留まり率（%）は、この図の直後に段階表（件数・歩留まり列を持つ `<table>`）を置いて補う。図には数値ラベルのみ添える
- 最終段（最も絞り込まれた段）だけ `fill="var(--accent)"` にする。中間段は `var(--accent-soft)` で統一する
- ラベルは段の右側に「段名（15px）」「数値（14px・`var(--ink-2)`）」の2行で置く。段内に文字を入れると幅が狭い段で見切れるため避ける
