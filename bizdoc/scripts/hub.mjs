#!/usr/bin/env node
// hub.mjs — doc-hub CLI（add / list / reindex / open）
// SSOT は projects/**（project.json / manifest.json）。index.html は使い捨て導出物であり、
// 消しても reindex で同一内容が再生成される（タイムスタンプを埋め込まない）。
//
// ドキュメント本体（projects/**/docs/**/index.html）は SSOT だが、その中の 2 つの
// **マーカー区間だけ**は導出領域として hub 側が書き換える（詳細は inject.mjs のヘッダ）。
//   - <style data-bizdoc="tokens">      … add 時に tokens.css を注入
//   - <!-- bizdoc:nav:start/end -->     … add で枠を作り、reindex が中身を貼り直す
// マーカーの外には決して触れない。マーカーを持たない文書は 1 バイトも変えずに素通りする。
//
// stdout 契約: add が印字するのは保存先 index.html の絶対パス 1 行のみ。
// 注入まわりの診断は必ず console.warn（stderr）へ出す（console.log を足すと契約が壊れる）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectIdFromPath, resolveMainWorktreeRoot, slugify } from './project-id.mjs';
import { renderIndex } from './render-index.mjs';
import { injectNavFrame, injectTokens, readTokensCss, refreshNavFile } from './inject.mjs';
import {
  applyOverrides,
  createGroup,
  deleteGroup,
  loadOverrides,
  pruneOrphans,
  renameGroup,
  resolveGroupKey,
  saveOverrides,
  setProjectOverride,
  suggestGroups,
} from './overrides.mjs';

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

// manifest.slug ベースで同一 slug の既存ドキュメントを探す（ディレクトリ名 parse はしない —
// slug 自体が -2 等で終わるケースと連番 suffix が区別できないため）
function findBySlug(docsDir, slug) {
  if (!fs.existsSync(docsDir)) return null;
  let best = null;
  for (const n of fs.readdirSync(docsDir)) {
    const dDir = path.join(docsDir, n);
    if (!fs.statSync(dDir).isDirectory()) continue;
    const man = readManifest(dDir);
    if (man?.slug === slug && (!best || (man.updated || '') > (best.man.updated || ''))) {
      best = { name: n, man };
    }
  }
  return best;
}

function extractSvgs(html) {
  // 注意: <svg> の入れ子は非対応（svg-patterns の規約で入れ子を禁止している）
  return html.match(/<svg[\s>][\s\S]*?<\/svg>/gi) || [];
}

function svgGate(html) {
  const svgs = extractSvgs(html);
  if (svgs.length === 0) return;
  if (spawnSync('xmllint', ['--version'], { stdio: 'ignore' }).error) {
    console.warn(`warn: xmllint が見つからないため SVG 検証をスキップ（${svgs.length}件）`);
    return;
  }
  svgs.forEach((svg, i) => {
    // stdin 渡しで検証する（共有 tmp への予測可能な一時ファイルは symlink 攻撃の余地があるため作らない）
    const r = spawnSync('xmllint', ['--noout', '-'], { input: svg, encoding: 'utf8' });
    if (r.status !== 0) die(`SVG #${i + 1} が不正な XML です（add を中止）:\n${r.stderr}`);
  });
}

// project.json の accent を解決する。既存値があれば維持し、未設定のときだけ --accent を採用して
// 書き戻す（同一プロジェクトの文書間でアクセントがぶれるのを防ぐ現行の約束をそのまま守る）。
function applyAccent(proj, requested) {
  const projJson = path.join(PROJECTS, proj.id, 'project.json');
  if (proj.accent) {
    if (requested && requested !== proj.accent) {
      console.warn(`warn: このプロジェクトの accent は ${proj.accent} で確定済みのため --accent は無視します`);
    }
    return proj.accent;
  }
  if (!requested) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(requested)) {
    console.warn(`warn: --accent は #rrggbb 形式で指定してください（無視しました）: ${requested}`);
    return null;
  }
  const value = requested.toLowerCase();
  try {
    const cur = JSON.parse(fs.readFileSync(projJson, 'utf8'));
    if (!cur.accent) {
      cur.accent = value;
      fs.writeFileSync(projJson, JSON.stringify(cur, null, 2) + '\n');
    }
    proj.accent = cur.accent;
    return cur.accent;
  } catch {
    console.warn('warn: project.json を更新できなかったため accent を既定のまま保存します');
    return null;
  }
}

