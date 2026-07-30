# matrix-2x2 — 2軸マトリクスによる分類・判断

用途: 2つの評価軸（例: 効果 × 実現難易度）で選択肢を4象限に分類し、着手優先度の判断を促す。

| 要素 | 上限 |
|---|---|
| 軸ラベル | 全角8文字 |
| 象限内要素 | 各象限 1〜3 個・全角10文字 |

```svg
<svg viewBox="0 0 760 560" role="img">
  <title>施策の優先度マトリクス（効果 × 実現難易度）</title>
  <rect x="150" y="60" width="460" height="420" fill="none" stroke="var(--line)" stroke-width="2"/>
  <rect x="150" y="60" width="230" height="210" fill="var(--accent-soft)"/>
  <rect x="380" y="60" width="230" height="210" fill="var(--bg-soft)"/>
  <rect x="150" y="270" width="230" height="210" fill="var(--bg-soft)"/>
  <rect x="380" y="270" width="230" height="210" fill="var(--bg-soft)"/>
  <line x1="380" y1="60" x2="380" y2="480" stroke="var(--line)" stroke-width="2"/>
  <line x1="150" y1="270" x2="610" y2="270" stroke="var(--line)" stroke-width="2"/>

  <g font-size="14" fill="var(--ink-2)">
    <text x="265" y="505" text-anchor="middle">低い</text>
    <text x="495" y="505" text-anchor="middle">高い</text>
    <text x="380" y="530" text-anchor="middle">実現難易度</text>
    <text x="130" y="165" text-anchor="end">高い</text>
    <text x="130" y="375" text-anchor="end">低い</text>
    <text x="60" y="270" text-anchor="middle" transform="rotate(-90 60 270)">効果</text>
  </g>

  <g font-size="14" fill="var(--ink)">
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
</svg>
```

調整ポイント:
- 推し象限（着手すべき象限）だけ `fill="var(--accent-soft)"` にする。他の3象限は `fill="var(--bg-soft)"` で揃え、複数象限を同時に強調しない
- 象限内要素は 1〜3 個まで。増えるときは象限の高さ210を広げるか、表（段階表・役割分担表）に分割する
- 軸タイトルは軸の外側（下辺・左辺）に置き、象限ラベルと重ならない位置（下辺は y=530、左辺は `rotate(-90)` で縦書き）を保つ
- 軸の「低い/高い」の向きは業務文脈に合わせて左右・上下を入れ替えてよいが、推し象限の位置と矛盾しないか必ず確認する
