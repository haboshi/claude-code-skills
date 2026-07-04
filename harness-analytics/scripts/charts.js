'use strict';
// 依存ゼロの inline SVG チャート関数群（純関数・テスト容易）。
// 数値を正確に描く（棒の長さ=実数値）。色は CSS 変数（--c-accent 等）でテーマ追従。
// build-report.js の <style> 側で変数を定義する前提。

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function trunc(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
const svgOpen = (w, h, stretch) => `<svg viewBox="0 0 ${w} ${h}" width="100%" style="height:auto${stretch ? '' : `;max-width:${w}px`}" role="img" xmlns="http://www.w3.org/2000/svg">`;
const round = (n) => Math.round(n * 100) / 100;

// 日本語向けの素朴な折り返し（空白に依存せず文字数で分割）
function wrapText(text, perLine, maxLines) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const lines = [];
  let i = 0;
  while (i < t.length && lines.length < maxLines) { lines.push(t.slice(i, i + perLine)); i += perLine; }
  if (i < t.length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.slice(0, Math.max(0, perLine - 1)) + '…';
  }
  return lines;
}

// 横棒ランキング。items: [{label, value, sub?, color?}]
// opts: { unit?:'$'|'%'|'', max?:number, valueFmt?:fn, labelWidth?:number }
function rankedBars(items, opts = {}) {
  const list = (items || []).slice(0, opts.limit || 8);
  if (!list.length) return placeholder('データなし');
  const W = 720, rowH = 30, padY = 8;
  const labelW = opts.labelWidth || 210;
  const valueW = 64;
  const barX = labelW + 8;
  const barMax = W - barX - valueW - 8;
  const max = opts.max != null ? opts.max : Math.max(...list.map((d) => d.value || 0), 1);
  const unit = opts.unit || '';
  const fmt = opts.valueFmt || ((v) => (unit === '$' ? '$' + Number(v).toFixed(2) : unit === '%' ? (v * 100).toFixed(1) + '%' : String(v)));
  const H = padY * 2 + list.length * rowH;
  let body = '';
  list.forEach((d, i) => {
    const y = padY + i * rowH;
    const cy = y + rowH / 2;
    const w = max > 0 ? Math.max(2, ((d.value || 0) / max) * barMax) : 2;
    const color = d.color || 'var(--c-accent)';
    body += `<text x="0" y="${cy + 4}" class="c-label">${escapeXml(trunc(d.label, 30))}</text>`;
    if (d.sub) body += `<text x="0" y="${cy + 15}" class="c-sub">${escapeXml(trunc(d.sub, 34))}</text>`;
    body += `<rect x="${barX}" y="${y + 6}" width="${barMax}" height="${rowH - 16}" rx="4" class="c-track"/>`;
    body += `<rect x="${barX}" y="${y + 6}" width="${round(w)}" height="${rowH - 16}" rx="4" class="bar" style="fill:${color}"/>`;
    body += `<text x="${W}" y="${cy + 4}" text-anchor="end" class="c-value">${escapeXml(fmt(d.value || 0))}</text>`;
  });
  return svgOpen(W, H) + body + '</svg>';
}

// 優先度マップ（散布＋バブル）。points: [{label, x, y, size, top?}]
// x=再発(件数), y=広がり(影響セッション), size=コスト影響。top=最優先を強調。
function priorityBubbles(points, opts = {}) {
  const pts = points || [];
  if (!pts.length) return placeholder('優先度マップ: 対象の失敗クラスターなし');
  const W = 720, H = 380;
  const mL = 54, mR = 24, mT = 20, mB = 48;
  const pw = W - mL - mR, ph = H - mT - mB;
  const maxX = opts.maxX != null ? opts.maxX : Math.max(...pts.map((p) => p.x || 0), 1);
  const maxY = opts.maxY != null ? opts.maxY : Math.max(...pts.map((p) => p.y || 0), 1);
  const maxSize = Math.max(...pts.map((p) => p.size || 0), 1);
  const sx = (v) => mL + (maxX > 0 ? (v / maxX) * pw : 0);
  const sy = (v) => mT + ph - (maxY > 0 ? (v / maxY) * ph : 0);
  const sr = (v) => 6 + Math.sqrt((v || 0) / maxSize) * 20;

  let grid = '';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const gx = mL + (pw * i) / ticks, gy = mT + (ph * i) / ticks;
    grid += `<line x1="${gx}" y1="${mT}" x2="${gx}" y2="${mT + ph}" class="c-grid"/>`;
    grid += `<line x1="${mL}" y1="${gy}" x2="${mL + pw}" y2="${gy}" class="c-grid"/>`;
    grid += `<text x="${gx}" y="${mT + ph + 16}" text-anchor="middle" class="c-tick">${Math.round((maxX * i) / ticks)}</text>`;
    grid += `<text x="${mL - 8}" y="${mT + ph - (ph * i) / ticks + 4}" text-anchor="end" class="c-tick">${Math.round((maxY * i) / ticks)}</text>`;
  }
  // 軸タイトル
  grid += `<text x="${mL + pw / 2}" y="${H - 6}" text-anchor="middle" class="c-axis">件数（再発の多さ）→</text>`;
  grid += `<text x="14" y="${mT + ph / 2}" text-anchor="middle" transform="rotate(-90 14 ${mT + ph / 2})" class="c-axis">影響セッション（広がり）↑</text>`;

  let bubbles = '';
  // top を最後に描いて前面に
  const ordered = [...pts].sort((a, b) => (a.top === b.top ? 0 : a.top ? 1 : -1));
  for (const p of ordered) {
    const cx = sx(p.x || 0), cy = sy(p.y || 0), r = sr(p.size || 0);
    const cls = p.top ? 'bubble bubble-top' : 'bubble';
    bubbles += `<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" class="${cls}"/>`;
    if (p.top) {
      const lx = Math.min(cx + r + 6, W - 150);
      bubbles += `<text x="${round(lx)}" y="${round(cy + 4)}" class="c-toplabel">${escapeXml(trunc(p.label, 24))}</text>`;
    }
  }
  return svgOpen(W, H) + grid + bubbles + '</svg>';
}

