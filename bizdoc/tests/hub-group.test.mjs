import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';

// relDir（base からの相対パス）にディレクトリを作り、そのプロジェクトとして文書を1本登録する
function addProject(base, hub, relDir) {
  const dir = path.join(base, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = path.basename(relDir);
  const html = path.join(base, `${name}.html`);
  fs.writeFileSync(html, `<!doctype html><title>${name} の文書</title><p>本文</p>`);
  runHub(hub, ['add', html, '--project', dir, '--slug', name]);
  const found = JSON.parse(runHub(hub, ['list', '--json'])).find((p) => p.label === name);
  return { dir, id: found.id };
}

function byId(hub) {
  const m = new Map();
  for (const p of JSON.parse(runHub(hub, ['list', '--json']))) m.set(p.id, p);
  return m;
}

test('group add: グループを作って割り当て、project.json は書き換えない', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  const b = addProject(base, hub, 'bravo');
  runHub(hub, ['group', 'add', 'JBR', a.id, b.id]);

  const ov = JSON.parse(fs.readFileSync(path.join(hub, 'overrides.json'), 'utf8'));
  assert.deepEqual(Object.values(ov.groups).map((g) => g.label), ['JBR']);
  const list = byId(hub);
  assert.equal(list.get(a.id).group, 'g_1');
  assert.equal(list.get(b.id).group, 'g_1');
  const raw = JSON.parse(fs.readFileSync(path.join(hub, 'projects', a.id, 'project.json'), 'utf8'));
  assert.equal(raw.group, undefined); // SSOT 側は無傷
});

test('group add: 同じラベルへの追加ではグループが増えない', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  const b = addProject(base, hub, 'bravo');
  runHub(hub, ['group', 'add', 'JBR', a.id]);
  runHub(hub, ['group', 'add', 'JBR', b.id]);
  const ov = JSON.parse(fs.readFileSync(path.join(hub, 'overrides.json'), 'utf8'));
  assert.equal(Object.keys(ov.groups).length, 1);
  assert.equal(byId(hub).get(b.id).group, 'g_1');
});

test('group add: パス指定でも解決できる', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  runHub(hub, ['group', 'add', 'JBR', a.dir]);
  assert.equal(byId(hub).get(a.id).group, 'g_1');
});

test('group remove: 割当だけ外れ、グループ定義は残る', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  runHub(hub, ['group', 'add', 'JBR', a.id]);
  runHub(hub, ['group', 'remove', a.id]);
  assert.equal(byId(hub).get(a.id).group, null);
  const ov = JSON.parse(fs.readFileSync(path.join(hub, 'overrides.json'), 'utf8'));
  assert.equal(ov.groups.g_1.label, 'JBR');
});

test('group rename / delete: 改名は反映され、削除でメンバーは未分類に戻る', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  runHub(hub, ['group', 'add', 'JBR', a.id]);
  runHub(hub, ['group', 'rename', 'JBR', 'JBR案件']);
  assert.ok(runHub(hub, ['group', 'list']).includes('JBR案件'));
  runHub(hub, ['group', 'delete', 'JBR案件']);
  assert.equal(byId(hub).get(a.id).group, null);
});

test('project label / hide / show: 表示名と一覧掲載を切り替える', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  runHub(hub, ['project', 'label', a.id, '案件アルファ']);
  assert.equal(byId(hub).get(a.id).label, '案件アルファ');

  runHub(hub, ['project', 'hide', a.id]);
  assert.equal(byId(hub).get(a.id).hidden, true);
  const hidden = fs.readFileSync(path.join(hub, 'index.html'), 'utf8');
  assert.ok(!hidden.includes(`href="projects/${a.id}/docs/`)); // JS 無効時の一覧からも消える

  runHub(hub, ['project', 'show', a.id]);
  assert.equal(byId(hub).get(a.id).hidden, false);
  assert.ok(fs.readFileSync(path.join(hub, 'index.html'), 'utf8').includes(`href="projects/${a.id}/docs/`));

  runHub(hub, ['project', 'label', a.id]); // 表示名の上書きを解除
  assert.equal(byId(hub).get(a.id).label, 'alpha');
});

test('未登録の参照は中止し、プロジェクトを発番しない', () => {
  const { base, hub } = setup();
  addProject(base, hub, 'alpha');
  assert.throws(() => runHub(hub, ['group', 'add', 'JBR', path.join(base, 'nope')]));
  assert.equal(fs.readdirSync(path.join(hub, 'projects')).length, 1);
  assert.ok(!fs.existsSync(path.join(hub, 'overrides.json')));
});

test('group suggest: 候補を出すだけで overrides.json を作らない', () => {
  const { base, hub } = setup();
  addProject(base, hub, path.join('octus', 'kata'));
  addProject(base, hub, path.join('octus', 'jiku'));
  const out = runHub(hub, ['group', 'suggest']);
  assert.ok(out.includes('octus'));
  assert.ok(out.includes('group add'));
  assert.ok(!fs.existsSync(path.join(hub, 'overrides.json')));
});

test('reindex: overrides があっても index.html は同じ内容に再生成される', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  runHub(hub, ['group', 'add', 'JBR', a.id]);
  const indexPath = path.join(hub, 'index.html');
  const before = fs.readFileSync(indexPath, 'utf8');
  fs.rmSync(indexPath);
  runHub(hub, ['reindex']);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before);
});

test('壊れた overrides.json は警告のうえ無視され、一覧は生成される', () => {
  const { base, hub } = setup();
  const a = addProject(base, hub, 'alpha');
  fs.writeFileSync(path.join(hub, 'overrides.json'), '{ broken');
  runHub(hub, ['reindex']);
  const index = fs.readFileSync(path.join(hub, 'index.html'), 'utf8');
  assert.ok(index.includes(`href="projects/${a.id}/docs/`));
});
