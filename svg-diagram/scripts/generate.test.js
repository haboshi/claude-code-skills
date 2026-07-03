/**
 * generate.js の純粋ロジックに対する単体テスト。
 *
 * 対象: SVG 構造バリデーション (validateSvg)、
 *      markdown コードフェンス除去 (stripCodeFences)、
 *      システムプロンプト生成 (buildSystemPrompt)。
 *
 * OpenRouter API 呼び出し（ネットワーク依存）はテストしない。
 * generate.js は import.meta.url ガードにより import しても main() が走らない。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, stripCodeFences, validateSvg } from "./generate.js";

// テスト用の最小妥当 SVG を生成するヘルパー
function validSvg({ xmlDecl = true, viewBox = true, xmlns = true } = {}) {
  const decl = xmlDecl ? '<?xml version="1.0" encoding="UTF-8"?>\n' : "";
  const attrs = [
    xmlns ? 'xmlns="http://www.w3.org/2000/svg"' : "",
    viewBox ? 'viewBox="0 0 1920 1080"' : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `${decl}<svg ${attrs}><rect x="0" y="0" width="10" height="10" /></svg>`;
}

// --- validateSvg: 正常系 ---

test("validateSvg: 妥当な SVG（XML宣言付き）を通す", () => {
  const { valid, errors } = validateSvg(validSvg());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateSvg: XML宣言なしの妥当な SVG も通す", () => {
  const { valid, errors } = validateSvg(validSvg({ xmlDecl: false }));
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

// --- validateSvg: 異常系 ---

test("validateSvg: svg 以外のルート要素を弾く", () => {
  const html =
    '<html><body><p>これは SVG ではありません</p></body></html>';
  const { valid, errors } = validateSvg(html);
  assert.equal(valid, false);
  // <svg タグそのものが無いため検出される
  assert.ok(
    errors.some((e) => e.includes("<svg")),
    `errors=${JSON.stringify(errors)}`,
  );
});

test("validateSvg: 閉じタグ </svg> が無いと弾く", () => {
  const svg =
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect />';
  const { valid, errors } = validateSvg(svg);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("</svg>")));
});

test("validateSvg: viewBox 属性が無いと弾く", () => {
  const { valid, errors } = validateSvg(validSvg({ viewBox: false }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("viewBox")));
});

test("validateSvg: xmlns 属性が無いと弾く", () => {
  const { valid, errors } = validateSvg(validSvg({ xmlns: false }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("xmlns")));
});

test("validateSvg: 空文字列は弾かれ、複数のエラーを返す", () => {
  const { valid, errors } = validateSvg("");
  assert.equal(valid, false);
  assert.ok(errors.length >= 2);
  assert.ok(errors.some((e) => e.includes("<svg")));
  assert.ok(errors.some((e) => e.includes("</svg>")));
});

test("validateSvg: 不正な XML（属性の引用符閉じ忘れ）を弾く", () => {
  // viewBox の引用符が閉じられておらず、XML パーサがエラーを出す
  const broken =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10><rect /></svg>';
  const { valid, errors } = validateSvg(broken);
  assert.equal(valid, false);
  assert.ok(errors.length >= 1);
});

// --- stripCodeFences ---

test("stripCodeFences: ```svg フェンスを除去し中身の SVG を取り出す", () => {
  const wrapped = '```svg\n<svg xmlns="x" viewBox="0 0 1 1"></svg>\n```';
  const result = stripCodeFences(wrapped);
  assert.equal(result, '<svg xmlns="x" viewBox="0 0 1 1"></svg>');
});

test("stripCodeFences: ```xml フェンスも除去する", () => {
  const wrapped = '```xml\n<svg></svg>\n```';
  assert.equal(stripCodeFences(wrapped), "<svg></svg>");
});

test("stripCodeFences: 言語指定なしの ``` フェンスも除去する", () => {
  const wrapped = "```\n<svg></svg>\n```";
  assert.equal(stripCodeFences(wrapped), "<svg></svg>");
});

test("stripCodeFences: フェンスが無い場合はそのまま返す", () => {
  const plain = '<svg xmlns="x" viewBox="0 0 1 1"></svg>';
  assert.equal(stripCodeFences(plain), plain);
});

test("stripCodeFences: 大文字フェンス（```SVG）も除去する（大小無視）", () => {
  const wrapped = "```SVG\n<svg></svg>\n```";
  assert.equal(stripCodeFences(wrapped), "<svg></svg>");
});

test("stripCodeFences: 抽出結果が validateSvg を通ること", () => {
  const wrapped = `\`\`\`svg\n${validSvg()}\n\`\`\``;
  const svg = stripCodeFences(wrapped);
  const { valid } = validateSvg(svg);
  assert.equal(valid, true);
});

// --- buildSystemPrompt ---

test("buildSystemPrompt: viewBox に width/height が埋め込まれる", () => {
  const prompt = buildSystemPrompt("dark", 800, 600);
  assert.ok(prompt.includes("viewBox=\"0 0 800 600\""));
});

test("buildSystemPrompt: dark テーマはダーク配色を含む", () => {
  const prompt = buildSystemPrompt("dark", 1920, 1080);
  assert.ok(prompt.includes("Dark"));
  assert.ok(prompt.includes("#0f172a"));
});

test("buildSystemPrompt: light テーマはライト配色を含む", () => {
  const prompt = buildSystemPrompt("light", 1920, 1080);
  assert.ok(prompt.includes("Light"));
  assert.ok(prompt.includes("#ffffff"));
});
