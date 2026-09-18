// マーケットプレイスの二重管理は、片方だけ更新して乖離するのが定番の事故。
// 「両方をバイト一致で更新する」という規約を、人の記憶ではなくテストで保つ。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findAbsolutePaths, describeLeak } from '../scripts/lib/leaks.mjs';

const repo = new URL('../../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, repo));
const plugin = JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'));

test('marketplace.json 2 ファイルがバイト一致', () => {
  assert.ok(read('marketplace.json').equals(read('.claude-plugin/marketplace.json')));
});

test('design-atlas が両方に登録されている', () => {
  for (const p of ['marketplace.json', '.claude-plugin/marketplace.json']) {
    const entry = JSON.parse(read(p).toString()).plugins.find((x) => x.name === 'design-atlas');
    assert.ok(entry, `${p} に design-atlas がない`);
    assert.equal(entry.source, './design-atlas');
    assert.equal(entry.version, plugin.version, 'plugin.json と版が食い違っている');
  }
});

test('marketplace のエントリに skills フィールドを書かない（インストール時にスキーマエラーになる）', () => {
  for (const entry of JSON.parse(read('marketplace.json').toString()).plugins) {
    assert.ok(!('skills' in entry), `${entry.name} に skills がある`);
  }
});

test('配布物に絶対パスが残っていない', () => {
  // 参照した非公開案件の語そのものはここに書けない（この公開リポジトリに書いた時点で漏れる）。
  // 機械で守れるのは構造的なパターンだけにし、案件固有語は DESIGN_ATLAS_FORBIDDEN で渡す。
  const extra = (process.env.DESIGN_ATLAS_FORBIDDEN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const root = new URL('../', import.meta.url);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const child = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, dir);
    return e.isDirectory() ? walk(child) : [child];
  });
  // 唯一の対象外。漏洩検出そのもののテストで、架空の絶対パスを検体として持つ必要がある。
  const sample = /tests\/(leaks|checks)\.test\.mjs$/;
  for (const file of walk(root)) {
    if (/\.(png|webp|jpg|jpeg|gif)$/i.test(file.pathname) || sample.test(file.pathname)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const hit of findAbsolutePaths(text, { extra })) {
      assert.fail(`${file.pathname} に ${describeLeak(hit)} が含まれている`);
    }
  }
});
