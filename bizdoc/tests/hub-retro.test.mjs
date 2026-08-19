// 既存文書への遡及（nav apply / retheme）。どちらも opt-in で、対象外の文書を壊さないことを固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';

const DOC = (title) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<style data-bizdoc="tokens"></style></head><body><p>本文</p></body></html>`;
// マーカーを持たない「取込品」。フル CSS を焼き込んだ旧文書や外部由来の HTML を模す
const LEGACY = (title) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<style>body{color:#333}</style></head><body><p>取込品</p></body></html>`;

function write(base, name, html) {
  const p = path.join(base, name);
  fs.writeFileSync(p, html);
  return p;
}

// add を通さず docs/ 配下へ直接置く（既存文書・手で取り込んだ文書の再現）
function seedLegacy(hub, projectId, dirName, html) {
  const dir = path.join(hub, 'projects', projectId, 'docs', dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ schema_version: 1, title: dirName, slug: dirName, type: 'その他', updated: '2026-01-01T00:00:00.000Z', entry: 'index.html', project_id: projectId }, null, 2)
  );
  return path.join(dir, 'index.html');
}

function projectIdOf(out) {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(out), 'manifest.json'), 'utf8')).project_id;
}

test('nav apply: nav 枠の無い既存文書に後から入る', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'a.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const pid = projectIdOf(seedOut);
  const legacy = seedLegacy(hub, pid, '20260101-legacy', LEGACY('旧文書'));
  assert.ok(!fs.readFileSync(legacy, 'utf8').includes('bizdoc:nav'), '前提が崩れている');

  const out = runHub(hub, ['nav', 'apply']);
  assert.match(out, /nav を 1 件に入れました/);
  const after = fs.readFileSync(legacy, 'utf8');
  assert.ok(after.includes('bizdoc-hubnav'), 'nav が入っていない');
  assert.ok(after.includes(`#p-${pid}`), '戻りリンクが不正');
  assert.ok(after.includes('body{color:#333}'), '取込品の元 CSS が失われている');
});

test('nav apply: --dry-run は書き込まない', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'b.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const legacy = seedLegacy(hub, projectIdOf(seedOut), '20260101-dry', LEGACY('旧文書'));
  const before = fs.readFileSync(legacy, 'utf8');
  const out = runHub(hub, ['nav', 'apply', '--dry-run']);
  assert.match(out, /--dry-run のため書き込みません/);
  assert.equal(fs.readFileSync(legacy, 'utf8'), before, 'dry-run なのに書き込まれた');
});

test('nav apply: 2 回目は対象なし（冪等）', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'c.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  seedLegacy(hub, projectIdOf(seedOut), '20260101-idem', LEGACY('旧文書'));
  runHub(hub, ['nav', 'apply']);
  const out = runHub(hub, ['nav', 'apply']);
  assert.match(out, /nav 枠の無いドキュメントはありません/, '2 回目で再注入されている');
});

test('nav apply: <body> を省いた文書にも入る（本文要素の直前）', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'd.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const frag = seedLegacy(hub, projectIdOf(seedOut), '20260101-frag', '<title>断片</title><style>p{color:#333}</style><div>本文</div>');
  runHub(hub, ['nav', 'apply']);
  const after = fs.readFileSync(frag, 'utf8');
  assert.ok(after.includes('bizdoc-hubnav'), '<body> 省略文書に入っていない');
  assert.ok(after.includes('p{color:#333}'), '元の CSS が失われている');
});

test('nav apply: 差し込み位置の無い文書はスキップし、診断は stderr へ出す', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'd2.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const frag = seedLegacy(hub, projectIdOf(seedOut), '20260101-noanchor', '<title>タイトルだけ</title>');
  const before = fs.readFileSync(frag, 'utf8');
  const out = runHub(hub, ['nav', 'apply']);
  assert.equal(fs.readFileSync(frag, 'utf8'), before, 'アンカー無しが書き換えられた');
  assert.ok(!out.includes('skip:'), '診断が stdout に出ている');
});

