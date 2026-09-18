#!/usr/bin/env node
// build.mjs — model.json + layout.json（+ 画像）から index.html を 1 回で組み立てる。
// 生成物にタイムスタンプを埋めないので、同じ入力からは同じバイト列が出る。
// 画像は既定で外部ファイル参照。--inline のときだけ WEBP に変換して埋め込む（配布用の 1 枚化）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, resolveWithin, ModelError } from './lib/model.mjs';
import { normalize, edgesFor } from './lib/normalize.mjs';
import { MODES } from './layout.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const asset = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');

const VIEW_TEXT = {
  overview: { eyebrow: 'CONNECTED VIEW', title: '画面・業務・データの対応', description: '業務のまとまりごとに、担当画面と代表データを重ねた俯瞰図です。', caption: (D) => `${D.groups.length}業務 · ${D.screens.length}画面` },
  screens: { eyebrow: 'SCREEN CONNECTIONS', title: '画面と操作のつながり', description: '丸い番号は画面内の操作位置。下部の操作ラベルは詳細表示・画面外の操作です。', caption: (D) => `${D.screens.length}画面 · ${D.transitions.length}遷移` },
  er: { eyebrow: 'ENTITY RELATIONSHIPS', title: 'データの関係と参照キー', description: '左の参照元から右の参照先へ。業務領域ごとにまとめ、項目の位置へ接続します。', caption: (D) => `参照元 → 参照先 · ${D.entities.length}概念 · ${D.relations.length}関係` },
  flow: { eyebrow: 'BUSINESS FLOW', title: '業務の前後関係', description: '左から右へ進み、分岐を上下に配置します。手戻り・例外は外周の線です。', caption: (D) => `${D.processes.length}工程 · ${D.lanes.length}担当区分` },
};

/** 条件コードの表示名。その条件を含む経路のうち、最も絞り込みの強いものの名前を使う。 */
function conditionLabels(D) {
  const out = {};
  for (const cond of new Set(D.processes.map((p) => p.cond).filter(Boolean))) {
    const owners = D.scenarios.filter((s) => s.conditions.includes(cond)).sort((a, b) => a.conditions.length - b.conditions.length);
    out[cond] = owners[0]?.label ?? cond;
  }
  return out;
}

/** 画像内の操作位置を割合へ直す。撮影サイズが無いと座標の意味が決まらないので、そのときは落とす。 */
function pinPercent(pin, image) {
  if (!pin || !image?.width || !image?.height) return null;
  return { ...pin, xPct: ((pin.x + (pin.w ?? 0) / 2) / image.width) * 100, yPct: ((pin.y + (pin.h ?? 0) / 2) / image.height) * 100 };
}

export function buildData(model, layout, { modelSha, images = {}, sourceBodies = {}, imageRatio = 0.729 } = {}) {
  const D = normalize(model);
  const screens = D.screens.map((s) => ({ ...s, images: s.images.map(({ path: _p, ...rest }) => rest) }));
  const transitions = D.transitions.map((t) => {
    const from = D.screens.find((s) => s.id === t.a);
    const image = from?.images.find((i) => i.key === t.pin?.image);
    return { ...t, pin: image && !image.historical ? pinPercent(t.pin, image) : null };
  });
  const views = Object.fromEntries(
    MODES.filter((m) => layout.views[m]).map((m) => [m, { ...VIEW_TEXT[m], caption: VIEW_TEXT[m].caption(D) }]),
  );
  const edges = Object.fromEntries(MODES.filter((m) => layout.views[m]).map((m) => [m, edgesFor(D, m)]));
  const layouts = Object.fromEntries(
    Object.entries(layout.views).map(([m, v]) => [m, { nodes: v.nodes, bounds: v.bounds, areas: v.areas ?? null }]),
  );
  return {
    meta: D.meta,
    labels: D.labels,
    views,
    scenarios: D.scenarios,
    conditionLabels: conditionLabels(D),
    guide: D.guide,
    trace: D.trace,
    openQuestions: D.openQuestions,
    notVerified: D.notVerified,
    lanes: D.lanes,
    areas: D.areas,
    screens,
    entities: D.entities,
    transitions,
    relations: D.relations,
    processes: D.processes,
    processEdges: D.processEdges,
    groups: D.groups,
    extensions: D.extensions,
    layouts,
    edges,
    images,
    imageRatio,
    sources: D.sources.map((s) => ({ ...s, embedded: sourceBodies[s.id] != null })),
    sourceBodies,
    evidence: modelSha ? { model_sha256: modelSha, sources: D.sources.length } : null,
  };
}

