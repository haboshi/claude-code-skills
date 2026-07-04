'use strict';
// harness-analytics 共有ユーティリティ。
// audit-tools/scripts/common.js の maskSecrets / listTranscripts / atomic IO を fork し、
// 本プラグイン用のディレクトリ定義・パス秘匿・project_hash を追加したもの。
// 変数名・関数名は英語、コメントは日本語（ガイドライン準拠）。

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

// 蓄積先（隠しではないが ~/.claude 配下・gitignore 前提のローカル状態）
const HA_DIR = path.join(CLAUDE_DIR, 'harness-analytics');
const DIGESTS_DIR = path.join(HA_DIR, 'digests');
const ROLLUPS_DIR = path.join(HA_DIR, 'rollups');
const CLUSTERS_DIR = path.join(HA_DIR, 'clusters');
const REPORTS_DIR = path.join(HA_DIR, 'reports');
const HISTORY_DIR = path.join(REPORTS_DIR, 'history');
const LOGS_DIR = path.join(HA_DIR, 'logs');
const CURSORS_PATH = path.join(HA_DIR, 'cursors.json');
const CONFIG_PATH = path.join(HA_DIR, 'config.json');

// 現行ダイジェストスキーマ版。上げると cursor 不一致セッションが再処理対象になる（分類ロジック変更時も上げる）。
const DIGEST_VERSION = 2;

// 日付ヘルパ（ローカルタイム基準の YYYY-MM-DD）
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowIso() { return new Date().toISOString(); }

// mtime を ms で取得（cross-platform、失敗時 0）
function mtimeMsOf(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}
function sizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// 機密マスク: コミット/共有/外部送信時の漏洩を防ぐ。プレフィックスは残し本体を隠す。
const SECRET_PATTERNS = [
  [/sk-proj-[A-Za-z0-9_\-]{12,}/g, 'sk-proj-***'],
  [/sk-ant-[A-Za-z0-9_\-]{12,}/g, 'sk-ant-***'],
  [/sk-[A-Za-z0-9_\-]{16,}/g, 'sk-***'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA***'],
  [/ASIA[0-9A-Z]{16}/g, 'ASIA***'],
  [/ghp_[A-Za-z0-9]{20,}/g, 'ghp_***'],
  [/gho_[A-Za-z0-9]{20,}/g, 'gho_***'],
  [/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***'],
  [/xox[baprs]-[A-Za-z0-9\-]{10,}/g, 'xox*-***'],
  [/AIza[0-9A-Za-z_\-]{30,}/g, 'AIza***'],
  [/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, 'jwt.***'],
  [/(password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?[^\s"']{6,}/gi, '$1=***'],
  [/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '***@***'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***(private key)'],
];
function maskSecrets(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// パス秘匿: /Users/<name>/ /home/<name>/ の作業者名を含む絶対パスを ~ に畳む（path-privacy.md R1）。
function maskPaths(text) {
  if (!text) return text;
  return String(text)
    .replace(/\/Users\/[^/\s"']+/g, '~')
    .replace(/\/home\/[^/\s"']+/g, '~')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"']+/g, '%USERPROFILE%');
}

// secret と path を両方畳む（外部送信・レポート埋め込み前の既定サニタイズ）
function sanitize(text, maxLen = 240) {
  let out = maskPaths(maskSecrets(text || ''));
  if (out.length > maxLen) out = out.slice(0, maxLen) + '…';
  return out;
}

// cwd を安定ハッシュ化（外部送信時に生パスの代わりに使う匿名 ID）
function projectHash(cwd) {
  if (!cwd) return 'unknown';
  return crypto.createHash('sha256').update(String(cwd)).digest('hex').slice(0, 12);
}

// 安全な JSON 読み書き（atomic write: tmp→rename）
function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}
function writeText(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

// 引数からフラグ値を取得（--key value / --key=value / 真偽フラグ）
function getFlag(args, name, hasValue = false, def = undefined) {
  const i = args.indexOf(`--${name}`);
  if (i !== -1) {
    if (hasValue) return args[i + 1] !== undefined ? args[i + 1] : def;
    return true;
  }
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return hasValue ? eq.split('=').slice(1).join('=') : true;
  return def;
}

// 全 .jsonl トランスクリプトを列挙（glob 不可、再帰 walk）。
function listTranscripts() {
  const results = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.jsonl')) results.push(full);
    }
  };
  walk(PROJECTS_DIR);
  return results;
}

// トランスクリプトのフルパスから <cwd-slug> を取り出す（projects/<cwd-slug>/<uuid>.jsonl）。
function cwdSlugOf(filePath) {
  const rel = path.relative(PROJECTS_DIR, filePath);
  const parts = rel.split(path.sep);
  return parts.length >= 2 ? parts[0] : 'unknown';
}

// 期間ウィンドウ文字列（14d / 30d / 8w）を ms に変換。既定 14 日。
function windowToMs(win) {
  if (!win) return 14 * 86400000;
  const m = /^(\d+)\s*([dwh])$/.exec(String(win).trim());
  if (!m) return 14 * 86400000;
  const n = parseInt(m[1], 10);
  const unit = { h: 3600000, d: 86400000, w: 7 * 86400000 }[m[2]];
  return n * unit;
}

// 既定 config を返す（ファイルが無ければこれ）
function defaultConfig() {
  return {
    version: 1,
    sinks: {
      local_jsonl: { enabled: true },
      fetchdb: { enabled: false, min_severity: 'failure', batch_reflect: false },
    },
    analysis: { window: '14d', top_k_clusters: 8 },
    privacy: { store_raw_tool_result: false },
  };
}
function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  return cfg || defaultConfig();
}

module.exports = {
  HOME, CLAUDE_DIR, PROJECTS_DIR,
  HA_DIR, DIGESTS_DIR, ROLLUPS_DIR, CLUSTERS_DIR, REPORTS_DIR, HISTORY_DIR, LOGS_DIR,
  CURSORS_PATH, CONFIG_PATH, DIGEST_VERSION,
  today, nowIso, mtimeMsOf, sizeOf,
  maskSecrets, maskPaths, sanitize, projectHash,
  readJson, writeJson, writeText, getFlag,
  listTranscripts, cwdSlugOf, windowToMs, defaultConfig, loadConfig,
};