function cmdAdd(htmlPath, opts) {
  ensureHub();
  if (!htmlPath || !fs.existsSync(htmlPath)) die(`HTML が見つかりません: ${htmlPath}`);
  const html = fs.readFileSync(htmlPath, 'utf8');
  svgGate(html);
  const proj = resolveProject(opts.project || process.cwd());
  const title = opts.title || readTitle(html, path.basename(htmlPath, path.extname(htmlPath)));
  const slug = slugify(opts.slug || title);
  const docsDir = path.join(PROJECTS, proj.id, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const existing = findBySlug(docsDir, slug);
  let name;
  let prev = null;
  if (opts.update) {
    if (!existing) die(`--update の対象がありません（slug: ${slug}）`);
    name = existing.name;
    prev = existing.man;
  } else if (existing && !opts.new) {
    die(
      `同じ slug のドキュメントが既にあります: ${existing.name}` +
        `（title: ${existing.man.title} / updated: ${existing.man.updated}）\n` +
        `--update で更新、--new で別ドキュメントとして追加してください`
    );
  } else {
    name = `${today()}-${slug}`;
    let n = 2;
    while (fs.existsSync(path.join(docsDir, name))) name = `${today()}-${slug}-${n++}`;
  }
  const docDir = path.join(docsDir, name);
  fs.mkdirSync(docDir, { recursive: true });

  // アクセント色: project.json に既存値があればそれを優先（文書間でぶれさせない）。
  // 未設定のときだけ --accent を採用し、project.json へ書き戻す。
  const accent = applyAccent(proj, opts.accent);

  // 導出領域の注入。svgGate は上で注入前の原文に対して実行済み（原文検証の意味を保つ）
  let outHtml = injectTokens(html, readTokensCss(), accent);
  const framed = injectNavFrame(outHtml);
  if (!framed.injected) console.warn('warn: <body> が無いため hub ナビを注入しませんでした');
  outHtml = framed.html;
  fs.writeFileSync(path.join(docDir, 'index.html'), outHtml);
  if (opts.assets) fs.cpSync(opts.assets, path.join(docDir, 'assets'), { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    schema_version: 1,
    title,
    slug,
    type: opts.type || prev?.type || 'その他',
    created: prev?.created || now,
    updated: now,
    entry: 'index.html',
    source_skill: opts['source-skill'] || prev?.source_skill || 'bizdoc',
    project_id: proj.id,
    tags: opts.tags ? opts.tags.split(',').map((s) => s.trim()).filter(Boolean) : prev?.tags || [],
    links: prev?.links || { decision_ids: [], jiku_focus_ids: [] },
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
      abs_path: proj.abs_path ?? null,
      accent: proj.accent ?? null,
      broken: !!proj.broken,
      docs,
    });
  }
  projects.sort((a, b) => (b.docs[0]?.updated || '').localeCompare(a.docs[0]?.updated || ''));
  return projects;
}

// index / list 用のデータ。collectIndex（SSOT 由来）に overrides を後段適用した結果を返す。
function buildIndexData() {
  const ov = loadOverrides(HUB, (msg) => console.warn(`warn: ${msg}`));
  return applyOverrides(collectIndex(), ov);
}

