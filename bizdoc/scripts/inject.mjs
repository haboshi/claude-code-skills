// inject.mjs — 保存済みドキュメントへの「導出領域」注入
//
// SSOT 意味論の補足（hub.mjs のヘッダと対で読むこと）:
//   projects/**/docs/**/index.html は SSOT ファイルだが、その中の 2 つのマーカー区間だけは
//   **導出領域**として hub 側が書き換える。マーカーの外には決して触れない。
//     - <style data-bizdoc="tokens"> ... </style>   ... tokens.css の注入先（add 時のみ）
//     - <!-- bizdoc:nav:start --> ... <!-- bizdoc:nav:end --> ... 一覧への導線（add で枠、reindex で中身）
//   マーカーを持たない文書（既存文書・外部からの取込品）は素通りする（1 バイトも変えない）。
//
// 注入後も文書は自己完結の 1 枚 HTML のまま（外部参照を作らない）。nav は hub 配下に
// 置かれているときだけ表示され、メール添付などで持ち出されたコピーでは自動的に消える。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKENS_RE = /(<style\b[^>]*\bdata-bizdoc=["']tokens["'][^>]*>)([\s\S]*?)(<\/style>)/i;
const NAV_START = '<!-- bizdoc:nav:start -->';
const NAV_END = '<!-- bizdoc:nav:end -->';
const NAV_RE = /<!-- bizdoc:nav:start -->[\s\S]*?<!-- bizdoc:nav:end -->/;
const BODY_RE = /<body\b[^>]*>/i;

// 一覧に載せる sibling の上限。超えた分は「一覧で見る」へ送る
export const NAV_SIBLING_LIMIT = 8;

export function tokensCssPath() {
  return fileURLToPath(new URL('../templates/tokens.css', import.meta.url));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// インライン <script> へ値を埋めるためのリテラル化。HTML エスケープ（escapeHtml）は
// JS 文字列文脈を守らないため、必ずこちらを使う。`<` を \u003c にするのは、値に
// `</script>` が含まれたときにパーサが script を閉じてしまうのを防ぐため
// （文書はメール添付で外部へ配布されるので、受信者側での任意 JS 実行につながる）。
export function jsLiteral(value) {
  return JSON.stringify(String(value)).replace(/</g, '\\u003c');
}

// accent（#rrggbb）を白で薄めた面色を決定論的に作る。CSS color-mix() に頼らず
// ビルド時に計算する（古い環境でも確実に出るうえ、テストで固定できる）。
export function blendWithWhite(hex, ratio = 0.08) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.round(255 - ratio * (255 - v)))
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'));
  return '#' + ch.join('');
}

