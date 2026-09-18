#!/usr/bin/env node
// build.mjs — model.json + layout.json（+ 画像）から index.html を 1 回で組み立てる。
// 生成物にタイムスタンプを埋めないので、同じ入力からは同じバイト列が出る。
// 画像は既定で外部ファイル参照。--inline のときだけ WEBP に変換して埋め込む（配布用の 1 枚化）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, resolveWithin, ModelError } from './lib/model.mjs';
import { toWebpDataUris } from './lib/webp.mjs';
import { checkModel, checkLayout, blocking } from './lib/checks.mjs';
import { normalize, edgesFor } from './lib/normalize.mjs';
import { MODES } from './layout.mjs';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const routing = createRequire(import.meta.url)('./routing.cjs');
const asset = (...p) => fs.readFileSync(path.join(here, '..', ...p), 'utf8');

const VIEW_TEXT = {
  overview: { tab: 'つながり', eyebrow: 'CONNECTED VIEW', title: '画面・業務・データの対応', description: '業務のまとまりごとに、担当画面と代表データを重ねた俯瞰図です。', caption: (D) => `${D.groups.length}業務 · ${D.screens.length}画面` },
  screens: { tab: '画面遷移', eyebrow: 'SCREEN CONNECTIONS', title: '画面と操作のつながり', description: '丸い番号は画面内の操作位置。下部の操作ラベルは詳細表示・画面外の操作です。', caption: (D) => `${D.screens.length}画面 · ${D.transitions.length}遷移` },
  er: { tab: 'ER図', eyebrow: 'ENTITY RELATIONSHIPS', title: 'データの関係と参照キー', description: '左の参照元から右の参照先へ。業務領域ごとにまとめ、項目の位置へ接続します。', caption: (D) => `参照元 → 参照先 · ${D.entities.length}概念 · ${D.relations.length}関係` },
  flow: { tab: '業務フロー', eyebrow: 'BUSINESS FLOW', title: '業務の前後関係', description: '左から右へ進み、分岐を上下に配置します。手戻り・例外は外周の線です。', caption: (D) => `${D.processes.length}工程 · ${D.lanes.length}担当区分` },
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
    // 根拠ソースの本文を同梱したか。同梱したなら、その事実を成果物の見える場所に出す。
    embedsSourceText: Object.keys(sourceBodies).length > 0,
  };
}

