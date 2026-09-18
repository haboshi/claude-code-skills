# design-atlas

宣言的な `model.json` 1 枚から、**画面遷移・ER・業務フロー**を 1 枚の HTML で横断して辿れる
設計マップを生成する。プロジェクト側はコードを書かない。

```
model.json ─┬─(任意) capture.mjs    → screens/*.png ＋ 撮影日時
            ├─ manifest.mjs         → source-manifest.json（入力＋sha256）
            ├─ layout.mjs           → layout.json（dot で層割当 → 経路探索）
            ├─ build.mjs            → index.html（既定は画像外部 / --inline で 1 枚化）
            ├─ verify-structure.mjs → 失敗なら exit 1（生成物を渡さない）
            ├─ verify-layout.mjs    → 指標を記録（止めない）
            ├─ verify-browser.mjs   → 実ブラウザ。失敗なら exit 1
            └─ publish.mjs          → doc-hub に登録
```

`layout.json` を中間層に挟んでいるので、build は 1 回で済む。生成物に時刻を埋めないので、
同じ入力からは同じバイト列が出る。

使い方は [`skills/design-atlas/SKILL.md`](skills/design-atlas/SKILL.md)、
`model.json` の書き方は [`docs/model-guide.md`](docs/model-guide.md)。

## 依存

Node 22 以上 / Graphviz `dot` / Chrome。npm 依存は無い。

```sh
brew install graphviz
npm test
```

Graphviz が無い環境では配置まわりのテストだけ skip する。

## この成果物が引き受けていること

- **検査を種別で分ける。** 構造が破れていたら生成を止める。見た目の指標は記録するだけで、
  合否にも使わないし、利用者の理解度の実測値とも呼ばない。
- **やっていない検証を書く。** `not_verified[]` は成果物に必ず出る。空にすると指摘が出る。
- **保護機構を迂回しない。** Chrome が起動できなければ、別経路を探さずに未実施として記録する。
- **個人の絶対パスを外へ出さない。** 入力パスは相対に限り、生成物への混入は機械で落とす。
