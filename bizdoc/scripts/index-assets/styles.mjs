// styles.mjs — index.html に埋め込む CSS。
// bizdoc 本体（templates/tokens.css）と同じ語彙（accent 1色・palt・tabular-nums・角丸 10-12px）を
// 使いつつ、こちらは「読む文書」ではなく「探す道具」なので情報密度を上げている。
// 外部フォント・外部画像は使わない（file:// / オフラインで開くため）。
export const STYLES = `
:root {
  --accent: #2563eb; --accent-soft: #eef4ff; --accent-ink: #1d4ed8;
  /* アクセント面の上に載る文字色。ダークのアクセントは明るいので暗い文字に入れ替える */
  --on-accent: #ffffff; --on-accent-2: rgba(255, 255, 255, .82);
  /* ink-3 は日付・件数・タグなど 11px 前後の小さい文字（タグは押せる操作要素）に使う。
     bizdoc 本体の #9ca3af は白地に 2.3:1 しかないため、4.5:1 を満たす濃さに置き換えている */
  --ink: #111827; --ink-2: #4b5563; --ink-3: #646e7d;
  --line: #e5e7eb; --line-strong: #d1d5db;
  --bg: #ffffff; --bg-soft: #f8fafc; --bg-sink: #eef2f7;
  --danger: #b91c1c; --danger-soft: #fef2f7;
  --shadow: 0 1px 2px rgba(15,23,42,.06), 0 8px 24px -18px rgba(15,23,42,.35);
  /* スクロールバーやフォーム部品もテーマに追随させる */
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent: #6ea8ff; --accent-soft: #16263d; --accent-ink: #9cc4ff;
    --on-accent: #0a111c; --on-accent-2: rgba(10, 17, 28, .72);
    --ink: #e6eaf0; --ink-2: #a3aebd; --ink-3: #8894a6;
    --line: #232c38; --line-strong: #33404f;
    --bg: #0e131a; --bg-soft: #131a23; --bg-sink: #182029;
    --danger: #f87171; --danger-soft: #2a1618;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -18px rgba(0,0,0,.8);
  }
}
* { box-sizing: border-box; }
.hidden { display: none !important; }
html, body { height: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
  font-size: 14px; line-height: 1.7; font-feature-settings: "palt";
  -webkit-font-smoothing: antialiased;
  display: grid; grid-template-columns: 16.5rem minmax(0, 1fr); overflow: hidden;
}
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
a { color: inherit; text-decoration: none; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
/* padding を入れると日本語の途中で語が割れて見えるので、色と下線だけで示す */
mark { background: transparent; color: var(--accent-ink); font-weight: 700; box-shadow: inset 0 -.35em var(--accent-soft); }

/* ── 左：スコープ（グループ > プロジェクト）─────────────── */
.side {
  background: var(--bg-soft); border-right: 1px solid var(--line);
  display: flex; flex-direction: column; min-height: 0;
}
.brand { padding: 1.15rem 1.1rem .85rem; border-bottom: 1px solid var(--line); }
.brand b { display: block; font-size: 15px; letter-spacing: .02em; }
.brand span { display: block; margin-top: .1rem; font-size: 10.5px; letter-spacing: .16em; color: var(--ink-3); font-weight: 700; }
.brand i { display: block; width: 2.2rem; height: 3px; background: var(--accent); border-radius: 2px; margin-top: .5rem; }
.scopes { flex: 1; min-height: 0; overflow-y: auto; padding: .6rem .55rem 1rem; }
.grp { margin-top: .45rem; }
.grp-h {
  display: flex; align-items: center; gap: .15rem; width: 100%; padding: .3rem .5rem .3rem .1rem;
  font-size: 11px; font-weight: 700; letter-spacing: .1em; color: var(--ink-2);
}
.grp-h .caret { flex: none; width: 1.1rem; transition: transform .15s; font-size: 9px; color: var(--ink-3); border-radius: 4px; }
.grp-h .caret:hover { color: var(--ink); background: var(--bg-sink); }
.grp-h[aria-expanded="false"] .caret { transform: rotate(-90deg); }
.grp-h .gl { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: .1rem .25rem; border-radius: 5px; }
.grp-h button.gl:hover { color: var(--ink); background: var(--bg-sink); }
.grp-h .gl[aria-current="true"] { color: var(--accent-ink); background: var(--accent-soft); }
.grp-h .gn { flex: none; font-weight: 600; letter-spacing: 0; padding-left: .3rem; }
.grp-b { overflow: hidden; }
.grp-h[aria-expanded="false"] + .grp-b { display: none; }
.scope {
  display: flex; align-items: baseline; gap: .5rem; width: 100%; text-align: left;
  padding: .34rem .55rem; border-radius: 7px; color: var(--ink-2); line-height: 1.5;
}
.scope:hover { background: var(--bg-sink); color: var(--ink); }
.scope .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.scope .n { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.scope[aria-current="true"] { background: var(--accent-soft); color: var(--accent-ink); font-weight: 700; box-shadow: inset 2px 0 var(--accent); }
.scope[aria-current="true"] .n { color: var(--accent-ink); }
.scope.is-broken .nm::after { content: " ●"; color: var(--danger); }
.scope.is-hidden .nm { opacity: .55; font-style: italic; }
/* 0 件でも押せる行なので、薄くしすぎない（件数の 0 で十分見分けがつく） */
.scope.is-zero .nm { color: var(--ink-3); font-weight: 400; }
.grp-b .scope { padding-left: 1.15rem; }
.side-foot { border-top: 1px solid var(--line); padding: .6rem .9rem .75rem; font-size: 11.5px; color: var(--ink-3); }
.side-foot label { display: flex; align-items: center; gap: .4rem; cursor: pointer; }
.side-foot input { accent-color: var(--accent); }

/* ── 右：ヘッダ ──────────────────────────────────── */
.main { min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.head { display: flex; align-items: center; gap: .9rem; padding: .95rem 1.6rem .8rem; background: var(--bg); }
.crumb { font-size: 18px; font-weight: 700; letter-spacing: .01em; display: flex; align-items: baseline; gap: .5rem; min-width: 0; }
.crumb .grp-of { font-size: 11px; font-weight: 700; letter-spacing: .12em; color: var(--ink-3); }
.crumb .grp-of::after { content: " /"; color: var(--line-strong); }
.crumb .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crumb .cnt { flex: none; font-size: 12px; font-weight: 400; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.crumb .cnt b { font-size: 14px; font-weight: 700; color: var(--accent); }
/* 幅が足りないときに削るのはパスの方（プロジェクト名を潰さない）。
   flex:none だと長いパスが名前を押し出す */
.crumb .nm { flex: 0 1 auto; }
.crumb .path { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; font-weight: 400; color: var(--ink-3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.search { margin-left: auto; position: relative; flex: none; }
.search input {
  width: 20rem; padding: .42rem 2.1rem .42rem .8rem; font: inherit; font-size: 13px;
  color: var(--ink); background: var(--bg-soft);
  border: 1px solid var(--line-strong); border-radius: 999px;
}
.search input::placeholder { color: var(--ink-3); }
.search input:focus { outline: none; border-color: var(--accent); background: var(--bg); box-shadow: 0 0 0 3px var(--accent-soft); }
.search kbd {
  position: absolute; right: .5rem; top: 50%; transform: translateY(-50%);
  font: inherit; font-size: 10.5px; color: var(--ink-3); border: 1px solid var(--line-strong);
  border-radius: 4px; padding: 0 .3rem; pointer-events: none; background: var(--bg);
}
.search input:not(:placeholder-shown) + kbd { display: none; }
.facet-actions { flex: none; align-self: flex-start; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .3rem; }
.sortbtn, .clearbtn { font-size: 11.5px; color: var(--ink-2); padding: .1rem .55rem; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.sortbtn:hover { border-color: var(--line-strong); background: var(--bg-soft); }
.clearbtn { border-color: var(--danger); color: var(--danger); }
.clearbtn:hover { background: var(--danger-soft); }

/* ── 右：ファセット ──────────────────────────────── */
.facets-row { display: flex; align-items: flex-start; gap: .9rem; padding: 0 1.6rem .7rem; border-bottom: 1px solid var(--line); background: var(--bg); }
/* 「他 58」を開くとチップが大量に並ぶので、ここだけ独立してスクロールさせ一覧の面積を守る。
   閉じているときは 2〜3 行、開いたときは画面の 4 割までに伸ばす */
.facets { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: .28rem; max-height: 7.5rem; overflow-y: auto; }
.facets.expanded { max-height: 40vh; }
/* ラベル列を固定し、チップが折り返してもラベルの右端で揃うようにする */
.facet-line { display: grid; grid-template-columns: 2.6rem minmax(0, 1fr); align-items: start; gap: .3rem; }
.facet-chips { display: flex; flex-wrap: wrap; gap: .28rem; }
.facet-label { font-size: 10px; font-weight: 700; letter-spacing: .1em; color: var(--ink-3); padding-top: .22rem; }
.facet-label i { display: block; font-style: normal; font-weight: 600; font-size: 9px; letter-spacing: 0; color: var(--accent); }
.facet-note { align-self: center; margin-left: .35rem; padding-left: .55rem; border-left: 1px solid var(--line-strong); font-size: 9.5px; color: var(--ink-3); }
.facet-filter { width: 7.5rem; padding: .1rem .6rem; font: inherit; font-size: 11.5px; color: var(--ink);
  background: var(--bg-soft); border: 1px solid var(--line-strong); border-radius: 999px; }
.facet-filter:focus { outline: none; border-color: var(--accent); background: var(--bg); box-shadow: 0 0 0 3px var(--accent-soft); }
.facet-none { align-self: center; font-size: 11px; color: var(--ink-3); }
.side-filter { padding: .55rem .8rem .1rem; }
.side-filter input { width: 100%; padding: .28rem .7rem; font: inherit; font-size: 12px; color: var(--ink);
  background: var(--bg); border: 1px solid var(--line-strong); border-radius: 999px; }
.side-filter input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.chip {
  display: inline-flex; align-items: baseline; gap: .3rem; padding: .12rem .55rem;
  border: 1px solid var(--line); border-radius: 999px; font-size: 11.5px; color: var(--ink-2);
  background: var(--bg); white-space: nowrap;
}
.chip:hover { border-color: var(--accent); color: var(--accent-ink); }
.chip .n { font-size: 10px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.chip[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
.chip[aria-pressed="true"] .n { color: var(--on-accent-2); }
.chip.more { border-style: dashed; color: var(--ink-3); }
.chip.rel { border-style: dashed; border-color: var(--accent); color: var(--accent-ink); background: var(--accent-soft); }
.chip.clear { border-color: var(--danger); color: var(--danger); }
.facet-sep { width: 1px; align-self: stretch; background: var(--line); margin: .1rem .45rem; }

/* ── 右：一覧 ────────────────────────────────────── */
.list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 1.6rem 3rem; scroll-padding-top: 2.2rem; }
.month {
  position: sticky; top: 0; z-index: 2; background: var(--bg);
  padding: 1.1rem 0 .35rem; font-size: 11px; font-weight: 700; letter-spacing: .12em; color: var(--ink-2);
  display: flex; align-items: center; gap: .6rem;
}
.month::before { content: ""; width: .95rem; height: 2px; background: var(--accent); border-radius: 2px; }
.month::after { content: ""; flex: 1; height: 1px; background: var(--line); }
/* タイトル列に上限を置き、右端のタグ列を本文に寄せる（1fr のままだと広い画面で間が空洞になる） */
.doc {
  display: grid; grid-template-columns: 4.2rem minmax(0, 44rem) minmax(0, 19rem); gap: 0 1.2rem;
  padding: .42rem .7rem .46rem; border-radius: 9px; border: 1px solid transparent; align-items: center;
  border-bottom: 1px solid var(--line);
}
.doc { cursor: pointer; }
.doc.broken { cursor: default; }
.doc:hover { background: var(--bg-soft); border-color: var(--line); }
.doc[data-cursor="1"] { background: var(--accent-soft); border-color: var(--accent); }
.doc .ttl:focus-visible { outline-offset: 3px; }
.doc .when { font-size: 11px; color: var(--ink-3); font-variant-numeric: tabular-nums; line-height: 1.45; }
.doc .when b { display: block; font-size: 12.5px; font-weight: 700; color: var(--ink-2); letter-spacing: -.01em; }
.doc .body { min-width: 0; }
/* block でないと（タイトルは <a> なので既定は inline）overflow が効かず ellipsis が死ぬ */
.doc .ttl { display: block; font-size: 14px; font-weight: 600; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc:hover .ttl, .doc[data-cursor="1"] .ttl { color: var(--accent-ink); }
.doc .meta { display: flex; flex-wrap: nowrap; align-items: baseline; gap: .35rem; font-size: 11.5px; color: var(--ink-3); overflow: hidden; }
.doc .kind { flex: none; padding: 0 .4rem; border: 1px solid var(--line-strong); border-radius: 999px; font-size: 10px; color: var(--ink-2); background: var(--bg-soft); }
.doc .of { flex: none; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.doc .tags { display: flex; gap: .35rem; overflow: hidden; font-size: 11px; }
.doc .tag { flex: none; color: var(--ink-3); white-space: nowrap; border-radius: 4px; }
.doc .tag::before { content: "#"; opacity: .55; }
.doc .tag.more { flex: none; color: var(--ink-3); }
.doc .tag.more::before { content: ""; }
button.tag:hover { color: var(--accent-ink); text-decoration: underline; }
.doc .tag[data-on] { color: var(--accent-ink); font-weight: 700; }
.doc .why { flex: none; color: var(--danger); }
.doc .why::before { content: "・"; color: var(--ink-3); }
.doc.broken { color: var(--danger); }
.doc.broken .ttl, .doc.broken:hover .ttl, .doc.broken[data-cursor="1"] .ttl { color: var(--danger); }
.doc.broken .kind { border-color: var(--danger); color: var(--danger); background: var(--danger-soft); }
@media (max-width: 1080px) { .doc { grid-template-columns: 4.2rem minmax(0, 1fr); } .doc .tags { display: none; } }
.empty { padding: 3.5rem 0; text-align: center; color: var(--ink-3); }
.empty b { display: block; font-size: 15px; color: var(--ink-2); margin-bottom: .3rem; }
.empty button { margin-top: .8rem; border: 1px solid var(--line-strong); border-radius: 999px; padding: .25rem .9rem; font-size: 12px; color: var(--ink-2); }
.empty button:hover { border-color: var(--accent); color: var(--accent-ink); }
.hint { padding: 1.4rem 0 0; font-size: 11px; color: var(--ink-3); }
.hint kbd { border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 .3rem; font-size: 10.5px; font-family: inherit; }

/* ── 幅の適応 ────────────────────────────────────── */
@media (max-width: 1100px) { .search input { width: 13rem; } .crumb .path { display: none; } }
@media (max-width: 820px) {
  body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
  .side { border-right: none; border-bottom: 1px solid var(--line); max-height: 42vh; }
  .side.collapsed .scopes, .side.collapsed .side-foot { display: none; }
  .brand { display: flex; align-items: center; gap: .6rem; padding: .7rem 1rem; cursor: pointer; }
  .brand i { display: none; }
  .brand span { margin-left: auto; margin-top: 0; }
  /* 畳んだ状態でも「ここからプロジェクトを選べる」と分かるようにする */
  .brand span { font-size: 10px; }
  .brand::after { content: "プロジェクト ▾"; flex: none; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; color: var(--accent); }
  .side:not(.collapsed) .brand::after { content: "閉じる ▴"; color: var(--ink-3); }
  .head, .facets-row, .list { padding-left: 1rem; padding-right: 1rem; }
  .head { flex-wrap: wrap; }
  .search { margin-left: 0; width: 100%; }
  .search input { width: 100%; }
}
@media print { .side, .facets-row, .search, .hint { display: none; } body { display: block; overflow: visible; } .list { overflow: visible; } }
`;
