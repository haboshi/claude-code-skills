import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';

test('add: プロジェクト発番・manifest 作成・index 再生成・.hub-cli 書き出し', () => {
  const { hub, proj, doc } = setup();
  const out = runHub(hub, ['add', doc, '--project', proj, '--type', '報告書', '--tags', 'a,b']).trim();
  assert.ok(out.endsWith('/index.html'));

  const projDirs = fs.readdirSync(path.join(hub, 'projects'));
  assert.equal(projDirs.length, 1);
  const pj = JSON.parse(fs.readFileSync(path.join(hub, 'projects', projDirs[0], 'project.json'), 'utf8'));
  assert.equal(pj.abs_path, proj);
  assert.equal(pj.id, projDirs[0]);
  assert.equal(pj.accent, null);

  const man = JSON.parse(fs.readFileSync(path.join(path.dirname(out), 'manifest.json'), 'utf8'));
  assert.equal(man.schema_version, 1);
  assert.equal(man.title, 'テスト文書');       // --title 省略時は <title> から取得
  assert.equal(man.type, '報告書');
  assert.equal(man.entry, 'index.html');
  assert.equal(man.project_id, pj.id);
  assert.deepEqual(man.tags, ['a', 'b']);
  assert.deepEqual(man.links, { decision_ids: [], jiku_focus_ids: [] });
  assert.match(path.basename(path.dirname(out)), /^\d{8}-[a-z0-9-]+$/);

  const index = fs.readFileSync(path.join(hub, 'index.html'), 'utf8');
  assert.ok(index.includes('テスト文書'));
  assert.ok(fs.existsSync(path.join(hub, '.hub-cli')));
});

test('add: 同一プロジェクトへの2文書目は発番せず既存 project を使う', () => {
  // 日本語タイトルは slugify で 'project' に潰れて同日同 slug 衝突になるため、
  // このテストの意図（project 再発番なし）に集中できるよう明示 --slug を渡す
  const { base, hub, proj, doc } = setup();
  runHub(hub, ['add', doc, '--project', proj, '--title', '一本目', '--slug', 'first-doc']);
  fs.writeFileSync(path.join(base, 'doc2.html'), '<!doctype html><title>二本目</title><p>x</p>');
  runHub(hub, ['add', path.join(base, 'doc2.html'), '--project', proj, '--slug', 'second-doc']);
  assert.equal(fs.readdirSync(path.join(hub, 'projects')).length, 1);
  const docs = fs.readdirSync(path.join(hub, 'projects', fs.readdirSync(path.join(hub, 'projects'))[0], 'docs'));
  assert.equal(docs.length, 2);
});

test('add: --assets でディレクトリを同梱コピーする', () => {
  const { base, hub, proj, doc } = setup();
  const assets = path.join(base, 'assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, 'x.png'), 'fake');
  const out = runHub(hub, ['add', doc, '--project', proj, '--assets', assets]).trim();
  assert.ok(fs.existsSync(path.join(path.dirname(out), 'assets', 'x.png')));
});
