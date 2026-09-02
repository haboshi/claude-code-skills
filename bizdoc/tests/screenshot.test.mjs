import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('../scripts/screenshot.mjs', import.meta.url));
const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG', `PNG でない: ${file}`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
// PNG を zlib で展開して 1 画素を読む（RGB / RGBA・filter 0 の行を前提。テストの合成画像でのみ使う）
function pngPixel(file, x, y) {
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), ct = b[25];
  const bpp = ct === 6 ? 4 : 3;
  let p = 33; const idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p); const t = b.subarray(p + 4, p + 8).toString(); if (t === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = require_zlib().inflateSync(Buffer.concat(idat));
  const stride = 1 + w * bpp;
  // 行 filter を戻す（sub/up/avg/paeth）。テスト画像は単色帯なので全 filter を素直に実装する
  const out = Buffer.alloc(w * bpp * h);
  for (let r = 0; r < h; r++) {
    const f = raw[r * stride]; const src = raw.subarray(r * stride + 1, (r + 1) * stride); const dst = out.subarray(r * w * bpp, (r + 1) * w * bpp);
    const prev = r > 0 ? out.subarray((r - 1) * w * bpp, r * w * bpp) : null;
    for (let i = 0; i < src.length; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0, up = prev ? prev[i] : 0, c = (prev && i >= bpp) ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? up : c); }
      dst[i] = v & 255;
    }
  }
  const o = (y * w + x) * bpp; return [out[o], out[o + 1], out[o + 2]];
}
function require_zlib() { return process.getBuiltinModule('node:zlib'); }

function doc(base, body) {
  const html = path.join(base, 'doc.html');
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>撮影テスト</title></head><body style="margin:0">${body}</body></html>`);
  return html;
}
const filler = (n, h = 48) => Array.from({ length: n }, (_, i) => `<p style="height:${h}px;margin:0">本文 ${i}</p>`).join('');

test('screenshot: 4000px 超の文書を 2000px 以下のセグメントに分け、図表を DOM 位置から 2 倍で切り出す', { timeout: 60000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shot-test-')));
  const html = doc(base, `<h1>見出し</h1>${filler(120)}
    <figure id="fig1" style="height:300px;margin:0"><svg viewBox="0 0 100 40" width="600" height="240"><text x="5" y="20" font-size="6">図中テキスト</text></svg></figure>
    ${filler(120)}
    <table id="t1"><tr><td>セル</td><td>セル</td></tr><tr><td>セル</td><td>セル</td></tr></table>
    <div class="kpi-grid" style="height:120px"><div class="kpi">42</div></div>`);
  const out = path.join(base, 'shot');
  const j = JSON.parse(execFileSync(process.execPath, [SCRIPT, html, out], { encoding: 'utf8' }));
  assert.ok(j.height > 6000, `実コンテンツ高が取れていない: ${j.height}`);
  // セグメント: 2000px 以下で全高を覆う
  assert.equal(j.segments.length, Math.ceil(j.height / 2000));
  const sumH = j.segments.reduce((s, x) => s + x.height, 0);
  assert.equal(sumH, j.height, 'セグメントの高さの和が全高と一致しない');
  for (const s of j.segments) { const sz = pngSize(s.file); assert.equal(sz.width, 1280); assert.equal(sz.height, s.height); assert.ok(s.height <= 2000); }
  // crops: figure / table / .kpi-grid の 3 つ。figure は旧 4000px 方式では写らなかった位置
  assert.deepEqual(j.crops.map((c) => c.tag.replace(/#.*|\..*/, '')).sort(), ['div', 'figure', 'table']);
  const fig = j.crops.find((c) => c.tag.startsWith('figure'));
  assert.ok(fig.top > 4000, `figure が 4000px 超の位置にない: ${fig.top}`);
  const cs = pngSize(fig.file);
  assert.equal(cs.width, 2560, 'crop が 2 倍幅でない');
  assert.ok(cs.height >= (fig.height + 2 * 48) * 2 - 4, `crop に前後の本文が含まれていない: ${cs.height}`);
  assert.equal(fig.truncated, false);
  assert.ok(j.crops.every((c) => c.top + c.height <= j.height), 'crop 座標が全高を超えている');
});

test('screenshot: 16384px 超の文書でも末尾のマーカーが正しい位置に写る（巻き戻し複製が起きない）', { timeout: 90000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shot-tall-')));
  // 20000px の本文の末尾に赤帯 200px
  const html = doc(base, `${filler(400, 50)}<div id="mark" style="height:200px;background:#ff0000"></div>`);
  const out = path.join(base, 'shot');
  const j = JSON.parse(execFileSync(process.execPath, [SCRIPT, html, out], { encoding: 'utf8' }));
  assert.ok(j.height >= 20200 && j.height < 20300, `高さ: ${j.height}`);
  const last = j.segments[j.segments.length - 1];
  const yInSeg = (j.height - 100) - last.top; // 赤帯の中央
  const px = pngPixel(last.file, 640, yInSeg);
  assert.ok(px[0] > 200 && px[1] < 60 && px[2] < 60, `末尾セグメントに赤帯が写っていない: ${px}`);
  // 先頭セグメントの同じ相対位置は白（複製が起きていれば赤になる）
  const px0 = pngPixel(j.segments[0].file, 640, 100);
  assert.ok(px0[0] > 200 && px0[1] > 200 && px0[2] > 200, `先頭が白でない: ${px0}`);
});

test('screenshot: min-height:100vh の文書でも height と crop 座標が同じ座標系にある', { timeout: 60000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shot-vh-')));
  const html = doc(base, `<section style="min-height:100vh">表紙</section>${filler(20)}<figure id="f" style="height:240px;margin:0;background:#eee">図</figure>${filler(10)}`);
  const out = path.join(base, 'shot');
  const j = JSON.parse(execFileSync(process.execPath, [SCRIPT, html, out], { encoding: 'utf8' }));
  const fig = j.crops.find((c) => c.tag.startsWith('figure'));
  assert.ok(fig && !fig.skipped && fig.file, 'figure が撮れていない');
  assert.ok(fig.top + fig.height <= j.height, `crop 座標が height を超えている: top=${fig.top} h=${fig.height} height=${j.height}`);
  const cs = pngSize(fig.file);
  assert.equal(cs.width, 2560);
  assert.ok(cs.height < 2000, `等倍のビューポート全体が crop として保存されている: ${cs.height}`);
});

test('screenshot: 入力なしはエラー', () => {
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }),
    (e) => /使い方/.test(String(e.stderr || e.message))
  );
});
