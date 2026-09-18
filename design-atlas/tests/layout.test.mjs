import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { buildLayout, loadRules, sizesFor, MODES } from '../scripts/layout.mjs';
import { normalize } from '../scripts/lib/normalize.mjs';
import { checkLayout } from '../scripts/lib/checks.mjs';

const require = createRequire(import.meta.url);
const routing = require('../scripts/routing.cjs');
const modelUrl = new URL('./fixtures/library/model.json', import.meta.url);
const model = () => JSON.parse(fs.readFileSync(modelUrl, 'utf8'));
const rules = () => loadRules(new URL('./fixtures/library/', import.meta.url).pathname);

// Graphviz は外部バイナリ。未導入の環境でも npm test が通るように、その場合だけ飛ばす。
const hasDot = spawnSync('dot', ['-V']).status === 0;
const withDot = { skip: hasDot ? false : 'Graphviz の dot が未導入' };

test('カード寸法は項目数から決まり、ブラウザを開かずに求まる', () => {
  const D = normalize(model());
  const sizes = sizesFor(D, 'er', rules());
  const loan = D.entities.find((e) => e.key === 'loan');
  const member = D.entities.find((e) => e.key === 'member');
  assert.ok(sizes[loan.id].h > sizes[member.id].h, '項目が多いカードの方が背が高い');
  assert.equal(sizes[loan.id].w, sizes[member.id].w, '幅は揃える');
});

test('4 面すべての配置が出る', withDot, () => {
  const layout = buildLayout(model(), rules());
  assert.deepEqual(Object.keys(layout.views).sort(), [...MODES].sort());
  for (const [mode, view] of Object.entries(layout.views)) {
    assert.ok(Object.keys(view.nodes).length > 0, `${mode} にカードがある`);
    assert.ok(view.bounds.w > 0 && view.bounds.h > 0, `${mode} の範囲が正の大きさ`);
  }
});

test('生成した配置は構造検査を 0 件で通る', withDot, () => {
  assert.deepEqual(checkLayout(buildLayout(model(), rules()), routing, model()), []);
});

test('同じ model.json からは同じ layout.json が出る（決定論）', withDot, () => {
  const a = JSON.stringify(buildLayout(model(), rules()));
  const b = JSON.stringify(buildLayout(model(), rules()));
  assert.equal(a, b);
});

test('ER は参照元を左、参照先を右に置く', withDot, () => {
  const { views } = buildLayout(model(), rules());
  const D = normalize(model());
  for (const r of D.relations) {
    const from = views.er.nodes[r.a];
    const to = views.er.nodes[r.b];
    assert.ok(to.x + to.w / 2 >= from.x + from.w / 2, `${r.id} が逆行している`);
  }
});

test('例外辺だけで繋がる工程は本線の下へ退避する', withDot, () => {
  const { views } = buildLayout(model(), rules());
  const D = normalize(model());
  const exceptionOnly = D.processes
    .map((p) => p.id)
    .filter((id) => {
      const es = D.processEdges.filter((e) => e.a === id || e.b === id);
      return es.length && es.every((e) => e.kind === 'exception');
    });
  assert.ok(exceptionOnly.length > 0, 'フィクスチャに例外専用の工程がある');
  const floor = Math.max(...Object.entries(views.flow.nodes).filter(([id]) => !exceptionOnly.includes(id)).map(([, n]) => n.y + n.h));
  for (const id of exceptionOnly) assert.ok(views.flow.nodes[id].y > floor, `${id} が本線の中に残っている`);
});

test('dot が無い環境では理由のあるエラーで止まる', () => {
  // ENOENT を握りつぶして黙って別配置に落とすと、生成物の由来が説明できなくなる。
  assert.match(fs.readFileSync(new URL('../scripts/layout.mjs', import.meta.url), 'utf8'), /ENOENT[\s\S]*dot が見つかりません/);
});
