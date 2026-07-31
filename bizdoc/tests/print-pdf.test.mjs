import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const SCRIPT = fileURLToPath(new URL('../scripts/print-pdf.mjs', import.meta.url));
const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('print-pdf: A4 PDF を生成し出力パスを stdout に返す', { timeout: 60000 }, (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-')));
  const html = path.join(base, 'doc.html');
  fs.writeFileSync(
    html,
    '<!doctype html><html><head><title>印刷テスト</title></head><body><h1>見出し</h1><p>本文</p></body></html>'
  );
  const out = path.join(base, 'out.pdf');
  const stdout = execFileSync(process.execPath, [SCRIPT, html, out, '--title', '印刷テスト'], { encoding: 'utf8' });
  assert.equal(stdout.trim(), out);
  const buf = fs.readFileSync(out);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buf.length > 5000, `PDF が小さすぎる: ${buf.length} bytes`);
});

test('print-pdf: 入力なしはエラー', () => {
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' }),
    (e) => /使い方/.test(String(e.stderr || e.message))
  );
});
