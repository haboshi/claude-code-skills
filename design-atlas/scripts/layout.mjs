#!/usr/bin/env node
// layout.mjs — model.json から layout.json を作る中間層。
// これがあるおかげで build は 1 回で済む（参照実装は生成物 index.html を正規表現で読み直し、build を 2 回走らせていた）。
// 層割当は Graphviz dot、経路とラベル配置は routing.cjs。どちらもブラウザを開かない。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadModel, ModelError } from './lib/model.mjs';
import { normalize, edgesFor } from './lib/normalize.mjs';
import { entitySize, entityCompactSize, screenSize, flowSize, groupSize } from './lib/sizes.mjs';

const require = createRequire(import.meta.url);
const routing = require('./routing.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const q = JSON.stringify;

export const MODES = ['overview', 'screens', 'er', 'flow'];

export function loadRules(modelDir) {
  const base = JSON.parse(fs.readFileSync(path.join(here, '..', 'config', 'layout-rules.json'), 'utf8'));
  const override = path.join(modelDir, 'layout-rules.json');
  if (!fs.existsSync(override)) return base;
  const extra = JSON.parse(fs.readFileSync(override, 'utf8'));
  // 浅いマージ + cards だけ 1 段深くマージする。規則の一部だけ差し替えたいことが多いため。
  return { ...base, ...extra, cards: { ...base.cards, ...(extra.cards ?? {}) } };
}

function dot(lines, sizes, margin) {
  const result = spawnSync('dot', ['-Tjson'], { input: lines.join('\n'), encoding: 'utf8', maxBuffer: 40e6 });
  if (result.error?.code === 'ENOENT') throw new ModelError('Graphviz の dot が見つかりません。brew install graphviz などで導入してください');
  if (result.status !== 0) throw new ModelError(`Graphviz dot が失敗しました: ${result.stderr?.trim() || '(出力なし)'}`);
  const graph = JSON.parse(result.stdout);
  const height = Number(graph.bb.split(',')[3]);
  const nodes = {};
  for (const n of (graph.objects ?? []).filter((o) => o.pos)) {
    const [x, y] = n.pos.split(',').map(Number);
    const size = sizes[n.name];
    if (!size) continue;
    // dot は中心座標・Y 上向き。キャンバスは左上原点・Y 下向きなので反転する。
    nodes[n.name] = { x: x - size.w / 2 + margin.x, y: height - y - size.h / 2 + margin.y, w: size.w, h: size.h };
  }
  return nodes;
}

const header = (rankSep, nodeSep, dir = 'LR', extra = '') =>
  ['digraph G {', `graph [rankdir=${dir},ranksep=${rankSep / 72},nodesep=${nodeSep / 72},splines=false,newrank=true${extra}];`, 'node [shape=box,fixedsize=true,label=""];'];

const declare = (id, size) => `${q(id)} [width=${size.w / 72},height=${size.h / 72}];`;

function erLayout(D, sizes, edges, rules) {
  const byArea = new Map(D.areas.map((a) => [a.id, []]));
  for (const e of D.entities) {
    if (!byArea.has(e.area)) throw new ModelError(`entities[${e.key}].area が areas[] にありません: ${e.area}`);
    byArea.get(e.area).push(e);
  }
  const lines = header(rules.rankSeparation, rules.nodeSeparation, rules.direction, ',ordering=out');
  for (const [areaId, members] of byArea) {
    if (!members.length) continue;
    lines.push(`subgraph cluster_${areaId.replace(/-/g, '_')} { margin=${rules.groupPadding};`);
    for (const e of members) lines.push(declare(e.id, sizes[e.id]));
    lines.push('}');
  }
  // 設計候補の関係は読む向きを同じに保ちつつ、層割当への影響を弱める。
  // 確定した関係どうしは同じ重みにする。線の太さ（weight）は関係の種類を表すもので、層割当の優先度ではない。
  for (const e of edges) lines.push(`${q(e.a)} -> ${q(e.b)} [weight=${e.proposed ? 1 : 3},constraint=true];`);
  lines.push('}');
  return dot(lines, sizes, rules.margin);
}

function flowLayout(D, sizes, edges, rules) {
  const cfg = rules.flow;
  const lines = header(cfg.rankSeparation, cfg.nodeSeparation, rules.direction);
  for (const [id, size] of Object.entries(sizes)) lines.push(declare(id, size));
  for (const e of edges) {
    const forward = e.kind !== 'exception';
    // 主経路は強く引き、例外は層割当から外して外周に落とす。
    lines.push(`${q(e.a)} -> ${q(e.b)} [constraint=${forward},weight=${e.primary ? 30 : forward ? 3 : 0}];`);
  }
  lines.push('}');
  const nodes = dot(lines, sizes, rules.margin);

  // 例外辺だけで繋がる工程は、本線の下へ退避させる。参照実装は 1 件を座標直書きしていた箇所。
  const incident = new Map(Object.keys(nodes).map((id) => [id, []]));
  for (const e of edges) {
    incident.get(e.a)?.push(e);
    incident.get(e.b)?.push(e);
  }
  // 本線が無いモデル（全部が例外辺）では退避先が決まらない。退避せずそのまま置く。
  const exceptionOnly = [...incident.entries()].filter(([, es]) => es.length && es.every((e) => e.kind === 'exception')).map(([id]) => id);
  if (exceptionOnly.length && exceptionOnly.length < Object.keys(nodes).length) {
    const others = Object.entries(nodes).filter(([id]) => !exceptionOnly.includes(id));
    const floor = Math.max(...others.map(([, n]) => n.y + n.h));
    exceptionOnly.forEach((id, i) => {
      const neighbourId = incident.get(id).map((e) => (e.a === id ? e.b : e.a)).find((n) => nodes[n] && !exceptionOnly.includes(n));
      const anchor = neighbourId ? nodes[neighbourId] : others[0][1];
      nodes[id].x = anchor.x + cfg.exceptionOffset.x;
      nodes[id].y = floor + cfg.exceptionOffset.y + i * (nodes[id].h + cfg.nodeSeparation);
    });
  }
  return nodes;
}

function chainLayout(sizes, edges, rules, cfg) {
  const lines = header(cfg.rankSeparation, cfg.nodeSeparation, rules.direction);
  for (const [id, size] of Object.entries(sizes)) lines.push(declare(id, size));
  for (const e of edges) lines.push(`${q(e.a)} -> ${q(e.b)} [weight=${e.strength ?? 2}];`);
  lines.push('}');
  return dot(lines, sizes, rules.margin);
}

/** 面ごとのカード寸法。ここだけが CSS の実測値に依存する。 */
export function sizesFor(D, mode, rules) {
  const cards = rules.cards;
  const sizes = {};
  if (mode === 'er') {
    for (const e of D.entities) sizes[e.id] = entitySize(e, cards);
  } else if (mode === 'flow') {
    for (const p of D.processes) sizes[p.id] = flowSize(p, cards);
  } else if (mode === 'screens') {
    for (const s of D.screens) {
      const portCount = D.transitions.filter((t) => t.a === s.id).length;
      sizes[s.id] = screenSize(s, cards, { portCount });
    }
  } else {
    // 俯瞰は業務グループを軸に組み立てる。groups[] が無いモデルでは面ごと出さない
    // （置くカードが無いのに配置だけ作ると、ビューワが何も描けない面が残る）。
    if (!D.groups.length) return {};
    for (const g of D.groups) sizes[g.id] = groupSize(cards);
    for (const s of D.screens) sizes[s.id] = screenSize(s, cards);
    for (const g of D.groups) if (g.primary) sizes[g.primary] = entityCompactSize(cards);
  }
  return sizes;
}

/** ER だけ、項目の行にポートを持つ。他の面はカードの辺に均等配置する。 */
function portsFor(D, mode, rules) {
  if (mode !== 'er') return {};
  const c = rules.cards.entity;
  return Object.fromEntries(
    D.entities.map((e) => [e.id, Object.fromEntries(e.fields.map((f, i) => [f.name, { y: c.head - 22 + c.field * i }]))]),
  );
}

export function buildLayout(model, rules) {
  const D = normalize(model);
  const views = {};
  for (const mode of MODES) {
    const edges = edgesFor(D, mode);
    const sizes = sizesFor(D, mode, rules);
    if (!Object.keys(sizes).length) continue;
    const nodes =
      mode === 'er' ? erLayout(D, sizes, edges, rules)
      : mode === 'flow' ? flowLayout(D, sizes, edges, rules)
      : chainLayout(sizes, edges, rules, rules[mode]);
    for (const id of Object.keys(sizes)) {
      if (!nodes[id]) throw new ModelError(`${mode}: ${id} の座標が得られませんでした（孤立したカードは dot が返しません）`);
    }
    const routes = routing.routeAll(nodes, edges, portsFor(D, mode, rules), mode);
    const points = Object.values(nodes);
    views[mode] = {
      nodes,
      edges: Object.fromEntries(
        Object.entries(routes).map(([id, r]) => [id, { points: r.points, s: r.s, t: r.t, mx: r.mx, my: r.my, labelWidth: r.labelWidth, labelBox: r.labelBox, leader: r.leader, back: r.back, clear: r.clear }]),
      ),
      bounds: { x: 0, y: 0, w: Math.max(...points.map((n) => n.x + n.w)) + 200, h: Math.max(...points.map((n) => n.y + n.h)) + 200 },
      unrouted: Object.values(routes).filter((r) => !r.clear).map((r) => r.id),
    };
    if (mode === 'er') views[mode].areas = D.areas;
  }
  return { schema: 'design-atlas/layout/1', model_version: D.meta.model_version, views };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modelPath, outPath] = process.argv.slice(2);
  if (!modelPath) {
    console.error('usage: layout.mjs <model.json> [layout.json]');
    process.exit(2);
  }
  try {
    const { model, dir } = loadModel(modelPath);
    const layout = buildLayout(model, loadRules(dir));
    const out = outPath ?? path.join(dir, 'layout.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(layout, null, 2) + '\n');
    console.log(JSON.stringify(Object.fromEntries(Object.entries(layout.views).map(([m, v]) => [m, { nodes: Object.keys(v.nodes).length, unrouted: v.unrouted.length }]))));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
