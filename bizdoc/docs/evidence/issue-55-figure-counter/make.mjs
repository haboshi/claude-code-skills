#!/usr/bin/env node
// make.mjs — Issue #55 の前後スクリーンショットを同じ条件で作り直す（bizdoc/ から実行）
//   node docs/evidence/issue-55-figure-counter/make.mjs [--before-ref c2c49ac]
// before / after とも sample.html の tokens マーカーへ CSS を inject.mjs の injectTokens で焼き込む（hub は通さない —
// after だけに hub ナビ帯が入ると高さがずれて対にならないため。hub add 経由の採番は tests/figure-numbering.test.mjs が見る）。
// screenshot.mjs の full-01.png を before-full-01.png / after-full-01.png に写す。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { injectTokens, readTokensCss } from '../../../scripts/inject.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshot = path.resolve(here, '../../../scripts/screenshot.mjs');
const i = process.argv.indexOf('--before-ref');
const ref = i >= 0 ? process.argv[i + 1] : 'c2c49ac';
const sample = fs.readFileSync(path.join(here, 'sample.html'), 'utf8');
const before = execFileSync('git', ['show', `${ref}:bizdoc/templates/tokens.css`], { encoding: 'utf8', cwd: here });
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bizdoc-evidence-'));
try {
  for (const [tag, css] of [['before', before], ['after', readTokensCss()]]) {
    const html = path.join(work, `${tag}.html`);
    fs.writeFileSync(html, injectTokens(sample, css));
    const j = JSON.parse(execFileSync(process.execPath, [screenshot, html, path.join(work, tag)], { encoding: 'utf8' }));
    if (j.segments.length !== 1) throw new Error(`${tag}: 1 セグメントに収まっていない（height ${j.height}）`);
    fs.copyFileSync(j.segments[0].file, path.join(here, `${tag}-full-01.png`));
    console.log(`${tag}: height ${j.height} → ${tag}-full-01.png`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