// <style data-bizdoc="tokens"> の中身を tokens.css で全置換する。
// マーカーが無ければ入力をそのまま返す（既存文書・取込品を壊さない）。
export function injectTokens(html, css, accent) {
  if (!TOKENS_RE.test(html)) return html;
  let body = css;
  if (accent && /^#[0-9a-f]{6}$/i.test(accent.trim())) {
    const a = accent.trim().toLowerCase();
    const soft = blendWithWhite(a);
    body = body
      .replace(/(--accent:\s*)#[0-9a-fA-F]{3,8}(\s*;)/, `$1${a}$2`)
      .replace(/(--accent-soft:\s*)#[0-9a-fA-F]{3,8}(\s*;)/, `$1${soft}$2`);
  }
  // 置換値に含まれる $ をリテラル扱いにする（$& 等の特殊扱いを避ける）
  return html.replace(TOKENS_RE, (_m, open, _old, close) => open + '\n' + body + close);
}

// <body> 直後に空のマーカー対を挿す。既にあれば何もしない。
// <body> を持たない HTML（取込品の断片など）は注入せず、呼び出し側に false を返す。
export function injectNavFrame(html) {
  if (NAV_RE.test(html)) return { html, injected: true };
  const m = BODY_RE.exec(html);
  if (!m) return { html, injected: false };
  const at = m.index + m[0].length;
  return { html: html.slice(0, at) + '\n' + NAV_START + NAV_END + html.slice(at), injected: true };
}

export function hasNavFrame(html) {
  return NAV_RE.test(html);
}

// nav の中身を描く。時刻・乱数を含めない（同じ入力なら同じバイト列になる）。
export function renderNav({ projectId, label, docs, selfDir }) {
  const siblings = (docs || [])
    .filter((d) => d.dir !== selfDir && !d.broken)
    .slice()
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a.dir.localeCompare(b.dir));
  const shown = siblings.slice(0, NAV_SIBLING_LIMIT);
  const rest = siblings.length - shown.length;
  const hubHref = `../../../../index.html#p-${projectId}`;

  const items = shown
    .map((d) => `      <li><a href="../${escapeHtml(d.dir)}/index.html">${escapeHtml(d.title || d.dir)}</a></li>`)
    .join('\n');
  const more = rest > 0
    ? `\n      <li><a href="${escapeHtml(hubHref)}">…他 ${rest} 件を一覧で見る</a></li>`
    : '';
  const details = siblings.length
    ? `
    <details class="bizdoc-hubnav-more">
      <summary>同じプロジェクトの資料（${siblings.length}）</summary>
      <ul>
${items}${more}
      </ul>
    </details>`
    : '';

  // display を付けるクラスは UA の [hidden]{display:none} に勝ってしまうため、
  // [hidden] 側を !important で必ず併記する（これが無いと持ち出しコピーで nav が消えない）
  return `${NAV_START}
<style>
.bizdoc-hubnav{display:flex;gap:.5rem 1rem;align-items:center;flex-wrap:wrap;margin:0 0 1.6rem;padding:.5rem .8rem;border:1px solid var(--line,#e5e7eb);border-radius:8px;background:var(--bg-soft,#f4f6fa);font-size:13px;line-height:1.6}
.bizdoc-hubnav[hidden]{display:none!important}
.bizdoc-hubnav a{color:var(--accent,#2563eb);text-decoration:none}
.bizdoc-hubnav a:hover{text-decoration:underline}
.bizdoc-hubnav-proj{color:var(--ink-2,#4b5563)}
.bizdoc-hubnav-more{margin-left:auto}
.bizdoc-hubnav-more summary{cursor:pointer;color:var(--ink-2,#4b5563)}
.bizdoc-hubnav-more ul{margin:.4rem 0 .2rem;padding-left:1.1rem}
.bizdoc-hubnav-more li{margin:.15rem 0}
@media print{.bizdoc-hubnav{display:none!important}}
</style>
<nav class="bizdoc-hubnav" hidden aria-label="doc-hub">
  <a href="${escapeHtml(hubHref)}">← doc-hub 一覧</a>
  <span class="bizdoc-hubnav-proj">${escapeHtml(label || projectId)}</span>${details}
</nav>
<script>(function(){var n=document.querySelector('.bizdoc-hubnav');var p=${jsLiteral(projectId)};if(n&&decodeURIComponent(location.pathname).indexOf('/projects/'+p+'/docs/')>=0)n.hidden=false;})();</script>
${NAV_END}`;
}

// マーカー対の中身を貼り直す。マーカーが無ければ入力をそのまま返す。
export function refreshNav(html, navHtml) {
  if (!NAV_RE.test(html)) return html;
  return html.replace(NAV_RE, () => navHtml);
}

// 1 ドキュメントの nav を最新化し、バイト列が変わるときだけ書き込む。
// 戻り値: 'written' | 'unchanged' | 'skipped'（マーカーなし）
export function refreshNavFile(indexPath, navArgs) {
  let html;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return 'skipped';
  }
  if (!NAV_RE.test(html)) return 'skipped';
  const next = refreshNav(html, renderNav(navArgs));
  if (next === html) return 'unchanged';
  const tmp = path.join(path.dirname(indexPath), `.nav-${process.pid}.tmp`);
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, indexPath);
  return 'written';
}

export function readTokensCss() {
  return fs.readFileSync(tokensCssPath(), 'utf8');
}
