'use strict';
// 増分インジェスト: transcript JSONL → セッションダイジェスト。
// 使い方:
//   node ingest.js --hook              # SessionEnd hook（stdin JSON の transcript_path 1件のみ）
//   node ingest.js [--window 14d]      # CLI: 窓内の変更セッションのみ増分処理
//   node ingest.js --backfill [--window 90d]   # 窓内を強制再生成（初回/スキーマ更新時）
//
// 冪等性: セッションファイル単位で「サイズ未変化かつ digest_version 一致ならスキップ」。
// 変更ファイルはファイル全体を読み直してダイジェストを再生成し上書きする（追記途中の部分行は
// JSON.parse 失敗で自然にスキップ、cursor はサイズを記録するので次回サイズ増で再処理される）。
// hook は best-effort・常に exit 0。真実は cursor。

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const C = require('./common');
const { digestFromRecords } = require('./digest');
const { LocalSink } = require('./sinks');

const RELEVANT = new Set(['user', 'assistant', 'system']);

async function readRecords(filePath) {
  const records = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line || line.indexOf('"type"') === -1) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // 部分行/破損行はスキップ
    if (RELEVANT.has(rec.type)) records.push(rec);
  }
  return records;
}

function logLine(msg) {
  try {
    fs.mkdirSync(C.LOGS_DIR, { recursive: true });
    fs.appendFileSync(require('path').join(C.LOGS_DIR, `${C.today()}.log`), `[${C.nowIso()}] ${msg}\n`);
  } catch { /* ログ失敗は致命的でない */ }
}

async function processFile(filePath, cursors, sink, opts) {
  const size = C.sizeOf(filePath);
  const mtimeMs = C.mtimeMsOf(filePath);
  const prev = cursors.sessions[filePath];
  const unchanged = prev && prev.size === size && prev.digest_version === C.DIGEST_VERSION;
  if (!opts.backfill && unchanged) return { skipped: true };

  const records = await readRecords(filePath);
  if (records.length === 0) return { skipped: true };
  const digest = digestFromRecords(records, {
    filePath,
    storeRawToolResult: opts.storeRaw === true,
  });
  const res = sink.emit(digest);
  cursors.sessions[filePath] = {
    size, mtimeMs,
    session_id: digest.session_id,
    cwd_slug: digest.cwd_slug,
    digest_version: C.DIGEST_VERSION,
    updated_at: C.nowIso(),
  };
  return { skipped: false, digest, path: res.path };
}

async function main() {
  const args = process.argv.slice(2);
  const isHook = C.getFlag(args, 'hook');
  const backfill = C.getFlag(args, 'backfill');
  const win = C.getFlag(args, 'window', true, backfill ? '90d' : '14d');
  const cutoff = Date.now() - C.windowToMs(win);

  const config = C.loadConfig();
  const storeRaw = !!(config.privacy && config.privacy.store_raw_tool_result);
  const cursors = C.readJson(C.CURSORS_PATH, null) || { version: 1, sessions: {} };
  const sink = new LocalSink();

  let files = [];
  if (isHook) {
    // stdin から SessionEnd payload を読む
    let raw = '';
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch { /* stdin 無しでも落とさない */ }
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch { payload = {}; }
    const tp = payload.transcript_path;
    if (tp && fs.existsSync(tp)) files = [tp];
  } else {
    files = C.listTranscripts().filter((f) => C.mtimeMsOf(f) >= cutoff);
  }

  let processed = 0, skipped = 0, failed = 0;
  for (const f of files) {
    try {
      const r = await processFile(f, cursors, sink, { backfill, storeRaw });
      if (r.skipped) skipped++; else processed++;
    } catch (e) {
      failed++;
      logLine(`ingest error ${f}: ${e.message}`);
    }
  }
  C.writeJson(C.CURSORS_PATH, cursors);

  const summary = { processed, skipped, failed, files: files.length, window: win, hook: !!isHook };
  logLine(`ingest done ${JSON.stringify(summary)}`);
  if (!isHook) process.stdout.write(JSON.stringify(summary) + '\n');

  // hook 経路のみ: レポートが stale なら自動リフレッシュを detached 起動（決定論・非ブロック）
  if (isHook) maybeAutoRefresh(config);
}

// stale 判定（純関数・テスト可能）: レポートが stale_days 超で cooldown を過ぎていれば true
function shouldRefresh(config, reportMtimeMs, marker, nowMs) {
  const ar = config.auto_refresh || {};
  if (ar.enabled === false) return false;
  const ageDays = reportMtimeMs ? (nowMs - reportMtimeMs) / 86400000 : Infinity; // レポート未生成は stale 扱い
  if (ageDays < (ar.stale_days || 7)) return false;
  const cooldownMs = (ar.cooldown_hours || 12) * 3600000;
  if (marker && marker.last_triggered_at && (nowMs - marker.last_triggered_at) < cooldownMs) return false;
  return true;
}

function maybeAutoRefresh(config) {
  try {
    const reportMtimeMs = C.mtimeMsOf(path.join(C.REPORTS_DIR, 'latest.html'));
    const marker = C.readJson(C.AUTO_REFRESH_PATH, null);
    if (!shouldRefresh(config, reportMtimeMs, marker, Date.now())) return false;
    C.writeJson(C.AUTO_REFRESH_PATH, { last_triggered_at: Date.now() }); // 先に印を打ち二重起動を防ぐ
    spawn(process.execPath, [path.join(__dirname, 'auto-refresh.js')], { detached: true, stdio: 'ignore' }).unref();
    logLine('auto-refresh triggered (stale report)');
    return true;
  } catch (e) { logLine('auto-refresh error: ' + e.message); return false; }
}

module.exports = { shouldRefresh };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { logLine('ingest fatal: ' + e.message); process.exit(0); }); // hook 前提で常に 0
}
