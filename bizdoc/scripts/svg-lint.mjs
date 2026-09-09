// svg-lint.mjs — svg-patterns/README.md の共通予防則のうち、機械判定できるものだけを検査する。
//
// 置いた理由（v0.12.1 / 2026-09-09）: SKILL.md は「SVG を埋め込む前に必ず README.md を Read する」と
// 定めているが、それは人手の約束であって守られたかを誰も確かめていなかった。実際、読まずに書いた図が
// 予防則 3・4・5・8/9 を同時に外したまま保存された。§6 の構成規範には Phase 5 の検査が 1 対 1 で
// 対応しているのに、§7 の図の予防則にだけ対応する検査が無い、という非対称が原因である。
//
// 機械判定できない予防則（11 無名の箱 / 12 読み順と終端 / 13 実データ標本 / 14 反復は個数で /
// 15 強調は同時 1 点）はここでは扱わない。図の題材を知らないと真偽が決まらないためで、
// 無理に近似すると正典パターン自身を誤検出して警告そのものが信用されなくなる。
// これらは Phase 5 の人の検査に残す。

// tokens.css の figure 実幅（予防則9。body max-width 64rem − 本文 padding − figure padding − 枠線）
export const FIGURE_WIDTH = 918;
// 予防則9 の規範値。正典パターンの font-size は 14.5 / 15 / 16 のみで、この閾値では誤検出しない
export const MIN_FONT_SIZE = 14.5;
// 予防則8/9 の実表示下限
export const MIN_RENDERED = 14;
// 予防則10（A4 印刷でおよそ半ページ）
export const MAX_VIEWBOX_HEIGHT = 500;

// 予防則5 の例外。正典パターンが実際に使っているリテラルと、色を持たない指定
const ALLOWED_LITERALS = new Set(['#fff', '#ffffff', 'none', 'currentcolor', 'transparent']);

const ROOT_TAG_RE = /<svg\b[^>]*>/i;
const ATTR = (name) => new RegExp(`\\b${name}="([^"]*)"`, 'i');

// 警告文へ差し込む属性値の無害化。属性値は文書の作者が自由に書ける値で、hub は取込（retro）で
// 他所の HTML も受け取る。制御文字をそのまま端末へ流すと ESC シーケンスで行を消せてしまい、
// 「警告が出ていない」ように見せられる — 警告は人が採否を決める材料なので、消せる状態にしない。
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g;

function safe(value, max = 40) {
  const flat = String(value).replace(CONTROL_RE, '·');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function rootAttrs(svg) {
  const tag = svg.match(ROOT_TAG_RE);
  return tag ? tag[0] : '';
}

function attr(tag, name) {
  const m = tag.match(ATTR(name));
  return m ? m[1] : null;
}

// 図中の色指定を集める。var(--*) 参照と許可リテラルは除く。
function colorLiterals(svg) {
  const found = new Set();
  for (const m of svg.matchAll(/\b(?:fill|stroke|stop-color|flood-color)="([^"]*)"/gi)) {
    const v = m[1].trim().toLowerCase();
    if (!v || v.startsWith('var(') || v.startsWith('url(') || ALLOWED_LITERALS.has(v)) continue;
    found.add(v);
  }
  return [...found];
}

// 1 枚の SVG を検査して、警告メッセージの配列を返す（空なら合格）。
// label は文書内での位置（「図1」等）。呼び出し側が付ける。
export function lintSvg(svg, label = 'SVG') {
  const out = [];
  const tag = rootAttrs(svg);
  if (!tag) return out;

  // 予防則3: role="img" と <title>（スクリーンリーダーが図の主張を読めるようにする）
  if (!/<title[\s>]/i.test(svg)) out.push(`${label}: <title> がありません（予防則3。図の主張を1文で入れる）`);
  if (!/\brole="img"/i.test(tag)) out.push(`${label}: role="img" がありません（予防則3）`);

  // 予防則2: width / height の px 直書き（figure svg { width:100% } が効かなくなる）
  for (const name of ['width', 'height']) {
    const v = attr(tag, name);
    if (v && v !== '100%') out.push(`${label}: ルート要素に ${name}="${safe(v)}" があります（予防則2。viewBox のみ指定する）`);
  }

  // 予防則4: font-family は本文の system font stack を継承させる
  if (/\bfont-family\s*[=:]/i.test(svg)) out.push(`${label}: font-family を指定しています（予防則4。本文から継承させる）`);

  // 予防則5: 色は tokens.css の変数を参照する（ダークテーマと accent 変更に追随させる）
  const literals = colorLiterals(svg);
  if (literals.length > 0) {
    out.push(
      `${label}: 色リテラル ${literals.length}種（${literals.slice(0, 4).map((x) => safe(x, 20)).join(' ')}${literals.length > 4 ? ' …' : ''}）` +
        `を直書きしています（予防則5。var(--ink) 等の CSS 変数を参照する）`
    );
  }

  // 予防則8/9: font-size の規範値と、viewBox 幅から逆算した実表示サイズ
  const viewBox = attr(tag, 'viewBox');
  const nums = viewBox ? viewBox.trim().split(/[\s,]+/).map(Number) : [];
  const [vbWidth, vbHeight] = nums.length === 4 && nums.every(Number.isFinite) ? [nums[2], nums[3]] : [null, null];
  if (!viewBox) {
    out.push(`${label}: viewBox がありません（予防則2/9。実表示サイズが判定できない）`);
  }

  const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number(m[1])).filter(Number.isFinite);
  const tooSmall = [...new Set(sizes.filter((s) => s < MIN_FONT_SIZE))].sort((a, b) => a - b);
  if (tooSmall.length > 0) {
    out.push(`${label}: font-size ${tooSmall.join(' / ')} が規範値 ${MIN_FONT_SIZE} 未満です（予防則9）`);
  }
  if (vbWidth && vbWidth > 780 && sizes.length > 0) {
    const min = Math.min(...sizes);
    const rendered = (min * FIGURE_WIDTH) / vbWidth;
    if (rendered < MIN_RENDERED) {
      out.push(
        `${label}: viewBox 幅 ${vbWidth} で font-size ${min} は実表示 ${rendered.toFixed(1)}px です` +
          `（予防則9。${MIN_RENDERED}px 以上にするか図を分割する）`
      );
    }
  }

  // 予防則10: 高い図は印刷でページごと送られ、直前に余白が出る
  if (vbHeight && vbHeight > MAX_VIEWBOX_HEIGHT) {
    out.push(`${label}: viewBox 高さ ${vbHeight} が推奨上限 ${MAX_VIEWBOX_HEIGHT} を超えます（予防則10。2枚に分ける）`);
  }

  return out;
}

// HTML 内の全 SVG を検査する。extractSvgs と同じ切り出し規則（入れ子は予防則6 で禁止）。
export function lintSvgs(html) {
  const svgs = html.match(/<svg[\s>][\s\S]*?<\/svg>/gi) || [];
  return svgs.flatMap((svg, i) => lintSvg(svg, `図${i + 1}`));
}
