// v0.11.2 (2026-09-05): 図番号「全部 図1」欠陥の回帰テスト（Issue #55）
//   - v0.11.1 で body に `counter-reset: sec` を別規則で足し、同一プロパティの後勝ちで既存の `counter-reset: fig` が
//     消えた。各 figure が自前でカウンタを新設して +1 するため、全ての図が「図1」になった。
//   - 構造の守り: 文書全体のカウンタは body の 1 宣言（fig sec）だけでリセットし、同じセレクタに counter-reset を
//     2 回書かない（@media 内・カンマ区切り・`html body` 型も数える）。3 つ目のカウンタを足すときに同じ事故を
//     繰り返さないための決定論ゲート。
//   - 描画の守り: Chrome があれば描画後の figcaption::before / h2::before の生成テキストを読み（helpers.mjs の
//     openRenderer。DOMSnapshot 経由）、画面・印刷メディア・hub.mjs add の保存物で 図1/図2/図3 と 01/02/03 を確認する。
//   - 対照（陽性コントロール）: 現行 CSS に v0.11.1 の重複宣言 `body { counter-reset: sec; }` を追記した退行形を
//     同じ読み口で描画し、図1/図1/図1 に戻ることを確認する（このテストが欠陥を検出できることの証明）。
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readTokensCss } from '../scripts/inject.mjs';
import { setup, runHub, counterResets, targetsBody, openRenderer, tokensDoc } from './helpers.mjs';

const css = readTokensCss();

test('tokens.css: 文書全体のカウンタ（fig / sec）は body の 1 宣言だけでリセットする', () => {
  const body = counterResets(css).filter((r) => targetsBody(r.selector));
  assert.equal(body.length, 1, `body を対象にした counter-reset は 1 宣言に統合する（同一プロパティは後勝ちで先の宣言が消える）: ${JSON.stringify(body)}`);
  const names = body[0].value.split(/\s+/).filter((t) => !/^-?\d+$/.test(t));
  assert.ok(names.includes('fig') && names.includes('sec'), `body の counter-reset に fig と sec が要る: ${body[0].value}`);
});

test('tokens.css: 同じセレクタに counter-reset を 2 回書かない（@media 内・カンマ区切りも数える）', () => {
  const seen = new Map();
  for (const r of counterResets(css)) seen.set(r.selector, (seen.get(r.selector) ?? 0) + 1);
  const dup = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
  assert.deepEqual(dup, [], `counter-reset が重複しているセレクタ: ${dup.join(', ')}`);
});

test('tokens.css: main に counter-reset を置かない（body で足りる。main 側のリセットは再採番の罠）', () => {
  assert.equal(counterResets(css).some((r) => /(^|[\s>+~])main$/.test(r.selector)), false);
});

test('tokens.css: figure は fig を加算し、figcaption が counter(fig) を表示する', () => {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(stripped, /figure\s*\{[^}]*counter-increment:\s*fig/);
  assert.match(stripped, /figcaption::before\s*\{[^}]*counter\(fig\)/);
});

const svg = '<svg viewBox="0 0 10 4" width="200" height="80"><rect width="10" height="4" fill="#eee"/></svg>';
const DOC_BODY =
  `<section><h2>一</h2><figure>${svg}<figcaption>最初の図</figcaption></figure></section>` +
  `<section><h2>二</h2><figure>${svg}<figcaption>二枚目の図</figcaption></figure></section>` +
  `<section><h2>三</h2><figure>${svg}<figcaption>三枚目の図</figcaption></figure></section>` +
  '<section class="conclusion"><h2>結論</h2></section>';
const FIGS = ['図1 ｜ ', '図2 ｜ ', '図3 ｜ '];
const SECS = ['01', '02', '03'];

let renderer = null;
before(async () => { renderer = await openRenderer('bizdoc-fig-'); });
after(async () => { await renderer?.close(); });

test('render: figure 3 枚で 図1, 図2, 図3 と通し採番され、セクションは 01, 02, 03 のまま', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.beforeText({ html: tokensDoc(css, DOC_BODY) });
  assert.deepEqual(r.FIGCAPTION, FIGS);
  assert.deepEqual(r.H2, SECS);
});

test('render（print）: 印刷メディアでも 図1, 図2, 図3 / 01, 02, 03（@media print 側の body 規則で消えない）', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.beforeText({ html: tokensDoc(css, DOC_BODY) }, { media: 'print' });
  assert.deepEqual(r.FIGCAPTION, FIGS);
  assert.deepEqual(r.H2, SECS);
});

test('render（対照）: v0.11.1 の重複宣言 body { counter-reset: sec } を足すと 図1, 図1, 図1 に退行する', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.beforeText({ html: tokensDoc(css + '\nbody { counter-reset: sec; }\n', DOC_BODY) });
  assert.deepEqual(r.FIGCAPTION, ['図1 ｜ ', '図1 ｜ ', '図1 ｜ ']);
  assert.deepEqual(r.H2, SECS);
});

test('render（配布物）: hub.mjs add で tokens と hub ナビを注入した保存物でも 図1, 図2, 図3', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const { base, hub, proj } = setup();
  const src = path.join(base, 'figs.html');
  fs.writeFileSync(src, `<!doctype html><html><head><meta charset="utf-8"><title>figs</title><style data-bizdoc="tokens"></style></head><body>${DOC_BODY}</body></html>`);
  const saved = runHub(hub, ['add', src, '--project', proj, '--slug', 'figs']).trim();
  assert.ok(saved.endsWith('/index.html'), saved);
  const r = await renderer.beforeText({ file: saved });
  assert.deepEqual(r.FIGCAPTION, FIGS);
  assert.deepEqual(r.H2, SECS);
});
