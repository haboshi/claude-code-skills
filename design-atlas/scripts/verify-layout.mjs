#!/usr/bin/env node
// verify-layout.mjs — 見た目の指標を測って記録するだけの段。合否を出さず、生成も止めない。
// ここで測る数は、利用者の理解度や追跡にかかる時間の実測値ではない。版どうしを比べるための目安である。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadModel, ModelError } from './lib/model.mjs';

const require = createRequire(import.meta.url);
const routing = require('./routing.cjs');

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(points) {
  const ps = routing.sample(points, 24);
  let total = 0;
  for (let i = 1; i < ps.length; i++) total += distance(ps[i - 1], ps[i]);
  return total;
}

/** 2 本の経路が交差する箇所の数。端点付近の合流は交差と数えない。 */
function crossings(a, b) {
  const p = routing.sample(a, 16);
  const q = routing.sample(b, 16);
  let n = 0;
  for (let i = 1; i < p.length; i++) {
    for (let j = 1; j < q.length; j++) {
      const [a1, a2, b1, b2] = [p[i - 1], p[i], q[j - 1], q[j]];
      const dx = a2.x - a1.x, dy = a2.y - a1.y, ex = b2.x - b1.x, ey = b2.y - b1.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-6) continue;
      const t = ((b1.x - a1.x) * ey - (b1.y - a1.y) * ex) / den;
      const u = ((b1.x - a1.x) * dy - (b1.y - a1.y) * dx) / den;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const hit = { x: a1.x + t * dx, y: a1.y + t * dy };
      if ([p[0], p.at(-1), q[0], q.at(-1)].some((e) => distance(hit, e) < 24)) continue;
      n++;
    }
  }
  return n;
}

/** 近い距離で並んで走る区間の長さ。束ねて見える箇所の目安。 */
function parallelRun(a, b, threshold = 26) {
  const p = routing.sample(a, 24);
  const q = routing.sample(b, 24);
  let run = 0;
  for (let i = 1; i < p.length; i++) {
    const near = q.some((v) => distance(p[i], v) < threshold);
    if (near) run += distance(p[i - 1], p[i]);
  }
  return run;
}

export function measure(layout) {
  const views = {};
  for (const [mode, view] of Object.entries(layout.views ?? {})) {
    const routes = Object.entries(view.edges ?? {});
    let cross = 0;
    let parallel = 0;
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        cross += crossings(routes[i][1].points, routes[j][1].points);
        parallel += parallelRun(routes[i][1].points, routes[j][1].points);
      }
    }
    const nodes = Object.values(view.nodes ?? {});
    const area = view.bounds.w * view.bounds.h;
    const covered = nodes.reduce((sum, n) => sum + n.w * n.h, 0);
    views[mode] = {
      cards: nodes.length,
      edges: routes.length,
      crossings: cross,
      parallel_run: Math.round(parallel),
      total_path_length: Math.round(routes.reduce((sum, [, r]) => sum + pathLength(r.points), 0)),
      card_density: Number((covered / area).toFixed(4)),
      bounds: view.bounds,
      detoured: view.unrouted?.length ?? 0,
    };
  }
  return {
    schema: 'design-atlas/layout-verification/1',
    measured_at: new Date().toISOString(),
    caveat: 'ここに並ぶ数は配置の目安であり、利用者の理解度・追跡時間の実測値ではない。合否の判定にも使わない。',
    views,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const modelPath = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
  if (!modelPath) {
    console.error('usage: verify-layout.mjs <model.json> [--out <file>]');
    process.exit(2);
  }
  try {
    const { dir } = loadModel(modelPath);
    const layoutPath = path.join(dir, 'layout.json');
    if (!fs.existsSync(layoutPath)) throw new ModelError('layout.json がありません。先に layout.mjs を走らせてください');
    const report = measure(JSON.parse(fs.readFileSync(layoutPath, 'utf8')));
    const out = get('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report.views));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
