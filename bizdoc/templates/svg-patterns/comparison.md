# comparison — 2〜3案の対比

用途: 2〜3 案を横並びの箱で対比し、推し案を強調する。数値中心の比較は `<table>` を使う。

| 要素 | 上限 |
|---|---|
| 案の数 | 2〜3 |
| 案名 | 全角8文字 |
| 項目 | 全角12文字（各案 3〜5 項目） |

```svg
<svg viewBox="0 0 740 210" role="img">
  <title>ツール導入 3案比較（推奨: 段階導入）</title>
  <g font-size="14">
    <rect x="20" y="20" width="220" height="180" rx="10" fill="var(--bg-soft)" stroke="var(--line)"/>
    <text x="130" y="46" font-size="16" font-weight="bold" text-anchor="middle" fill="var(--ink)">現行維持</text>
    <line x1="20" y1="60" x2="240" y2="60" stroke="var(--line)"/>
    <text x="36" y="86" fill="var(--ink-2)">費用: 現状維持</text>
    <text x="36" y="112" fill="var(--ink-2)">期間: なし</text>
    <text x="36" y="138" fill="var(--ink-2)">拡張性: 低い</text>
    <text x="36" y="164" fill="var(--ink-2)">リスク: 低い</text>

    <rect x="260" y="20" width="220" height="180" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    <text x="276" y="46" font-size="16" font-weight="bold" fill="var(--ink)">段階導入</text>
    <rect x="424" y="30" width="48" height="22" rx="5" fill="var(--accent)"/>
    <text x="448" y="45" font-size="14" text-anchor="middle" fill="#ffffff">推奨</text>
    <line x1="260" y1="60" x2="480" y2="60" stroke="var(--line)"/>
    <text x="276" y="86" fill="var(--ink-2)">費用: 月50万円</text>
    <text x="276" y="112" fill="var(--ink-2)">期間: 2ヶ月</text>
    <text x="276" y="138" fill="var(--ink-2)">拡張性: 高い</text>
    <text x="276" y="164" fill="var(--ink-2)">リスク: 中程度</text>

    <rect x="500" y="20" width="220" height="180" rx="10" fill="var(--bg-soft)" stroke="var(--line)"/>
    <text x="610" y="46" font-size="16" font-weight="bold" text-anchor="middle" fill="var(--ink)">全面刷新</text>
    <line x1="500" y1="60" x2="720" y2="60" stroke="var(--line)"/>
    <text x="516" y="86" fill="var(--ink-2)">費用: 初期800万円</text>
    <text x="516" y="112" fill="var(--ink-2)">期間: 6ヶ月</text>
    <text x="516" y="138" fill="var(--ink-2)">拡張性: 高い</text>
    <text x="516" y="164" fill="var(--ink-2)">リスク: 高い</text>
  </g>
</svg>
```

調整ポイント:
- 2 案にするときは `viewBox` 幅を 500（220×2 + 20×3 の目安）に縮め、x 座標を詰め直す
- 推し案は `fill="var(--accent-soft)"` + `stroke="var(--accent)"` の箱に「推奨」バッジ（`fill="var(--accent)"` の角丸矩形 + 白文字）を1つだけ乗せる。複数案を同時に推さない
- 項目行は最大 5 行まで。増えるときは行間 26px を保ったまま `viewBox` 高さを伸ばす
- 数値の出典が必要な場合は、この図の外側に `<p class="src">` を添える（SVG 内には出典を書かない）
