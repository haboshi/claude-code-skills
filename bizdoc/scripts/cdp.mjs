// cdp.mjs — print-pdf.mjs / screenshot.mjs が共有する Chrome DevTools Protocol の最小クライアント。
// 依存ゼロ: Node 22+ の組み込み WebSocket + macOS の Chrome。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const CHROME = process.env.BIZDOC_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export function parseArgs(argv) {
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

export class Cdp {
  constructor(ws, { timeoutMs = 60000 } = {}) {
    this.ws = ws; this.nextId = 0; this.pending = new Map(); this.listeners = []; this.timeoutMs = timeoutMs;
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        clearTimeout(timer);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) this.listeners.forEach((fn) => fn(msg));
    });
  }
  // 応答が来なければ timeoutMs で reject する（実測: 4 万 px 超の文書で captureScreenshot が無応答のまま固まった）
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP ${method} が ${this.timeoutMs / 1000} 秒以内に応答しませんでした`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.push(fn); }
}

// Chrome を一時プロファイルで起動し、about:blank のページに attach した CDP セッションを返す。
// 戻り値の close() は async — WebSocket を閉じ、Chrome の終了を待ってから一時プロファイルを消す。
// 呼び出し側は必ず `finally { await close(); }` で呼び、try の中で process.exit しない（finally が走らず
// デバッグポートを開いた Chrome が孤児化する。2026-09-05 に print-pdf.mjs の空 PDF 判定で実際に起きた）。
export async function launchChrome({ prefix = 'bizdoc-cdp-', extraArgs = [], timeoutMs } = {}) {
  if (!fs.existsSync(CHROME)) throw new Error('Chrome が見つかりません（BIZDOC_CHROME で指定できます）');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', ...extraArgs, 'about:blank'],
    // detached: 自前のプロセスグループにして、close() で renderer / GPU などのヘルパーごと SIGTERM を送れるようにする
    { stdio: 'ignore', detached: true });
  let ws;
  // 後片付け。Chrome の終了を待ってからプロファイルを消す — kill 直後はまだ書き込み中で rmSync が
  // ENOTEMPTY になり、プロファイル（1〜2MB）が一時領域に残り続けていた（2026-09-05 実測: 3 日で 197 個・358MB）。
  // 二重呼び出しは同じ Promise を返す。
  let closing;
  const close = () => (closing ??= (async () => {
    try { ws?.close(); } catch { /* 未接続か既に閉じている */ }
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise((resolve) => chrome.once('exit', resolve));
      const signalGroup = (sig) => { try { process.kill(-chrome.pid, sig); } catch { chrome.kill(sig); } };
      signalGroup('SIGTERM');
      const hard = setTimeout(() => signalGroup('SIGKILL'), 3000);
      hard.unref?.();
      await exited;
      clearTimeout(hard);
    }
    // 成果物は書き出し済みなので後片付けの失敗で終了コードを変えない（「掴んでいる」系だけ握りつぶす）。
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (e) {
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM', 'ENOENT'].includes(e?.code)) throw e;
      console.warn(`warn: 一時プロファイルを削除できませんでした: ${userDataDir} — ${e.code}`);
    }
  })());
  try {
    ws = new WebSocket(await waitForWsUrl(userDataDir));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('DevTools WebSocket に接続できませんでした')), { once: true });
    });
  } catch (e) {
    await close();
    throw e;
  }
  const cdp = new Cdp(ws, { timeoutMs });
  let sessionId;
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
    await cdp.send('Page.enable', {}, sessionId);
  } catch (e) {
    // ここで失敗すると呼び出し側はまだ close() を持っていない。デバッグポートを開いた Chrome を残さない
    await close();
    throw e;
  }

  const navigate = async (url, loadTimeoutMs = 10000) => {
    const loaded = new Promise((resolve) => cdp.on((m) => { if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) resolve(); }));
    await cdp.send('Page.navigate', { url }, sessionId);
    // ref:false — load が先に来たときタイマーがプロセスを 10 秒引き留めないようにする
    await Promise.race([loaded, delay(loadTimeoutMs, undefined, { ref: false })]);
  };
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (exceptionDetails) {
      const msg = exceptionDetails.exception?.description || exceptionDetails.text || 'ページ側で例外';
      throw new Error(`Runtime.evaluate: ${msg}`);
    }
    return result.value;
  };
  return { cdp, sessionId, navigate, evaluate, close, userDataDir };
}