function scenarioOptions(D) {
  if (!D.scenarios.length) return '';
  const has = D.scenarios.some((s) => s.id === 'all');
  const head = has ? '' : '<option value="all">全経路</option>';
  return head + D.scenarios.map((s) => `<option value="${s.id}">${s.label}</option>`).join('');
}

export function renderHtml(data, model) {
  const D = normalize(model);
  // </ を壊しておかないと、本文中の文字列が <script> を閉じてしまう。
  const serialized = JSON.stringify(data).replace(/<\//g, '<\\/');
  const trace = data.trace ? `<button id="trace-example" class="quiet">${escapeHtml(data.trace.label)}</button>` : '';
  return asset('templates', 'index.html')
    .replace('/*ATLAS_CSS*/', () => asset('scripts', 'viewer', 'styles.css'))
    .replace('/*ATLAS_TITLE*/', () => escapeHtml(data.meta.title))
    .replace('/*ATLAS_DESCRIPTION*/', () => escapeHtml(data.meta.description))
    .replace('/*ATLAS_BRAND*/', () => escapeHtml(data.meta.title))
    .replace('/*ATLAS_BRAND_SUB*/', () => escapeHtml(data.meta.subtitle))
    .replace('/*ATLAS_SCENARIOS*/', () => scenarioOptions(D))
    .replace('/*ATLAS_TRACE_BUTTON*/', () => trace)
    .replace('/*ATLAS_DATA*/', () => serialized)
    .replace('/*ATLAS_JS*/', () => `${asset('scripts', 'routing.cjs')}\n${asset('scripts', 'viewer', 'app.js')}`);
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 画像を集める。既定は成果物の隣へ複製して相対パスで参照する（差分が見えるように）。 */
function collectImages(D, dir, outDir, { inline }) {
  const images = {};
  const copies = [];
  for (const s of D.screens) {
    for (const img of s.images) {
      const abs = resolveWithin(dir, img.path, `screens[${s.key}].images[${img.key}].path`);
      if (!fs.existsSync(abs)) throw new ModelError(`画像がありません: ${img.path}`);
      if (inline) {
        const ext = path.extname(abs).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
        images[img.key] = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
      } else {
        const rel = path.posix.join('assets', `${img.key}${path.extname(abs)}`);
        copies.push([abs, path.join(outDir, rel)]);
        images[img.key] = rel;
      }
    }
  }
  return { images, copies };
}

function collectSourceBodies(D, dir) {
  const bodies = {};
  for (const s of D.sources) {
    if (s.kind !== 'file' || s.embed === false) continue;
    const abs = resolveWithin(dir, s.path, `sources[${s.id}].path`);
    bodies[s.id] = fs.readFileSync(abs, 'utf8');
  }
  return bodies;
}

export function build(modelPath, outPath, { inline = false } = {}) {
  const { model, dir, sha256: modelSha } = loadModel(modelPath);
  const layoutPath = path.join(dir, 'layout.json');
  if (!fs.existsSync(layoutPath)) throw new ModelError('layout.json がありません。先に layout.mjs を走らせてください');
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const D = normalize(model);
  const outDir = path.dirname(path.resolve(outPath));
  const { images, copies } = collectImages(D, dir, outDir, { inline });
  const data = buildData(model, layout, { modelSha, images, sourceBodies: collectSourceBodies(D, dir) });
  const html = renderHtml(data, model);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [from, to] of copies) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  fs.writeFileSync(outPath, html);
  return { bytes: Buffer.byteLength(html), images: Object.keys(images).length, inline };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const inline = argv.includes('--inline');
  const [modelPath, outPath] = argv.filter((a) => !a.startsWith('--'));
  if (!modelPath) {
    console.error('usage: build.mjs <model.json> [index.html] [--inline]');
    process.exit(2);
  }
  try {
    const out = outPath ?? path.join(path.dirname(path.resolve(modelPath)), 'index.html');
    console.log(JSON.stringify(build(modelPath, out, { inline })));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
