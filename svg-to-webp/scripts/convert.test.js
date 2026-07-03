import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONVERT = path.join(__dirname, "convert.js");

// convert.js は import 時に main() が実行され、引数不足だと process.exit(1) するため、
// 直接 import せず CLI としてサブプロセス実行してパイプライン全体を検証する。
function runConvert(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CONVERT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

// 小さな有効 SVG フィクスチャ（200x150 の青い矩形）。
const SVG_FIXTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
  '<rect width="200" height="150" fill="#3498db"/></svg>';

// マジックバイト判定
function isWebp(buf) {
  // "RIFF" .... "WEBP"
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}
function isPng(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buf.length >= 8 && buf.subarray(0, 8).equals(sig);
}

describe("convert.js (svg-to-webp) 変換パイプライン", () => {
  let tmpDir;
  let sharp;

  before(async () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `svg2webp-test-${crypto.randomBytes(4).toString("hex")}-`)
    );
    // 幅リサイズ検証のため、プラグインの sharp を利用（メタデータ確認）。
    sharp = (await import("sharp")).default;
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it("SVG を WebP に変換し、ファイル生成とマジックバイトを満たす", async () => {
    const input = path.join(tmpDir, "in.svg");
    const output = path.join(tmpDir, "out.webp");
    fs.writeFileSync(input, SVG_FIXTURE, "utf8");

    const { code, stderr } = await runConvert([
      "--input", input, "--output", output,
      "--width", "120", "--height", "90",
    ]);

    assert.strictEqual(code, 0, `exit code 0 を期待。stderr: ${stderr}`);
    assert.ok(fs.existsSync(output), "WebP 出力ファイルが生成される");
    const buf = fs.readFileSync(output);
    assert.ok(isWebp(buf), "出力が WebP マジックバイト(RIFF....WEBP)を持つ");
    assert.ok(buf.length > 0, "出力サイズ > 0");
  });

  it("SVG を PNG に変換し、PNG マジックバイトを満たす", async () => {
    const input = path.join(tmpDir, "in-png.svg");
    const output = path.join(tmpDir, "out.png");
    fs.writeFileSync(input, SVG_FIXTURE, "utf8");

    const { code, stderr } = await runConvert([
      "--input", input, "--output", output,
      "--format", "png", "--width", "120", "--height", "90",
    ]);

    assert.strictEqual(code, 0, `exit code 0 を期待。stderr: ${stderr}`);
    assert.ok(fs.existsSync(output), "PNG 出力ファイルが生成される");
    const buf = fs.readFileSync(output);
    assert.ok(isPng(buf), "出力が PNG マジックバイト(\\x89PNG)を持つ");
  });

  it("--width 指定が出力メタデータに反映される", async () => {
    const input = path.join(tmpDir, "in-resize.svg");
    const output = path.join(tmpDir, "out-resize.webp");
    fs.writeFileSync(input, SVG_FIXTURE, "utf8");

    const { code, stderr } = await runConvert([
      "--input", input, "--output", output,
      "--width", "64", "--height", "48",
    ]);

    assert.strictEqual(code, 0, `exit code 0 を期待。stderr: ${stderr}`);
    const meta = await sharp(output).metadata();
    // fit: contain(既定)により出力キャンバスは指定サイズちょうどになる。
    assert.strictEqual(meta.width, 64, "幅指定 64 が反映される");
    assert.strictEqual(meta.height, 48, "高さ指定 48 が反映される");
  });

  it("ディレクトリ一括変換で全 SVG を変換する", async () => {
    const inDir = path.join(tmpDir, "batch-in");
    const outDir = path.join(tmpDir, "batch-out");
    fs.mkdirSync(inDir, { recursive: true });
    fs.writeFileSync(path.join(inDir, "a.svg"), SVG_FIXTURE, "utf8");
    fs.writeFileSync(path.join(inDir, "b.svg"), SVG_FIXTURE, "utf8");
    // SVG 以外は無視されることも確認。
    fs.writeFileSync(path.join(inDir, "ignore.txt"), "not svg", "utf8");

    const { code, stderr } = await runConvert([
      "--input-dir", inDir, "--output-dir", outDir,
      "--width", "80", "--height", "60",
    ]);

    assert.strictEqual(code, 0, `exit code 0 を期待。stderr: ${stderr}`);
    assert.ok(fs.existsSync(path.join(outDir, "a.webp")), "a.webp が生成される");
    assert.ok(fs.existsSync(path.join(outDir, "b.webp")), "b.webp が生成される");
    assert.ok(!fs.existsSync(path.join(outDir, "ignore.webp")), "非 SVG は変換されない");
    assert.ok(isWebp(fs.readFileSync(path.join(outDir, "a.webp"))), "a.webp は WebP");
  });

  it("存在しない入力ファイルはエラー終了する", async () => {
    const output = path.join(tmpDir, "should-not-exist.webp");
    const { code, stderr } = await runConvert([
      "--input", path.join(tmpDir, "nope.svg"), "--output", output,
    ]);

    assert.notStrictEqual(code, 0, "非 0 の終了コードでエラー終了する");
    assert.match(stderr, /not found/i, "エラーメッセージに not found を含む");
    assert.ok(!fs.existsSync(output), "出力ファイルは生成されない");
  });

  it("必須引数不足はエラー終了する", async () => {
    const { code } = await runConvert(["--width", "100"]);
    assert.notStrictEqual(code, 0, "引数不足で非 0 終了");
  });
});
