---
name: drawio-bridge
description: 既にある .drawio ファイルを検証・SVG化・HTML埋め込み整形し、export 済み SVG のラベルと線の重なりを機械検出する部品。確定座標で構成図を組む xml-builder とレイアウト規約も持つ。「この drawio を検証して」「drawio を SVG にして」「drawio を HTML に埋め込みたい」「.drawio が開けない/図が空になる」「図の重なりを検査して」「線がラベルを横切る」「AWS 構成図を座標で組みたい」「drawio-bridge」で発動。他スキル（bizdoc 等の HTML 生成側）からプログラム的に呼ばれることを想定する。自由な図の発想や Mermaid での作図は公式 drawio スキル、Mermaid 記法の画像化は mermaid-to-webp、業務文書の中の図解は bizdoc が担当。
---

# drawio-bridge

`.drawio` を「検証する・画像にする・HTML に貼れる形にする」だけを担う部品。
**図の内容を考えるのは公式 drawio スキルの仕事**で、このスキルはその後段にあたる。

## 住み分け

| やりたいこと | 使うもの |
|---|---|
| 図を新しく描く・後から draw.io で編集したい | **公式 drawio スキル**（`/plugin install drawio@drawio`） |
| 既にある `.drawio` を検証・SVG化・HTML に埋め込む | **本スキル** |
| 列と帯で並べる構成図（AWS など）を座標で確定させて描き、重なりを機械検査する | **本スキル**（`xml-builder.js` + `check-overlap`） |
| Mermaid 記法の図を画像化する | mermaid-to-webp |
| LLM に自由レイアウトの SVG を描かせる | svg-diagram |
| 業務文書の中に図解を入れる | bizdoc（自前のインライン SVG） |

## 初回セットアップ

マーケットプレイス経由で配布されたプラグインには `node_modules` が入らないため、
最初の1回だけ依存を入れる（入っていない状態で実行すると exit 4 で手順を案内する）。

```bash
npm install --prefix "${CLAUDE_PLUGIN_ROOT}"
```

`export` と `inline` はさらに draw.io Desktop を必要とする（後述）。

## クイックスタート

```bash
# 検証（エラーがあれば exit 1）
node ${CLAUDE_PLUGIN_ROOT}/scripts/drawio.js validate --in diagram.drawio

# SVG に変換（編集用の原本を埋め込んだまま）
node ${CLAUDE_PLUGIN_ROOT}/scripts/drawio.js export --in diagram.drawio --out diagram.svg

# HTML に inline 埋め込みできる形にして stdout へ
node ${CLAUDE_PLUGIN_ROOT}/scripts/drawio.js inline --in diagram.drawio --id-prefix fig1

# 重なり検査（辺×ラベル・ラベル×ラベル。0 件なら exit 0）
node ${CLAUDE_PLUGIN_ROOT}/scripts/drawio.js check-overlap --in diagram.svg
```

## サブコマンド

### `validate --in <file> [--json]`

draw.io 公式の AI 生成ルールを機械検査可能にしたもの。**「開けるが図が空」「辺が描画されない」といった静かな失敗**を事前に潰す。

- error があれば exit 1、warn だけなら exit 0
- `--json` で機械可読な `{ok, issues[]}` を stdout に出す

主な検査: 整形式 / 構造セル `id="0"` `id="1"` の存在 / id 一意性 / parent 実在 / `vertex` と `edge` の排他 / 辺の source・target 解決 / 辺の `mxGeometry relative="1"`（自己閉じの辺は描画が壊れる）/ 頂点の width・height / 負の寸法 / 圧縮 / XML コメント（公式が禁止）/ `html=1` 無しの HTML ラベル / リテラルの `\n`。

### `export --in <file> --out <file> [--format svg|png|pdf|jpg|xml] [--border 10] [--layout <preset>] [--page 2] [--no-embed]`

draw.io Desktop CLI を呼ぶ。既定で `-e`（編集用の原本を埋め込む）を付けるので、**書き出した SVG/PNG/PDF は draw.io で開き直して編集できる**。`jpg` は原本を埋め込めないため、後で編集する可能性があるなら使わない。

