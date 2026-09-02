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

test('screenshot: 4000px を超える文書でも全体を実コンテンツ高で撮り、図表を DOM 位置から 2 倍で切り出す', { timeout: 60000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shot-test-')));
  const html = path.join(base, 'doc.html');
  // 本文で 6000px 超まで押し下げ、末尾に figure と table を置く（従来の 4000px 固定では写らない位置）
  const filler = Array.from({ length: 120 }, (_, i) => `<p style="height:48px;margin:0">本文 ${i}</p>`).join('');
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><title>撮影テスト</title></head><body style="margin:0">
    <h1>見出し</h1>${filler}
    <figure id="fig1" style="height:300px;margin:0"><svg viewBox="0 0 100 40" width="600" height="240"><text x="5" y="20" font-size="6">図中テキスト</text></svg></figure>
    ${filler}
    <table id="t1"><tr><td>セル</td><td>セル</td></tr><tr><td>セル</td><td>セル</td></tr></table>
  </body></html>`);
  const out = path.join(base, 'shot');
  const stdout = execFileSync(process.execPath, [SCRIPT, html, out], { encoding: 'utf8' });
  const j = JSON.parse(stdout);
  assert.ok(j.height > 6000, `実コンテンツ高が取れていない: ${j.height}`);
  const full = pngSize(j.full);
  assert.equal(full.width, 1280);
  assert.equal(full.height, j.height, '全体 PNG の高さが scrollHeight と一致しない');
  assert.equal(j.crops.length, 2, `図表 2 個が検出されない: ${JSON.stringify(j.crops.map((c) => c.tag))}`);
  const fig = j.crops.find((c) => c.tag.startsWith('figure'));
  const tbl = j.crops.find((c) => c.tag.startsWith('table'));
  assert.ok(fig && tbl);
  assert.ok(fig.top > 4000, `figure が 4000px 超の位置にない: ${fig.top}`);
  const cs = pngSize(fig.file);
  assert.equal(cs.width, 2560, 'crop が 2 倍幅でない');
  assert.ok(cs.height >= (fig.height + 2 * 48) * 2 - 4, `crop に前後の本文が含まれていない: ${cs.height}`);
  assert.equal(fig.truncated, false);
});

test('screenshot: 入力なしはエラー', () => {
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }),
    (e) => /使い方/.test(String(e.stderr || e.message))
  );
});