// nav マーカーを持つ全ドキュメントの中身を貼り直す。nav を描く経路をここ 1 本に集約することで、
// 新規追加（add → reindex）と既存の鮮度更新が同じコードを通り、冪等性が自明になる。
// バイト列が変わるときだけ書き込む（無変更なら mtime も動かさない）。
function refreshNavs(data) {
  let written = 0;
  for (const p of data.projects) {
    for (const d of p.docs) {
      if (d.broken) continue;
      const indexPath = path.join(PROJECTS, p.dir, 'docs', d.dir, 'index.html');
      const r = refreshNavFile(indexPath, {
        projectId: p.id,
        label: p.label,
        docs: p.docs,
        selfDir: d.dir,
      });
      if (r === 'written') written++;
    }
  }
  if (written) console.warn(`info: hub ナビを更新しました（${written}件）`);
}

function cmdReindex() {
  ensureHub();
  const data = buildIndexData();
  const html = renderIndex(data);
  const tmp = path.join(HUB, `.index-${process.pid}.tmp`);
  fs.writeFileSync(tmp, html);
  fs.renameSync(tmp, path.join(HUB, 'index.html')); // 原子書き込み（iCloud 同期・並行実行への防御）
  refreshNavs(data);
}

function cmdList(opts) {
  ensureHub();
  const { projects, groups } = buildIndexData();
  let data = projects;
  if (opts.project) {
    const p = findProject(opts.project);
    data = p ? data.filter((x) => x.id === p.id) : [];
  }
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  for (const p of data) {
    const g = groups.find((x) => x.key === p.group);
    const marks = [g ? `${g.label}/` : '', p.hidden ? '[非表示] ' : ''].join('');
    console.log(`${marks}${p.label} (${p.id}) — ${p.docs.length}件`);
    for (const d of p.docs) console.log(`  ${d.dir}  [${d.type}] ${d.title}`);
  }
}

// ref（project id または パス）を登録済みプロジェクトへ解決する。未登録なら中止する（発番しない）。
function requireProject(ref) {
  const p = findProject(ref);
  if (!p) die(`プロジェクトが見つかりません: ${ref}\n登録済みの id かパスを指定してください（一覧: hub.mjs list）`);
  return p;
}

// overrides を更新して保存し、index を貼り直す。存在しないプロジェクトのエントリはここで掃除する。
function updateOverrides(fn) {
  ensureHub();
  const ov = loadOverrides(HUB, (msg) => console.warn(`warn: ${msg}`));
  const next = pruneOrphans(fn(ov), loadProjects().map((p) => p.id));
  saveOverrides(HUB, next);
  cmdReindex();
  return next;
}

function requireGroupKey(ov, ref) {
  const key = resolveGroupKey(ov, ref);
  if (!key) die(`グループが見つかりません: ${ref}（一覧: hub.mjs group list）`);
  return key;
}

