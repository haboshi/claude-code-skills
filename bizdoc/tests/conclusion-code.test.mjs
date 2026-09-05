// v0.11.3 (2026-09-05): .conclusion（ダーク地の終端パネル）内の <code> が読めない件（Issue #55 併記）
//   - code / pre / table / .callout / .card は白地前提で --bg-soft 地 + --line 枠 + --ink 系の文字を使う。
//     パネル内では明るい地に明るい継承色が載って読めなかった。
//   - 部品ごとの上書きでなく、.conclusion で「地と文字」のトークンを反転する（文中の <code> だけ直すと
//     <pre> と直下の <code> が残る — レビューで実測）。@media print では .conclusion が白地に反転するので、
//     トークンも inherit で親（body）の値へ戻す。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readTokensCss } from '../scripts/inject.mjs';
import { openRenderer, tokensDoc } from './helpers.mjs';

const css = readTokensCss();
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const TOKENS = ['--bg-soft', '--line', '--ink', '--ink-2'];

test('tokens.css: .conclusion は地と文字のトークンをダーク用に反転し、印刷では親の値へ戻す', () => {
  const screen = stripped.match(/\.conclusion\s*\{([^}]*)\}/)[1];
  for (const v of TOKENS) assert.match(screen, new RegExp(`${v}:\\s*(?!inherit)\\S`), `画面用 .conclusion が ${v} を上書きしていない`);
  assert.doesNotMatch(screen, /background:\s*var\(--ink\)/, 'パネル地は --ink を上書きするため固定値にする');
  const print = stripped.slice(stripped.indexOf('@media print')).match(/\.conclusion\s*\{([^}]*)\}/)[1];
  for (const v of TOKENS) assert.match(print, new RegExp(`${v}:\\s*inherit`), `印刷用 .conclusion が ${v} を inherit で戻していない`);
});

const BODY =
  '<section class="conclusion"><h2>結論</h2><p>本文 <code id="chip">ecs-task</code></p>' +
  '<code id="direct">direct</code><pre><code id="block">aws ecs describe-services</code></pre></section>';
const EXPR = `(() => {
  const g = (sel) => { const s = getComputedStyle(document.querySelector(sel)); return { bg: s.backgroundColor, color: s.color, border: s.borderTopStyle }; };
  return { panel: g('.conclusion'), chip: g('#chip'), direct: g('#direct'), pre: g('pre'), block: g('#block') };
})()`;
// 相対輝度（0 = 黒, 1 = 白）。色の絶対値でなく「地が暗ければ文字は明るい」の関係を見る
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

let renderer = null;
before(async () => { renderer = await openRenderer('bizdoc-ccode-'); });
after(async () => { await renderer?.close(); });

test('render: 画面ではダーク地の上で code チップ・直下の code・pre が読める配色になり、pre > code は装飾なしのまま', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.evaluate({ html: tokensDoc(css, BODY) }, EXPR);
  assert.ok(lum(r.panel.bg) < 0.2, `パネル地は暗い: ${r.panel.bg}`);
  for (const k of ['chip', 'direct', 'pre']) {
    assert.equal(r[k].bg, 'rgba(255, 255, 255, 0.14)', `${k} の地は半透明の白（--bg-soft の反転値）`);
    assert.ok(lum(r[k].color) > 0.7, `${k} の文字は明るい: ${r[k].color}`);
  }
  assert.equal(r.block.bg, 'rgba(0, 0, 0, 0)', 'pre > code は器を持たない（pre code の契約）');
  assert.equal(r.block.border, 'none');
});

test('render（print）: 白地パネルに合わせて code / pre も白地用の配色に戻る', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.evaluate({ html: tokensDoc(css, BODY) }, EXPR, { media: 'print' });
  assert.equal(r.panel.bg, 'rgb(255, 255, 255)');
  for (const k of ['chip', 'direct', 'pre']) {
    assert.equal(r[k].bg, 'rgb(244, 246, 250)', `${k} の地は --bg-soft（親の値）`);
    assert.ok(lum(r[k].color) < 0.2, `${k} の文字は暗い: ${r[k].color}`);
  }
});
