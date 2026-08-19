// アクセント色の決定（--accent の書き戻しと、既存値を上書きしない約束）を固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, runHub } from './helpers.mjs';
import { blendWithWhite } from '../scripts/inject.mjs';

const DOC = (title) =>
  `<!doctype html><html><head><title>${title}</title>` +
  `<style data-bizdoc="tokens"></style></head><body><p>本文</p></body></html>`;

function write(base, name, html) {
  const p = path.join(base, name);
  fs.writeFileSync(p, html);
  return p;
}

function projectJson(out) {
  // .../projects/<id>/docs/<name>/index.html → .../projects/<id>/project.json
  const p = path.resolve(path.dirname(out), '../../project.json');
  assert.match(p, /projects\/[^/]+\/project\.json$/, 'project.json のパス形が想定と違う');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('--accent: project.json が未設定なら書き戻され、注入 CSS に反映される', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'a.html', DOC('文書A')), '--project', proj, '--accent', '#FF9900']).trim();
  assert.equal(projectJson(out).accent, '#ff9900', 'project.json へ書き戻されていない');
  const saved = fs.readFileSync(out, 'utf8');
  assert.match(saved, /--accent:\s*#ff9900\s*;/, '注入 CSS に accent が反映されていない');
  assert.match(saved, new RegExp(`--accent-soft:\\s*${blendWithWhite('#ff9900')}\\s*;`), 'accent-soft が導出されていない');
});

test('--accent: 既存の accent は上書きしない（文書間でぶれさせない）', () => {
  const { base, hub, proj } = setup();
  const first = runHub(hub, ['add', write(base, 'b1.html', DOC('一本目')), '--project', proj, '--slug', 'one', '--accent', '#2563eb']).trim();
  assert.equal(projectJson(first).accent, '#2563eb');
  const second = runHub(hub, ['add', write(base, 'b2.html', DOC('二本目')), '--project', proj, '--slug', 'two', '--accent', '#ff9900']).trim();
  assert.equal(projectJson(second).accent, '#2563eb', '既存 accent が上書きされた');
  assert.match(fs.readFileSync(second, 'utf8'), /--accent:\s*#2563eb\s*;/, '2本目が既存 accent で描かれていない');
});

test('--accent: 不正な値は無視され、既定のまま保存される', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'c.html', DOC('文書C')), '--project', proj, '--accent', 'orange']).trim();
  assert.equal(projectJson(out).accent, null, '不正値が書き戻された');
  assert.equal(out.split('\n').length, 1, 'stdout が汚れている');
});

test('--accent なし: 既定の tokens.css がそのまま入る', () => {
  const { base, hub, proj } = setup();
  const out = runHub(hub, ['add', write(base, 'd.html', DOC('文書D')), '--project', proj]).trim();
  assert.equal(projectJson(out).accent, null);
  assert.match(fs.readFileSync(out, 'utf8'), /--accent:\s*#2563eb\s*;/, '既定 accent で描かれていない');
});

test('blendWithWhite: 決定論で、既定 accent から既定 soft 相当の薄色を作る', () => {
  assert.equal(blendWithWhite('#ff9900'), blendWithWhite('#ff9900'), '同入力で結果が揺れる');
  assert.match(blendWithWhite('#2563eb'), /^#[0-9a-f]{6}$/);
  assert.equal(blendWithWhite('#ffffff'), '#ffffff', '白は白のまま');
  assert.equal(blendWithWhite('#000000', 1), '#000000', '比率 1 で元色に一致しない');
  assert.equal(blendWithWhite('not-a-color'), null, '不正入力に null を返さない');
});

test('--accent: 後から確定したとき、既定色で保存済みの文書も同じ色に揃う', () => {
  // accent 未設定のまま文書を保存すると既定 #2563eb で焼かれる。後から --accent を
  // 初めて指定したとき、新しい文書だけ新色になると「文書間でぶれさせない」約束が破れる。
  const { base, hub, proj } = setup();
  const first = runHub(hub, ['add', write(base, 'x1.html', DOC('先に保存')), '--project', proj, '--slug', 'earlier']).trim();
  assert.match(fs.readFileSync(first, 'utf8'), /--accent:\s*#2563eb\s*;/, '前提: 既定色で保存されている');
  assert.equal(projectJson(first).accent, null);

  const second = runHub(hub, ['add', write(base, 'x2.html', DOC('後から保存')), '--project', proj, '--slug', 'later', '--accent', '#ff9900']).trim();
  assert.match(fs.readFileSync(second, 'utf8'), /--accent:\s*#ff9900\s*;/, '新しい文書に反映されていない');
  assert.match(fs.readFileSync(first, 'utf8'), /--accent:\s*#ff9900\s*;/, '既存文書が既定色のまま取り残された');
  assert.equal(projectJson(second).accent, '#ff9900');
});

test('--accent: 確定時の貼り直しはマーカーを持たない文書に触れない', () => {
  const { base, hub, proj } = setup();
  const seed = runHub(hub, ['add', write(base, 'y1.html', DOC('起点')), '--project', proj, '--slug', 'seed']).trim();
  const pid = projectJson(seed).accent === null ? JSON.parse(fs.readFileSync(path.join(path.dirname(seed), 'manifest.json'), 'utf8')).project_id : null;
  const dir = path.join(hub, 'projects', pid, 'docs', '20260101-legacy');
  fs.mkdirSync(dir, { recursive: true });
  const legacy = path.join(dir, 'index.html');
  const raw = '<!doctype html><html><head><title>取込品</title><style>body{color:#333}</style></head><body><p>本文</p></body></html>';
  fs.writeFileSync(legacy, raw);

  runHub(hub, ['add', write(base, 'y2.html', DOC('新規')), '--project', proj, '--slug', 'newer', '--accent', '#ff9900']);
  assert.equal(fs.readFileSync(legacy, 'utf8'), raw, 'マーカー無しの取込品が書き換えられた');
});
