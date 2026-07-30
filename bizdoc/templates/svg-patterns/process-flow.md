# process-flow — 手順・工程の流れ

用途: 3〜6 ステップの直線的なプロセス・フローを示す。分岐が要るなら relation を使う。

| 要素 | 上限 |
|---|---|
| ステップ数 | 3〜6 |
| ステップ名 | 全角6文字 |
| 補足ラベル | 全角10文字（省略可） |

```svg
<svg viewBox="0 0 760 120" role="img">
  <title>導入プロセス（4ステップ）</title>
  <g font-size="15" text-anchor="middle">
    <rect x="10" y="30" width="150" height="52" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="85" y="61" fill="var(--ink)">要件整理</text>
    <path d="M168 56 h24" stroke="var(--ink-2)" stroke-width="2" marker-end="url(#ar)"/>
    <rect x="200" y="30" width="150" height="52" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="275" y="61" fill="var(--ink)">試験導入</text>
    <path d="M358 56 h24" stroke="var(--ink-2)" stroke-width="2" marker-end="url(#ar)"/>
    <rect x="390" y="30" width="150" height="52" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="465" y="61" fill="var(--ink)">全社展開</text>
    <path d="M548 56 h24" stroke="var(--ink-2)" stroke-width="2" marker-end="url(#ar)"/>
    <rect x="580" y="30" width="150" height="52" rx="8" fill="var(--accent)" stroke="var(--accent)"/>
    <text x="655" y="61" fill="#ffffff">定着運用</text>
  </g>
  <defs>
    <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/>
    </marker>
  </defs>
</svg>
```

調整ポイント:
- ステップ数を変えるときは `viewBox` 幅 = ステップ数 × 190 - 30 を目安に再計算する
- 強調したいステップだけ `fill="var(--accent)"` + 白文字にする（複数を強調しない）
- 補足ラベルは各ボックスの下 `y=100` 付近に `font-size="12" fill="var(--ink-2)"` で置く
- marker の `id` は文書内で一意にする（同一文書に複数フロー図を置くときは `ar2` 等に変える）
