---
name: design-atlas
description: >-
  宣言的な model.json 1 枚から、画面遷移・ER・業務フローを 1 枚の HTML で横断して辿れる
  「設計マップ（Design Atlas）」を決定論的に生成する。構造検査と実ブラウザ検証を通し、
  入力の sha256・実行した検査・実施していない検証を成果物自身に残す。
  「設計マップ」「デザインアトラス」「Design Atlas」「画面とERと業務フローを1枚で横断」
  「システム全体を俯瞰できる資料」「画面遷移とデータの対応を一緒に見たい」で発動。
  図を 1 枚描きたいだけのときは発動しない — 「ER図を描いて」「フローチャート」「構成図」
  「図解して」は drawio / mermaid-to-webp / svg-diagram / bizdoc が担当する。
metadata:
  version: 0.1.0
  requires:
    bins:
      - node
      - dot
      - google-chrome
---

# design-atlas

システム 1 つ分の**画面・データ・業務**を 1 枚の HTML にまとめ、3 つの面を行き来しながら辿れる
成果物を作る。商談や設計レビューで「この画面は何を読み書きして、どの工程のどこにいるのか」を
その場で追えるようにするための道具。

プロジェクト側が書くのは `model.json` 1 枚だけで、コードは書かない。

## いつ使わないか

| 依頼 | 使うもの |
|---|---|
| 図を 1 枚描く・後から GUI で編集したい | 公式 drawio スキル |
| Mermaid 記法の図を画像にする | mermaid-to-webp |
| 自由レイアウトの SVG を描かせる | svg-diagram |
| 業務文書の中に図解を入れる | bizdoc |
| **画面・ER・業務フローを横断して辿らせたい** | **design-atlas（本スキル）** |

単独の図が欲しいだけなら本スキルは重すぎる。3 つの面の**対応関係**を辿らせたいときだけ使う。

## 依存

Node 22 以上 / Graphviz の `dot` / Chrome。`dot` が無ければ配置段で、Chrome が無ければ
ブラウザ検証段で止まる。どちらも別経路で代替しない（未実施として記録する）。

```sh
brew install graphviz
```

Chrome の場所は `DESIGN_ATLAS_CHROME` で変えられる。

## 手順

1. **`model.json` を書く**。契約は `schema/model.schema.json`。最小構成は `meta` / `screens` /
   `areas` / `entities` / `relations`。画面遷移・業務フロー・画像・根拠は足せるところから足す。
   書き方は `docs/model-guide.md`、写経できる例は `tests/fixtures/library/model.json`。
2. **段を順に走らせる**。`<dir>` は `model.json` のあるディレクトリ。

```sh
S=<このプラグイン>/scripts
node $S/manifest.mjs        <dir>/model.json                       # 入力の sha256
node $S/layout.mjs          <dir>/model.json                       # 配置（dot + 経路探索）
node $S/build.mjs           <dir>/model.json <out>/index.html      # 1 枚 HTML（構造が破れていれば書き出さない）
node $S/verify-structure.mjs <dir>/model.json --artifacts <out> --out <out>/structure-verification.json
node $S/verify-layout.mjs   <dir>/model.json --out <out>/layout-verification.json
node $S/verify-browser.mjs  <out>/index.html --shots <out>/shots --out <out>/browser-verification.json
```

3. **配る版を作って、その版を検証する**。渡すファイルが開けることを確かめる。

```sh
node $S/build.mjs          <dir>/model.json <out>/atlas.html --inline
node $S/verify-browser.mjs <out>/atlas.html --out <out>/browser-verification.json
```

4. **doc-hub へ登録する**（任意）。

```sh
node $S/publish.mjs <dir>/model.json <out> [--update]
```

`capture.mjs` は任意段。モックが動くなら画面を撮って `screens[].images[]` に足せる。
モックがまだ無い段階でも、画像ゼロで成立する。

## 検査の種別

**生成を止める**（`verify-structure` / `verify-browser`）
スキーマに反する id、存在しない entity・field・screen・source・lane・area・process への参照、
id の重複、どの関係にも現れないエンティティ、遷移先の不在、宣言した sha256 と実ファイルの不一致、
カードの重複・貫通、ラベルの衝突、ER の参照順の逆行、**生成物への絶対パスの混入**、
ブラウザでの JS エラー・カードや線の欠落・画像の読み込み失敗。

**記録するだけ**（`verify-layout`）
交差数・近接並走区間・総経路長・カード密度。**これらは版どうしを比べる目安であり、
利用者の理解度や追跡にかかる時間の実測値ではない。** 合否にも使わない。

**必ず出力に書く**
`not_verified[]`、実行した検査の一覧、実行日時、Chrome のバージョン、入力の sha256。
`not_verified[]` を空にすると「未実施の検証は無い」という主張になるため、空なら指摘が出る。

## 決めごと

- `sources[].path` と `screens[].images[].path` は `model.json` のあるディレクトリからの**相対**。
  絶対パスと `..` での脱出は拒否する。成果物は社外に渡りうるので、個人のパスを持ち込まない。
- モデルを直したら `meta.model_version` を上げる。上げると閲覧者の手動配置が持ち越されず初期配置に戻る。
- 配置規則は `config/layout-rules.json`。`model.json` の隣に `layout-rules.json` を置けば上書きできる。
- 生成物に時刻を埋めないので、同じ入力からは同じバイト列が出る。差分はモデルの差分だけになる。
