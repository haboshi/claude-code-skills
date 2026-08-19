import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';

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

test('print-pdf: 並列実行しても終了コードが非ゼロにならない', { timeout: 120000 }, async (t) => {
  // Chrome は kill 直後もプロファイルへ書き込むため、後片付けが ENOTEMPTY で落ちうる。
  // PDF は書き出し済みなので、後片付けの失敗で失敗扱いにしてはいけない（実測で 3 回に 1 回
  // 落ちるフレーキーの原因だった）。
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-par-')));
  const runs = [1, 2, 3, 4].map((i) => {
    const html = path.join(base, `d${i}.html`);
    fs.writeFileSync(html, `<!doctype html><html><head><title>並列${i}</title></head><body><h1>h</h1><p>p</p></body></html>`);
    const out = path.join(base, `o${i}.pdf`);
    return new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, html, out, '--title', `並列${i}`], (err) => resolve({ i, out, err }));
    });
  });
  const results = await Promise.all(runs);
  for (const r of results) {
    assert.equal(r.err, null, `並列 ${r.i} が失敗した: ${r.err?.message}`);
    assert.equal(fs.readFileSync(r.out).subarray(0, 5).toString(), '%PDF-', `並列 ${r.i} の PDF が壊れている`);
  }
});
