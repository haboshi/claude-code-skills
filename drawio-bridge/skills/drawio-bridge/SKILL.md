---
name: drawio-bridge
description: 既にある .drawio ファイルを検証・SVG化・HTML埋め込み整形する部品。「この drawio を検証して」「drawio を SVG にして」「drawio を HTML に埋め込みたい」「.drawio が開けない/図が空になる」「drawio-bridge」で発動。他スキル（bizdoc 等の HTML 生成側）からプログラム的に呼ばれることを想定する。図そのものを新しく描く依頼では発動しない — 「図を作って」「アーキテクチャ図を描いて」は公式 drawio スキル、Mermaid 記法の画像化は mermaid-to-webp、業務文書の中の図解は bizdoc が担当。
---

# drawio-bridge

`.drawio` を「検証する・画像にする・HTML に貼れる形にする」だけを担う部品。
**図の内容を考えるのは公式 drawio スキルの仕事**で、このスキルはその後段にあたる。

## 住み分け

| やりたいこと | 使うもの |
|---|---|
| 図を新しく描く・後から draw.io で編集したい | **公式 drawio スキル**（`/plugin install drawio@drawio`） |
| 既にある `.drawio` を検証・SVG化・HTML に埋め込む | **本スキル** |
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
```

## サブコマンド

### `validate --in <file> [--json]`

draw.io 公式の AI 生成ルールを機械検査可能にしたもの。**「開けるが図が空」「辺が描画されない」といった静かな失敗**を事前に潰す。

- error があれば exit 1、warn だけなら exit 0
- `--json` で機械可読な `{ok, issues[]}` を stdout に出す

主な検査: 整形式 / 構造セル `id="0"` `id="1"` の存在 / id 一意性 / parent 実在 / `vertex` と `edge` の排他 / 辺の source・target 解決 / 辺の `mxGeometry relative="1"`（自己閉じの辺は描画が壊れる）/ 頂点の width・height / 負の寸法 / 圧縮 / XML コメント（公式が禁止）/ `html=1` 無しの HTML ラベル / リテラルの `\n`。

### `export --in <file> --out <file> [--format svg|png|pdf|xml] [--border 10] [--layout <preset>] [--page 2] [--no-embed]`

draw.io Desktop CLI を呼ぶ。既定で `-e`（編集用の原本を埋め込む）を付けるので、**書き出した SVG/PNG/PDF は draw.io で開き直して編集できる**。

`--layout` に `verticalFlow` / `horizontalFlow` / `verticalTree` / `horizontalTree` / `radialTree` / `organic` を渡すと ELK で自動整列する。座標を自前で詰めるより安定する。

複数ページの `.drawio` は既定で**1ページ目だけ**が出る。`--page`（1 始まり）で選ぶ。`inline` でも同じように使える。

### `inline --in <file.drawio|file.svg> [--out <file>] [--id-prefix <p>] [--page 2] [--max-width 780] [--no-font-fallback]`

HTML に inline 埋め込みできる SVG に整えて stdout（または `--out`）へ出す。`.drawio` を渡した場合は内部で SVG に変換してから処理する。

やっていること:

- `width` / `height` を外し `viewBox` を残す（`max-width: 100%` で本文幅に追随する）
- XML 宣言・DOCTYPE・コメントを落とす
- `--id-prefix` で全 id と、それを指す `url(#…)` / `href="#…"` / `<style>` 内のセレクタを付け替える — 同じ HTML に複数の図を貼るときの衝突回避（ルート svg と defs の gradient / marker が id を持つ）
- 日本語があれば `font-family` に日本語フォントのフォールバックを足す（draw.io の export は `Helvetica` しか書かない）
- 色をライト固定にする（`--color-scheme dark|auto` で変更可）。draw.io の SVG は
  `color-scheme: light dark` を持ち閲覧環境のダーク設定に追随するため、白基調の文書に
  そのまま貼ると**線が白く飛んで消え、ラベルも薄くなる**（実測で確認済み）
- `viewBox` 幅が `--max-width`（既定 780）を超えたら警告する。縮小表示され図中文字が本文より小さくなるため

埋め込まれた編集用の原本（`content` 属性）は保持する。実測で全体 33KB のうち 2KB しかなく、外しても軽くならないため。

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

## 図を書くときの落とし穴

`references/` に、公式ドキュメントと実測から確定した内容だけを置いてある。

- `references/aws-shapes.md` — AWS シェイプの style 文字列
- `references/gcp-azure-shapes.md` — GCP / Azure シェイプの指定方法
- `references/japanese-text.md` — 日本語ラベルの改行・フォント

とくに頻出するもの:

- **改行に `\n` は使えない**（バックスラッシュと n がそのまま表示される）。`&#xa;` を使う
- HTML ラベルを使うなら style に `html=1` が要る。無いとタグが生で表示される
- 圧縮された XML と XML コメントは公式が明示的に禁止している
- シェイプ名を推測で書かない。存在しない `resIcon` を指定すると**エラーにならず静かに空の図形**になる
