import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkModel, checkManifest, checkArtifacts } from '../scripts/lib/checks.mjs';

const base = () => JSON.parse(fs.readFileSync(new URL('./fixtures/library/model.json', import.meta.url), 'utf8'));
const codes = (findings) => findings.map((f) => f.code);

test('架空フィクスチャは構造検査を 0 件で通る', () => {
  assert.deepEqual(checkModel(base()), []);
});

test('存在しないエンティティを指す画面は止める', () => {
  const m = base();
  m.screens[0].entities.push('ghost');
  assert.ok(codes(checkModel(m)).includes('undefined-ref'));
});

test('存在しない項目を指す関係は止める', () => {
  const m = base();
  m.relations[0].to.field = 'no_such_field';
  const f = checkModel(m);
  assert.ok(f.some((x) => x.code === 'undefined-ref' && x.message.includes('no_such_field')));
});

test('どの関係にも現れないエンティティは止める', () => {
  const m = base();
  m.relations = m.relations.filter((r) => r.to.entity !== 'reservation' && r.from.entity !== 'reservation');
  assert.ok(codes(checkModel(m)).includes('orphan-entity'));
});

test('遷移先の画面が無ければ止める', () => {
  const m = base();
  m.transitions[0].to = 'missing';
  assert.ok(codes(checkModel(m)).includes('undefined-ref'));
});

test('同じ画面への遷移は止める', () => {
  const m = base();
  m.transitions[0].to = m.transitions[0].from;
  assert.ok(codes(checkModel(m)).includes('self-transition'));
});

test('参考画像の座標を遷移の根拠にすると止める', () => {
  const m = base();
  m.screens[0].images = [{ key: 'top', path: 'shot.png', historical: true }];
  m.transitions[1].pin = { image: 'top', x: 10, y: 20 };
  assert.ok(codes(checkModel(m)).includes('historical-pin'));
});

test('工程があるのに担当区分が無ければ止める', () => {
  const m = base();
  m.lanes = [];
  assert.ok(codes(checkModel(m)).includes('missing-lanes'));
});

test('どの工程も持たない条件を経路が指したら止める', () => {
  const m = base();
  m.meta.scenarios[1].conditions = ['nonexistent'];
  assert.ok(codes(checkModel(m)).includes('undefined-ref'));
});

test('id の重複は止める', () => {
  const m = base();
  m.areas.push({ id: 'people', label: '重複' });
  assert.ok(codes(checkModel(m)).includes('duplicate-id'));
});

test('not_verified が空なら指摘する（未実施が無いという主張を無自覚に出さない）', () => {
  const m = base();
  m.not_verified = [];
  assert.ok(codes(checkModel(m)).includes('empty-not-verified'));
});

test('宣言 sha256 と実体の不一致は止める', () => {
  const findings = checkManifest({ sources: [{ id: 'spec', matches_declared: false }, { id: 'b', matches_declared: true }] });
  assert.deepEqual(codes(findings), ['sha256-mismatch']);
});

test('成果物の絶対パス混入は止め、値そのものは報告しない', () => {
  const findings = checkArtifacts({ 'index.html': '<p>/Users/someone/work/a.json</p>' });
  assert.deepEqual(codes(findings), ['absolute-path']);
  assert.ok(!findings[0].message.includes('someone'));
});

test('相対パスだけの成果物は通る', () => {
  assert.deepEqual(checkArtifacts({ 'index.html': '<a href="mock/lend.html">開く</a>' }), []);
});

test('属性から抜け出せる id は止める', () => {
  const m = base();
  m.areas.push({ id: 'x" onload="alert(1)', label: '注入' });
  m.entities[0].area = 'x" onload="alert(1)';
  assert.ok(codes(checkModel(m)).includes('invalid-id'));
});

test('ディレクトリを跨ぐ画像キーは止める', () => {
  const m = base();
  m.screens[0].images = [{ key: '../../escape', path: 'shot.png' }];
  assert.ok(codes(checkModel(m)).includes('invalid-id'));
});
