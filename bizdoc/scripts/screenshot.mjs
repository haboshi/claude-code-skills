#!/usr/bin/env node
// screenshot.mjs — bizdoc の検品用スクリーンショット（Phase 5 決定論ゲート 2）
// 全体 PNG を「実コンテンツ高」で撮り、図・表の位置を DOM から取って個別に切り出し 2 倍で書き出す。
//
// 背景（2026-09-03 実測）: Chrome CLI の --screenshot はビューポート分しか撮れず、
// --window-size=1280,4000 固定では doc-hub の実文書 10/10 が 4000px 超（中央値 8,100px）で
// 図表の 52% が写っていなかった。切り出し位置を画素目測で読むのも不安定なので、
// print-pdf.mjs と同じ CDP で scrollHeight と getBoundingClientRect を引く。
// 依存ゼロ: Node 22+ の組み込み WebSocket + macOS の Chrome。
//
// 使い方:
//   node screenshot.mjs <input.html> <outdir> [--width 1280] [--scale 2] [--selector "figure, table, .figure"]
// 出力:
//   <outdir>/full.png          … 全体（幅 --width、高さ = scrollHeight、scale 1）
//   <outdir>/crop-NN-<tag>.png … 各図表（前後 2 行分の本文を含む領域を --scale 倍で再ラスタライズ）
//   stdout                     … JSON { full, height, crops: [{ file, tag, top, height }] }
// Read で見るときは crop 側で文字サイズ・折り返しを判定する（full は骨格と位置の確認用）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTEXT_PX = 48; // 図表の前後に含める本文の高さ（本文と図中文字の相対比較のため）
const MAX_CROP_HEIGHT = 2400; // これ以上高い要素は分割せず先頭部分だけ撮る（Read の縮小で潰れるのを防ぐ）

function die(msg) { console.error(msg); process.exit(1); }

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
    this.ws = ws; this.nextId = 0; this.pending = new Map(); this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) this.listeners.forEach((fn) => fn(msg));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.push(fn); }
}

const args = parseArgs(process.argv.slice(2));
const [input, outdir] = args._;
if (!input || !outdir) die('使い方: node screenshot.mjs <input.html> <outdir> [--width 1280] [--scale 2] [--selector "figure, table"]');
const absInput = path.resolve(input);
if (!fs.existsSync(absInput)) die(`入力 HTML が見つかりません: ${absInput}`);
if (!fs.existsSync(CHROME)) die('Chrome が見つかりません（BIZDOC_CHROME で指定できます）');
const width = Math.max(320, parseInt(args.width ?? '1280', 10) || 1280);
const scale = Math.min(3, Math.max(1, parseFloat(args.scale ?? '2') || 2));
const selector = args.selector || 'figure, table, .figure, svg:not(figure svg):not(.icon)';
fs.mkdirSync(outdir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bizdoc-shot-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

try {
  const ws = new WebSocket(await waitForWsUrl(userDataDir));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools WebSocket に接続できませんでした')), { once: true });
  });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  const loaded = new Promise((resolve) => cdp.on((m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) resolve(); }));
  await cdp.send('Page.navigate', { url: 'file://' + absInput }, sessionId);
  await Promise.race([loaded, delay(10000)]);
  await delay(400); // フォント・レイアウトの安定待ち

  const evalJson = async (expression) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return result.value;
  };
  const height = await evalJson('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))');
  // 全体: 実コンテンツ高でビューポートを張り直してから撮る（clip 指定だけでは lazy な描画が残ることがある）
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await delay(150);
  const full = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height, scale: 1 } }, sessionId);
  const fullPath = path.join(outdir, 'full.png');
  fs.writeFileSync(fullPath, Buffer.from(full.data, 'base64'));

  // 図表の位置を DOM から取る（画素目測をしない）。入れ子（figure 内の svg / table）は外側だけ採る。
  const rects = await evalJson(`(() => {
    const sel = ${JSON.stringify(selector)};
    const els = Array.from(document.querySelectorAll(sel));
    const outer = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    return outer.map((e) => { const r = e.getBoundingClientRect(); const tag = (e.tagName || '').toLowerCase() + (e.id ? '#' + e.id : (e.className && typeof e.className === 'string' ? '.' + e.className.split(/\\s+/)[0] : ''));
      return { tag, top: Math.round(r.top + window.scrollY), height: Math.round(r.height), width: Math.round(r.width) }; })
      .filter((r) => r.height > 8 && r.width > 8);
  })()`);

  const crops = [];
  let n = 0;
  for (const r of rects) {
    n++;
    const top = Math.max(0, r.top - CONTEXT_PX);
    const bottom = Math.min(height, r.top + Math.min(r.height, MAX_CROP_HEIGHT) + CONTEXT_PX);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: top, width, height: bottom - top, scale } }, sessionId);
    const safeTag = r.tag.replace(/[^a-z0-9#.-]/gi, '').slice(0, 40) || 'el';
    const file = path.join(outdir, `crop-${String(n).padStart(2, '0')}-${safeTag}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    crops.push({ file, tag: r.tag, top: r.top, height: r.height, truncated: r.height > MAX_CROP_HEIGHT });
  }
  ws.close();
  console.log(JSON.stringify({ full: fullPath, width, height, scale, crops }, null, 2));
} finally {
  chrome.kill();
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (e) {
    if (!['ENOTEMPTY', 'EBUSY', 'EPERM', 'ENOENT'].includes(e?.code)) throw e;
  }
}
