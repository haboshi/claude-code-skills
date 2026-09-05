// v0.11.3 (2026-09-05): 版数の三点一致。plugin.json と 2 つの marketplace.json（ルート / .claude-plugin）の bizdoc
// 登録版数は散文（repo CLAUDE.md）だけで守られていて、v0.11.1 のとき実際にずれた（plugin 0.11.1 / marketplace 0.11.0）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));

test('版数: plugin.json と両 marketplace.json の bizdoc 登録版数が一致し、marketplace.json 同士はバイト一致', () => {
  const plugin = JSON.parse(fs.readFileSync(p('../.claude-plugin/plugin.json'), 'utf8'));
  const [root, dot] = ['../../marketplace.json', '../../.claude-plugin/marketplace.json'].map((f) => fs.readFileSync(p(f)));
  assert.ok(root.equals(dot), 'ルートと .claude-plugin/ の marketplace.json は完全一致させる（repo CLAUDE.md）');
  const entry = JSON.parse(root.toString('utf8')).plugins.find((x) => x.name === 'bizdoc');
  assert.ok(entry, 'marketplace.json に bizdoc の登録が無い');
  assert.equal(entry.version, plugin.version, `plugin.json ${plugin.version} と marketplace.json ${entry.version} がずれている`);
});
