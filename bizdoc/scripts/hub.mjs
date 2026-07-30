#!/usr/bin/env node
// hub.mjs — doc-hub CLI（add / list / reindex / open）
// SSOT は projects/**（project.json / manifest.json）。index.html は使い捨て導出物であり、
// 消しても reindex で同一内容が再生成される（タイムスタンプを埋め込まない）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectIdFromPath, resolveMainWorktreeRoot, slugify } from './project-id.mjs';

const HUB = process.env.DOC_HUB_DIR || path.join(os.homedir(), 'Documents', 'doc-hub');
const PROJECTS = path.join(HUB, 'projects');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function ensureHub() {
  fs.mkdirSync(PROJECTS, { recursive: true });
  const pointer = path.join(HUB, '.hub-cli');
  const self = fileURLToPath(import.meta.url);
  if (!fs.existsSync(pointer) || fs.readFileSync(pointer, 'utf8').trim() !== self) {
    fs.writeFileSync(pointer, self + '\n');
  }
}

function loadProjects() {
  if (!fs.existsSync(PROJECTS)) return [];
  const out = [];
  for (const dir of fs.readdirSync(PROJECTS)) {
    try {
      const pj = JSON.parse(fs.readFileSync(path.join(PROJECTS, dir, 'project.json'), 'utf8'));
      out.push({ dir, ...pj });
    } catch { /* 破損 project.json は collectIndex 側で破損エントリとして扱う */ }
  }
  return out;
}

// 発番なしの検索（list / open 用）。ref は project id または パス
function findProject(ref) {
  const projects = loadProjects();
  const byId = projects.find((p) => p.id === ref);
  if (byId) return byId;
  const root = resolveMainWorktreeRoot(path.resolve(ref));
  return (
    projects.find((p) => p.abs_path === root) ||
    projects.find((p) => (p.aliases || []).includes(root)) ||
    null
  );
}

