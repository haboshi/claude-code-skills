import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';

test('reindex: index.html を消しても同一内容を再生成する（SSOT は manifest 群）', () => {
  const { hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj]);
  const indexPath = path.join(hub, 'index.html');
  const before = fs.readFileSync(indexPath, 'utf8');
  fs.rmSync(indexPath);
  runHub(hub, ['reindex']);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before);
});

test('reindex: 壊れた manifest は破損エントリとして index に載り、他の文書は正常に載る', () => {
  const { base, hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj, '--slug', 'healthy', '--title', '健全な文書']);
  fs.writeFileSync(path.join(base, 'doc2.html'), '<!doctype html><title>壊れる文書</title>');
  const out = runHub(hub, ['add', path.join(base, 'doc2.html'), '--project', proj, '--slug', 'broken-doc']).trim();
  fs.writeFileSync(path.join(path.dirname(out), 'manifest.json'), '{ this is not json');
  runHub(hub, ['reindex']);
  const index = fs.readFileSync(path.join(hub, 'index.html'), 'utf8');
  assert.ok(index.includes('健全な文書'));
  assert.ok(index.includes('破損'));
});

test('list --json: プロジェクトとドキュメントを返す', () => {
  const { hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj, '--type', '解説']);
  const data = JSON.parse(runHub(hub, ['list', '--json']));
  assert.equal(data.length, 1);
  assert.equal(data[0].docs.length, 1);
  assert.equal(data[0].docs[0].type, '解説');
});

test('list --project: 対象プロジェクトのみに絞る（未登録パスは空配列・発番しない）', () => {
  const { base, hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj]);
  const other = path.join(base, 'other');
  fs.mkdirSync(other);
  const data = JSON.parse(runHub(hub, ['list', '--project', other, '--json']));
  assert.deepEqual(data, []);
  assert.equal(fs.readdirSync(path.join(hub, 'projects')).length, 1); // 発番されていない
});
