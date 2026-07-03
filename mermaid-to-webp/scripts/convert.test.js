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
const MMDC = path.resolve(__dirname, "../node_modules/.bin/mmdc");

// convert.js は import 時に main() が実行され引数不足で process.exit(1) するため、
// CLI としてサブプロセス実行して中核パイプラインをスモークテストする。
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

// mmdc(mermaid-cli)/Chromium が実行可能かを軽く確認する。
// Chromium 未取得・サンドボックス制約などで失敗する環境ではテストを skip する。
function probeMmdc() {
  return new Promise((resolve) => {
    if (!fs.existsSync(MMDC)) {
      resolve({ ok: false, reason: "mmdc バイナリが見つからない" });
      return;
    }
    const child = spawn(process.execPath, [MMDC, "--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; try { child.kill(); } catch (_e) { /* noop */ } resolve({ ok: false, reason: "mmdc --version がタイムアウト" }); }
    }, 30000);
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, reason: `mmdc --version が code ${code}` });
    });
    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, reason: `mmdc 起動失敗: ${err.message}` });
    });
  });
}

function isWebp(buf) {
  return (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  );
}

const MERMAID_FIXTURE = "graph TD; A-->B;";

describe("convert.js (mermaid-to-webp) 中核パイプライン", () => {
  let tmpDir;
  let mmdcAvailable = false;
  let skipReason = "";

  before(async () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `mmd2webp-test-${crypto.randomBytes(4).toString("hex")}-`)
    );
    const probe = await probeMmdc();
    mmdcAvailable = probe.ok;
    skipReason = probe.reason || "";
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  });

  it("Mermaid テキストを WebP に変換する（mmdc 実行可能時）", async (t) => {
    if (!mmdcAvailable) {
      t.skip(`mermaid-cli/Chromium が実行不能のため skip: ${skipReason}`);
      return;
    }

    const input = path.join(tmpDir, "graph.mmd");
    const output = path.join(tmpDir, "graph.webp");
    fs.writeFileSync(input, MERMAID_FIXTURE, "utf8");

    const { code, stderr } = await runConvert([
      "--input", input, "--output", output,
      "--width", "400", "--height", "300",
    ]);

    assert.strictEqual(code, 0, `exit code 0 を期待。stderr: ${stderr}`);
    assert.ok(fs.existsSync(output), "WebP 出力ファイルが生成される");
    const buf = fs.readFileSync(output);
    assert.ok(isWebp(buf), "出力が WebP マジックバイト(RIFF....WEBP)を持つ");
    assert.ok(buf.length > 0, "出力サイズ > 0");
  });

  it("stdin から Mermaid を読み PNG に変換する（mmdc 実行可能時）", async (t) => {
    if (!mmdcAvailable) {
      t.skip(`mermaid-cli/Chromium が実行不能のため skip: ${skipReason}`);
      return;
    }

    const output = path.join(tmpDir, "graph-stdin.png");
    // stdin モードは spawn の stdin へ書き込む。
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [
        CONVERT, "--stdin", "--output", output,
        "--format", "png", "--width", "400", "--height", "300",
      ], { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.write(MERMAID_FIXTURE);
      child.stdin.end();
    });

    assert.strictEqual(result.code, 0, `exit code 0 を期待。stderr: ${result.stderr}`);
    assert.ok(fs.existsSync(output), "PNG 出力ファイルが生成される");
    const buf = fs.readFileSync(output);
    const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(buf.subarray(0, 8).equals(pngSig), "出力が PNG マジックバイトを持つ");
  });

  // mmdc の有無に依存しない引数バリデーション（常に実行）。
  it("必須引数不足はエラー終了する（mmdc 非依存）", async () => {
    const { code } = await runConvert(["--width", "100"]);
    assert.notStrictEqual(code, 0, "引数不足で非 0 終了");
  });

  it("存在しない入力ファイルはエラー終了する（mmdc 非依存）", async () => {
    const { code, stderr } = await runConvert([
      "--input", path.join(tmpDir, "nope.mmd"), "--output", path.join(tmpDir, "x.webp"),
    ]);
    assert.notStrictEqual(code, 0, "非 0 の終了コードでエラー終了する");
    assert.match(stderr, /not found/i, "エラーメッセージに not found を含む");
  });
});
