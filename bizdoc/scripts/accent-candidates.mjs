// accent-candidates.mjs — プロジェクトのスタイル定義から accent の候補色を機械的に集める。
//
// 役割は「候補を絞ること」だけで、**1色に確定させることはしない**。実測（2026-08-31、社内5案件）で
// 変数名の優先度による自動選択は 3 件中 1 件しか人の選択と一致せず、和名の体系（--shu 朱 / --ai 藍 /
// --matcha 抹茶）を持つ案件では色相が 76.8° ずれた。一方、除外側は確実に効く — hover 用の
// `--accent: 243 244 246`（gray-100）や本文色 `--text-primary` は、ブランド色かどうかを判断する
// までもなくフィルタで落ちる。そこで「機械が候補を作り、人が選ぶ」に役割を割った。
// 最終的な採否は SKILL.md Phase 5 で人に尋ね、hub.mjs add --accent へ渡す。
//
// フィルタの根拠（tokens.css v0.9.0 の accent 用途から逆算）:
//   1. 彩度 — accent は「主役を指す色」。無彩色は指せない
//   2. 対白コントラスト — リンク・見出し番号・KPI 数値は白地に置かれる（WCAG AA 4.5:1）
//      加えて .card .tag と丸番号は accent 地に白抜きするため、同じ比が両用途を担保する
//   3. --warn との色相距離 — v0.9.0 が警告色を足した。tokens.css 自身が「テラコッタ 20.9°・
//      橙 14.0° は隣り合うと区別しづらい」と注記しており、実測でもテラコッタ accent では
//      「推奨」と「要検討」のバッジが判別できなくなった
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIN_SATURATION = 0.15;
export const MIN_CONTRAST = 4.5;
export const MIN_HUE_DISTANCE = 45;
const MAX_DEPTH = 4;
const DEFAULT_LIMIT = 6;

const TOKENS_CSS = fileURLToPath(new URL('../templates/tokens.css', import.meta.url));

// 探索するファイル名。実測で当たったもののみ（推測で広げない — 広げるほど vendor 配下の
// 同名ファイルを拾い、Laravel Ignition の tailwind.config.js のような無関係の色が混ざる）
const STYLE_FILES = new Set([
  'globals.css', 'tokens.css', 'theme.css', 'variables.css', 'design-tokens.css',
  'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs', 'tailwind.config.mjs',
]);

// 走査しないディレクトリ。vendor は実測で必要（reception で vendor/facade/ignition の
// tailwind.config.js を拾い、案件と無関係の色が候補に出た）
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'vendor', 'coverage',
  '.turbo', '.cache', 'tmp', 'target', '.venv', 'venv',
]);

// 本文色・意味色・地色は accent になり得ないので名前で落とす。値だけでは本文の黒
// （--ink / --text-primary / --foreground）がコントラスト最上位で残り続ける
const EXCLUDE_NAME = new RegExp(
  '(^|-)(' + [
    'ink', 'text', 'foreground', 'fg', 'body', 'heading', 'muted', 'placeholder',
    'border', 'line', 'ring', 'shadow', 'outline', 'divider',
    'bg', 'background', 'surface', 'card', 'popover', 'sidebar', 'input', 'overlay',
    'success', 'error', 'danger', 'warning', 'warn', 'info', 'destructive',
  ].join('|') + ')(-|$)', 'i');

// tailwind.config の色スケールは `700: '#15803d'` のように段数が名前になる。段数だけでは
// 何の色か分からないので、意味のある別名を1つも持たない色は候補から外す（実測: vegeexpress で
// --800 / --900 が primary の暗い版として別候補に並び、同系の緑が3つ出た）
const MEANINGLESS_NAME = /^\d+$/;

// 名前の優先度。低い数値が先。実測で --primary を持つ案件は人の選択と 3.9° まで一致したが、
// 持たない案件では当たらない。順序は「候補の並び」であって「自動採用」ではない
const NAME_RANK = [/(^|-)brand(-|$)/i, /(^|-)primary(-|$)/i, /(^|-)accent(-|$)/i, /(^|-)theme(-|$)/i];

function rankOf(names) {
  for (let i = 0; i < NAME_RANK.length; i++) {
    if (names.some((n) => NAME_RANK[i].test(n))) return i;
  }
  return NAME_RANK.length;
}

// ── 色の解釈 ─────────────────────────────
// CSS の色表記を #rrggbb へ正規化する。解釈できない表記（oklch・color-mix・var 参照）は
// null を返して黙って捨てる — 誤変換した色を候補に混ぜるより、取りこぼす方が安全
export function parseColor(input) {
  const v = String(input).trim().replace(/\s*!important$/i, '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return '#' + m[1].toLowerCase();
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return '#' + [...m[1]].map((c) => c + c).join('').toLowerCase();
  // スペース区切り RGB（Tailwind / shadcn の `--primary: 22 163 74`）
  m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(v);
  if (m) return fromBytes(m.slice(1, 4).map(Number));
  m = /^rgba?\(\s*(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})(?:[,/\s][^)]*)?\)$/i.exec(v);
  if (m) return fromBytes(m.slice(1, 4).map(Number));
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,/\s][^)]*)?\)$/i.exec(v);
  if (m) return fromHsl(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100);
  return null;
}

