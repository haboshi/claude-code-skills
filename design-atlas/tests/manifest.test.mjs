import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildManifest } from '../scripts/manifest.mjs';
import { sha256 } from '../scripts/lib/model.mjs';

function scratch(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-atlas-test-'));
  for (const [name, body] of Object.entries(files)) {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

test('挙げた入力の sha256 とバイト数を記録する', () => {
  const body = '<h1>貸出画面</h1>\n';
  const dir = scratch({
    'mock/lend.html': body,
    'model.json': JSON.stringify({ meta: { model_version: 3 }, sources: [{ id: 'lend', kind: 'file', path: 'mock/lend.html' }] }),
  });
  const m = buildManifest(path.join(dir, 'model.json'));
  assert.equal(m.sources.length, 1);
  assert.equal(m.sources[0].sha256, sha256(body));
  assert.equal(m.sources[0].bytes, Buffer.byteLength(body));
  assert.equal(m.model.version, 3);
});

test('宣言済み sha256 との一致・不一致を記録する（判定は verify-structure が行う）', () => {
  const body = 'x\n';
  const dir = scratch({
    'a.txt': body,
    'model.json': JSON.stringify({
      sources: [
        { id: 'ok', kind: 'file', path: 'a.txt', sha256: sha256(body) },
        { id: 'ng', kind: 'file', path: 'a.txt', sha256: '0'.repeat(64) },
      ],
    }),
  });
  const m = buildManifest(path.join(dir, 'model.json'));
  assert.equal(m.sources[0].matches_declared, true);
  assert.equal(m.sources[1].matches_declared, false);
});

test('絶対パスの sources は拒否する', () => {
  const dir = scratch({ 'model.json': JSON.stringify({ sources: [{ id: 'a', kind: 'file', path: '/etc/hosts' }] }) });
  assert.throws(() => buildManifest(path.join(dir, 'model.json')), /相対パス/);
});

test('model.json のディレクトリの外を指す sources は拒否する', () => {
  const dir = scratch({ 'model.json': JSON.stringify({ sources: [{ id: 'a', kind: 'file', path: '../outside.txt' }] }) });
  assert.throws(() => buildManifest(path.join(dir, 'model.json')), /外を指しています/);
});

test('生成した manifest に絶対パスが入らない', () => {
  const dir = scratch({ 'a.txt': 'x', 'model.json': JSON.stringify({ sources: [{ id: 'a', kind: 'file', path: 'a.txt' }] }) });
  const text = JSON.stringify(buildManifest(path.join(dir, 'model.json')));
  assert.ok(!text.includes(dir), 'テスト用の一時ディレクトリの実パスが混入した');
});

test('kind: note はファイルを読まずに範囲だけ残す', () => {
  const dir = scratch({
    'model.json': JSON.stringify({ sources: [{ id: 'n', kind: 'note', note: '2026-02-03 打合せ', range: '§2' }] }),
  });
  const m = buildManifest(path.join(dir, 'model.json'));
  assert.equal(m.sources[0].sha256, undefined);
  assert.equal(m.sources[0].range, '§2');
});
