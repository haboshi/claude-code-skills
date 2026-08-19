# GCP / Azure シェイプ

draw.io Desktop v31.1.8 同梱の stencil / 画像ライブラリから抽出した実体。
AWS（`aws-shapes.md`）と違って **GCP と Azure は指定方法そのものが異なる**ので先に読むこと。

## Google Cloud — `mxgraph.gcp3.*`

stencil なので AWS と同じく `shape=` に名前を書く。`resIcon` に相当する仕組みは無い。

```
sketch=0;html=1;verticalLabelPosition=bottom;verticalAlign=top;align=center;shape=mxgraph.gcp3.bigquery;
```

サイズは 66×58 前後。色は stencil 自身が Google のブランドカラーを持つので `fillColor` は不要
（実測: BigQuery を export すると #34a853 / #ea4335 / #fbbc04 が出る）。

### 使える名前（45 件）

stencil 名を小文字化し、スペースをアンダースコアに変えたものが style の名前になる。

`agents` / `aihypercomputer` / `aimachinelearning` / `alloydb` / `anthos` / `apigee` / `bigquery` / `businessintelligence` / `cloudrun` / `cloudspanner` / `cloudsql` / `cloud_storage` / `collaboration` / `compute` / `computeengine` / `containers` / `dataanalytics` / `databases` / `developer_tools` / `devops` / `distributedcloud` / `gke` / `hybridmulticloud` / `hyperdisk` / `integrationservices` / `looker` / `managementtools` / `mandiant` / `mapsgeospatial` / `marketplace` / `mediaservices` / `migration` / `mixedreality` / `networking` / `observability` / `operations` / `secops` / `securitycommandcenter` / `securityidentity` / `serverlesscomputing` / `storage` / `threatintelligence` / `vertexai` / `web3` / `webmobile`

> `gcp3` は製品を大きく束ねた図形群で、AWS ほど細かくない。
> 個別サービスのアイコンが要るときは旧 `mxgraph.gcp2.*`（カード形式）も残っている。
> ただし gcp2 のカード用アイコン `prIcon` の具体名は**未確認**なので、使うなら
> draw.io のサイドバーから実物をドラッグして Edit Style でコピーすること。

## Azure — `img/lib/azure2/…`（stencil ではない）

現行の Azure アイコンは **stencil ではなくアプリ同梱の SVG 画像**。そのため指定は
`shape=image` とパスの組み合わせになる。

```
sketch=0;html=1;verticalLabelPosition=bottom;verticalAlign=top;align=center;shape=image;image=img/lib/azure2/compute/Virtual_Machine.svg;
```

**このパスは draw.io 本体からしか解決できない。** 別のレンダラに XML を渡すと画像が抜けるので、
Azure 図の画像化は必ず draw.io Desktop（本プラグインの `export` / `inline`）を通すこと。

旧 `mxgraph.azure.*` は stencil として残っており、そちらは `shape=` で指定できる。

### カテゴリ（31 種 / SVG 704 件）

`ai_machine_learning` / `analytics` / `app_services` / `azure_ecosystem` / `azure_stack` / `azure_vmware_solution` / `blockchain` / `compute` / `containers` / `cxp` / `databases` / `devops` / `general` / `hybrid_multicloud` / `identity` / `integration` / `internet_of_things` / `intune` / `iot` / `management_governance` / `menu` / `migrate` / `mixed_reality` / `monitor` / `networking` / `other` / `power_platform` / `preview` / `security` / `storage` / `web`

ファイル名は元の製品名の空白をアンダースコアにしたもの（例: `compute/Virtual_Machine.svg`、
`ai_machine_learning/AI_Foundry.svg`）。**大文字小文字がそのまま効く**ので、
正確な綴りはサイドバーからコピーする。

## 共通の注意

- 名前を推測で書かない。存在しない名前を指定してもエラーにならず、空の図形になる
- draw.io を更新すると同梱のライブラリも変わる。この一覧は v31.1.8 時点のもの
