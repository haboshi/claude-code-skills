// v0.11.2 (2026-09-05): headless Chrome の後始末（push 時のセキュリティレビュー「孤児化したデバッグエンドポイント」への対応）
//   - close() は Chrome の終了を待ってから一時プロファイルを消す（kill 直後の rm は ENOTEMPTY で残っていた。
//     実測: 3 日で 197 個・358MB）
//   - print-pdf.mjs / screenshot.mjs は try の中で process.exit しない（finally の close() が走らず、
//     --remote-debugging-port を開いた Chrome が残る）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChrome, CHROME } from '../scripts/cdp.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('cdp: close() の後に一時プロファイルが残らず、Chrome プロセスも終了している', { timeout: 60000 }, async (t) => {
  if (!fs.existsSync(CHROME)) return t.skip('Chrome なし');
  const s = await launchChrome({ prefix: 'bizdoc-cleanup-' });
  assert.ok(fs.existsSync(s.userDataDir));
  await s.close();
  assert.equal(fs.existsSync(s.userDataDir), false, `プロファイルが残っている: ${s.userDataDir}`);
  // そのプロファイルを使う Chrome（本体・ヘルパーとも）が残っていない。ヘルパーは本体の exit から数百 ms 遅れて
  // 消えるので、有界のポーリングで確認する（pgrep は一致なしで exit 1）
  const gone = () => { try { execFileSync('pgrep', ['-f', `user-data-dir=${s.userDataDir}`], { stdio: 'ignore' }); return false; } catch { return true; } };
  const t0 = Date.now();
  while (!gone() && Date.now() - t0 < 5000) await delay(200);
  assert.ok(gone(), `Chrome プロセスが残っている: ${s.userDataDir}`);
  await s.close(); // 二重呼び出しでも落ちない
});

for (const script of ['print-pdf.mjs', 'screenshot.mjs']) {
  test(`${script}: Chrome 起動後の try の中で process.exit / die しない（finally の close() を必ず通す）`, () => {
    const src = read(`../scripts/${script}`);
    const start = src.indexOf('await launchChrome(');
    const tryStart = src.indexOf('try {', start);
    const fin = src.indexOf('} finally {', tryStart);
    assert.ok(start >= 0 && tryStart >= 0 && fin >= 0, 'launchChrome 後の try/finally が見つからない');
    // コメント（説明文に「die()」と書いてある）を除いてから、コードだけを照合する
    const body = src.slice(tryStart, fin).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(body, /\bdie\(|process\.exit\(/, `${script} の try 内で終了している`);
    assert.match(src.slice(fin), /await close\(\)/, 'finally で await close() していない');
  });
}
