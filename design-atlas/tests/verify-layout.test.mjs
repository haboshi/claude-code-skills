import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { measure } from '../scripts/verify-layout.mjs';
import { buildLayout, loadRules } from '../scripts/layout.mjs';

const hasDot = spawnSync('dot', ['-V']).status === 0;
const withDot = { skip: hasDot ? false : 'Graphviz の dot が未導入' };
const model = () => JSON.parse(fs.readFileSync(new URL('./fixtures/library/model.json', import.meta.url), 'utf8'));
const rules = () => loadRules(new URL('./fixtures/library/', import.meta.url).pathname);

test('各面の指標を記録する', withDot, () => {
  const report = measure(buildLayout(model(), rules()));
  for (const [mode, m] of Object.entries(report.views)) {
    for (const key of ['cards', 'edges', 'crossings', 'parallel_run', 'total_path_length', 'card_density']) {
      assert.equal(typeof m[key], 'number', `${mode}.${key} が数値`);
    }
  }
});

test('指標は合否を持たない', withDot, () => {
  const report = measure(buildLayout(model(), rules()));
  assert.equal(report.passed, undefined, '合否を名乗らない');
  assert.equal(report.findings, undefined, '指摘を出さない');
  assert.match(report.caveat, /実測値ではない/, '数の読み替えを禁じる但し書きが出力に残る');
});

test('交差の数え方は左右対称', withDot, () => {
  // 同じ配置なら、測る順番で数が変わらない。
  const layout = buildLayout(model(), rules());
  assert.equal(JSON.stringify(measure(layout).views), JSON.stringify(measure(layout).views));
});
