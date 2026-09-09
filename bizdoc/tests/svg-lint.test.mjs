// v0.12.1 (2026-09-09): 図の予防則の決定論チェック。
// 背景: SKILL.md §7 は「埋め込む前に必ず svg-patterns/README.md を Read する」と定めるが、
// 守られたかを確かめる手段が無く、読まずに書いた図が予防則 3・4・5・9 を同時に外して保存された。
// このテストは (1) 違反を検出すること (2) 正典パターンの書き方を誤検出しないこと の両方を固定する。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintSvg, lintSvgs } from '../scripts/svg-lint.mjs';

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// 正典パターンの書き方に沿った合格例
const GOOD = `<svg viewBox="0 0 780 300" role="img"><title>合格例</title>
  <rect x="0" y="0" width="100" height="40" fill="var(--bg-soft)" stroke="var(--line)"/>
  <text x="10" y="20" font-size="15" fill="var(--ink)">ラベル 3件</text>
  <text x="10" y="40" font-size="14.5" fill="var(--ink)">副ラベル 2件</text>
  <circle cx="5" cy="5" r="2" fill="#ffffff"/></svg>`;

test('合格例: 正典パターンの書き方は 1 件も警告しない', () => {
  assert.deepEqual(lintSvg(GOOD, '図1'), []);
});

test('予防則3: <title> と role="img" の欠落を検出する', () => {
  const svg = '<svg viewBox="0 0 780 300"><text font-size="15" fill="var(--ink)">x</text></svg>';
  const out = lintSvg(svg, '図1');
  assert.ok(out.some((m) => /<title> がありません/.test(m)), out.join('\n'));
  assert.ok(out.some((m) => /role="img" がありません/.test(m)), out.join('\n'));
});

test('予防則2: ルート要素の width / height 直書きを検出し、100% は許す', () => {
  const bad = '<svg viewBox="0 0 780 300" width="780" height="300" role="img"><title>t</title></svg>';
  assert.ok(lintSvg(bad).some((m) => /width="780"/.test(m)));
  assert.ok(lintSvg(bad).some((m) => /height="300"/.test(m)));
  const ok = '<svg viewBox="0 0 780 300" width="100%" role="img"><title>t</title></svg>';
  assert.deepEqual(lintSvg(ok), []);
});

test('予防則4: font-family の指定を検出する', () => {
  const svg = '<svg viewBox="0 0 780 300" role="img"><title>t</title><text font-family="Helvetica" font-size="15" fill="var(--ink)">x</text></svg>';
  assert.ok(lintSvg(svg).some((m) => /font-family/.test(m)));
});

test('予防則5: 色リテラルを検出し、白と none と var() は許す', () => {
  const bad = '<svg viewBox="0 0 780 300" role="img"><title>t</title><rect fill="#f4f6fa" stroke="#d1d5db"/></svg>';
  const out = lintSvg(bad);
  assert.ok(out.some((m) => /色リテラル 2種/.test(m)), out.join('\n'));
  const ok = '<svg viewBox="0 0 780 300" role="img"><title>t</title><rect fill="#ffffff" stroke="none"/><rect fill="var(--accent)"/></svg>';
  assert.deepEqual(lintSvg(ok), []);
});

test('予防則9: font-size 14.5 未満と、viewBox 幅からの実表示不足を検出する', () => {
  const small = '<svg viewBox="0 0 780 300" role="img"><title>t</title><text font-size="13" fill="var(--ink)">x</text></svg>';
  assert.ok(lintSvg(small).some((m) => /規範値 14.5 未満/.test(m)));

  // 幅 1400・font-size 15 → 15 × 918 ÷ 1400 ≈ 9.8px（README.md の実例）
  const wide = '<svg viewBox="0 0 1400 300" role="img"><title>t</title><text font-size="15" fill="var(--ink)">x</text></svg>';
  assert.ok(lintSvg(wide).some((m) => /実表示 9\.8px/.test(m)), lintSvg(wide).join('\n'));

  // 幅 780 以下は基準幅で合格（14.5 × 918 ÷ 780 ≈ 17.1px）
  assert.deepEqual(lintSvg(GOOD), []);
});

test('予防則10: viewBox 高さが 500 を超えたら警告する', () => {
  const tall = '<svg viewBox="0 0 780 600" role="img"><title>t</title><text font-size="15" fill="var(--ink)">x</text></svg>';
  assert.ok(lintSvg(tall).some((m) => /高さ 600/.test(m)));
});

test('marker の viewBox をルートと取り違えない', () => {
  const svg = `<svg viewBox="0 0 780 300" role="img"><title>t</title>
    <defs><marker id="a" viewBox="0 0 10 10"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink)"/></marker></defs>
    <text font-size="15" fill="var(--ink)">x</text></svg>`;
  assert.deepEqual(lintSvg(svg), []);
});

test('lintSvgs: 文書内の各図に 図N のラベルを付ける', () => {
  const html = `<title>x</title>${GOOD}<svg viewBox="0 0 780 300"><text font-size="15" fill="var(--ink)">y</text></svg>`;
  const out = lintSvgs(html);
  assert.ok(out.every((m) => m.startsWith('図2')), out.join('\n'));
});

test('正典パターン: svg-patterns/*.md の作例を誤検出しない', () => {
  const dir = p('../templates/svg-patterns');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md')) {
    // 作例は ```html フェンス内にあり、図の高さは題材ごとに違う（予防則10 は推奨なので対象外）
    const msgs = lintSvgs(fs.readFileSync(path.join(dir, f), 'utf8')).filter((m) => !/高さ/.test(m));
    if (msgs.length) offenders.push(`${f}: ${msgs.join(' / ')}`);
  }
  assert.deepEqual(offenders, [], `正典パターンを誤検出している:\n${offenders.join('\n')}`);
});
