import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyOverrides, createGroup, deleteGroup, emptyOverrides, loadOverrides, pruneOrphans,
  renameGroup, resolveGroupKey, saveOverrides, setProjectOverride, suggestGroups,
} from '../scripts/overrides.mjs';

function tmpHub() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ov-test-')));
}

test('loadOverrides: ファイルが無ければ空を返す', () => {
  assert.deepEqual(loadOverrides(tmpHub()), emptyOverrides());
});

test('loadOverrides: 壊れた JSON は空として扱い、警告を通知する', () => {
  const hub = tmpHub();
  fs.writeFileSync(path.join(hub, 'overrides.json'), '{ not json');
  const warns = [];
  assert.deepEqual(loadOverrides(hub, (m) => warns.push(m)), emptyOverrides());
  assert.equal(warns.length, 1);
});

test('loadOverrides: 不正なグループキーと、存在しないグループへの参照を落とす', () => {
  const hub = tmpHub();
  fs.writeFileSync(path.join(hub, 'overrides.json'), JSON.stringify({
    version: 1,
    groups: { g_1: { label: 'JBR' }, 'not-a-key': { label: '無効' } },
    projects: { a: { group: 'g_1' }, b: { group: 'g_99' }, c: { label: '  ' }, d: 'string' },
  }));
  const ov = loadOverrides(hub);
  assert.deepEqual(Object.keys(ov.groups), ['g_1']);
  assert.deepEqual(ov.projects, { a: { group: 'g_1' } });
});

test('saveOverrides → loadOverrides で往復する', () => {
  const hub = tmpHub();
  const { key, next } = createGroup(emptyOverrides(), 'JBR');
  saveOverrides(hub, setProjectOverride(next, 'p1', { group: key, label: '案件A' }));
  const back = loadOverrides(hub);
  assert.equal(back.groups[key].label, 'JBR');
  assert.deepEqual(back.projects.p1, { group: key, label: '案件A' });
});

test('applyOverrides: label / group / hidden を反映し、入力は書き換えない', () => {
  const projects = [{ id: 'p1', label: '元の名前', docs: [] }, { id: 'p2', label: 'そのまま', docs: [] }];
  const { key, next } = createGroup(emptyOverrides(), 'JBR');
  const ov = setProjectOverride(setProjectOverride(next, 'p1', { group: key, label: '新しい名前' }), 'p2', { hidden: true });
  const out = applyOverrides(projects, ov);
  assert.equal(out.projects[0].label, '新しい名前');
  assert.equal(out.projects[0].group, key);
  assert.equal(out.projects[1].hidden, true);
  assert.deepEqual(out.groups, [{ key, label: 'JBR' }]);
  assert.equal(projects[0].label, '元の名前'); // 元の配列は無傷
  assert.equal(projects[0].group, undefined);
});

test('resolveGroupKey: キー・ラベルのどちらでも引ける（不一致は null）', () => {
  const { key, next } = createGroup(emptyOverrides(), 'JBR');
  assert.equal(resolveGroupKey(next, key), key);
  assert.equal(resolveGroupKey(next, 'JBR'), key);
  assert.equal(resolveGroupKey(next, 'jbr'), null);
  assert.equal(resolveGroupKey(next, ''), null);
});

test('createGroup: 採番は連番で、削除後も既存キーと衝突しない', () => {
  const a = createGroup(emptyOverrides(), 'A');
  const b = createGroup(a.next, 'B');
  assert.equal(a.key, 'g_1');
  assert.equal(b.key, 'g_2');
  const c = createGroup(deleteGroup(b.next, 'g_1'), 'C');
  assert.equal(c.key, 'g_3');
});

test('deleteGroup: 所属プロジェクトは未分類に戻り、他の上書きは残る', () => {
  const { key, next } = createGroup(emptyOverrides(), 'JBR');
  const ov = setProjectOverride(setProjectOverride(next, 'p1', { group: key, label: '別名' }), 'p2', { group: key });
  const after = deleteGroup(ov, key);
  assert.equal(after.groups[key], undefined);
  assert.deepEqual(after.projects.p1, { label: '別名' });
  assert.equal(after.projects.p2, undefined); // 設定が空になったエントリごと消える
});

test('renameGroup: ラベルだけ変わり、割当は保たれる', () => {
  const { key, next } = createGroup(emptyOverrides(), '旧名');
  const ov = renameGroup(setProjectOverride(next, 'p1', { group: key }), key, '新名');
  assert.equal(ov.groups[key].label, '新名');
  assert.equal(ov.projects.p1.group, key);
});

test('setProjectOverride: null / 空文字は該当キーを消す', () => {
  const ov = setProjectOverride(emptyOverrides(), 'p1', { label: 'X', hidden: true });
  assert.deepEqual(setProjectOverride(ov, 'p1', { label: null }).projects.p1, { hidden: true });
  assert.equal(setProjectOverride(setProjectOverride(ov, 'p1', { label: '' }), 'p1', { hidden: null }).projects.p1, undefined);
});

test('pruneOrphans: 消えたプロジェクトの上書きを落とし、グループ定義は残す', () => {
  const { key, next } = createGroup(emptyOverrides(), 'JBR');
  const ov = setProjectOverride(setProjectOverride(next, 'alive', { group: key }), 'gone', { hidden: true });
  const after = pruneOrphans(ov, ['alive']);
  assert.deepEqual(Object.keys(after.projects), ['alive']);
  assert.equal(after.groups[key].label, 'JBR');
});

test('suggestGroups: 汎用の置き場（他候補の祖先）を除き、親プロジェクト自身もメンバーに含める', () => {
  const projects = [
    { id: 'jbr', label: 'jbr', abs_path: '/w/Projects/jbr' },
    { id: 'a', label: 'analytics', abs_path: '/w/Projects/jbr/analytics' },
    { id: 'b', label: 'partner', abs_path: '/w/Projects/jbr/partner' },
    { id: 'c', label: 'Kata', abs_path: '/w/Projects/octus/Kata' },
    { id: 'd', label: 'Jiku', abs_path: '/w/Projects/octus/Jiku' },
    { id: 'e', label: 'smarep', abs_path: '/w/Projects/smarep' },
  ];
  const out = suggestGroups(projects);
  assert.deepEqual(out.map((s) => s.label), ['jbr', 'octus']); // Projects は jbr/octus の祖先なので候補から外れる
  assert.deepEqual(out[0].members.map((m) => m.id), ['jbr', 'a', 'b']);
  assert.equal(out[1].members.length, 2);
});

test('suggestGroups: abs_path が無いプロジェクトは無視する', () => {
  assert.deepEqual(suggestGroups([{ id: 'x', label: 'x', abs_path: null }]), []);
});
