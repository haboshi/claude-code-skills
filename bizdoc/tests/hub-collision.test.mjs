import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';

function docDirs(hub) {
  const p = fs.readdirSync(path.join(hub, 'projects'))[0];
  return fs.readdirSync(path.join(hub, 'projects', p, 'docs')).sort();
}

test('add: 同一 slug は既定でエラー（既存情報を提示し、黙って上書きしない）', () => {
  const { hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj, '--slug', 'same']);
  assert.throws(
    () => runHub(hub, ['add', doc, '--project', proj, '--slug', 'same']),
    (e) => /--update/.test(String(e.stderr)) && /--new/.test(String(e.stderr))
  );
  assert.equal(docDirs(hub).length, 1);
});

test('add --update: 同 slug の最新を更新（created 維持・updated 更新・ディレクトリ名維持）', async () => {
  const { hub, proj, doc } = setup();
  const first = runHub(hub, ['add', doc, '--project', proj, '--slug', 'same', '--type', '提案書']).trim();
  const before = JSON.parse(fs.readFileSync(path.join(path.dirname(first), 'manifest.json'), 'utf8'));
  await new Promise((r) => setTimeout(r, 10));
  const second = runHub(hub, ['add', doc, '--project', proj, '--slug', 'same', '--update']).trim();
  assert.equal(second, first); // 同じディレクトリを更新
  const after = JSON.parse(fs.readFileSync(path.join(path.dirname(first), 'manifest.json'), 'utf8'));
  assert.equal(after.created, before.created);
  assert.ok(after.updated > before.updated);
  assert.equal(after.type, '提案書'); // --type 未指定の update は既存値を維持
  assert.equal(docDirs(hub).length, 1);
});

test('add --update: 更新対象がなければエラー', () => {
  const { hub, proj, doc } = setup();
  assert.throws(() => runHub(hub, ['add', doc, '--project', proj, '--slug', 'none', '--update']));
});

test('add --new: 連番の別ドキュメントとして追加', () => {
  const { hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj, '--slug', 'same']);
  const out = runHub(hub, ['add', doc, '--project', proj, '--slug', 'same', '--new']).trim();
  assert.ok(path.basename(path.dirname(out)).endsWith('-2'));
  assert.equal(docDirs(hub).length, 2);
});
