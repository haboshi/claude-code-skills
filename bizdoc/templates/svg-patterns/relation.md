# relation — 中心ノードと周辺ノードの関係・体制

用途: 中心（事務局・システム等）と周辺 3〜6 ノードの関係・役割分担を1枚で示す。分岐のある手順は
process-flow、階層構造は architecture を使う。

| 要素 | 上限 |
|---|---|
| 周辺ノード数 | 3〜6 |
| ノード名 | 全角6文字（7字以上は周辺ノードの半径を48から64へ拡大） |
| エッジラベル | 全角6文字 |

```svg
<svg viewBox="0 0 760 470" role="img">
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
  <g font-size="14" text-anchor="middle" fill="var(--ink-2)">
    <text x="380" y="163">報告</text>
    <text x="468" y="227">要望</text>
    <text x="435" y="330">連携</text>
    <text x="326" y="330">委託</text>
    <text x="292" y="227">支援</text>
  </g>

  <circle cx="380" cy="250" r="56" fill="var(--accent)"/>
  <text x="380" y="255" text-anchor="middle" font-size="15" fill="#ffffff">推進事務局</text>

  <g>
    <circle cx="380" cy="65" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="556" cy="193" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="489" cy="400" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="271" cy="400" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
    <circle cx="204" cy="193" r="48" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2"/>
  </g>
  <g font-size="14" text-anchor="middle" fill="var(--ink)">
    <text x="380" y="70">経営層</text>
    <text x="556" y="198">利用部門</text>
    <text x="489" y="405">情シス部</text>
    <text x="271" y="405">外部ベンダー</text>
    <text x="204" y="198">監査部門</text>
  </g>
</svg>
```

調整ポイント:
- 周辺ノードを増減するときは、中心 (380,250) から半径185で放射状に等間隔（360÷ノード数 度）に再配置する
- エッジラベルは線の中間に白背景のピル型ボックス（`fill="var(--bg)"`）を敷いてから乗せる。線と文字が重なって読めなくなるのを防ぐため
- 中心ノードのみ `fill="var(--accent)"` + 白文字にする。周辺ノードは全て `var(--accent-soft)` で揃え、特定ノードだけを強調しない
- ノード名が全角6文字に収まらない場合は、まず周辺ノードの半径を48から64へ拡大する。それでも収まらない場合のみ名称を略称化する（例: 「情報システム部」→「情シス部」）