test('retheme: tokens マーカーを持つ文書に現在の tokens.css を貼り直す', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'e.html', DOC('文書E')), '--project', proj, '--slug', 'themed']).trim();
  // 保存済みファイルの CSS を古い内容に差し替えて「テンプレが更新された」状態を作る
  const stale = fs.readFileSync(out, 'utf8').replace(
    /(<style[^>]*data-bizdoc="tokens"[^>]*>)[\s\S]*?(<\/style>)/,
    '$1body{color:red}$2'
  );
  fs.writeFileSync(out, stale);
  assert.ok(!fs.readFileSync(out, 'utf8').includes('--measure:'), '前提が崩れている');

  const res = runHub(hub, ['retheme']);
  assert.match(res, /tokens を 1 件に貼り直しました/);
  assert.match(fs.readFileSync(out, 'utf8'), /--measure:/, 'tokens が戻っていない');
});

test('retheme: マーカーを持たない取込品には触れない', () => {
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'f.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const legacy = seedLegacy(hub, projectIdOf(seedOut), '20260101-untouched', LEGACY('別デザイン'));
  const before = fs.readFileSync(legacy, 'utf8');
  runHub(hub, ['retheme']);
  assert.equal(fs.readFileSync(legacy, 'utf8'), before, '取込品が書き換えられた');
});

test('retheme: 2 回目は書き込みが発生しない（冪等）', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'g.html', DOC('文書G')), '--project', proj, '--slug', 'idem2']).trim();
  runHub(hub, ['retheme']);
  const mtime = fs.statSync(out).mtimeMs;
  const res = runHub(hub, ['retheme']);
  assert.match(res, /更新の要るドキュメントはありません/);
  assert.equal(fs.statSync(out).mtimeMs, mtime, '無変更なのに書き込まれた');
});

test('retheme: accent は project.json の値で貼り直される', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'h.html', DOC('文書H')), '--project', proj, '--slug', 'acc', '--accent', '#ff9900']).trim();
  const stale = fs.readFileSync(out, 'utf8').replace(
    /(<style[^>]*data-bizdoc="tokens"[^>]*>)[\s\S]*?(<\/style>)/,
    '$1body{color:red}$2'
  );
  fs.writeFileSync(out, stale);
  runHub(hub, ['retheme']);
  assert.match(fs.readFileSync(out, 'utf8'), /--accent:\s*#ff9900\s*;/, 'accent が復元されていない');
});

test('nav apply: manifest が無い文書にも入る（sibling には出さない）', () => {
  // add を通さず手で置かれた文書は manifest を持たず「破損」扱いになる。
  // 壊れているのはメタデータであって HTML ではないので、戻り導線はむしろ必要。
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'i.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const pid = projectIdOf(seedOut);
  const dir = path.join(hub, 'projects', pid, 'docs', '20260101-nomanifest');
  fs.mkdirSync(dir, { recursive: true });
  const orphan = path.join(dir, 'index.html');
  fs.writeFileSync(orphan, LEGACY('manifest なし'));

  runHub(hub, ['nav', 'apply']);
  assert.ok(fs.readFileSync(orphan, 'utf8').includes('bizdoc-hubnav'), 'manifest 無し文書に入っていない');
  assert.ok(fs.readFileSync(seedOut, 'utf8').includes('20260101-nomanifest') === false, '破損 doc が sibling に出ている');
});

test('reindex: nav 枠を持たない既存文書を黙って書き換えない（後付けは nav apply の opt-in）', () => {
  // ヘッダで「既存文書への後付けは opt-in」と約束している。reindex がそれを破ると、
  // 明示の操作なしに過去の文書が書き換わる。
  const { base, hub, proj } = setup();
  const seedOut = runHub(hub, ['add', write(base, 'r1.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const legacy = seedLegacy(hub, projectIdOf(seedOut), '20260101-untouched-by-reindex', LEGACY('取込品'));
  const before = fs.readFileSync(legacy, 'utf8');
  runHub(hub, ['reindex']);
  assert.equal(fs.readFileSync(legacy, 'utf8'), before, 'reindex が nav 未注入の文書を書き換えた');
  assert.ok(!fs.readFileSync(legacy, 'utf8').includes('bizdoc:nav'), 'nav が勝手に入った');
});
