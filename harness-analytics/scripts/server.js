'use strict';
// harness-analytics ローカル HTTP サーバ（静的配信・依存ゼロ）。turn-review-plugin/server.js を移植・簡略化。
// - 127.0.0.1 バインド・固定ポート（config.server.port 既定7788、使用中なら auto-assign フォールバック）
// - singleton（mkdir ロック）、server.json に port/pid/heartbeat、アイドルで自殺
// - 配信は HA_DIR 配下のみ（path traversal ガード）。書き込み系 API は持たない。

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const C = require('./common');
const { acquire, release } = require('./locks');

const config = C.loadConfig();
const IDLE_TIMEOUT_MS = ((config.server && config.server.idle_timeout_min) || 30) * 60 * 1000;
function configuredPort() {
  const p = parseInt((config.server || {}).port, 10);
  return (Number.isInteger(p) && p > 0 && p < 65536) ? p : 0;
}

let lastActivity = Date.now();
const STARTED_AT = Date.now();
let lockDir = null;

function send(res, code, type, body) { res.writeHead(code, { 'Content-Type': type }); res.end(body); }

const CT = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.jsonl': 'application/x-ndjson; charset=utf-8',
};

async function serveStatic(res, fsPath) {
  // HA_DIR 配下に留まることを保証（path traversal 防御）
  const resolved = path.resolve(fsPath);
  if (resolved !== path.resolve(C.HA_DIR) && !resolved.startsWith(path.resolve(C.HA_DIR) + path.sep)) {
    return send(res, 403, 'text/plain', 'Forbidden');
  }
  try {
    let p = resolved;
    const stat = await fsp.stat(p);
    if (stat.isDirectory()) p = path.join(p, 'index.html');
    const data = await fsp.readFile(p);
    send(res, 200, CT[path.extname(p)] || 'application/octet-stream', data);
  } catch { send(res, 404, 'text/plain', 'Not Found'); }
}

// reports/history/<date>/report.html の一覧を動的生成
async function historyIndex(res) {
  let dates = [];
  try { dates = (await fsp.readdir(C.HISTORY_DIR)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); } catch { dates = []; }
  const items = dates.map((d) => `<li><a href="/reports/history/${d}/report.html">${d}</a></li>`).join('') || '<li>履歴なし</li>';
  const html = `<!doctype html><meta charset="utf-8"><title>harness-analytics 履歴</title>`
    + `<body style="font-family:-apple-system,sans-serif;max-width:640px;margin:40px auto;padding:0 20px">`
    + `<h1>harness-analytics レポート履歴</h1><p><a href="/">最新へ</a></p><ul>${items}</ul></body>`;
  send(res, 200, 'text/html; charset=utf-8', html);
}

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') return serveStatic(res, path.join(C.REPORTS_DIR, 'latest.html'));
  if (urlPath === '/api/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, pid: process.pid, started_at: STARTED_AT, port: server.address() && server.address().port }));
  if (urlPath === '/history' || urlPath === '/reports/history' || urlPath === '/reports/history/') return historyIndex(res);
  return serveStatic(res, path.join(C.HA_DIR, urlPath.replace(/^\/+/, '')));
});

const shutdown = async (code = 0) => { try { if (lockDir) await release(lockDir); } catch { /* noop */ } process.exit(code); };
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

function writeInfo() {
  fs.writeFileSync(C.SERVER_INFO_PATH, JSON.stringify({ port: server.address() && server.address().port, pid: process.pid, started_at: STARTED_AT, updated_at: Date.now() }));
}
setInterval(() => {
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) { console.error('idle timeout, shutting down'); shutdown(0); return; }
  try { writeInfo(); } catch { /* noop */ }
}, 10000).unref();

(async () => {
  await fsp.mkdir(C.HA_DIR, { recursive: true, mode: 0o700 });
  await fsp.mkdir(C.REPORTS_DIR, { recursive: true });
  try { lockDir = await acquire(C.SERVER_LOCK_PATH); }
  catch { console.error('server already running'); process.exit(0); }
  const onListening = () => { writeInfo(); console.log(JSON.stringify({ type: 'started', port: server.address().port })); };
  const wanted = configuredPort();
  server.once('error', (e) => {
    if (wanted && e.code === 'EADDRINUSE') { console.error(`port ${wanted} in use, falling back to auto-assign`); server.listen(0, '127.0.0.1', onListening); }
    else { console.error(e.stack || String(e)); shutdown(1); }
  });
  server.listen(wanted, '127.0.0.1', onListening);
})();
