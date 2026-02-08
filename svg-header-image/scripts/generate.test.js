import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { validateColor, validateThemeColors } from "./theme-validator.js";

describe("validateColor", () => {
  it("accepts #RGB shorthand", () => {
    assert.strictEqual(validateColor("#f00"), true);
    assert.strictEqual(validateColor("#abc"), true);
  });

  it("accepts #RRGGBB", () => {
    assert.strictEqual(validateColor("#1e293b"), true);
    assert.strictEqual(validateColor("#ffffff"), true);
    assert.strictEqual(validateColor("#000000"), true);
  });

  it("accepts #RRGGBBAA", () => {
    assert.strictEqual(validateColor("#1e293bff"), true);
    assert.strictEqual(validateColor("#00000080"), true);
  });

  it("accepts #RGBA shorthand", () => {
    assert.strictEqual(validateColor("#f00f"), true);
  });

  it("rejects SVG injection attempt", () => {
    assert.strictEqual(validateColor('#000"><script>alert(1)</script>'), false);
  });

  it("rejects arbitrary strings", () => {
    assert.strictEqual(validateColor("red"), false);
    assert.strictEqual(validateColor("rgb(255,0,0)"), false);
    assert.strictEqual(validateColor("not-a-color"), false);
  });

  it("rejects empty string", () => {
    assert.strictEqual(validateColor(""), false);
  });

  it("rejects null/undefined", () => {
    assert.strictEqual(validateColor(null), false);
    assert.strictEqual(validateColor(undefined), false);
  });

  it("rejects hex without hash", () => {
    assert.strictEqual(validateColor("1e293b"), false);
  });

  it("rejects too-long hex", () => {
    assert.strictEqual(validateColor("#1e293bff00"), false);
  });
});

describe("validateThemeColors", () => {
  it("accepts valid theme object", () => {
    const theme = {
      bg: ["#0f172a", "#1e293b", "#334155"],
      accent: ["#38bdf8", "#818cf8", "#c084fc"],
      text: "#f8fafc",
      subText: "#94a3b8",
    };
    assert.doesNotThrow(() => validateThemeColors(theme));
  });

  it("throws on invalid bg color", () => {
    const theme = {
      bg: ['#000"><script>alert(1)</script>', "#1e293b", "#334155"],
      accent: ["#38bdf8", "#818cf8", "#c084fc"],
      text: "#f8fafc",
      subText: "#94a3b8",
    };
    assert.throws(() => validateThemeColors(theme), /Invalid color/);
  });

  it("throws on invalid accent color", () => {
    const theme = {
      bg: ["#0f172a", "#1e293b", "#334155"],
      accent: ["not-a-color", "#818cf8", "#c084fc"],
      text: "#f8fafc",
      subText: "#94a3b8",
    };
    assert.throws(() => validateThemeColors(theme), /Invalid color/);
  });

  it("throws on invalid text color", () => {
    const theme = {
      bg: ["#0f172a", "#1e293b", "#334155"],
      accent: ["#38bdf8", "#818cf8", "#c084fc"],
      text: "javascript:alert(1)",
      subText: "#94a3b8",
    };
    assert.throws(() => validateThemeColors(theme), /Invalid color/);
  });

  it("throws on invalid subText color", () => {
    const theme = {
      bg: ["#0f172a", "#1e293b", "#334155"],
      accent: ["#38bdf8", "#818cf8", "#c084fc"],
      text: "#f8fafc",
      subText: "<img onerror=alert(1)>",
    };
    assert.throws(() => validateThemeColors(theme), /Invalid color/);
  });
});
