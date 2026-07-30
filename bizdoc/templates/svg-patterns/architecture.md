# architecture — 2〜4層の構成図

用途: システムや組織を層（横帯）に分け、層内の要素と層間の連携（矢印）で全体像を示す。

| 要素 | 上限 |
|---|---|
| 層数 | 2〜4 |
| 層名 | 全角8文字 |
| 要素名 | 全角8文字（層あたり 2〜4 要素） |

```svg
<svg viewBox="0 0 760 370" role="img">
  <title>システム構成（3層）</title>
  <g font-size="14">
    <rect x="20" y="20" width="720" height="90" rx="10" fill="var(--bg-soft)" stroke="var(--line)"/>
    <text x="34" y="38" fill="var(--ink-2)">画面層</text>
    <rect x="170" y="48" width="200" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="270" y="78" text-anchor="middle" fill="var(--ink)">Webブラウザ</text>
    <rect x="390" y="48" width="200" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="490" y="78" text-anchor="middle" fill="var(--ink)">モバイル画面</text>

    <path d="M380 110 v30" stroke="var(--ink-2)" stroke-width="2" marker-end="url(#ar-arch)"/>

    <rect x="20" y="140" width="720" height="90" rx="10" fill="var(--bg-soft)" stroke="var(--line)"/>
    <text x="34" y="158" fill="var(--ink-2)">業務ロジック層</text>
    <rect x="120" y="168" width="160" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="200" y="198" text-anchor="middle" fill="var(--ink)">API連携</text>
    <rect x="300" y="168" width="160" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="380" y="198" text-anchor="middle" fill="var(--ink)">認証処理</text>
    <rect x="480" y="168" width="160" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="560" y="198" text-anchor="middle" fill="var(--ink)">業務ルール</text>

    <path d="M380 230 v30" stroke="var(--ink-2)" stroke-width="2" marker-end="url(#ar-arch)"/>

    <rect x="20" y="260" width="720" height="90" rx="10" fill="var(--bg-soft)" stroke="var(--line)"/>
    <text x="34" y="278" fill="var(--ink-2)">データ層</text>
    <rect x="170" y="288" width="200" height="48" rx="8" fill="var(--accent)" stroke="var(--accent)"/>
    <text x="270" y="318" text-anchor="middle" fill="#ffffff">DB</text>
    <rect x="390" y="288" width="200" height="48" rx="8" fill="var(--accent-soft)" stroke="var(--accent)"/>
    <text x="490" y="318" text-anchor="middle" fill="var(--ink)">外部連携</text>
  </g>
  <defs>
    <marker id="ar-arch" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)"/>
    </marker>
  </defs>
</svg>
```

調整ポイント:
- 層を増減するときは1層あたり高さ90 + 矢印分30を目安に `viewBox` 高さを再計算する（例: 4層なら 90×4 + 30×3 + 上下余白40 ≈ 490）
- 層名は帯の左上、要素ボックスは帯内に横並びで置く（層あたり2〜4個。5個以上になるなら層を分割する）
- データの実体（DB 等）や強調したい層だけ `fill="var(--accent)"` + 白文字にする（複数を強調しない）
- `marker id` はパターンごとに固有にする（本パターンは `ar-arch`。process-flow の `ar` と衝突させない）
