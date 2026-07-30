import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { slugify, projectIdFromPath, resolveMainWorktreeRoot } from '../scripts/project-id.mjs';

test('slugify: 記号を - に潰し前後の - を除去', () => {
  assert.equal(slugify('My Repo (v2)'), 'my-repo-v2');
  assert.equal(slugify('日本語のみ'), 'project');
});

test('projectIdFromPath: <slug>-<hex8> 形式で決定論的', () => {
  const id = projectIdFromPath('/tmp/My Repo');
  assert.match(id, /^my-repo-[0-9a-f]{8}$/);
  assert.equal(id, projectIdFromPath('/tmp/My Repo'));
  assert.notEqual(id, projectIdFromPath('/tmp/other'));
});

test('resolveMainWorktreeRoot: git 外はそのまま解決', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pid-plain-')));
  assert.equal(resolveMainWorktreeRoot(dir), dir);
});

test('resolveMainWorktreeRoot: リポジトリ内サブディレクトリはリポジトリルートに解決', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git なし');
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pid-repo-')));
  const run = (args, cwd = repo) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  run(['init', '-q']);
  fs.mkdirSync(path.join(repo, 'sub'));
  assert.equal(resolveMainWorktreeRoot(path.join(repo, 'sub')), repo);
});

test('resolveMainWorktreeRoot: worktree は main worktree ルートに解決', (t) => {
  if (spawnSync('git', ['--version']).status !== 0) return t.skip('git なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pid-wt-')));
  const repo = path.join(base, 'main');
  fs.mkdirSync(repo);
  const run = (args, cwd = repo) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  };
  run(['init', '-q']);
  run(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init']);
  const wt = path.join(base, 'wt');
  run(['worktree', 'add', '-q', wt]);
  assert.equal(resolveMainWorktreeRoot(wt), repo);
});
