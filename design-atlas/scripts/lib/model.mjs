// model.json の読み込みとパス解決。sources[].path / screens[].image は
// すべて model.json のあるディレクトリからの相対で解決する（絶対パスを成果物に持ち込まないため）。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ModelError extends Error {}

export function loadModel(modelPath) {
  const abs = path.resolve(modelPath);
  let raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new ModelError(`model.json を読めません: ${path.basename(abs)}（${e.code}）`);
  }
  let model;
  try {
    model = JSON.parse(raw);
  } catch (e) {
    throw new ModelError(`model.json が JSON として読めません: ${e.message}`);
  }
  return { model, dir: path.dirname(abs), raw, sha256: sha256(raw) };
}

export function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** model.json のディレクトリ配下に閉じた相対パスだけを許す。`..` での脱出は拒否する。 */
export function resolveWithin(dir, relative, label) {
  if (typeof relative !== 'string' || !relative) throw new ModelError(`${label} のパスが空です`);
  if (path.isAbsolute(relative)) throw new ModelError(`${label} は相対パスで書いてください（絶対パスは成果物に持ち込めません）`);
  const abs = path.resolve(dir, relative);
  const inside = path.relative(dir, abs);
  if (inside.startsWith('..')) throw new ModelError(`${label} が model.json のディレクトリの外を指しています: ${relative}`);
  return abs;
}

/** 配列を id で引ける Map にする。重複 id はここで落とす。 */
export function indexById(items = [], label) {
  const map = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) throw new ModelError(`${label} に id のない要素があります`);
    if (map.has(item.id)) throw new ModelError(`${label} の id が重複しています: ${item.id}`);
    map.set(item.id, item);
  }
  return map;
}
