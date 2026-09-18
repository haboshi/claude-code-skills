# model.json の書き方

契約の正本は [`schema/model.schema.json`](../schema/model.schema.json)。写経できる例は
[`tests/fixtures/library/model.json`](../tests/fixtures/library/model.json)（架空の図書館システム）。

## 最小構成

3 面すべてを埋める必要はない。ER だけでも成立する。

```json
{
  "meta": { "id": "my-system", "title": "受発注 設計マップ", "model_version": 1 },
  "areas": [{ "id": "core", "label": "中核" }],
  "entities": [
    { "id": "user", "name": "利用者", "area": "core",
      "fields": [{ "name": "user_id", "label": "利用者ID", "role": "key" }] },
    { "id": "order", "name": "注文", "area": "core",
      "fields": [{ "name": "order_id", "label": "注文ID", "role": "key" },
                 { "name": "user_id", "label": "利用者ID", "role": "ref" }] }
  ],
  "relations": [
    { "from": { "entity": "user", "field": "user_id", "cardinality": "1" },
      "to":   { "entity": "order", "field": "user_id", "cardinality": "0..N" },
      "label": "利用者の注文" }
  ],
  "screens": [{ "id": "list", "name": "注文一覧", "entities": ["user", "order"] }],
  "not_verified": ["実機での操作確認は行っていない。"]
}
```

## つまずきやすいところ

| 症状 | 原因と直し方 |
|---|---|
| `... がどの関係にも現れません` | ER に置いたのに `relations[]` に出てこないエンティティ。関係を書くか、そのカードを消す |
| `... が存在しない項目を指しています` | `relations[].from.field` は `entities[].fields[].name` と一字一句同じにする |
| `参照順が逆行しています` | ER は左が参照元。`from` と `to` が逆か、関係の向きの取り違え |
| `not_verified[] が空です` | 空にすると「未実施の検証は無い」という主張になる。無いなら、その旨を 1 行書く |
| `id に使えない文字が…` | id は英小文字・数字・`_`・`-` のみ。日本語は `name` / `label` に書く |
| `... は相対パスで書いてください` | `sources[].path` と画像は `model.json` からの相対。成果物に個人のパスを持ち込まない |
| 説明ラベルが重なる | `config/layout-rules.json` を `model.json` の隣にコピーして `nodeSeparation` を広げる |

## 3 面の考え方

**画面（screens / transitions）** — 「何を押すと、どこへ、何を持って移るか」。`carry` には
引き継ぐものを書く。引き継がないなら、そう書く（空欄にしない）。

**データ（areas / entities / relations）** — 横方向は**参照元 → 参照先**であって時系列ではない。
`role` の `key` / `ref` は、その設計上の識別・参照のしかたであり、実 DB の PK・FK 制約ではない。
まだ無い項目には `proposed: true` を付けると破線で出る。

**業務（lanes / processes / process_edges）** — `primary: true` を主経路の辺に付けると一直線に
並ぶ。手戻り・例外は `kind: "exception"` にすると本線の下へ落ちる。

## 証跡まわり

- `sources[]` に `sha256` を書いておくと、入力が入れ替わったときに生成が止まる。
- `meta.guide[]` は「図の読み方」に出る散文。`open_questions[]` と `not_verified[]` は
  自動で節が足されるので、ここに重ねて書かない。
- `meta.trace` を書くと「1 件を最初から最後までたどる」導線が出る。省くとボタンごと出ない。
- 画像は `historical: true` を付けると「現行版より古い参考画像」として表示され、その画像の
  座標を遷移の根拠に使おうとすると生成が止まる。
