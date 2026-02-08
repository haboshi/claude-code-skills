import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseBackground } from "./color-utils.js";

describe("parseBackground", () => {
  it("parses 'transparent' to RGBA with alpha 0", () => {
    const result = parseBackground("transparent");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 0 });
  });

  it("parses 'white' to RGBA white", () => {
    const result = parseBackground("white");
    assert.deepStrictEqual(result, { r: 255, g: 255, b: 255, alpha: 1 });
  });

  it("parses 'black' to RGBA black", () => {
    const result = parseBackground("black");
    assert.deepStrictEqual(result, { r: 0, g: 0, b: 0, alpha: 1 });
  });

  it("parses #RGB shorthand", () => {
    const result = parseBackground("#f00");
    assert.deepStrictEqual(result, { r: 255, g: 0, b: 0, alpha: 1 });
  });

  it("parses #RRGGBB", () => {
    const result = parseBackground("#1e293b");
    assert.deepStrictEqual(result, { r: 30, g: 41, b: 59, alpha: 1 });
  });

  it("parses #RRGGBBAA", () => {
    const result = parseBackground("#1e293b80");
    const expected = { r: 30, g: 41, b: 59, alpha: 128 / 255 };
    assert.strictEqual(result.r, expected.r);
    assert.strictEqual(result.g, expected.g);
    assert.strictEqual(result.b, expected.b);
    assert.ok(Math.abs(result.alpha - expected.alpha) < 0.01);
  });

  it("returns white fallback for invalid color", () => {
    const result = parseBackground("invalid-color");
    assert.deepStrictEqual(result, { r: 255, g: 255, b: 255, alpha: 1 });
  });

  it("returns white fallback for empty string", () => {
    const result = parseBackground("");
    assert.deepStrictEqual(result, { r: 255, g: 255, b: 255, alpha: 1 });
  });

  it("returns white fallback for partial hex", () => {
    const result = parseBackground("#1e");
    assert.deepStrictEqual(result, { r: 255, g: 255, b: 255, alpha: 1 });
  });
});
