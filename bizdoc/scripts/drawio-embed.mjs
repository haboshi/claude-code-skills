#!/usr/bin/env node
// drawio-embed.mjs — draw.io が書き出した SVG を、白基調の 1 枚 HTML に安全に貼れる形へ整える。
//
// usage: node drawio-embed.mjs <in.svg> [--id-prefix dg1] [--title "図の説明"]
// stdout: 加工後の SVG（そのまま <figure> の中へ貼る）
//
// draw.io の export SVG をそのまま貼ると、実測で 3 つの壊れ方をする（いずれも実 export で確認済み）:
//   1. `color-scheme: light dark` が入っており、色が light-dark(#000, #fff) で書かれる。
//      閲覧環境がダークだと線が白くなり、白基調の紙面で矢印が丸ごと消える
//   2. mxCell の id がそのまま SVG の id になる（"0" "1" を含む）。同じ文書に 2 枚貼ると必ず衝突する
//   3. font-family が Helvetica のみで日本語のフォールバックが無く、表示が環境依存になる
// あわせて、bizdoc の予防則に合わせた整形も行う（width/height を落として viewBox 基準にし、
// role="img" と <title> を付ける）。
import fs from 'node:fs';

const HELP = 'usage: drawio-embed.mjs <in.svg> [--id-prefix <prefix>] [--title <text>] [--accent #rrggbb] [--accent-soft #rrggbb]';

// 日本語フォールバックを持つスタック。tokens.css の body と同じ系統に揃える
const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif";

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

// light-dark(a, b) を a（ライト側）に畳む。白基調に固定するため常にライト側を採る。
// 引数には rgb(...) が入れ子で来る（実測: light-dark(rgb(51, 51, 51), rgb(...))）ため、
// 正規表現では対応できない。括弧の深さを数えて第1引数だけを取り出す。
export function foldLightDark(svg) {
  const NEEDLE = 'light-dark(';
  let out = '';
  let i = 0;
  for (;;) {
    const rel = svg.slice(i).search(/light-dark\(/i);
    if (rel < 0) { out += svg.slice(i); break; }
    const start = i + rel;
    out += svg.slice(i, start);
    let depth = 0;
    let j = start + NEEDLE.length;
    let firstArgEnd = -1;
    for (; j < svg.length; j++) {
      const c = svg[j];
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ',' && depth === 0 && firstArgEnd < 0) firstArgEnd = j;
    }
    if (j >= svg.length) { out += svg.slice(start); break; }  // 閉じ括弧が無い: そのまま残す
    const light = svg.slice(start + NEEDLE.length, firstArgEnd < 0 ? j : firstArgEnd).trim();
    out += light;
    i = j + 1;
  }
  return out;
}

// id と、それを指す参照（url(#id) / href="#id" / xlink:href="#id"）をまとめて接頭辞つきに変える。
// 接頭辞を付けないと、同じ文書に 2 枚貼ったとき id="0" 同士が衝突して片方の描画が壊れる。
export function prefixIds(svg, prefix) {
  const ids = new Set();
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  if (ids.size === 0) return svg;
  let out = svg.replace(/(\sid=")([^"]+)(")/g, (_m, a, id, b) => `${a}${prefix}-${id}${b}`);
  // 参照側。長い id から置換して部分一致による取り違えを防ぐ
  for (const id of [...ids].sort((a, b) => b.length - a.length)) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${prefix}-${id})`)
      .replace(new RegExp(`((?:xlink:)?href=")#${esc}(")`, 'g'), `$1#${prefix}-${id}$2`);
  }
  return out;
}

