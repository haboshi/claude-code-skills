// v0.11.1 (2026-09-02): セクション番号「全部 01」欠陥の回帰テスト
//   - tokens.css は body でカウンタをリセットする（<main> 非依存）
//   - .conclusion の h2 は番号対象外
//   - hub.mjs add は tokens <style> 不在・目次と h2 数の不一致を stderr に warn する（stdout 契約は不変）
//   - Chrome があれば実描画で 01,02,03 の連番を確認する（v0.11.2: DOMSnapshot で ::before のテキストを読む。helpers.mjs の openRenderer）
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { setup, counterResets, targetsBody, openRenderer, tokensDoc } from './helpers.mjs';

const TOKENS = fileURLToPath(new URL('../templates/tokens.css', import.meta.url));
const HUB_MJS = fileURLToPath(new URL('../scripts/hub.mjs', import.meta.url));

const css = fs.readFileSync(TOKENS, 'utf8');

test('tokens.css: body で sec カウンタをリセットする（<main> 非依存）', () => {
  // v0.11.2: fig と同じ body の 1 宣言（counter-reset: fig sec）に統合。コメントを除いた実宣言だけを見る
  // （以前の正規表現はコメント中の `body { counter-reset: sec }` にも当たり、宣言を消しても通っていた）
  const body = counterResets(css).filter((r) => targetsBody(r.selector));
  assert.equal(body.length, 1, JSON.stringify(body));
  assert.ok(body[0].value.split(/\s+/).includes('sec'), body[0].value);
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

let renderer = null;
before(async () => { renderer = await openRenderer('bizdoc-num-'); });
after(async () => { await renderer?.close(); });

test('render: <main> なし・3 セクション + conclusion で 01,02,03 の連番になり、conclusion の h2 は番号を持たない', { timeout: 60000 }, async (t) => {
  if (!renderer) return t.skip('Chrome なし');
  const r = await renderer.beforeText({
    html: tokensDoc(
      css,
      '<section><h2>一</h2></section><section><h2>二</h2></section><section><h2>三</h2></section>' +
        '<section class="conclusion"><h2>結論</h2></section>'
    ),
  });
  // .conclusion > h2::before は content: none なので生成テキストを持たず、H2 の配列に現れない
  assert.deepEqual(r.H2, ['01', '02', '03']);
});
