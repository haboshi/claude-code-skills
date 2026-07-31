# relation — 中心ノードと周辺ノードの関係・体制

用途: 中心（事務局・システム等）と周辺 3〜6 ノードの関係・役割分担を1枚で示す。分岐のある手順は
process-flow、階層構造は architecture を使う。
様式: 2行構成ノード（主ラベル+副ラベル）+ 注釈行（README の様式イディオム準拠）。

| 要素 | 上限 |
|---|---|
| 周辺ノード数 | 3〜6 |
| ノード名（主ラベル） | 全角6文字（7字以上は周辺ノードの半径を48から64へ拡大） |
| 副ラベル | 全角5文字（circle 内に収める制約が強いため主ラベルより短く取る） |
| エッジラベル | 全角6文字 |
| 注釈行 | 全角40文字 × 0〜2行 |

```svg
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
```

調整ポイント:
- 周辺ノードを増減するときは、中心 (380,250) から半径185で放射状に等間隔（360÷ノード数 度）に再配置する
- エッジラベルは線の中間に白背景のピル型ボックス（`fill="var(--bg)"`）を敷いてから乗せる。線と文字が重なって読めなくなるのを防ぐため
- 各ノードは主ラベル（15・circle 中心からやや上）+ 副ラベル（14.5・`var(--ink-2)`、circle 中心からやや下）の2行構成にする（README 様式イディオム準拠）。中心ノードのみ `fill="var(--accent)"` + 白文字（主・副とも `#ffffff`。accent 面上の文字色のため `var(--bg)` でなく白直書きで可）にし、周辺ノードは全て `var(--accent-soft)` で揃え、特定ノードだけを強調しない
- 半径48の circle に2行を収める都合上、副ラベルは全角5文字が上限（主ラベルの6文字より短い）。中心ノード（半径56）は副ラベルも全角6文字程度まで許容できる
- ノード名（主ラベル）が全角6文字に収まらない場合は、まず周辺ノードの半径を48から64へ拡大する（そのときは副ラベルも全角7〜8文字まで拡張できる）。それでも収まらない場合のみ名称を略称化する（例: 「情報システム部」→「情シス部」）
- 注釈行（0〜2行）は最下段の周辺ノード（cy=400, r=48 → 下端 y=448）の下 8px の位置から開始する
