// render-index.mjs — hub の index.html を組み立てる。
//
// 入力契約: { projects, groups }
//   projects: [{ id, dir, label, abs_path, accent, broken, hidden, group, docs: [...] }]
//   groups:   [{ key, label }]
// 出力は自己完結の 1 ファイル HTML（file:// で開くため外部 CDN・外部フェッチは使わない）。
// タイムスタンプを埋め込まない（同じ入力なら同じバイト列 = reindex が冪等）。相対日付は
// クライアント側の描画時に計算する。
import os from 'node:os';
import { STYLES } from './index-assets/styles.mjs';
import { APP_JS } from './index-assets/app.mjs';

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 表示用にホームディレクトリを ~ へ短縮する
export function tildify(p) {
  if (!p) return '';
  const home = os.homedir();
  return p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

export function docHref(projectDir, docDir) {
  return `projects/${encodeURIComponent(projectDir)}/docs/${encodeURIComponent(docDir)}/index.html`;
}

// JS 描画が使えない環境（JavaScript 無効）でも全文書に辿り着けるようにする素の一覧
function noscriptList(projects) {
  return projects
    .filter((p) => !p.hidden)
    .map((p) => {
      const items = p.docs
        .map((d) => {
          const label = escapeHtml(`${d.title}（${d.type}）`);
          return d.broken ? `<li>${label}</li>` : `<li><a href="${docHref(p.dir, d.dir)}">${label}</a></li>`;
        })
        .join('');
      return `<h2>${escapeHtml(p.label)}</h2><ul>${items}</ul>`;
    })
    .join('\n');
}

export function renderIndex({ projects, groups }) {
  // 埋め込むのは描画に要る項目だけ。abs_path は ~ 短縮した表示用の path に置き換える。
  const payload = {
    groups,
    projects: projects.map((p) => ({
      id: p.id,
      dir: p.dir,
      label: p.label,
      path: tildify(p.abs_path),
      group: p.group ?? null,
      hidden: !!p.hidden,
      broken: !!p.broken,
      docs: p.docs.map((d) => ({
        dir: d.dir,
        title: d.title,
        type: d.type,
        updated: d.updated || '',
        tags: d.tags || [],
        broken: !!d.broken,
      })),
    })),
  };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const total = payload.projects.filter((p) => !p.hidden).reduce((a, p) => a + p.docs.length, 0);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>doc-hub</title>
<style>${STYLES}</style>
</head>
<body>
<h1 class="sr-only">doc-hub — 生成ドキュメントの一覧</h1>
<aside class="side" aria-label="プロジェクトの絞り込み">
  <button type="button" class="brand"><b>doc-hub</b><span>${total} DOCUMENTS</span><i></i></button>
  <div class="side-filter" hidden><input type="search" placeholder="プロジェクトを絞る" aria-label="プロジェクト名で絞り込む" autocomplete="off" spellcheck="false"></div>
  <nav class="scopes" id="scopes" aria-label="プロジェクト"></nav>
  <div class="side-foot"><label><input type="checkbox">非表示のプロジェクトも出す</label></div>
</aside>
<div class="main">
  <header class="head">
    <h2 class="crumb"></h2>
    <div class="search"><input type="search" placeholder="タイトル・タグ・種別・プロジェクトで探す" aria-label="ドキュメントを探す（空白区切りで絞り込み）" autocomplete="off" spellcheck="false"><kbd>/</kbd></div>
  </header>
  <div class="facets-row">
    <div class="facets" role="group" aria-label="種別とタグの絞り込み"></div>
    <div class="facet-actions">
      <button type="button" class="clearbtn" hidden>絞り込みを解除</button>
      <button type="button" class="sortbtn">更新日順 ⇄ タイトル順</button>
    </div>
  </div>
  <p class="sr-only" role="status" aria-live="polite"></p>
  <main class="list"></main>
</div>
<noscript>
<div style="padding:1.5rem">
<p><b>このページは JavaScript で描画されます。</b>無効のため、素の一覧を表示しています。</p>
${noscriptList(payload.projects)}
</div>
</noscript>
<script>window.__DOC_HUB__ = ${json};</script>
<script>${APP_JS}</script>
</body>
</html>
`;
}
