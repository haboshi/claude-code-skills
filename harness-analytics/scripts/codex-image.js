'use strict';
// codex CLI の image_gen で1枚絵を生成し JPG 化する（依存ゼロ・macOS）。
// turn-review-plugin/lib/codex.js + lib/image.js の必要部分を移植。
// 偽造対策: codex 起動以降(sinceMs)に生成された PNG の実在を image_gen 実行の裏付けとし、
// 裏付けの無い workdir/image.png は破棄する（低 reasoning は image_gen を呼ばず偽装することがある）。

const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] == null ? '' : vars[k]));
}

async function runCodex({ bin = 'codex', prompt, timeoutSec = 600, addDir, model = 'gpt-5.4-mini', reasoning = 'low', logFile, lastMessageFile }) {
  const args = ['exec', '--skip-git-repo-check', '--full-auto'];
  if (addDir) args.push('--cd', addDir);        // --add-dir は実測 read-only。workdir を --cd にする
  if (lastMessageFile) args.push('-o', lastMessageFile);
  args.push('-c', `model_reasoning_effort=${reasoning}`, '-c', `model=${model}`, prompt);
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;                     // ChatGPT サブスク認証を強制（API 従量課金回避）
  const result = await new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => stdout += d);
    child.stderr.on('data', (d) => stderr += d);
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`codex timed out after ${timeoutSec}s`)); }, timeoutSec * 1000);
    child.on('exit', (code) => { clearTimeout(t); resolve({ exitCode: code, stdout, stderr }); });
    child.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  let lastMessage = '';
  if (lastMessageFile) { try { lastMessage = (await fs.readFile(lastMessageFile, 'utf8')).trim(); } catch { /* noop */ } }
  // codex.log にはプロンプト本体（workdir 絶対パスを含む最後の arg）を残さない
  if (logFile) { try { await fs.appendFile(logFile, JSON.stringify({ ts: new Date().toISOString(), args: args.slice(0, -1), exitCode: result.exitCode, stderr: result.stderr, lastMessage }) + '\n'); } catch { /* noop */ } }
  return { ...result, lastMessage };
}

async function runWithRetry(opts, { retries = 2, validate } = {}) {
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await runCodex(opts);
      if (res.exitCode !== 0) { lastErr = new Error(`codex exit ${res.exitCode}: ${(res.stderr || '').slice(0, 300)}`); continue; }
      if (validate && !(await validate(res))) { lastErr = new Error('validation failed'); continue; }
      return res;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function codexImageRoots() {
  return [
    path.join(os.homedir(), '.codex', 'generated_images'),
    path.join(os.homedir(), 'Library', 'Application Support', 'orca', 'codex-runtime-home', 'home', 'generated_images'),
  ];
}

// sinceMs 以降の最新 PNG を返す（他セッション/過去実行の画像を拾わない）
async function findLatestCodexImage(windowSec = 600, sinceMs = 0) {
  const cutoff = Math.max(Date.now() - windowSec * 1000, sinceMs);
  const candidates = [];
  for (const root of codexImageRoots()) {
    let dirs; try { dirs = await fs.readdir(root); } catch { continue; }
    for (const d of dirs) {
      let entries; try { entries = await fs.readdir(path.join(root, d)); } catch { continue; }
      for (const e of entries) {
        if (!e.endsWith('.png')) continue;
        const p = path.join(root, d, e);
        try { const st = await fs.stat(p); if (st.mtimeMs >= cutoff) candidates.push({ path: p, mtime: st.mtimeMs }); } catch { /* noop */ }
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

function convertToJpg(srcPng, dstJpg, quality = 82) {
  return new Promise((resolve, reject) => {
    const child = spawn('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), srcPng, '--out', dstJpg], { stdio: 'ignore' });
    let settled = false;
    const t = setTimeout(() => { if (settled) return; settled = true; child.kill('SIGKILL'); reject(new Error('sips timed out')); }, 30000);
    child.on('exit', (code) => { if (settled) return; settled = true; clearTimeout(t); code === 0 ? resolve(dstJpg) : reject(new Error(`sips exit ${code}`)); });
    child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(t); reject(e); });
  });
}

// codex 完了後、workdir/image.jpg を確定する。偽造は破棄。返り値: 'jpg-from-local'|'jpg-from-codex'|'missing'
async function ensureImage(workdir, { quality = 82, windowSec = 600, sinceMs = 0 } = {}) {
  const localPng = path.join(workdir, 'image.png');
  const localJpg = path.join(workdir, 'image.jpg');
  const codexPng = await findLatestCodexImage(windowSec, sinceMs);
  try {
    await fs.access(localPng);
    if (sinceMs && !codexPng) { await fs.rm(localPng, { force: true }); return 'missing'; } // 裏付けなし＝偽造
    await convertToJpg(localPng, localJpg, quality);
    await fs.rm(localPng, { force: true });
    return 'jpg-from-local';
  } catch { /* localPng なし */ }
  if (codexPng) { try { await convertToJpg(codexPng, localJpg, quality); return 'jpg-from-codex'; } catch { /* noop */ } }
  return 'missing';
}

// codex / sips の実在確認
function commandExists(cmd) {
  return new Promise((resolve) => {
    const child = spawn('command', ['-v', cmd], { stdio: 'ignore', shell: '/bin/bash' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

module.exports = { renderPrompt, runCodex, runWithRetry, findLatestCodexImage, convertToJpg, ensureImage, commandExists };
