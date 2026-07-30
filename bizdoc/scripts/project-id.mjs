// project-id.mjs — turn-review 方式のプロジェクト ID 解決
// ID 形式: <basename-slug>-<sha256(絶対パス)先頭8hex>
// この ID は「初回発番の材料」であり、発番後は project.json 側で不変に保つ（hub.mjs 参照）
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

export function projectIdFromPath(absPath) {
  const hash = crypto.createHash('sha256').update(absPath).digest('hex').slice(0, 8);
  return `${slugify(path.basename(absPath))}-${hash}`;
}

// git worktree / リポジトリ内サブディレクトリを main worktree のルートへ解決する。
// git 管理外・bare repo はそのままの絶対パスを返す。
export function resolveMainWorktreeRoot(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0) return path.resolve(dir);
  const common = r.stdout.trim();
  const abs = path.isAbsolute(common) ? common : path.resolve(dir, common);
  if (path.basename(abs) === '.git') return path.dirname(abs);
  return path.resolve(dir);
}
