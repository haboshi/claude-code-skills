# Issue #55 図番号「全部 図1」修正の実証スクリーンショット

`scripts/screenshot.mjs` の **full セグメント**（`full-01.png`）で、figure 2 枚の採番と `.conclusion` 内の
`<code>` を修正前後で比較したもの。2 枚は同じ検証文書・同じ経路（tokens マーカーへの CSS 焼き込み。hub は通さない）で
撮っているので、差は CSS だけ。

| ファイル | 内容 |
|---|---|
| `before-full-01.png` | 修正前（c2c49ac / v0.11.1 の tokens.css）。図1 / **図1**。結論パネルの code は文字が見えない |
| `after-full-01.png` | 修正後（v0.11.2）。図1 / **図2**。結論パネルの code が読める |
| `sample.html` | 検証文書。`<style data-bizdoc="tokens"></style>` のマーカー付きで、figure 2 枚と `.conclusion` を 1 セグメント（2000px 以下）に収めている |
| `make.mjs` | 上の 2 枚を作り直すスクリプト（下記） |

注: Issue #55 の再現手順には「`crop-*` は要素を単独で再ラスタライズするため採番が常に 1」とあるが、これは v0.11.1 の
バグそのものの観測だった。crop は同じ描画ページからの clip 切り出し（2 倍スケール）で、修正後の `crop-02-figure.png` には
「図2」が写る。採番の判定に crop を使ってよい（ただし文書全体の通し番号は full セグメントで上から数える方が確実）。

## 再実行手順（bizdoc/ で実行。Chrome が必要）

```bash
node docs/evidence/issue-55-figure-counter/make.mjs            # before = c2c49ac の tokens.css、after = 現行
node docs/evidence/issue-55-figure-counter/make.mjs --before-ref <rev>
```

同じ採番を機械で読むテストは `tests/figure-numbering.test.mjs`（画面・印刷・`hub.mjs add` の保存物・退行形の陽性対照）。