function fromBytes(n) {
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return '#' + n.map((x) => x.toString(16).padStart(2, '0')).join('');
}

function fromHsl(h, s, l) {
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp) % 6];
  const mm = l - c / 2;
  return fromBytes(seg.map((v) => Math.round((v + mm) * 255)));
}

function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

export function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function saturationOf(hex) {
  const [r, g, b] = toRgb(hex);
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

export function hueOf(hex) {
  const [r, g, b] = toRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

export function hueDistance(a, b) {
  const d = Math.abs(hueOf(a) - hueOf(b));
  return Math.min(d, 360 - d);
}

// tokens.css の --warn を正とする。値をここへ写すと、テンプレを直したとき判定だけ古いままになる
export function readWarnColor(tokensPath = TOKENS_CSS) {
  try {
    const m = /--warn:\s*([^;]+);/.exec(fs.readFileSync(tokensPath, 'utf8'));
    const hex = m && parseColor(m[1]);
    if (hex) return hex;
  } catch { /* テンプレが読めない環境では既定値へ落ちる */ }
  return '#c2740a';
}

// ── 抽出 ─────────────────────────────────
// CSS カスタムプロパティと、tailwind.config の `key: '#rrggbb'` 形の両方を拾う
export function extractVariables(text) {
  const out = [];
  for (const m of text.matchAll(/--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const hex = parseColor(m[2]);
    if (hex) out.push({ name: m[1], hex, raw: m[2].trim() });
  }
  for (const m of text.matchAll(/['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g)) {
    const hex = parseColor(m[2]);
    if (hex) out.push({ name: m[1], hex, raw: m[2] });
  }
  return out;
}

export function findStylesheets(rootDir, depth = MAX_DEPTH) {
  const found = [];
  const walk = (dir, left) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (left > 0 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), left - 1);
      } else if (e.isFile() && STYLE_FILES.has(e.name)) {
        found.push(path.join(dir, e.name));
      }
    }
  };
  walk(rootDir, depth);
  return found.sort();
}

// ── 本体 ─────────────────────────────────
export function collectAccentCandidates(rootDir, opts = {}) {
  const warn = opts.warn || readWarnColor();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const files = opts.files || findStylesheets(rootDir);
  const byHex = new Map();
  const rejected = { saturation: 0, contrast: 0, hue: 0, name: 0 };

  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const { name, hex, raw } of extractVariables(text)) {
      if (EXCLUDE_NAME.test(name)) { rejected.name++; continue; }
      if (saturationOf(hex) < MIN_SATURATION) { rejected.saturation++; continue; }
      if (contrastRatio(hex, '#ffffff') < MIN_CONTRAST) { rejected.contrast++; continue; }
      if (hueDistance(hex, warn) < MIN_HUE_DISTANCE) { rejected.hue++; continue; }
      const cur = byHex.get(hex);
      if (cur) {
        if (!cur.names.includes(name)) cur.names.push(name);
        if (!cur.sources.includes(file)) cur.sources.push(file);
      } else {
        byHex.set(hex, { hex, names: [name], sources: [file], raw });
      }
    }
  }

  const candidates = [...byHex.values()]
    .filter((c) => {
      const meaningful = c.names.filter((n) => !MEANINGLESS_NAME.test(n));
      if (meaningful.length === 0) { rejected.name++; return false; }
      c.names = meaningful;
      return true;
    })
    .map((c) => ({
    hex: c.hex,
    names: c.names,
    sources: c.sources.map((f) => path.relative(rootDir, f) || path.basename(f)),
    contrast: Number(contrastRatio(c.hex, '#ffffff').toFixed(2)),
    hueDistance: Math.round(hueDistance(c.hex, warn)),
    saturation: Number(saturationOf(c.hex).toFixed(2)),
    rank: rankOf(c.names),
  }));
  // 名前の格 → 彩度の高い順。accent は主張する色なので、同格なら鮮やかな方を上に置く
  candidates.sort((a, b) => a.rank - b.rank || b.saturation - a.saturation || a.hex.localeCompare(b.hex));
  return { candidates: candidates.slice(0, limit), scanned: files.length, warn, rejected };
}

// ── CLI ──────────────────────────────────
// 使い方: node accent-candidates.mjs <プロジェクトルート> [--json] [--limit N]
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('-')) || process.cwd();
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : DEFAULT_LIMIT;
  const root = path.resolve(dir);
  if (!fs.existsSync(root)) {
    console.error(`ディレクトリがありません: ${root}`);
    process.exit(1);
  }
  const result = collectAccentCandidates(root, { limit });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.candidates.length === 0) {
    console.log(`候補なし（走査 ${result.scanned} ファイル）— 既定色のままにするか、色を指定して尋ねる`);
  } else {
    console.log(`accent 候補 ${result.candidates.length} 件（走査 ${result.scanned} ファイル / warn=${result.warn}）`);
    for (const c of result.candidates) {
      console.log(`  ${c.hex}  対白 ${c.contrast}:1 / warn ${c.hueDistance}° / 彩度 ${c.saturation}`);
      console.log(`      ${c.names.map((n) => '--' + n).join(', ')}  [${c.sources[0]}]`);
    }
  }
}
