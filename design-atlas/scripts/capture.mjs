#!/usr/bin/env node
// capture.mjs — 任意段。動くモックがあるときだけ、画面を撮って screens[].images[] の材料を作る。
// 画像ゼロでも設計マップは成立する（モックがまだ無い最上流から使えるようにするため）。
// 撮影日時はモデルの取得日時と別に記録する。混ぜると「古い画像を今の根拠にする」事故が起きる。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './cdp.mjs';
import { loadModel, resolveWithin, ModelError } from './lib/model.mjs';

export async function capture(modelPath, outDir, { width = 1440, height = 1050 } = {}) {
  const { model, dir } = loadModel(modelPath);
  const targets = (model.screens ?? []).filter((s) => s.mock?.href);
  if (!targets.length) throw new ModelError('screens[].mock.href がありません。撮る対象がありません');
  for (const s of targets) {
    if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(s.id)) {
      throw new ModelError(`screens[].id に使えない文字が含まれています（英小文字・数字・_・- のみ）: ${JSON.stringify(String(s.id)).slice(0, 40)}`);
    }
  }
  fs.mkdirSync(outDir, { recursive: true });

  const session = await launchChrome();
  const captured = [];
  try {
    const { cdp, sessionId, navigate } = session;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    for (const s of targets) {
      const href = s.mock.href.split('?')[0];
      const abs = resolveWithin(dir, href, `screens[${s.id}].mock.href`);
      if (!fs.existsSync(abs)) { console.warn(`warn: ${s.id}: ${href} がありません`); continue; }
      const url = pathToFileURL(abs).href + (s.mock.href.includes('?') ? '?' + s.mock.href.split('?')[1] : '');
      await navigate(url, 15000);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      // capture は verify-structure より前に走る任意段なので、id はまだ検査されていない。
      // 書き出し名に使う前にここで確かめ、outDir の外へ出られないようにする。
      const file = resolveWithin(outDir, `${s.id}.png`, `screens[].id`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      captured.push({ key: s.id, label: '画面上部', path: path.relative(dir, file), captured_at: new Date().toISOString(), historical: false, width, height });
    }
  } finally {
    await session.close();
  }
  return captured;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const modelPath = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
  if (!modelPath) {
    console.error('usage: capture.mjs <model.json> [--out <dir>]');
    console.error('  撮った結果は screens[].images[] に貼れる形で標準出力に出る（model.json は書き換えない）');
    process.exit(2);
  }
  try {
    const outDir = get('--out') ?? path.join(path.dirname(path.resolve(modelPath)), 'screens');
    const captured = await capture(modelPath, outDir);
    console.log(JSON.stringify(captured, null, 2));
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
