# 日本語ラベルの扱い

draw.io は日本語をそのまま扱えるが、**改行とフォントの2点だけ落とし穴がある**。
いずれも実測（draw.io Desktop v31.1.8 の SVG export）で確認したもの。

## 改行に `\n` は使えない

`value="一行目\n二行目"` と書くと、改行されず**バックスラッシュと n がそのまま表示される**。

| 書き方 | 結果 | 条件 |
|---|---|---|
| `value="一行目&#xa;二行目"` | 改行される | `html=0` / `html=1` どちらでも |
| `value="一行目&lt;br&gt;二行目"` | 改行される | style に `html=1` が要る |
| `value="一行目\n二行目"` | **改行されない** | — |

`&#xa;` が無難。`validate` は `\n` を見つけたら警告する。

## HTML ラベルには `html=1` が要る

style に `html=1` が無いまま `value` にタグを入れると、タグが生のまま表示される。

```
style="rounded=1;whiteSpace=wrap;html=1;"
value="&lt;b&gt;売上&lt;/b&gt;&#xa;前年比 120%"
```

`whiteSpace=wrap` も併せて付ける。無いと長い日本語が図形からはみ出す。

## フォントは export 時に補う必要がある

draw.io の SVG export は `font-family: Helvetica` としか書かない。Helvetica は日本語の
グリフを持たないので、**表示は閲覧環境のフォールバック任せ**になり、環境によって字形や
字幅が変わる。

本プラグインの `inline` は、SVG 内に日本語があれば自動でフォールバックを足す。

```
font-family: Helvetica, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif
```

`--no-font-fallback` で止められる。図の中で明示的にフォントを決めたい場合は、
mxCell の style に `fontFamily=Hiragino Sans` を書けば export にもそのまま出る。

## 文字数とレイアウト

- 日本語は同じ文字数でも欧文より横幅を食う。図形幅は**欧文の想定より 1.5 倍**を見ておく
- ラベルが長くなるときは、図形を広げるより `&#xa;` で折り返すほうが図全体の座標が崩れない
- `inline` は viewBox 幅が 780 を超えると警告する。本文幅に収まらない図は縮小表示され、
  図中の日本語が本文より小さくなって読めなくなる

## PNG に落とすときの注意

`html=1` のラベルは SVG では `<foreignObject>` として描かれる。ブラウザでは正しく
表示されるが、**foreignObject を解釈しないレンダラでは文字が消える**。draw.io は
`<switch>` で `<text>` のフォールバックも書き出すので、PNG 化は draw.io Desktop
（`export --format png`）を使うのが最も安全。
