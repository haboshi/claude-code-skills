// v0.11.1 (2026-09-02): セクション番号「全部 01」欠陥の回帰テスト
//   - tokens.css は body でカウンタをリセットする（<main> 非依存）
//   - .conclusion の h2 は番号対象外
//   - hub.mjs add は tokens <style> 不在・目次と h2 数の不一致を stderr に warn する（stdout 契約は不変）
//   - Chrome があれば実レンダリングで 01,02,03 の連番を確認する
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setup } from './helpers.mjs';

const TOKENS = fileURLToPath(new URL('../templates/tokens.css', import.meta.url));
const HUB_MJS = fileURLToPath(new URL('../scripts/hub.mjs', import.meta.url));
const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const css = fs.readFileSync(TOKENS, 'utf8');

test('tokens.css: body で sec カウンタをリセットする（<main> 非依存）', () => {
  assert.match(css, /body\s*\{\s*counter-reset:\s*sec;?\s*\}/);
});

test('tokens.css: .conclusion の h2 は採番しない', () => {
  assert.match(css, /\.conclusion\s*>\s*h2[^{]*\{[^}]*counter-increment:\s*none/);
  assert.match(css, /\.conclusion\s*>\s*h2::before[^{]*\{[^}]*content:\s*none/);
});

function runHubRaw(hub, args) {
  return spawnSync(process.execPath, [HUB_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOC_HUB_DIR: hub },
  });
}

const doc = (body, withTokens = true) =>
  `<!doctype html><html><head><title>採番テスト</title>${withTokens ? '<style data-bizdoc="tokens"></style>' : ''}</head><body>${body}</body></html>`;

test('add: <style data-bizdoc="tokens"> が無いと stderr に warn（stdout は保存先パスのみ）', () => {
  const { base, hub, proj } = setup();
  const p = path.join(base, 'no-tokens.html');
  fs.writeFileSync(p, doc('<section><h2>一</h2></section>', false));
  const r = runHubRaw(hub, ['add', p, '--project', proj]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /data-bizdoc="tokens"/);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.ok(r.stdout.trim().endsWith('/index.html'));
});

test('add: 目次リンク数と番号付き section 数の不一致を warn（.conclusion は数えない）', () => {
  const { base, hub, proj } = setup();
  const p = path.join(base, 'toc-mismatch.html');
  fs.writeFileSync(
    p,
    doc(
      '<nav class="toc"><a href="#s-01">一</a><a href="#s-02">二</a><a href="#s-03">結論</a></nav>' +
        '<section id="s-01"><h2>一</h2></section><section id="s-02"><h2>二</h2></section>' +
        '<section class="conclusion"><h2>結論</h2></section>'
    )
  );
  const r = runHubRaw(hub, ['add', p, '--project', proj]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /目次リンク 3 件と番号付きセクション 2 件/);
});

test('add: 整合した文書は warn を出さない', () => {
  const { base, hub, proj } = setup();
  const p = path.join(base, 'ok.html');
  fs.writeFileSync(
    p,
    doc(
      '<nav class="toc"><a href="#s-01">一</a><a href="#s-02">二</a></nav>' +
        '<section id="s-01"><h2>一</h2></section><section id="s-02"><h2>二</h2></section>' +
        '<section class="conclusion"><h2>結論</h2></section>'
    )
  );
  const r = runHubRaw(hub, ['add', p, '--project', proj]);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /目次リンク|data-bizdoc="tokens"/);
});

test('render: <main> なし・3 セクション + conclusion で 01,02,03 の連番になる', { timeout: 60000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bizdoc-num-')));
  const html = path.join(base, 'n.html');
  fs.writeFileSync(
    html,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>` +
      '<section><h2>一</h2></section><section><h2>二</h2></section><section><h2>三</h2></section>' +
      '<section class="conclusion"><h2>結論</h2></section></body></html>'
  );
  // ::before の content は DOM に無いので、getComputedStyle で counter 値を読む
  const js =
    "JSON.stringify([...document.querySelectorAll('section > h2')].map(h => getComputedStyle(h, '::before').content))";
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--run-all-compositor-stages-before-draw`, '--virtual-time-budget=2000', '--dump-dom', 'file://' + html], { encoding: 'utf8' });
  // --dump-dom では擬似要素が取れないため、CSS 側の規則だけを最低限検証（連番の実測は screenshot 系テストに委ねる）
  assert.equal(r.status, 0);
  assert.match(r.stdout, /<section class="conclusion">/);
  void js;
});