`inline` と違い **`export` は入力を検証しない**（画像化したいだけの用途を妨げないため）。壊れた図を弾きたいときは先に `validate` を通す。

`--layout` に `verticalFlow` / `horizontalFlow` / `verticalTree` / `horizontalTree` / `radialTree` / `organic` を渡すと ELK で自動整列する。座標を自前で詰めるより安定する。

複数ページの `.drawio` は既定で**1ページ目だけ**が出る。`--page`（1 始まり）で選ぶ。`inline` でも同じように使える。

### `inline --in <file.drawio|file.svg> [--out <file>] [--id-prefix <p>] [--page 2] [--max-width 780] [--no-font-fallback] [--color-scheme light|dark|auto]`

HTML に inline 埋め込みできる SVG に整えて stdout（または `--out`）へ出す。`.drawio` を渡した場合は内部で SVG に変換してから処理する。

やっていること:

- `width` / `height` を外し `viewBox` を残す（`max-width: 100%` で本文幅に追随する）
- XML 宣言・DOCTYPE・コメントを落とす
- `--id-prefix` で全 id と、それを指す `url(#…)` / `url("#…")`（`style` 属性内）/ `href="#…"` / `<style>` 内のセレクタを付け替える — 同じ HTML に複数の図を貼るときの衝突回避（ルート svg と defs の gradient / marker が id を持つ）。**v0.3.0 より前は `style="fill: url(&quot;#…&quot;)"` を付け替えておらず、AWS アイコンのタイルが透明になった**（draw.io は勾配の塗りを属性と style の両方に書き、style が優先される。2026-09 実測）
- 日本語があれば `font-family` に日本語フォントのフォールバックを足す（draw.io の export は `Helvetica` しか書かない）
- 色をライト固定にする（`--color-scheme dark|auto` で変更可）。draw.io の SVG は
  `color-scheme: light dark` を持ち閲覧環境のダーク設定に追随するため、白基調の文書に
  そのまま貼ると**線が白く飛んで消え、ラベルも薄くなる**（実測で確認済み）
- `viewBox` 幅が `--max-width`（既定 780）を超えたら警告する。縮小表示され図中文字が本文より小さくなるため

埋め込まれた編集用の原本（`content` 属性）は保持する。実測で全体 33KB のうち 2KB しかなく、外しても軽くならないため。

### `check-overlap --in <file.svg|file.drawio> [--json] [--pad 2] [--label-pad 0] [--page 2]`

export 済みの SVG から **ラベルの矩形** と **辺の折れ線** を取り出し、辺×ラベル・ラベル×ラベルの交差を列挙する。
目視検品で「線が文字を横切る」を毎回同じ箇所で見落とすため、座標を直す決定論ゲートとして置く。

- ラベル矩形は foreignObject 内の flex コンテナ（位置・幅）と、文字数からの幅見積り（CJK 1 文字 = font-size、半角 = 0.56 倍、行高 1.25 倍）
- 辺は `pointer-events="stroke"` の path。曲線は終点だけ採り、角を落とす近似
- 自分のラベルは除外する。`--pad` は辺×ラベルの余白（既定 2px）、`--label-pad` はラベル×ラベル（負の値は `--label-pad=-2` の形で渡す。凡例の隣接行など接触を許すとき）
- 重なりがあれば exit 1、`--json` で `{ok, labels, edges, issues[]}` を出す
- `.drawio` を渡した場合は内部で SVG に変換する（draw.io Desktop が要る）

見積りは実描画と数 px ずれる。0 件にしてから PNG を目視し、目視で直すのは色と語だけにする。

## 他スキルからの呼び出し

`${CLAUDE_PLUGIN_ROOT}` は**自分のプラグインルート**を指すので、別プラグインからは使えない。
呼び出し側では次の手順でパスを解決する。

```bash
# drawio-bridge の検出（マーケットプレイス → ローカルの順に探索）
DB_SCRIPTS=$(find ~/.claude/plugins/cache -path "*/drawio-bridge/*/scripts/drawio.js" 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
[ -z "$DB_SCRIPTS" ] && DB_SCRIPTS="../drawio-bridge/scripts"

# 初回のみ依存を入れる（配布物には node_modules が含まれない）
[ -d "$DB_SCRIPTS/../node_modules" ] || npm install --prefix "$DB_SCRIPTS/.."

# 検証 → 埋め込み用 SVG を取得
node "$DB_SCRIPTS/drawio.js" validate --in diagram.drawio || exit 1
node "$DB_SCRIPTS/drawio.js" inline --in diagram.drawio --id-prefix fig1 > fig1.svg
```

