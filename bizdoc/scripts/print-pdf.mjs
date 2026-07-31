#!/usr/bin/env node
// print-pdf.mjs — bizdoc の A4 PDF 書き出し
// 全ページに「文書タイトル ｜ ページ番号/総ページ」のフッターを入れる。
// 依存ゼロ: Node 22+ の組み込み WebSocket + macOS の Chrome（CDP Page.printToPDF）。
// CLI の --print-to-pdf ではフッターテンプレートを指定できない（既定フッターは
// file:// パスを印字してしまい path-privacy 違反になる）ため、CDP 経由にしている。
//
// 使い方:
//   node print-pdf.mjs <input.html> <output.pdf> [--title "<フッター表示タイトル>"]
//   --title 省略時は HTML の <title> を使う
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function waitForWsUrl(userDataDir, timeoutMs = 10000) {
  const f = path.join(userDataDir, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const [port, wsPath] = fs.readFileSync(f, 'utf8').trim().split('\n');
      if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    } catch { /* まだ書かれていない */ }
    await delay(100);
  }
  throw new Error('Chrome の DevTools ポートが開きませんでした');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const args = parseArgs(process.argv.slice(2));
const [input, output] = args._;
if (!input || !output) die('使い方: node print-pdf.mjs <input.html> <output.pdf> [--title "<タイトル>"]');
const absInput = path.resolve(input);
if (!fs.existsSync(absInput)) die(`入力 HTML が見つかりません: ${absInput}`);
if (!fs.existsSync(CHROME)) {
  die('Chrome が見つかりません。フォールバック（ページ番号なし）:\n' +
    `  "${CHROME}" --headless=new --print-to-pdf="<出力>" --no-pdf-header-footer "file://<入力>"`);
}

const html = fs.readFileSync(absInput, 'utf8');
const title = args.title || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? path.basename(absInput, '.html')).trim();

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bizdoc-pdf-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
   '--no-first-run', '--no-default-browser-check', 'about:blank'],
  { stdio: 'ignore' }
);

try {
  const wsUrl = await waitForWsUrl(userDataDir);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools WebSocket に接続できませんでした')), { once: true });
  });
  const cdp = new Cdp(ws);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  const loaded = new Promise((resolve) => {
    cdp.on((m) => {
      if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) resolve();
    });
  });
  await cdp.send('Page.navigate', { url: 'file://' + absInput }, sessionId);
  await Promise.race([loaded, delay(10000)]);
  await delay(300); // フォント・レイアウトの安定待ち

  // tokens.css の @page margin は紙面レイアウト用。CDP 側の margin（フッター領域）と
  // 二重になるため、印刷時のみ @page margin を 0 に上書きする（余白は CDP 側で与える）
  await cdp.send('Runtime.evaluate', {
    expression:
      "(() => { const s = document.createElement('style');" +
      " s.textContent = '@media print{@page{margin:0}}';" +
      " document.head.appendChild(s); })()",
  }, sessionId);

  const footerTemplate =
    `<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 12mm;display:flex;` +
    `justify-content:space-between;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif;">` +
    `<span>${escapeHtml(title)}</span>` +
    `<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

  const { data } = await cdp.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: false,
    paperWidth: 8.27,   // A4
    paperHeight: 11.69,
    marginTop: 0.51,    // ≈13mm
    marginBottom: 0.67, // ≈17mm（フッター領域を含む）
    marginLeft: 0.51,
    marginRight: 0.51,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate,
  }, sessionId);

  fs.writeFileSync(path.resolve(output), Buffer.from(data, 'base64'));
  console.log(path.resolve(output));
  ws.close();
} finally {
  chrome.kill();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
