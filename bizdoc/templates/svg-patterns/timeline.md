# timeline — 横軸の時系列・マイルストーン

用途: 3〜6 マイルストーンを横軸の時系列で示す。並行タスクの詳細まで示したいときは
components.md の「時系列・計画を示す」表現3（ガントに準ずる SVG）を使う。
様式: 2行構成ノード（主ラベル+副ラベル）+ 注釈行（README の様式イディオム準拠）。

| 要素 | 上限 |
|---|---|
| マイルストーン数 | 3〜6 |
| 時期ラベル | 全角6文字 |
| 項目名（主ラベル） | 全角10文字 |
| 副ラベル | 全角10文字 |
| 注釈行 | 全角40文字 × 0〜2行 |

```svg
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
```

調整ポイント:
- マイルストーンを増減するときは、軸の両端 x=40/x=720 の間で等間隔に再配置する（4点なら間隔180、6点なら間隔約135）
- ノードは軸上の円 + 時期ラベル（軸上・14.5）+ 主ラベル（軸下・15）+ 副ラベル（軸下・14.5、`var(--ink-2)`）の構成にする（README 様式イディオム準拠。1行の項目名だけで終わらせない）
- 直近の到達点や最終ゴールだけ `fill="var(--accent)"`・半径を 1px 大きくして強調する（複数を強調しない）
- 時期ラベルは軸の上、主・副ラベルは軸の下に置き視線の流れ（左→右）を崩さない
- 注釈行（0〜2行）は軸の下 80px の位置から開始する。マイルストーン数を変えても注釈行の y は固定で構わない（副ラベルの下に十分な余白がある）
- 予定と実績を並べたいときは、軸をもう1本下に足すのではなく `comparison` パターンで並べる方が読みやすい
