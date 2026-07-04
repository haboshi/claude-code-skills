'use strict';
// クラスター→「問題→改善」インフォグラフィックのキャッシュ判定・生成・アーカイブ。
// codex image_gen（サブスク枠）で概念図を生成し、コンテンツハッシュで再利用する。
// 使い方: node infographic.js [--limit 10] [--force] [--dry-run] [--timeout 600]
//   数値(件数/コスト/trend)はキーに含めない（毎回変動しキャッシュ不能になるため）。画像は概念のみ。

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const C = require('./common');
const CI = require('./codex-image');
const { mergeLlm, prioritize } = require('./build-report');

const PROMPT_VERSION = 1; // prompts/cluster-infographic.md を変えたら上げる（キャッシュ更新）
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'cluster-infographic.md');
const INDEX_PATH = path.join(C.INFOGRAPHICS_DIR, 'index.json');
const ARCHIVE_PATH = path.join(C.INFOGRAPHICS_DIR, 'archive.jsonl');

function stable(o) {
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  return JSON.stringify(o);
}

// 画像に渡す「事実」（secret/パスをマスク・数値は含めない）
function clusterImageFacts(c) {
  const s = (t) => C.sanitize(t, 600);
  return {
    v: PROMPT_VERSION,
    error_class: c.error_class, tool: c.tool,
    suggested_fix: s(c.suggested_fix), target_surface: s(c.target_surface),
    llm: c.llm ? {
      root_cause: s(c.llm.root_cause), proposed_edit: s(c.llm.proposed_edit),
      target_files: Array.isArray(c.llm.target_files) ? c.llm.target_files.map((x) => C.maskPaths(x)) : c.llm.target_files,
    } : null,
  };
}
function cacheKey(facts) { return crypto.createHash('sha256').update(stable(facts)).digest('hex').slice(0, 16); }

function loadIndex() { return C.readJson(INDEX_PATH, {}) || {}; }
function saveIndex(idx) { C.writeJson(INDEX_PATH, idx); }
function appendArchive(entry) {
  try { fs.mkdirSync(C.INFOGRAPHICS_DIR, { recursive: true }); fs.appendFileSync(ARCHIVE_PATH, JSON.stringify(entry) + '\n'); } catch { /* noop */ }
}
async function fileExists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function ensureClusterImage(cluster, opts) {
  const { config, force, dryRun, template, today } = opts;
  const facts = clusterImageFacts(cluster);
  const hash = cacheKey(facts);
  const dir = path.join(C.INFOGRAPHICS_DIR, hash);
  const jpg = path.join(dir, 'image.jpg');
  const index = opts.index;
  const existing = index[cluster.cluster_id];
  const hit = existing && existing.hash === hash && await fileExists(jpg);

  if (!force && hit) { appendArchive({ date: today, cluster_id: cluster.cluster_id, hash, action: 'reused' }); return { cluster_id: cluster.cluster_id, status: 'cached', hash }; }
  if (dryRun) return { cluster_id: cluster.cluster_id, status: hit ? 'would-skip' : 'would-generate', hash };

  await fsp.mkdir(dir, { recursive: true });
  const prompt = CI.renderPrompt(template, { FACTS: JSON.stringify(facts, null, 2), WORKDIR: dir });
  C.writeText(path.join(dir, 'prompt.md'), C.maskPaths(prompt)); // 保存版は workdir 絶対パスも ~ に畳む（codex には実パスを渡す）

  const sinceMs = Date.now();
  const inf = config.infographics || {};
  try {
    await CI.runWithRetry({
      bin: 'codex', prompt, addDir: dir,
      model: inf.model || 'gpt-5.4-mini', reasoning: inf.reasoning || 'low',
      timeoutSec: opts.timeoutSec, lastMessageFile: path.join(dir, 'last-message.txt'), logFile: path.join(dir, 'codex.log'),
    }, { retries: 2 });
  } catch (e) { return { cluster_id: cluster.cluster_id, status: 'failed', hash, reason: e.message }; }

  const provenance = await CI.ensureImage(dir, { sinceMs });
  if (provenance === 'missing') return { cluster_id: cluster.cluster_id, status: 'failed', hash, reason: 'no image produced' };

  C.writeJson(path.join(dir, 'meta.json'), { hash, cluster_id: cluster.cluster_id, prompt_version: PROMPT_VERSION, created_at: C.nowIso(), facts, model: inf.model || 'gpt-5.4-mini', provenance });
  index[cluster.cluster_id] = { hash, created_at: C.nowIso() };
  saveIndex(index);
  appendArchive({ date: today, cluster_id: cluster.cluster_id, hash, action: 'generated' });
  return { cluster_id: cluster.cluster_id, status: 'generated', hash };
}

async function main() {
  const args = process.argv.slice(2);
  const config = C.loadConfig();
  const inf = config.infographics || {};
  if (inf.enabled === false) { process.stdout.write(JSON.stringify({ skipped: 'infographics disabled' }) + '\n'); return; }

  const force = C.getFlag(args, 'force');
  const dryRun = C.getFlag(args, 'dry-run');
  const limit = parseInt(C.getFlag(args, 'limit', true, String(inf.limit || 10)), 10) || 10;
  const timeoutSec = parseInt(C.getFlag(args, 'timeout', true, String(inf.timeout_sec || 600)), 10) || 600;

  if (!dryRun) {
    if (!(await CI.commandExists('codex'))) { process.stdout.write(JSON.stringify({ skipped: 'codex CLI 不在。レポートは決定論SVGで成立します。' }) + '\n'); return; }
    if (!(await CI.commandExists('sips'))) { process.stdout.write(JSON.stringify({ skipped: 'sips 不在（macOS必須）。' }) + '\n'); return; }
  }

  const data = C.readJson(path.join(C.CLUSTERS_DIR, 'latest.json'), null);
  if (!data) { process.stderr.write('clusters が見つかりません。先に cluster.js を実行してください。\n'); process.exit(1); }
  const llm = fs.existsSync(path.join(C.CLUSTERS_DIR, 'llm-latest.json')) ? C.readJson(path.join(C.CLUSTERS_DIR, 'llm-latest.json'), null) : null;
  const clusters = mergeLlm(data.clusters || [], llm);
  const { problems } = prioritize(clusters);
  const top = problems.slice(0, limit);

  const template = fs.readFileSync(PROMPT_PATH, 'utf8');
  const index = loadIndex();
  const today = C.today();
  const results = [];
  for (let i = 0; i < top.length; i++) {
    const c = top[i];
    process.stderr.write(`  [${i + 1}/${top.length}] ${c.cluster_id} …\n`);
    const r = await ensureClusterImage(c, { config, force, dryRun, template, today, index, timeoutSec });
    results.push(r);
    process.stderr.write(`      → ${r.status}${r.reason ? ' (' + r.reason + ')' : ''}\n`);
  }
  const summary = {
    total: results.length,
    generated: results.filter((r) => r.status === 'generated').length,
    cached: results.filter((r) => r.status === 'cached').length,
    failed: results.filter((r) => r.status === 'failed').length,
    dry_run: !!dryRun,
    results: dryRun ? results : undefined,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
}

module.exports = { clusterImageFacts, cacheKey, stable, PROMPT_VERSION };

if (require.main === module) main().catch((e) => { process.stderr.write('infographic fatal: ' + e.message + '\n'); process.exit(1); });
