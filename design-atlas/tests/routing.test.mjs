// routing.cjs は viewer と layout.mjs が共有する唯一の経路計算。ドメインに依存しないことと、
// 「配置が変わらなければ同じ経路が出る」ことをここで固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const routing = require('../scripts/routing.cjs');

const nodes = {
  a: { x: 0, y: 0, w: 200, h: 120 },
  b: { x: 500, y: 0, w: 200, h: 120 },
  c: { x: 500, y: 300, w: 200, h: 120 },
};
const edges = [
  { id: 'e0', a: 'a', b: 'b', label: 'first', strength: 3, type: 'relation', ca: '1', cb: '0..N', sourcePort: 'k', targetPort: 'k' },
  { id: 'e1', a: 'a', b: 'c', label: 'second', strength: 2, type: 'relation', ca: '1', cb: '0..N', sourcePort: 'k', targetPort: 'k' },
];
const ports = { a: { k: { y: 60 } }, b: { k: { y: 60 } }, c: { k: { y: 60 } } };

test('routeAll は全ての辺に経路とラベル位置を返す', () => {
  const routes = routing.routeAll(nodes, edges, ports, 'er');
  assert.deepEqual(Object.keys(routes).sort(), ['e0', 'e1']);
  for (const r of Object.values(routes)) {
    assert.ok(r.points.length >= 4, '3次ベジェは最低4点');
    assert.ok(r.path.startsWith('M'), 'SVG path が組み立てられる');
    assert.ok(Number.isFinite(r.mx) && Number.isFinite(r.my), 'ラベル位置が数値');
    assert.equal(r.clear, true, '空いた盤面では迂回なしで通る');
  }
});

test('同じ入力からは同じ経路が出る（決定論）', () => {
  const first = routing.routeAll(nodes, edges, ports, 'er');
  const second = routing.routeAll(nodes, edges, ports, 'er');
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
});

test('経路はカードの内部を通らない', () => {
  const routes = routing.routeAll(nodes, edges, ports, 'er');
  for (const [id, r] of Object.entries(routes)) {
    const edge = edges.find((e) => e.id === id);
    // 端点は自分のカードの辺上にあるため、両端のカードだけ除外する。
    assert.equal(routing.blocked(r.points, nodes, [edge.a, edge.b]), false, `${id} が他のカードを貫通した`);
  }
});

test('ポート位置を指定すると接続点がその行の高さに来る', () => {
  const routes = routing.routeAll(nodes, edges, { ...ports, a: { k: { y: 100 } } }, 'er');
  assert.equal(routes.e0.s.y, nodes.a.y + 100);
});

test('segmentHits は矩形と交差する線分だけを真と判定する', () => {
  const rect = { x: 100, y: 100, w: 100, h: 100 };
  assert.equal(routing.segmentHits({ x: 0, y: 150 }, { x: 300, y: 150 }, rect), true);
  assert.equal(routing.segmentHits({ x: 0, y: 50 }, { x: 300, y: 50 }, rect), false);
});