// スパークライン（トレンド）。series: number[]（時系列）。上昇=悪化想定で末尾ドットを色分け。
function sparkline(series) {
  const s = (series || []).filter((v) => typeof v === 'number' && isFinite(v));
  if (s.length < 2) return placeholder('トレンド: データ不足（2点以上必要）', 240, 56);
  const W = 260, H = 56, pad = 6;
  const min = Math.min(...s), max = Math.max(...s);
  const span = max - min || 1;
  const dx = (W - pad * 2) / (s.length - 1);
  const sy = (v) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const pointsAttr = s.map((v, i) => `${round(pad + i * dx)},${round(sy(v))}`).join(' ');
  const last = s[s.length - 1];
  const lastUp = last >= s[0];
  const dotColor = lastUp ? 'var(--c-crit)' : 'var(--c-good)'; // 上昇=悪化想定（friction/エラー）
  return svgOpen(W, H)
    + `<polyline points="${pointsAttr}" fill="none" class="spark" style="stroke:var(--c-accent)"/>`
    + `<circle cx="${round(pad + (s.length - 1) * dx)}" cy="${round(sy(last))}" r="3.5" style="fill:${dotColor}"/>`
    + '</svg>';
}

// ドーナツ（内訳）。parts: [{label, value, color}]
function donut(parts, opts = {}) {
  const list = (parts || []).filter((p) => (p.value || 0) > 0);
  const total = list.reduce((s, p) => s + (p.value || 0), 0);
  if (!total) return placeholder('内訳: データなし', 160, 160);
  const W = 160, H = 160, cx = 80, cy = 80, r = 56, sw = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  let arcs = '';
  for (const p of list) {
    const frac = (p.value || 0) / total;
    const len = frac * circ;
    arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" style="stroke:${p.color || 'var(--c-accent)'}" stroke-width="${sw}"`
      + ` stroke-dasharray="${round(len)} ${round(circ - len)}" stroke-dashoffset="${round(-offset)}"`
      + ` transform="rotate(-90 ${cx} ${cy})"/>`;
    offset += len;
  }
  const centerLabel = opts.centerLabel != null ? opts.centerLabel : String(total);
  const centerSub = opts.centerSub || '';
  arcs += `<text x="${cx}" y="${cy + 2}" text-anchor="middle" class="c-donut-v">${escapeXml(centerLabel)}</text>`;
  if (centerSub) arcs += `<text x="${cx}" y="${cy + 18}" text-anchor="middle" class="c-donut-k">${escapeXml(centerSub)}</text>`;
  return svgOpen(W, H) + arcs + '</svg>';
}

function placeholder(text, w = 720, h = 80) {
  return svgOpen(w, h) + `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="c-empty">${escapeXml(text)}</text>` + '</svg>';
}

// 「問題→改善」2パネル図（決定論・依存ゼロ）。左=起きている問題、右=こうなると良い、間に矢印。
function beforeAfterCard(problemText, fixText) {
  const W = 720, H = 200, pw = 320, gap = 80;
  const rx = W - pw;
  const perLine = 18, maxLines = 5, lineH = 20;
  const panel = (x, title, lines, color) => {
    let s = `<rect x="${x}" y="8" width="${pw}" height="${H - 16}" rx="10" class="ba-panel" style="stroke:${color}"/>`;
    s += `<text x="${x + 16}" y="34" class="ba-title" style="fill:${color}">${escapeXml(title)}</text>`;
    lines.forEach((ln, i) => { s += `<text x="${x + 16}" y="${62 + i * lineH}" class="ba-body">${escapeXml(ln)}</text>`; });
    return s;
  };
  const midY = H / 2;
  const arrow = `<g transform="translate(${pw + 8},${midY})">`
    + `<line x1="0" y1="0" x2="${gap - 18}" y2="0" class="ba-arrow"/>`
    + `<polygon points="${gap - 18},-6 ${gap - 4},0 ${gap - 18},6" class="ba-arrowhead"/></g>`;
  return svgOpen(W, H, true)
    + panel(0, '起きている問題', wrapText(problemText, perLine, maxLines), 'var(--c-crit)')
    + arrow
    + panel(rx, 'こうなると良い', wrapText(fixText, perLine, maxLines), 'var(--c-good)')
    + '</svg>';
}

module.exports = { rankedBars, priorityBubbles, sparkline, donut, beforeAfterCard, wrapText, escapeXml, trunc };
