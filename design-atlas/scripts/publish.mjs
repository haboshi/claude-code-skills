#!/usr/bin/env node
// publish.mjs — 生成した設計マップを doc-hub へ登録する。
// doc-hub の正本は bizdoc プラグイン。ここはその公開契約（projects/<id>/docs/<name>/ に
// index.html と manifest.json を置き、reindex を 1 回）に従うだけで、hub の実装は持たない。
// reindex は bizdoc の hub.mjs があるときだけ呼び、無ければ「未実施」として報告する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadModel, ModelError } from './lib/model.mjs';

const HUB = process.env.DOC_HUB_DIR || path.join(os.homedir(), 'Documents', 'doc-hub');
const PROJECTS = path.join(HUB, 'projects');
const here = path.dirname(fileURLToPath(import.meta.url));

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龯]+/g, '-').replace(/^-|-$/g, '') || 'design-atlas';
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;

/** doc-hub の中でディレクトリ名になる値。model 由来なので、結合する前に 1 階層分だと確かめる。 */
function safeSegment(value, label) {
  const s = String(value);
  if (!SAFE_SEGMENT.test(s)) throw new ModelError(`${label} は英小文字・数字・_・- のみ使えます: ${JSON.stringify(s).slice(0, 40)}`);
  return s;
}
const today = () => new Date().toISOString().slice(0, 10);

/** bizdoc の hub.mjs を探す。プラグインは独立して入るので、無いことを異常にしない。 */
function findHub() {
  const candidates = [
    process.env.DESIGN_ATLAS_HUB_CLI,
    path.join(here, '..', '..', 'bizdoc', 'scripts', 'hub.mjs'),
    path.join(os.homedir(), '.claude', 'plugins', 'bizdoc', 'scripts', 'hub.mjs'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function publish(modelPath, artifactDir, { slug: slugOpt, update = false } = {}) {
  const { model } = loadModel(modelPath);
  const rawProject = model.meta?.project ?? model.meta?.id;
  if (!rawProject) throw new ModelError('meta.project も meta.id もありません。doc-hub のプロジェクトを決められません');
  const projectId = safeSegment(rawProject, 'meta.project');
  const indexPath = path.join(artifactDir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new ModelError(`index.html がありません: ${artifactDir}`);

  // slugify は記号を潰すので `..` は残らないが、結合前にもう一度 1 階層分であることを確かめる。
  const slug = slugify(slugOpt ?? model.meta.title);
  if (slug.includes('/') || slug.includes(path.sep) || slug === '.' || slug === '..') throw new ModelError(`slug がディレクトリ名として使えません: ${slug}`);
  const docsDir = path.join(PROJECTS, projectId, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const existing = fs.readdirSync(docsDir).find((n) => n.endsWith(`-${slug}`));
  if (existing && !update) throw new ModelError(`同じ slug のドキュメントが既にあります: ${existing}（--update で更新してください）`);
  const name = existing && update ? existing : `${today()}-${slug}`;
  const docDir = path.join(docsDir, name);
  fs.mkdirSync(docDir, { recursive: true });

  const prev = fs.existsSync(path.join(docDir, 'manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(docDir, 'manifest.json'), 'utf8'))
    : null;

  // 成果物一式を写す。外部画像・検証結果も一緒に渡さないと、相対参照が切れて証跡も辿れない。
  const copied = [];
  for (const entry of fs.readdirSync(artifactDir, { withFileTypes: true })) {
    if (entry.name === 'model.json' || entry.name === 'layout.json') continue;
    const from = path.join(artifactDir, entry.name);
    const to = path.join(docDir, entry.name);
    fs.cpSync(from, to, { recursive: true });
    copied.push(entry.name);
  }

  const now = new Date().toISOString();
  const manifest = {
    schema_version: 1,
    title: model.meta.title,
    slug,
    type: '設計',
    created: prev?.created ?? now,
    updated: now,
    entry: 'index.html',
    source_skill: 'design-atlas',
    project_id: projectId,
    tags: prev?.tags ?? ['design-atlas', '設計マップ'],
    links: prev?.links ?? { decision_ids: [], jiku_focus_ids: [] },
  };
  fs.writeFileSync(path.join(docDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const hub = findHub();
  let reindexed = false;
  if (hub) {
    const r = spawnSync(process.execPath, [hub, 'reindex'], { encoding: 'utf8' });
    reindexed = r.status === 0;
  }
  return {
    doc: path.join(docDir, 'index.html'),
    name,
    copied: copied.length,
    reindexed,
    note: reindexed ? null : 'doc-hub の reindex は実行していません（bizdoc の hub.mjs が見つからないか失敗しました）。一覧には次の reindex で載ります。',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !['--slug'].includes(argv[i - 1]));
  const [modelPath, artifactDir] = positional;
  if (!modelPath) {
    console.error('usage: publish.mjs <model.json> [artifact-dir] [--slug <slug>] [--update]');
    process.exit(2);
  }
  try {
    const result = publish(modelPath, artifactDir ?? path.dirname(path.resolve(modelPath)), {
      slug: get('--slug'),
      update: argv.includes('--update'),
    });
    if (result.note) console.error(`  · ${result.note}`);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
