#!/usr/bin/env node
// manifest.mjs — model.json が挙げた入力ファイルを実際に読み、sha256 と取得日時を source-manifest.json に残す。
// 「何を根拠にこの図を描いたか」を成果物側から辿れるようにするための段。内容の検査はしない。
import fs from 'node:fs';
import path from 'node:path';
import { loadModel, resolveWithin, sha256, ModelError } from './lib/model.mjs';

export function buildManifest(modelPath) {
  const { model, dir, sha256: modelSha } = loadModel(modelPath);
  const sources = [];
  for (const src of model.sources ?? []) {
    if (!src || typeof src.id !== 'string') throw new ModelError('sources[] に id のない要素があります');
    const entry = {
      id: src.id,
      kind: src.kind ?? 'file',
      note: src.note ?? null,
      commit: src.commit ?? null,
      fetched_at: src.fetched_at ?? null,
    };
    if (entry.kind === 'file') {
      const abs = resolveWithin(dir, src.path, `sources[${src.id}].path`);
      const body = fs.readFileSync(abs, 'utf8');
      entry.path = src.path;
      entry.bytes = Buffer.byteLength(body);
      entry.sha256 = sha256(body);
      // model.json 側に sha256 が宣言済みなら突き合わせる。不一致は verify-structure が止める。
      entry.declared_sha256 = src.sha256 ?? null;
      entry.matches_declared = src.sha256 ? src.sha256 === entry.sha256 : null;
    } else {
      entry.path = src.path ?? null;
      entry.range = src.range ?? null;
    }
    sources.push(entry);
  }
  return {
    schema: 'design-atlas/source-manifest/1',
    model: { path: path.basename(path.resolve(modelPath)), sha256: modelSha, version: model.meta?.model_version ?? null },
    generated_at: new Date().toISOString(),
    sources,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [modelPath, outPath] = process.argv.slice(2);
  if (!modelPath) {
    console.error('usage: manifest.mjs <model.json> [source-manifest.json]');
    process.exit(2);
  }
  try {
    const manifest = buildManifest(modelPath);
    const out = outPath ?? path.join(path.dirname(path.resolve(modelPath)), 'source-manifest.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ sources: manifest.sources.length, out: path.basename(out) }));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
