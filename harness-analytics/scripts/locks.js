'use strict';
// stdlib のみのファイルロック（依存ゼロ）。turn-review-plugin/lib/locks.js を移植・簡略化。
// mkdir(recursive:false) は既存時 EEXIST で原子的に失敗する＝プロセス間の相互排他に使える。

const fs = require('fs/promises');
const crypto = require('crypto');

const STALE_LOCK_MS = 5 * 60 * 1000;   // 5分でstaleロックを強制解除
const ACQUIRE_TIMEOUT_MS = 30 * 1000;
const POLL_INTERVAL_MS = 25;

function lockDirFor(target) {
  return target.endsWith('.lockdir') ? target : `${target}.lockdir`;
}

async function acquire(target) {
  const dir = lockDirFor(target);
  const start = Date.now();
  for (;;) {
    try {
      await fs.mkdir(dir, { recursive: false });
      return dir;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = await fs.stat(dir);
        if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
          continue;
        }
      } catch { /* stat 失敗（消えた）→ 再試行 */ }
      if (Date.now() - start > ACQUIRE_TIMEOUT_MS) throw new Error(`lock acquire timeout: ${target}`);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

async function release(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

async function atomicWrite(target, content) {
  const tmp = `${target}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, target);
}

module.exports = { acquire, release, atomicWrite, lockDirFor };
