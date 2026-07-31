# process-flow — 手順・工程の流れ

用途: 3〜6 ステップの直線的なプロセス・フローを示す。分岐が要るなら relation を使う。
様式: 番号つき円 + ステップ名 + 成果物/補足チップの2段構成（README の様式イディオム準拠）。

| 要素 | 上限 |
|---|---|
| ステップ数 | 3〜6（7以上は図を分割） |
| ステップ名 | 全角6文字 |
| 補足チップ | 全角8文字（成果物・期間など） |
| 注釈行 | 全角40文字 × 0〜2行 |

```svg
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
```

調整ポイント:
- ステップ数 n を変えるときの座標式: 間隔 = (780 − 196) ÷ (n − 1)、cx = 98 + i × 間隔（i = 0..n−1）。
  矢印は「cx + 28 から 長さ = 間隔 − 61」の水平線。チップ幅 = min(150, 間隔 − 12)、x = cx − チップ幅/2
- 5〜6 ステップでは間隔が狭くなるため、ステップ名・チップは全角6文字以内に絞る（収まらなければ図を分割）
- 文字サイズは README 予防則9 の規範どおり（主 15・従 14.5）。viewBox 幅 780 を広げない — ステップを増やすのではなく分割で対応する
- 強調（`fill="var(--accent)"` + 白文字）は最重要の1ステップのみ。円の番号は白、他ステップは accent 文字
- 補足チップは成果物・期間・担当のいずれかで統一する（行ごとに意味を混ぜない）
- 注釈行（0〜2行）で運用の含意を言い切る（様式は README 参照）
- marker の `id` は文書内で一意にする（同一文書に複数フロー図を置くときは `ar2` 等に変える）
