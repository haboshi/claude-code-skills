import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, runHub } from './helpers.mjs';

const hasXmllint = !spawnSync('xmllint', ['--version']).error;

test('add: 不正 SVG（タグ閉じ忘れ）を reject する', (t) => {
  if (!hasXmllint) return t.skip('xmllint なし');
  const { base, hub, proj } = setup();
  const bad = path.join(base, 'bad.html');
  fs.writeFileSync(bad, '<!doctype html><title>x</title><svg viewBox="0 0 10 10"><rect</svg>');
  assert.throws(() => runHub(hub, ['add', bad, '--project', proj]), (e) => /SVG/.test(String(e.stderr)));
});

test('add: 整形式の SVG は通る', (t) => {
  if (!hasXmllint) return t.skip('xmllint なし');
  const { base, hub, proj } = setup();
  const ok = path.join(base, 'ok.html');
  fs.writeFileSync(
    ok,
    '<!doctype html><title>y</title><svg viewBox="0 0 10 10" role="img"><title>t</title><rect width="4" height="4"/></svg>'
  );
  const out = runHub(hub, ['add', ok, '--project', proj]).trim();
  assert.ok(fs.existsSync(out));
});