function cmdGroup(sub, rest, opts) {
  ensureHub();
  if (sub === 'list') {
    const { projects, groups } = buildIndexData();
    if (opts.json) {
      console.log(JSON.stringify({ groups, projects: projects.map((p) => ({ id: p.id, label: p.label, group: p.group, hidden: p.hidden })) }, null, 2));
      return;
    }
    for (const g of [...groups, { key: null, label: '(未分類)' }]) {
      const members = projects.filter((p) => p.group === g.key);
      console.log(`${g.label}${g.key ? ` (${g.key})` : ''} — ${members.length}プロジェクト`);
      for (const m of members) console.log(`  ${m.hidden ? '[非表示] ' : ''}${m.label} (${m.id}) — ${m.docs.length}件`);
    }
    return;
  }
  if (sub === 'add') {
    const label = rest[0];
    const refs = rest.slice(1);
    if (!label || refs.length === 0) die('使い方: hub.mjs group add <ラベル> <project...>');
    const targets = refs.map(requireProject);
    updateOverrides((ov) => {
      let next = ov;
      let key = resolveGroupKey(ov, label);
      if (!key) ({ key, next } = createGroup(ov, label));
      for (const t of targets) next = setProjectOverride(next, t.id, { group: key });
      return next;
    });
    console.log(`${label} に ${targets.length}件を割り当てました: ${targets.map((t) => t.label).join(', ')}`);
    return;
  }
  if (sub === 'remove') {
    if (rest.length === 0) die('使い方: hub.mjs group remove <project...>');
    const targets = rest.map(requireProject);
    updateOverrides((ov) => targets.reduce((acc, t) => setProjectOverride(acc, t.id, { group: null }), ov));
    console.log(`グループ割当を解除しました: ${targets.map((t) => t.label).join(', ')}`);
    return;
  }
  if (sub === 'rename') {
    const [ref, label] = rest;
    if (!ref || !label) die('使い方: hub.mjs group rename <グループ> <新しいラベル>');
    updateOverrides((ov) => renameGroup(ov, requireGroupKey(ov, ref), label));
    console.log(`グループ名を ${label} に変更しました`);
    return;
  }
  if (sub === 'delete') {
    const ref = rest[0];
    if (!ref) die('使い方: hub.mjs group delete <グループ>');
    updateOverrides((ov) => deleteGroup(ov, requireGroupKey(ov, ref)));
    console.log(`グループを削除しました（所属プロジェクトは未分類に戻ります）: ${ref}`);
    return;
  }
  if (sub === 'suggest') {
    const { projects } = buildIndexData();
    const suggestions = suggestGroups(projects);
    if (suggestions.length === 0) {
      console.log('パス階層からのグループ候補はありません。');
      return;
    }
    console.log('パス階層からのグループ候補（自動適用はしません。下のコマンドで反映）:');
    for (const s of suggestions) {
      console.log(`\n  ${s.label} — ${s.members.length}プロジェクト`);
      for (const m of s.members) console.log(`    ${m.label} (${m.id})`);
      console.log(`    → hub.mjs group add "${s.label}" ${s.members.map((m) => m.id).join(' ')}`);
    }
    return;
  }
  die(`不明なサブコマンド: group ${sub ?? '(なし)'}（list|add|remove|rename|delete|suggest）`);
}

function cmdProject(sub, rest) {
  ensureHub();
  if (sub === 'label') {
    const [ref, ...labelParts] = rest;
    if (!ref) die('使い方: hub.mjs project label <project> <表示名>（表示名を省略すると上書きを解除）');
    const target = requireProject(ref);
    const label = labelParts.join(' ');
    updateOverrides((ov) => setProjectOverride(ov, target.id, { label: label || null }));
    console.log(label ? `表示名を「${label}」にしました` : `表示名の上書きを解除しました（${target.label}）`);
    return;
  }
  if (sub === 'hide' || sub === 'show') {
    if (rest.length === 0) die(`使い方: hub.mjs project ${sub} <project...>`);
    const targets = rest.map(requireProject);
    const hidden = sub === 'hide' ? true : null;
    updateOverrides((ov) => targets.reduce((acc, t) => setProjectOverride(acc, t.id, { hidden }), ov));
    console.log(`${sub === 'hide' ? '一覧から隠しました' : '一覧に戻しました'}: ${targets.map((t) => t.label).join(', ')}`);
    return;
  }
  die(`不明なサブコマンド: project ${sub ?? '(なし)'}（label|hide|show）`);
}

function cmdOpen(opts) {
  ensureHub();
  if (!fs.existsSync(path.join(HUB, 'index.html'))) cmdReindex();
  let url = 'file://' + path.join(HUB, 'index.html');
  if (opts.group) {
    const key = resolveGroupKey(loadOverrides(HUB), opts.group);
    if (key) url += `#g-${key}`;
    else console.warn(`warn: グループが見つかりません: ${opts.group}（全体を開きます）`);
  } else if (opts.project) {
    const p = findProject(opts.project);
    if (p) url += `#p-${p.id}`;
  }
  spawnSync('open', [url]);
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
else if (cmd === 'list') cmdList(args);
else if (cmd === 'open') cmdOpen(args);
else if (cmd === 'group') cmdGroup(args._[1], args._.slice(2), args);
else if (cmd === 'project') cmdProject(args._[1], args._.slice(2));
else die(`使い方: hub.mjs <add|list|reindex|open|group|project> ...（不明なコマンド: ${cmd ?? '(なし)'}）`);