// 日本語フォールバックを持たない font-family を置き換える。
// 値そのものがクォートを含む（例: 'Hiragino Sans', sans-serif）ため、値の切り出しで
// シングルクォートを終端にしてはいけない — 途中で切ると既に日本語対応済みの指定を
// 判定し損ね、二重に置換して壊れたスタックになる（テストで検出した）。
export function fixFonts(svg) {
  return svg.replace(/font-family\s*:\s*([^;"]+)/gi, (m, fam) => (
    /Hiragino|Yu Gothic|Noto Sans JP|Meiryo/i.test(fam) ? m : `font-family: ${FONT_STACK}`
  ));
}

// 図の配色を文書のアクセント色に合わせる。drawio の既定スタイル（Mermaid 変換で付く
// 紫系 #9370db / #ececff）のままだと、文書のアクセント1色の原則が崩れる。
// 面は accent を白で薄めた色、線は accent、文字色（濃グレー）はそのまま残す。
export function retint(svg, accent, soft) {
  if (!accent) return svg;
  const map = new Map([
    ['rgb(147, 112, 219)', accent],   // Mermaid 既定の線色（紫）
    ['#9370db', accent],
    ['rgb(236, 236, 255)', soft],     // 同・面色（淡い紫）
    ['#ececff', soft],
  ]);
  let out = svg;
  for (const [from, to] of map) {
    if (!to) continue;
    out = out.split(from).join(to);
  }
  return out;
}

// ルート <svg> を bizdoc の規範に合わせる:
// width/height の px 直書きを外し（figure svg { width:100% } を効かせる）、
// color-scheme をライト固定にし、role="img" と <title> を持たせる。
export function normalizeRoot(svg, title) {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) throw new Error('ルート <svg> が見つかりません');
  let tag = m[0];
  tag = tag.replace(/\s(width|height)="[^"]*"/gi, '');
  tag = tag.replace(/\sstyle="([^"]*)"/i, (_s, v) => {
    const cleaned = v.replace(/color-scheme\s*:\s*[^;]+;?/gi, '').trim();
    return ` style="${(cleaned + '; color-scheme: light').replace(/^;\s*/, '')}"`;
  });
  if (!/\sstyle="/i.test(tag)) tag = tag.replace(/<svg\b/i, '<svg style="color-scheme: light"');
  if (!/\srole="/i.test(tag)) tag = tag.replace(/<svg\b/i, '<svg role="img"');
  let out = svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
  if (title && !/<title>/i.test(out)) {
    out = out.replace(tag, `${tag}\n  <title>${escapeXml(title)}</title>`);
  }
  return out;
}

// ルート svg の content 属性（編集用に埋め込まれた mxfile XML）を落とす。
// HTML に貼る用途では使われないうえ、中に width= や id= を含むため検査を惑わせる。
// 元の .drawio ファイルを残しておけば編集可能性は失われない。
export function stripEmbeddedXml(svg) {
  return svg.replace(/(<svg\b[^>]*?)\scontent="(?:[^"\\]|\\.)*"/i, '$1');
}

export function prepareForEmbed(svg, { idPrefix = 'dg', title = '', accent = '', accentSoft = '' } = {}) {
  // XML 宣言と DOCTYPE はインライン埋め込みでは不要（あると HTML パーサが警告を出す）
  let out = svg.replace(/<\?xml[^>]*\?>\s*/i, '').replace(/<!DOCTYPE[^>]*>\s*/i, '');
  out = stripEmbeddedXml(out);
  out = foldLightDark(out);
  out = retint(out, accent, accentSoft);
  out = fixFonts(out);
  out = prefixIds(out, idPrefix);
  out = normalizeRoot(out, title);
  return out.trim() + '\n';
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) { console.error(HELP); process.exit(1); }
  const get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (!fs.existsSync(input)) { console.error(`SVG が見つかりません: ${input}`); process.exit(1); }
  const svg = fs.readFileSync(input, 'utf8');
  process.stdout.write(prepareForEmbed(svg, {
    idPrefix: get('--id-prefix') || 'dg',
    title: get('--title') || '',
    accent: get('--accent') || '',
    accentSoft: get('--accent-soft') || '',
  }));
}
