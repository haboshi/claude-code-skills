import test from 'node:test';
import assert from 'node:assert/strict';
import { findAbsolutePaths, describeLeak } from '../scripts/lib/leaks.mjs';

test('ホームディレクトリの絶対パスを検出する', () => {
  const hits = findAbsolutePaths('see /Users/someone/projects/a.json for details');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'macOS ホーム');
});

test('一時領域と Windows パスも検出する', () => {
  assert.equal(findAbsolutePaths('cwd=/private/tmp/run-12/out').length, 1);
  assert.equal(findAbsolutePaths('path C:\\Users\\a\\b.txt').length, 1);
});

test('URL の path 部分は誤検知しない', () => {
  assert.deepEqual(findAbsolutePaths('https://example.test/Users/profile'), []);
  assert.deepEqual(findAbsolutePaths('relative/home/page.html'), []);
});

test('相対パスと mock 参照は通す', () => {
  assert.deepEqual(findAbsolutePaths('<a href="mock/index.html">open</a>'), []);
});

test('extra に渡した語も混入として扱う', () => {
  const hits = findAbsolutePaths('project acme-internal build', { extra: ['acme-internal'] });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, '指定文字列');
});

test('describeLeak は値そのものを出さない', () => {
  const [hit] = findAbsolutePaths('/Users/secret-name/x');
  assert.ok(!describeLeak(hit).includes('secret-name'));
});
