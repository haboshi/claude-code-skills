---
description: 画面遷移・ER・業務フローを 1 枚の HTML で横断して辿れる設計マップ（Design Atlas）を生成する
---

design-atlas スキルを使って設計マップを作る。

$ARGUMENTS

進め方:

1. `model.json` が既にあるか確認する。無ければ、対象システムの画面・データ概念・業務工程を
   利用者と確認しながら `schema/model.schema.json` に沿って起こす。
   参照できる実例は `tests/fixtures/library/model.json`。
2. manifest → layout → build → verify-structure → verify-layout → verify-browser の順に走らせる。
   構造検査かブラウザ検証が 1 件でも拾ったら、成果物を渡さずに原因を直す。
3. 配る版（`--inline`）を作り、**その版を** ブラウザ検証に通す。
4. 実施していない検証を `not_verified[]` に書く。空のままにしない。
5. 必要なら `publish.mjs` で doc-hub に登録する。

図を 1 枚描きたいだけの依頼なら、本スキルではなく drawio / mermaid-to-webp / svg-diagram /
bizdoc に回す。
