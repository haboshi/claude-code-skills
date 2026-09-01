// accent 候補抽出の契約を固定する。実測（2026-08-31、社内5案件）で踏んだ罠を回帰させない:
//   - hover 用の `--accent: 243 244 246`（gray-100）を「名前が accent だから」と拾わないこと
//   - 本文色（--ink / --text-primary / --foreground）がコントラスト最上位で残り続けないこと
//   - warn と近い暖色（テラコッタ）を候補に出さないこと
//   - vendor 配下の無関係な tailwind.config を拾わないこと
//   - tailwind の色スケール（--700 / --800）を別々の候補として並べないこと
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseColor, contrastRatio, saturationOf, hueOf, hueDistance,
  extractVariables, findStylesheets, collectAccentCandidates, readWarnColor,
} from '../scripts/accent-candidates.mjs';

function tmpProject(files) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'accent-test-')));
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return base;
}
const hexes = (r) => r.candidates.map((c) => c.hex);

test('parseColor: 4 形式を #rrggbb へ正規化する', () => {
  assert.equal(parseColor('#2563EB'), '#2563eb');
  assert.equal(parseColor('#abc'), '#aabbcc');
  assert.equal(parseColor('22 163 74'), '#16a34a', 'Tailwind のスペース区切り RGB');
  assert.equal(parseColor('rgb(37, 99, 235)'), '#2563eb');
  assert.equal(parseColor('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(parseColor('hsl(120, 100%, 25%)'), '#008000');
  assert.equal(parseColor('hsl(217, 91%, 60%)'), '#3c83f6');
});

test('parseColor: 解釈できない表記は null（誤変換して候補に混ぜない）', () => {
  for (const v of ['oklch(0.7 0.15 250)', 'var(--brand)', 'color-mix(in srgb, red, blue)',
                   'transparent', '999 999 999', '', 'currentColor']) {
    assert.equal(parseColor(v), null, `${v} が null でない`);
  }
});

test('計算: コントラスト・彩度・色相が既知の値と一致する', () => {
  assert.equal(Number(contrastRatio('#ffffff', '#ffffff').toFixed(2)), 1);
  assert.equal(Number(contrastRatio('#000000', '#ffffff').toFixed(0)), 21);
  assert.equal(Number(contrastRatio('#2563eb', '#ffffff').toFixed(2)), 5.17);
  assert.equal(saturationOf('#ffffff'), 0, '白は無彩色');
  assert.equal(Number(saturationOf('#16a34a').toFixed(2)), 0.87);
  assert.equal(Math.round(hueOf('#ff0000')), 0);
  assert.equal(Math.round(hueOf('#00ff00')), 120);
  assert.equal(Math.round(hueDistance('#ff0000', '#00ff00')), 120);
  assert.equal(Math.round(hueDistance('#ff0000', '#0000ff')), 120, '色相環は最短距離で測る');
});

test('extractVariables: CSS 変数と tailwind.config の両方を拾う', () => {
  const css = extractVariables(':root { --primary: #16a34a; --gap: 4px; --bg: 255 255 255; }');
  assert.deepEqual(css.map((v) => v.name), ['primary', 'bg'], '色でない値は落ちる');
  const tw = extractVariables("module.exports={theme:{colors:{brand:'#1d6f5c'}}}");
  assert.deepEqual(tw.map((v) => v.hex), ['#1d6f5c']);
});

test('gray-100 の --accent を名前で拾わない（vegeexpress の実例）', () => {
  const dir = tmpProject({
    'app/globals.css': ':root{ --accent: 243 244 246; --accent-foreground: 17 24 39; --primary-dark: 21 128 61; }',
  });
  const r = collectAccentCandidates(dir);
  assert.deepEqual(hexes(r), ['#15803d'], '灰色の accent を採らず、彩度のある色だけが残る');
});

test('本文色は名前で除外する（値だけだとコントラスト最上位で残り続ける）', () => {
  const dir = tmpProject({
    'globals.css': ':root{ --ink: #1f2523; --text-primary: #111827; --foreground: #1c2d3f;'
      + ' --muted-foreground: #6b7280; --teal: #147b73; }',
  });
  assert.deepEqual(hexes(collectAccentCandidates(dir)), ['#147b73']);
});

test('warn と色相が近い暖色は候補にしない（テラコッタ 20.9°）', () => {
  const dir = tmpProject({ 'tokens.css': ':root{ --accent: #A6472B; --brand: #1d6f5c; }' });
  const r = collectAccentCandidates(dir);
  assert.ok(!hexes(r).includes('#a6472b'), 'テラコッタが残っている');
  assert.deepEqual(hexes(r), ['#1d6f5c']);
  assert.equal(r.rejected.hue, 1);
});

test('コントラスト不足は落とし、同ファイルの暗色は残す', () => {
  const dir = tmpProject({ 'globals.css': ':root{ --primary: #16a34a; --primary-dark: #15803d; }' });
  const r = collectAccentCandidates(dir);
  assert.deepEqual(hexes(r), ['#15803d'], '3.30:1 の緑が落ち、5.02:1 の暗色が残る');
  assert.equal(r.rejected.contrast, 1);
});

test('色スケールの段数だけの名前は候補にしない', () => {
  const dir = tmpProject({
    'tailwind.config.ts': "export default {colors:{green:{700:'#15803d',800:'#166534',900:'#14532d'}}}",
    'globals.css': ':root{ --primary-dark: #15803d; }',
  });
  const r = collectAccentCandidates(dir);
  assert.deepEqual(hexes(r), ['#15803d'], '同系の暗い緑が3つ並ばない');
  assert.deepEqual(r.candidates[0].names, ['primary-dark'], '意味のない段数名は表示から外れる');
});

test('同じ色は1件に畳み、別名をまとめる', () => {
  const dir = tmpProject({ 'globals.css': ':root{ --primary: #0b3a6e; --secondary-blue: #0b3a6e; }' });
  const r = collectAccentCandidates(dir);
  assert.equal(r.candidates.length, 1);
  assert.deepEqual(r.candidates[0].names, ['primary', 'secondary-blue']);
});

test('並び順: brand → primary → accent の順で、同格なら彩度の高い順', () => {
  const dir = tmpProject({
    'tokens.css': ':root{ --teal: #147b73; --primary: #0b3a6e; --brand: #6a4d8c; --accent: #3a6ea8; }',
  });
  const names = collectAccentCandidates(dir).candidates.map((c) => c.names[0]);
  assert.deepEqual(names.slice(0, 3), ['brand', 'primary', 'accent']);
});

test('vendor / node_modules は走査しない（無関係な色を拾わない）', () => {
  const dir = tmpProject({
    'vendor/facade/ignition/tailwind.config.js': "module.exports={colors:{x:'#8b1a1a'}}",
    'node_modules/pkg/globals.css': ':root{ --primary: #123456; }',
    'globals.css': ':root{ --brand: #1d6f5c; }',
  });
  assert.deepEqual(findStylesheets(dir).map((f) => path.basename(f)), ['globals.css']);
  assert.deepEqual(hexes(collectAccentCandidates(dir)), ['#1d6f5c']);
});

test('候補ゼロは空配列で返す（呼び出し側が既定色へ落とせる）', () => {
  const dir = tmpProject({ 'globals.css': ':root{ --ink: #111827; --bg: #ffffff; }' });
  const r = collectAccentCandidates(dir);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.scanned, 1);
});

test('warn は tokens.css を正とする（値を写して古びさせない）', () => {
  assert.equal(readWarnColor(), '#c2740a', '配布テンプレの --warn と一致していない');
  const dir = tmpProject({ 'globals.css': ':root{ --brand: #1d6f5c; }' });
  assert.equal(collectAccentCandidates(dir).warn, '#c2740a');
});

test('limit で件数を絞れる', () => {
  const dir = tmpProject({
    'tokens.css': ':root{ --a1: #147b73; --a2: #0b3a6e; --a3: #6a4d8c; --a4: #3d7f4d; }',
  });
  assert.equal(collectAccentCandidates(dir, { limit: 2 }).candidates.length, 2);
});
