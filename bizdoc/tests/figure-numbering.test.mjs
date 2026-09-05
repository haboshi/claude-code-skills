// v0.11.2 (2026-09-05): 図番号「全部 図1」欠陥の回帰テスト
//   v0.11.1 が body の counter-reset を 2 か所に分けて書いたため、後の宣言（sec）が前の宣言（fig）を
//   上書きし、figure ごとにカウンタが新設されて全ての図が「図1」になった。
//   counter-reset は要素ごとに 1 宣言しか効かない。body のリセットは fig と sec を同じ宣言に持つこと。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKENS = fileURLToPath(new URL('../templates/tokens.css', import.meta.url));
const css = fs.readFileSync(TOKENS, 'utf8');

/** body { … } ブロックの中身を全て返す（複数あれば複数）。 */
function bodyBlocks(text) {
  return [...text.matchAll(/(?:^|[}\n])\s*body\s*\{([^}]*)\}/g)].map((m) => m[1]);
}

test('tokens.css: body の counter-reset は fig と sec を同じ宣言に持つ', () => {
  const blocks = bodyBlocks(css);
  const resets = blocks.flatMap((b) => [...b.matchAll(/counter-reset:\s*([^;]+);/g)].map((m) => m[1].trim()));
  assert.ok(resets.length >= 1, 'body に counter-reset が無い');
  const last = resets[resets.length - 1];
  assert.match(last, /\bfig\b/, `最後に効く body の counter-reset に fig が無い: "${last}"`);
  assert.match(last, /\bsec\b/, `最後に効く body の counter-reset に sec が無い: "${last}"`);
});

test('tokens.css: body の counter-reset 宣言は 1 つだけ（分割すると後勝ちで前が消える）', () => {
  const blocks = bodyBlocks(css);
  const count = blocks.reduce((n, b) => n + (b.match(/counter-reset:/g) || []).length, 0);
  assert.equal(count, 1, `body の counter-reset が ${count} 回宣言されている`);
});

test('tokens.css: figure は fig を加算し、figcaption が counter(fig) を表示する', () => {
  assert.match(css, /figure\s*\{[^}]*counter-increment:\s*fig/);
  assert.match(css, /figcaption::before\s*\{[^}]*counter\(fig\)/);
});

// 描画確認は置かない。Chrome は getComputedStyle(el, '::before').content に counter() を
// 展開前の文字列で返し、擬似要素の採番結果をスクリプトから読む手段が無い（2026-09-05 実測）。
// 採番の実物確認は screenshot.mjs の検品（Phase 5）で行う。