function scenarioOptions(D) {
  if (!D.scenarios.length) return '';
  const has = D.scenarios.some((s) => s.id === 'all');
  const head = has ? '' : '<option value="all">全経路</option>';
  return head + D.scenarios.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.label)}</option>`).join('');
}

export function renderHtml(data, model) {
  const D = normalize(model);
  // </ を壊しておかないと、本文中の文字列が <script> を閉じてしまう。
  const serialized = JSON.stringify(data).replace(/<\//g, '<\\/');
  const trace = data.trace ? `<button id="trace-example" class="quiet">${escapeHtml(data.trace.label)}</button>` : '';
  // 面の切り替えボタンは、実際に配置がある面だけ出す。押しても何も起きないボタンを並べない。
  const views = Object.keys(data.layouts)
    .map((m, i) => `<button data-view="${m}" aria-pressed="${i === 0}">${escapeHtml(VIEW_TEXT[m].tab)}</button>`)
    .join('');

  const slots = {
    ATLAS_CSS: () => asset('scripts', 'viewer', 'styles.css'),
    ATLAS_TITLE: () => escapeHtml(data.meta.title),
    ATLAS_DESCRIPTION: () => escapeHtml(data.meta.description),
    ATLAS_BRAND: () => escapeHtml(data.meta.title),
    ATLAS_BRAND_SUB: () => escapeHtml(data.meta.subtitle),
    ATLAS_SCENARIOS: () => scenarioOptions(D),
    ATLAS_TRACE_BUTTON: () => trace,
    ATLAS_VIEWS: () => views,
    ATLAS_DATA: () => serialized,
    ATLAS_JS: () => `${asset('scripts', 'routing.cjs')}\n${asset('scripts', 'viewer', 'app.js')}`,
  };

  // 差し込みは 1 回で済ませる。順に replace すると、先に入れた値の中の
  // 「/*ATLAS_DATA*/」のような文字列が次の段で本物の差し込み口として展開されてしまう
  // （model.json の題名や説明にその並びを書けば、属性から抜け出せる）。
  return asset('templates', 'index.html').replace(
    /\/\*(ATLAS_[A-Z_]+)\*\//g,
    (whole, name) => (Object.hasOwn(slots, name) ? slots[name]() : whole),
  );
}

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 画像を集める。既定は成果物の隣へ複製して相対パスで参照する（差分が見えるように）。 */
async function collectImages(D, dir, outDir, { inline }) {
  const sources = {};
  const copies = [];
  const images = {};
  for (const s of D.screens) {
    for (const img of s.images) {
      const abs = resolveWithin(dir, img.path, `screens[${s.key}].images[${img.key}].path`);
      if (!fs.existsSync(abs)) throw new ModelError(`画像がありません: ${img.path}`);
      if (inline) sources[img.key] = abs;
      else {
        // key は検査済みだが、書き出し先を作るときも basename に落として外へ出られないようにする。
        const rel = path.posix.join('assets', `${path.basename(img.key)}${path.extname(abs)}`);
        copies.push([abs, path.join(outDir, rel)]);
        images[img.key] = rel;
      }
    }
  }
  if (!inline) return { images, copies, note: null };
  const { images: inlined, converted, note } = await toWebpDataUris(sources);
  return { images: inlined, copies, converted, note };
}

function collectSourceBodies(D, dir) {
  const bodies = {};
  for (const s of D.sources) {
    // 既定は同梱しない。本文には案件固有の内容が入りうるので、明示的に許したときだけ載せる。
    if (s.kind !== 'file' || s.embed !== true) continue;
    const abs = resolveWithin(dir, s.path, `sources[${s.id}].path`);
    bodies[s.id] = fs.readFileSync(abs, 'utf8');
  }
  return bodies;
}

export async function build(modelPath, outPath, { inline = false, force = false } = {}) {
  const { model, dir, sha256: modelSha } = loadModel(modelPath);
  const layoutPath = path.join(dir, 'layout.json');
  if (!fs.existsSync(layoutPath)) throw new ModelError('layout.json がありません。先に layout.mjs を走らせてください');
  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));

  // 構造が破れているなら書き出さない。壊れた成果物をいったん作ってから検査で咎めるのでは、
  // 出来上がったファイルが手元に残り、そのまま渡されうる。verify-structure は後段で改めて
  // 記録を残すが、止めるのはここ。
  const broken = blocking([...checkModel(model), ...checkLayout(layout, routing, model)]);
  if (broken.length && !force) {
    const head = broken.slice(0, 5).map((f) => `  ✗ [${f.code}] ${f.message}`).join('\n');
    throw new ModelError(`構造検査で ${broken.length} 件の指摘があるため生成しません:\n${head}${broken.length > 5 ? `\n  … 他 ${broken.length - 5} 件` : ''}`);
  }
  const D = normalize(model);
  const outDir = path.dirname(path.resolve(outPath));
  const { images, copies, converted, note } = await collectImages(D, dir, outDir, { inline });
  const data = buildData(model, layout, { modelSha, images, sourceBodies: collectSourceBodies(D, dir) });
  const html = renderHtml(data, model);
  fs.mkdirSync(outDir, { recursive: true });
  for (const [from, to] of copies) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  fs.writeFileSync(outPath, html);
  return { bytes: Buffer.byteLength(html), images: Object.keys(images).length, inline, converted: converted ?? null, note: note ?? null };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const inline = argv.includes('--inline');
  const force = argv.includes('--force');
  const [modelPath, outPath] = argv.filter((a) => !a.startsWith('--'));
  if (!modelPath) {
    console.error('usage: build.mjs <model.json> [index.html] [--inline] [--force]');
    console.error('  --force: 構造検査の指摘を無視して生成する（壊れた図を確認したいときだけ）');
    process.exit(2);
  }
  try {
    const out = outPath ?? path.join(path.dirname(path.resolve(modelPath)), 'index.html');
    const result = await build(modelPath, out, { inline, force });
    if (result.note) console.error(`  · ${result.note}`);
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