// 発番ありの解決（add 用）。解決順: abs_path 一致 → aliases 一致 → 新規発番。
// 発番後の id は不変。パス移動時は project.json の abs_path を手で書き換えて追随する。
function resolveProject(ref) {
  const found = findProject(ref);
  if (found) return found;
  const root = resolveMainWorktreeRoot(path.resolve(ref));
  const id = projectIdFromPath(root);
  const proj = {
    id,
    label: path.basename(root),
    abs_path: root,
    aliases: [],
    accent: null,
    created: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(PROJECTS, id, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(PROJECTS, id, 'project.json'), JSON.stringify(proj, null, 2) + '\n');
  return { dir: id, ...proj };
}

function readManifest(docDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(docDir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readTitle(html, fallback) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1].trim() : fallback;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function cmdAdd(htmlPath, opts) {
  ensureHub();
  if (!htmlPath || !fs.existsSync(htmlPath)) die(`HTML が見つかりません: ${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const proj = resolveProject(opts.project || process.cwd());
  const title = opts.title || readTitle(html, path.basename(htmlPath, path.extname(htmlPath)));
  const slug = slugify(opts.slug || title);
  const docsDir = path.join(PROJECTS, proj.id, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const name = `${today()}-${slug}`;
  const docDir = path.join(docsDir, name);
  fs.mkdirSync(docDir, { recursive: true });
  fs.copyFileSync(htmlPath, path.join(docDir, 'index.html'));
  if (opts.assets) fs.cpSync(opts.assets, path.join(docDir, 'assets'), { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    schema_version: 1,
    title,
    slug,
    type: opts.type || 'その他',
    created: now,
    updated: now,
    entry: 'index.html',
    source_skill: opts['source-skill'] || 'bizdoc',
    project_id: proj.id,
    tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : [],
    links: { decision_ids: [], jiku_focus_ids: [] },
  };
  fs.writeFileSync(path.join(docDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  cmdReindex();
  console.log(path.join(docDir, 'index.html'));
}

// index 用データ収集。壊れた project.json / manifest.json は「破損」エントリとして残す
function collectIndex() {
  const projects = [];
  if (!fs.existsSync(PROJECTS)) return projects;
  for (const dir of fs.readdirSync(PROJECTS).sort()) {
    const projDir = path.join(PROJECTS, dir);
    if (!fs.statSync(projDir).isDirectory()) continue;
    let proj;
    try {
      proj = JSON.parse(fs.readFileSync(path.join(projDir, 'project.json'), 'utf8'));
    } catch {
      proj = { id: dir, label: dir, broken: true };
    }
    const docs = [];
    const docsDir = path.join(projDir, 'docs');
    if (fs.existsSync(docsDir)) {
      for (const n of fs.readdirSync(docsDir).sort()) {
        const dDir = path.join(docsDir, n);
        if (!fs.statSync(dDir).isDirectory()) continue;
        const man = readManifest(dDir);
        if (man) {
          docs.push({ dir: n, title: man.title, type: man.type, updated: man.updated, tags: man.tags || [] });
        } else {
          docs.push({ dir: n, title: n, type: '破損', updated: '', tags: [], broken: true });
        }
      }
    }
    docs.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    projects.push({
      id: proj.id ?? dir,
      dir,
      label: proj.label ?? dir,
      accent: proj.accent ?? null,
      broken: !!proj.broken,
      docs,
    });
  }
  projects.sort((a, b) => (b.docs[0]?.updated || '').localeCompare(a.docs[0]?.updated || ''));
  return projects;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIndex(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const sections = data
    .map((p) => {
      const rows = p.docs
        .map((d) => {
          const date = d.dir.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
          const cls = d.broken ? ' class="broken"' : '';
          const link = d.broken
            ? escapeHtml(d.title)
            : `<a href="projects/${encodeURIComponent(p.dir)}/docs/${encodeURIComponent(d.dir)}/index.html">${escapeHtml(d.title)}</a>`;
          return `<tr${cls} data-search="${escapeHtml([d.title, d.type, ...(d.tags || [])].join(' ').toLowerCase())}"><td>${date}</td><td><span class="type">${escapeHtml(d.type)}</span></td><td>${link}</td><td>${escapeHtml((d.tags || []).join(', '))}</td></tr>`;
        })
        .join('\n');
      return `<section id="p-${escapeHtml(p.id)}">
<h2>${escapeHtml(p.label)}${p.broken ? ' <span class="broken-badge">project.json 破損</span>' : ''} <span class="count">${p.docs.length}件</span></h2>
<table><thead><tr><th>日付</th><th>種別</th><th>タイトル</th><th>タグ</th></tr></thead><tbody>
${rows}
</tbody></table>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>doc-hub</title>
<style>
:root { --accent: #2563eb; --ink: #1f2937; --ink-2: #6b7280; --line: #e5e7eb; --bg: #ffffff; --bg-soft: #f8fafc; }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem 1.5rem 4rem; background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif;
  max-width: 60rem; margin-inline: auto; line-height: 1.6; }
h1 { font-size: 1.4rem; border-bottom: 3px solid var(--accent); padding-bottom: .5rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
.count { color: var(--ink-2); font-weight: normal; font-size: .85rem; }
input[type="search"] { width: 100%; padding: .55rem .8rem; font-size: .95rem; border: 1px solid var(--line); border-radius: 8px; }
table { width: 100%; border-collapse: collapse; font-size: .9rem; }
th { text-align: left; color: var(--ink-2); font-weight: 600; border-bottom: 2px solid var(--line); padding: .4rem .5rem; }
td { border-bottom: 1px solid var(--line); padding: .45rem .5rem; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.type { background: var(--bg-soft); border: 1px solid var(--line); border-radius: 999px; padding: .05rem .55rem; font-size: .78rem; }
.broken td, .broken-badge { color: #b91c1c; }
.broken-badge { font-size: .75rem; border: 1px solid #fecaca; background: #fef2f2; border-radius: 999px; padding: .05rem .5rem; }
.hidden { display: none; }
</style>
</head>
<body>
<h1>doc-hub</h1>
<p><input type="search" id="q" placeholder="タイトル・種別・タグで絞り込み" autocomplete="off"></p>
${sections}
<script>
const DATA = ${json};
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const needle = q.value.trim().toLowerCase();
  document.querySelectorAll('tbody tr').forEach((tr) => {
    tr.classList.toggle('hidden', needle !== '' && !tr.dataset.search.includes(needle));
  });
  document.querySelectorAll('section').forEach((sec) => {
    sec.classList.toggle('hidden', needle !== '' && sec.querySelectorAll('tbody tr:not(.hidden)').length === 0);
  });
});
</script>
</body>
</html>
`;
}

function cmdReindex() {
  ensureHub();
  const html = renderIndex(collectIndex());
  const tmp = path.join(HUB, `.index-${process.pid}.tmp`);
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, path.join(HUB, 'index.html')); // 原子書き込み（iCloud 同期・並行実行への防御）
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update' || a === '--new' || a === '--json') args[a.slice(2)] = true;
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
if (cmd === 'add') cmdAdd(args._[1], args);
else if (cmd === 'reindex') cmdReindex();
else die(`使い方: hub.mjs <add|list|reindex|open> ...（不明なコマンド: ${cmd ?? '(なし)'}）`);
