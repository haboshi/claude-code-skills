# レイアウト規約 — 確定座標で描く構成図が重ならないために

draw.io の XML をプログラムで生成して AWS 構成図を描いたとき、目視検品で「線が文字を横切る」
「ラベルが隣と重なる」を 3 回連続で見落とした（2026-09 実測、111 件 → 0 件にするまで 4 回作り直し）。
ここに書くのは、その作り直しで確定した規約。`scripts/xml-builder.js` はこれを機械的に守らせ、
`drawio.js check-overlap` が結果を検査する。

## 1. ラベルは別セルにする（アイコン直下のラベルを使わない）

`shape=mxgraph.aws4.resourceIcon` に `verticalLabelPosition=bottom` でラベルを持たせると、
ラベルの幅がアイコン幅に縛られず横に伸び、隣の列のラベルと重なる。

- アイコンセルは `value=""`、`fontSize=1`
- ラベルは `text;html=1;whiteSpace=wrap;` の別セルにし、**幅を列幅（150px）に固定**する
- 2 行に収まらない語は短くする。draw.io は幅内で折り返すので 3 行目が出たら文字数が多い

## 2. 縦の辺はアンカーに、横の辺はアイコンに繋ぐ

アイコンの下辺から出た辺は、その直下にあるラベルを縦断する。

- ノードごとに「アイコン＋ラベルを覆う透明矩形（`strokeColor=none;fillColor=none`）」を置き、
  上下方向の辺（`exitY=1` / `entryY=0`）はこの矩形に繋ぐ。下辺 = ラベルの下になる
- 左右方向の辺（`exitX=1` / `entryX=0`）はアイコンセルに繋ぐ。矩形に繋ぐと線がアイコンから
  離れた位置（ラベルの高さ）から出る
- ラベルを横に置くノード（入口・出口など縦に辺が集まるもの）は、矩形をアイコンと同じ大きさにする

`xml-builder.js` の `node()` はこの 3 点を自動で行い、`id` がアンカー、`${id}_i` がアイコン。

## 3. 直交ルーティングは `edgeStyle=orthogonalEdgeStyle;` と書く

`orthogonalEdgeStyle;` だけ（`edgeStyle=` を落とす）では効かず、斜めの直線になる。
始点と終点が同じ列（または同じ帯）にあれば、直交ルーティングは 1 本の直線を引く。
**列と帯を揃えることが、辺を曲げない最も確実な方法**である。

## 4. 属性値の改行は `&lt;br&gt;`

`value` 属性に生の `<br>` を書くと XML として不正になり、draw.io は空の図を出す（エラーにならない）。
`\n` は `html=1` のラベルでは無視される。正しくは `<br>` を XML エスケープした `&lt;br&gt;`。
`xml-builder.js` の `escapeLabel()` は `\n` を `<br>` に変換してからエスケープする。

## 5. 列・帯・回廊で座標を決める

| 要素 | 値 | 理由 |
|---|---|---|
| 列の間隔 | 160px（ラベル幅 150 + 隙間 10） | 隣のラベルと重ねない最小 |
| 帯（アイコン上端）の間隔 | 140〜180px | アイコン 42 + ラベル 2 行 40 + 回廊 40 以上 |
| 回廊 | 帯と帯の間に 40px | 横に走る辺と辺ラベル（高さ 18px）を通す |
| 枠の見出し | 枠内に辺を通す列を避けて置く | 見出し文字を縦線が横切る |

- 同じ列に置いた 2 ノード間の辺は直線になる。別の列へ渡る辺は回廊を通す
- 枠（VPC・サブネット）の見出しは、その枠に入る縦線の x 座標から外す。中央寄せか、
  下辺（`verticalAlign=bottom`）に置くと避けやすい
- 辺ラベルは `offset` で回廊の中へ寄せる（縦の辺なら x を +44〜88、横の辺なら y を −12〜−14）

## 6. 長い迂回は waypoints で確定させる

3 つ以上の帯をまたぐ辺（例: バッチから NAT を経てリージョン外へ）は、直交ルーティングに任せると
他のラベルを横切る。`edgeStyle=none;` にして `<Array as="points">` で回廊上の折れ点を明示する。
`xml-builder.js` の `edge()` に `points` を渡すと自動でこの形になる。

## 7. 凡例と注記

- 凡例の行間は **18px 以上**（14px 文字の行高 17.5px と重なる）
- 注記は図の下に 1 行 22px で並べ、アクセント色の 7px 正方形を頭に置く
- 注記が 5 行を超えたら本文に移す

## 8. AWS カテゴリ色（`mxgraph.aws4.resourceIcon` の fillColor / gradientColor）

| category | fillColor | gradientColor | 主なサービス |
|---|---|---|---|
| compute | #D05C17 | #F78E04 | ECS, EC2, Lambda |
| database | #3334B9 | #4D72F3 | Aurora, DynamoDB, ElastiCache |
| storage | #277116 | #60A337 | S3 |
| network | #4D27AA | #945DF2 | Route 53, ALB/NLB, NAT Gateway |
| security | #BD0816 | #FF5252 | WAF, IAM |
| appint | #B0084D | #FF4F8B | API Gateway, EventBridge |
| ml | #01A88D | #4AB29A | Bedrock |
| mgmt | #BC1356 | #F34482 | CloudWatch, Systems Manager |
| analytics | #4D27AA | #945DF2 | Athena, Data Firehose |

`resIcon` の名前は `references/aws-shapes.md` にあるものだけを使う（存在しない名前は空のタイルになる）。

## 9. 文字サイズと viewBox 幅

bizdoc の図の器は幅 918px で、SVG は `width:100%` で縮小表示される。
実表示サイズ = font-size × 918 ÷ viewBox 幅。**本文と同等の 14px 以上**が規範。

| viewBox 幅 | font-size 16 の実表示 | 判定 |
|---|---|---|
| 780 | 18.8px | 余裕 |
| 1050 | 14.0px | 上限 |
| 1200 | 12.2px | 違反。font-size を 18 以上に |

列を 6 本並べる構成図は幅 1050 が上限。7 本以上は帯を増やして縦に伸ばすか、図を分ける。

## 10. 検品は機械判定を先に、目視を後に

```bash
node scripts/drawio.js validate --in fig.drawio
node scripts/drawio.js export --in fig.drawio --out fig.svg
node scripts/drawio.js check-overlap --in fig.svg      # 0 件になるまで座標を直す
node scripts/drawio.js export --in fig.drawio --out fig.png --format png --border 12
```

`check-overlap` の幅見積りは CJK 1 文字 = font-size、半角 = 0.56 倍。実描画とは数 px ずれるので
`--pad`（既定 2）で吸収する。0 件になってから PNG を目視する。目視で直すのは色と語だけにする。