終了コードの契約:

| code | 意味 |
|---|---|
| 0 | 成功（warn は stderr に出るが成功） |
| 1 | 検証エラー、または変換失敗 |
| 2 | 引数が不正（未知の値・範囲外の `--page` を含む） |
| 3 | draw.io Desktop が見つからない（stderr に導入手順を出す） |
| 4 | npm 依存が入っていない（stderr に `npm install` の手順を出す） |

**exit 3 を握り潰さないこと。** CLI 不在時に無音で成功扱いにすると、図が抜けた HTML がそのまま出来上がる。

## draw.io Desktop への依存

`export` と `inline`（`.drawio` 入力時）は draw.io Desktop を必要とする。2026 年時点で `.drawio` を正しく描画できる純 Node / 純 Python のライブラリは存在せず、変換は draw.io 本体のレンダラを通すしかない。

```bash
brew install --cask drawio        # macOS
```

実行ファイルの場所は `DRAWIO_BIN` で上書きできる。`validate` は Desktop 無しで動く。

## 確定座標で描く（`scripts/xml-builder.js`）

列と帯で並べる構成図（AWS の VPC・サブネット・データ層など）は、Mermaid の自動レイアウトより
座標を確定させた方が重ならない。`xml-builder.js` は `references/layout-rules.md` の規約を機械的に守らせる
最小のビルダーで、`node()` がアンカー・アイコン・ラベルの 3 セルを作り、`edge()` が直交ルーティングと
waypoints を書き分ける。図の内容（何を描くか）を考えるのは公式 drawio スキルの仕事で、ここは描き方だけを持つ。

```js
import { DrawioBuilder, LINE } from '<drawio-bridge>/scripts/xml-builder.js'
const b = new DrawioBuilder({ name: '構成図', width: 1050, height: 900 })
b.node('web', { col: 235, y: 355, resIcon: 'ecs', category: 'compute', label: 'ECS Fargate\n2 タスク' })
b.node('db', { col: 235, y: 535, resIcon: 'aurora', category: 'database', label: 'Aurora\nWriter' })
b.edge('e1', 'web', 'db', { label: '検索', color: LINE.blue, exit: [0.5, 1], entry: [0.5, 0], offset: [44, 0] })
process.stdout.write(b.toXml())
```

- 縦の辺は `id`（アンカー）、横の辺は `${id}_i`（アイコン）に繋ぐ。理由は `layout-rules.md` §2
- ラベルの `\n` は `<br>` に変換してエスケープされる。生の `<br>` を書かない
- 完成例: `references/examples/aws-architecture.example.js`（`node` で実行すると .drawio を stdout に出す。`validate` を通り `check-overlap` が 0 件であることをテストで固定している）
- 手順: `build → validate → export（svg）→ check-overlap を 0 件まで → inline（HTML 埋め込み）か export --format png`

## 図を書くときの落とし穴

`references/` に、公式ドキュメントと実測から確定した内容だけを置いてある。

- `references/aws-shapes.md` — AWS シェイプの style 文字列
- `references/gcp-azure-shapes.md` — GCP / Azure シェイプの指定方法
- `references/japanese-text.md` — 日本語ラベルの改行・フォント
- `references/layout-rules.md` — 確定座標で描くときの規約（ラベル分離・アンカー・直交ルーティング・列と帯・文字サイズ）
- `references/examples/aws-architecture.example.js` — `xml-builder.js` の完成例

とくに頻出するもの:

- **改行に `\n` は使えない**（バックスラッシュと n がそのまま表示される）。`&#xa;` を使う
- HTML ラベルを使うなら style に `html=1` が要る。無いとタグが生で表示される
- 圧縮された XML と XML コメントは公式が明示的に禁止している
- シェイプ名を推測で書かない。存在しない `resIcon` を指定すると**エラーにならず静かに空の図形**になる
