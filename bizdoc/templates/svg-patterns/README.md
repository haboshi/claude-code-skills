# SVG 図解パターン集 — 共通予防則（全パターン必須）

1. 文字幅の見積り: CJK 1文字 = 1em、半角 = 0.5em。ボックス幅 = 想定ラベルの見積り幅 + 左右 0.5em。
   各パターンが定めるラベル文字数上限を超える場合は、ラベルを短くするか図を分割する
2. `viewBox` のみ指定し、`width` / `height` の px 直書きをしない（`figure svg { width:100% }` が効く）
3. ルート要素に `role="img"` と `<title>`（+ 必要なら `<desc>`）を必須とする
4. `font-family` は指定しない（本文の system font stack を継承させる）
5. 色は tokens.css の CSS 変数を参照する（`fill="var(--accent)"` 等）。アクセント1色の原則は SVG にも適用
6. `<svg>` の入れ子は禁止（hub の SVG 検証ゲートの抽出が入れ子に対応しないため）
7. XML として整形式であること（属性は必ず引用符・タグは必ず閉じる。& は &amp;）。
   hub.mjs add の xmllint 検証で不正 XML は reject される
8. 文字は 14px 相当以上（viewBox 座標系で調整）。低コントラストのグレー文字をラベルに使わない

## 埋め込み時の注意（予防則の補足）

- これらの SVG は文書 HTML に**インラインで貼る**こと。`<img src="pattern.svg">` のように外部ファイル参照にすると、
  SVG 内の `var(--accent)` 等が文書側 `:root` の CSS 変数を解決できず、無色・黒塗りになる。
- 各パターンの `marker id`（矢印定義など）は同一文書内で他パターンと衝突しないよう、パターンごとに
  異なる id を使う（例: process-flow は `ar`、architecture は `ar-arch`）。同一文書に複数の図を貼るときは
  衝突がないか目視で確認する。

## パターン一覧

| ファイル | 用途 |
|---|---|
| `process-flow.md` | 手順・工程の直線的な流れ |
| `comparison.md` | 2〜3案の対比 |
| `timeline.md` | 横軸の時系列・マイルストーン |
| `architecture.md` | 2〜4層の構成図 |
| `matrix-2x2.md` | 2軸マトリクスによる分類・判断 |
| `kpi-cards.md` | （SVG でなく HTML `.kpi-grid` を使う委譲ページ） |
| `funnel.md` | 段階的な絞り込み・歩留まり |
| `relation.md` | 中心ノードと周辺ノードの関係・体制 |
