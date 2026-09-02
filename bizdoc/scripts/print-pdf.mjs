#!/usr/bin/env node
// print-pdf.mjs — bizdoc の A4 PDF 書き出し
// 全ページに「文書タイトル ｜ ページ番号/総ページ」のフッターを入れる。
// 依存ゼロ: Node 22+ の組み込み WebSocket + macOS の Chrome（CDP Page.printToPDF）。
// CLI の --print-to-pdf ではフッターテンプレートを指定できない（既定フッターは
// file:// パスを印字してしまい path-privacy 違反になる）ため、CDP 経由にしている。
// CDP クライアント・Chrome の起動と後片付けは screenshot.mjs と共有（scripts/cdp.mjs）。
//
// 使い方:
//   node print-pdf.mjs <input.html> <output.pdf> [--title "<フッター表示タイトル>"] [--scale 0.9]
//   --title 省略時は HTML の <title> を使う。--scale は全体の印刷倍率（0.5〜2、既定 1）
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CHROME, launchChrome, parseArgs } from './cdp.mjs';

// A4 の紙面余白（mm）。ここが唯一の正で、@page への注入と CDP の margin* の
// 両方をこの値から導出する。片方だけ変えると Chrome 側で不整合になる。
// 下だけ広いのは、フッター（タイトル｜ページ番号）を下余白の中に描くため。
const MARGIN_TOP_MM = 15;
const MARGIN_SIDE_MM = 15;
const MARGIN_BOTTOM_MM = 19;
const MM_PER_INCH = 25.4;

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const args = parseArgs(process.argv.slice(2));
const [input, output] = args._;
if (!input || !output) die('使い方: node print-pdf.mjs <input.html> <output.pdf> [--title "<タイトル>"]');
const absInput = path.resolve(input);
if (!fs.existsSync(absInput)) die(`入力 HTML が見つかりません: ${absInput}`);
if (!fs.existsSync(CHROME)) {
  die('Chrome が見つかりません。フォールバック（ページ番号なし）:\n' +
    `  "${CHROME}" --headless=new --print-to-pdf="<出力>" --no-pdf-header-footer "file://<入力>"`);
}

const html = fs.readFileSync(absInput, 'utf8');
const title = args.title || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? path.basename(absInput, '.html')).trim();

const { cdp, sessionId, navigate, evaluate, close } = await launchChrome({ prefix: 'bizdoc-pdf-' });
try {
  await navigate('file://' + absInput);
  await delay(300); // フォント・レイアウトの安定待ち

  // Chrome の printToPDF は、文書が @page margin を明示していると CDP の margin*
  // パラメータを無視して CSS 側を優先する。かつて「二重になるのを避ける」目的で
  // @page{margin:0} を注入していたが、それが勝って余白が完全に消えていた（実測 0mm）。
  // 正しくは CDP と同じ値を @page に注入し、両者を一致させる。
  await evaluate(
    "(() => { const s = document.createElement('style');" +
    ` s.textContent = '@media print{@page{margin:${MARGIN_TOP_MM}mm ${MARGIN_SIDE_MM}mm ${MARGIN_BOTTOM_MM}mm}}';` +
    " document.head.appendChild(s); })()"
  );

  const footerTemplate =
    `<div style="width:100%;font-size:8px;color:#9ca3af;padding:0 ${MARGIN_SIDE_MM}mm;display:flex;` +
    `justify-content:space-between;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif;">` +
    `<span>${escapeHtml(title)}</span>` +
    `<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

  const scale = Math.min(2, Math.max(0.5, parseFloat(args.scale ?? '1') || 1));
  const { data } = await cdp.send('Page.printToPDF', {
    printBackground: true,
    scale,
    preferCSSPageSize: false,
    paperWidth: 8.27,   // A4
    paperHeight: 11.69,
    marginTop: MARGIN_TOP_MM / MM_PER_INCH,
    marginBottom: MARGIN_BOTTOM_MM / MM_PER_INCH, // フッター領域を含む
    marginLeft: MARGIN_SIDE_MM / MM_PER_INCH,
    marginRight: MARGIN_SIDE_MM / MM_PER_INCH,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate,
  }, sessionId);

  const pdf = Buffer.from(data, 'base64');
  // v0.11.1 (2026-09-02): 未描画のまま printToPDF して exit 0 で「成功」していた無音失敗を止める
  //   （2026-08 実測: 6 件中 4 件が空 PDF。load の race（10s）に負けると本文ゼロで出力される）。
  //   ページ数 0 / 本文長ゼロ相当（< MIN_PDF_BYTES）は非 0 終了にし、呼び出し側に再実行を促す。
  const MIN_PDF_BYTES = 2048;
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pdf.length < MIN_PDF_BYTES || pageCount === 0) {
    die(`空 PDF の可能性があります（${pdf.length} bytes / ${pageCount} pages）。load が完了する前に印刷された疑い — マシン負荷を下げて再実行するか、HTML 単体でレンダリングを確認してください`);
  }
  fs.writeFileSync(path.resolve(output), pdf);
  console.log(path.resolve(output));
} finally {
  close();
}
