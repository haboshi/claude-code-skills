import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseBackground } from "./color-utils.js";

// svg-to-webp 版 color-utils の仕様検証。
// mermaid-to-webp 版とほぼ同一のパースロジックだが、
// 不正値のフォールバックが transparent（alpha 0）である点が異なる（意図的な複製）。
describe("parseBackground (svg-to-webp)", () => {
  it("'transparent' を alpha 0 の RGBA に変換する", () => {
    const result = parseBackground("transparent");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 0 });
  });

  it("'white' を白の RGBA に変換する", () => {
    const result = parseBackground("white");
    assert.deepStrictEqual(result, { r: 255, g: 255, b: 255, alpha: 1 });
  });

  it("'black' を黒の RGBA に変換する", () => {
    const result = parseBackground("black");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 1 });
  });

  it("#RGB 短縮形をパースする", () => {
    const result = parseBackground("#f00");
    assert.deepStrictEqual(result, { r: 255, g: 0, b: 0, alpha: 1 });
  });

  it("#RRGGBB をパースする", () => {
    const result = parseBackground("#1e293b");
    assert.deepStrictEqual(result, { r: 30, g: 41, b: 59, alpha: 1 });
  });

  it("#RRGGBBAA をパースし alpha を 0-1 に正規化する", () => {
    const result = parseBackground("#1e293b80");
    const expected = { r: 30, g: 41, b: 59, alpha: 128 / 255 };
    assert.strictEqual(result.r, expected.r);
    assert.strictEqual(result.g, expected.g);
    assert.strictEqual(result.b, expected.b);
    assert.ok(Math.abs(result.alpha - expected.alpha) < 0.01);
  });

  // ここが mermaid 版との差分: フォールバックは white ではなく transparent。
  it("不正な色名は transparent にフォールバックする", () => {
    const result = parseBackground("invalid-color");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 0 });
  });

  it("空文字列は transparent にフォールバックする", () => {
    const result = parseBackground("");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 0 });
  });

  it("不完全な hex は transparent にフォールバックする", () => {
    const result = parseBackground("#1e");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 0 });
  });
});
