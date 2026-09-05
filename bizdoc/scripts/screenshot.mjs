#!/usr/bin/env node
// screenshot.mjs — bizdoc の検品用スクリーンショット（Phase 5 決定論ゲート 2）
// 全体を「実コンテンツ高」で撮って高さ 2000px 以下のセグメントに分け、図・表の位置を DOM から取って
// 個別に前後の本文込みで 2 倍解像度に書き出す。
//
// 設計上の制約（2026-09-03 実測）:
// - Chrome CLI の --screenshot はビューポート分しか撮れず、--window-size=1280,4000 固定では doc-hub の
//   実文書 10/10 が 4000px 超（中央値 8,100px）で図表の 52% が写らなかった。
// - ビューポートを scrollHeight に張り直して 1 枚で撮ると、16384px を超えた領域が先頭コンテンツの
//   巻き戻しコピーに差し替わる（欠落でなく複製なので PNG を見ても分からない。doc-hub 実測 158 件中 4 件が該当）。
//   さらに min-height:Nvh を持つ文書は張り直しで再レイアウトされ、height と要素座標が別の世界の値になる。
// - Read ツールは長辺 2000px に縮小して提示するため、6000px 超の 1 枚絵は本文が判読できない。
// そこでビューポートは 800px 固定のまま、captureBeyondViewport + clip で 2000px 以下のセグメントに分けて撮り、
// 要素座標も同じビューポート状態で測る。
//
// 使い方:
//   node screenshot.mjs <input.html> <outdir> [--width 1280] [--scale 2] [--selector "figure, table, .kpi-grid, svg"]
// 出力:
//   <outdir>/full-NN.png       … 全体を上から 2000px ごとに分割（幅 --width・等倍。Read で文字が読める）
//   <outdir>/crop-NN-<tag>.png … 各図表（前後 48px の本文を含む領域を --scale 倍で再ラスタライズ）
//   stdout                     … JSON { height, segments: [{file, top, height}], crops: [{file, tag, top, height, truncated}] }
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChrome, parseArgs } from './cdp.mjs';

const VIEWPORT_HEIGHT = 800;   // 計測・撮影とも固定（vh 依存レイアウトを動かさない）
const SEGMENT_HEIGHT = 2000;   // Read が縮小せずに提示できる上限（長辺 2000px）
const CONTEXT_PX = 48;         // 図表の前後に含める本文の高さ（本文と図中文字の相対比較のため）
const MAX_CROP_HEIGHT = 2400;  // これ以上高い要素は先頭部分だけ撮り truncated:true を返す

function die(msg) { console.error(msg); process.exit(1); }

const args = parseArgs(process.argv.slice(2));
const [input, outdir] = args._;
if (!input || !outdir) die('使い方: node screenshot.mjs <input.html> <outdir> [--width 1280] [--scale 2] [--selector "figure, table, .kpi-grid, svg"]');
const absInput = path.resolve(input);
if (!fs.existsSync(absInput)) die(`入力 HTML が見つかりません: ${absInput}`);
const width = Math.max(320, parseInt(args.width ?? '1280', 10) || 1280);
const scale = Math.min(3, Math.max(1, parseFloat(args.scale ?? '2') || 2));
// 入れ子（figure 内の svg / table）は後段の outer フィルタで外側だけ残す。
// .kpi-grid は kpi-cards パターン（SVG でなく HTML で組む数値カード）を拾うため。
const selector = args.selector || 'figure, table, .kpi-grid, svg';
fs.mkdirSync(outdir, { recursive: true });

let session;
try {
  session = await launchChrome({ prefix: 'bizdoc-shot-', extraArgs: ['--hide-scrollbars'] });
} catch (e) {
  die(e.message);
}
const { cdp, sessionId, navigate, evaluate, close } = session;
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: VIEWPORT_HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
  await navigate('file://' + absInput);
  await delay(400); // フォント・レイアウトの安定待ち

  const height = await evaluate('Math.ceil(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))');
  const shoot = async (top, h, s) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: top, width, height: h, scale: s } }, sessionId);
    return Buffer.from(data, 'base64');
  };

  // 全体: 2000px 以下のセグメントに分割（ビューポートは動かさない）
  const segments = [];
  for (let top = 0, n = 1; top < height; top += SEGMENT_HEIGHT, n++) {
    const h = Math.min(SEGMENT_HEIGHT, height - top);
    const file = path.join(outdir, `full-${String(n).padStart(2, '0')}.png`);
    fs.writeFileSync(file, await shoot(top, h, 1));
    segments.push({ file, top, height: h });
  }

  // 図表の位置を DOM から取る（画素目測をしない）。サイズ 0 の要素を先に落としてから、入れ子は外側だけ残す
  // （順序を逆にすると display:contents の figure とその中の svg が両方消える）。
  const rects = await evaluate(`(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.height > 8 && r.width > 8);
    const outer = els.filter(({ e }) => !els.some((o) => o.e !== e && o.e.contains(e)));
    return outer.map(({ e, r }) => {
      const cls = typeof e.className === 'string' ? e.className.split(/\\s+/).filter(Boolean)[0] : '';
      const tag = e.tagName.toLowerCase() + (e.id ? '#' + e.id : (cls ? '.' + cls : ''));
      return { tag, top: Math.round(r.top + window.scrollY), height: Math.round(r.height), width: Math.round(r.width) };
    });
  })()`);

  const crops = [];
  let n = 0;
  for (const r of rects) {
    n++;
    const top = Math.max(0, r.top - CONTEXT_PX);
    const bottom = Math.min(height, r.top + Math.min(r.height, MAX_CROP_HEIGHT) + CONTEXT_PX);
    const safeTag = r.tag.replace(/[^a-z0-9#.-]/gi, '').slice(0, 40) || 'el';
    const entry = { tag: r.tag, top: r.top, height: r.height, truncated: r.height > MAX_CROP_HEIGHT };
    if (bottom <= top) { crops.push({ ...entry, file: null, skipped: true }); continue; } // 負の clip を Chrome に渡さない
    const file = path.join(outdir, `crop-${String(n).padStart(2, '0')}-${safeTag}.png`);
    fs.writeFileSync(file, await shoot(top, bottom - top, scale));
    crops.push({ file, ...entry });
  }
  console.log(JSON.stringify({ width, height, scale, segments, crops }, null, 2));
} finally {
  await close();
}
