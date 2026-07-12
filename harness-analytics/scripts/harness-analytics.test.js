'use strict';
// harness-analytics 純関数のテスト（依存ゼロ・node scripts/harness-analytics.test.js で実行）。
const assert = require('assert');
const { classifyToolResult, detectRetries, detectDrift, detectHallucinationMarkers } = require('./classify');
const { digestFromRecords } = require('./digest');
const { buildClusters, attachTrend } = require('./cluster');
const { computeKpis } = require('./rollup');
const { costUsd } = require('./pricing');
const { rankedBars, priorityBubbles, sparkline, donut, beforeAfterCard, wrapText } = require('./charts');
const { prioritize, scoreOf, clusterDetailBlock } = require('./build-report');
const { clusterImageFacts, cacheKey } = require('./infographic');
const { shouldRefresh } = require('./ingest');

let passed = 0;
function test(name, fn) { fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }

// --- classify ---
test('classifyToolResult: file_not_read', () => {
  assert.strictEqual(classifyToolResult('Edit', 'Error: File has not been read yet. Read it first.', true), 'file_not_read');
});
test('classifyToolResult: edit_no_match', () => {
  assert.strictEqual(classifyToolResult('Edit', 'The old_string was not found in the file', true), 'edit_no_match');
});
test('classifyToolResult: permission_denied', () => {
  assert.strictEqual(classifyToolResult('Bash', 'permission denied', true), 'permission_denied');
});
test('classifyToolResult: not_found beats command_failed', () => {
  assert.strictEqual(classifyToolResult('Bash', 'bash: foo: command not found (exit code 127)', true), 'not_found');
});
test('classifyToolResult: is_error=false → null', () => {
  assert.strictEqual(classifyToolResult('Read', 'ok', false), null);
});
test('classifyToolResult: unknown error → other', () => {
  assert.strictEqual(classifyToolResult('X', 'something weird happened', true), 'other');
});
test('classifyToolResult: guard_block（フック BLOCKED は防御成功）', () => {
  assert.strictEqual(classifyToolResult('Bash', '[Hook] BLOCKED (git-commit-gate): [skip-gate] に理由がありません', true), 'guard_block');
  assert.strictEqual(classifyToolResult('Bash', 'denied by the auto mode classifier. Reason: [Create Unsafe Agents]', true), 'guard_block');
});
test('classifyToolResult: guard_block は「Blocked: sleep」を横取りしない（permission_denied 維持）', () => {
  assert.strictEqual(classifyToolResult('Bash', 'Blocked: sleep 45 followed by: tail -8 run.log', true), 'permission_denied');
});
test('classifyToolResult: sandbox 外アクセスは permission_denied 維持', () => {
  assert.strictEqual(classifyToolResult('Bash', "ls was blocked. may only list files in '~/.claude'.", true), 'permission_denied');
});
test('classifyToolResult: no_op（old==new は Edit 系のみ）', () => {
  assert.strictEqual(classifyToolResult('Edit', 'No changes to make: old_string and new_string are exactly the same.', true), 'no_op');
});
test('classifyToolResult: stale_read（File modified since read は Edit 系のみ）', () => {
  assert.strictEqual(classifyToolResult('Edit', 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.', true), 'stale_read');
});
test('classifyToolResult: Edit 固有ワードは非 Edit ツールに適用しない', () => {
  assert.strictEqual(classifyToolResult('Bash', 'no changes to make', true), 'other');
});

// --- detectHallucinationMarkers（R8 混線検出）---
test('detectHallucinationMarkers: 高精度マーカー単独で suspected', () => {
  assert.strictEqual(detectHallucinationMarkers('<result>\n<name>Read</name>').suspected, true);
  assert.strictEqual(detectHallucinationMarkers('"tool_use_id": "abc"').suspected, true);
});
test('detectHallucinationMarkers: 通常散文は非検出', () => {
  assert.strictEqual(detectHallucinationMarkers('普通の説明文です。ツールを実行しました。').suspected, false);
});
test('detectHallucinationMarkers: 低精度マーカーは単独でも複数でも suspected にしない（オーサリング誤検知回避）', () => {
  // <invoke>/<parameter name=> は skill/agent 定義を書く正当なテキストと区別できないため高精度のみで判定
  assert.strictEqual(detectHallucinationMarkers('<invoke だけの言及').suspected, false);
  assert.strictEqual(detectHallucinationMarkers('<invoke name="x"> と <parameter name="y">').suspected, false);
  // 低精度でも markers 自体は診断用に記録される
  assert.deepStrictEqual(detectHallucinationMarkers('<invoke name="x"> と <parameter name="y">').markers, ['invoke_tag', 'parameter_tag']);
});

// --- detectRetries ---
test('detectRetries: 3 連続同一失敗を1件に', () => {
  const events = [
    { tool: 'Edit', target: 'a.ts', isError: true, turnIdx: 1 },
    { tool: 'Edit', target: 'a.ts', isError: true, turnIdx: 1 },
    { tool: 'Edit', target: 'a.ts', isError: true, turnIdx: 2 },
  ];
  const r = detectRetries(events);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].attempts, 3);
  assert.strictEqual(r[0].tool, 'Edit');
});
test('detectRetries: 成功で連鎖リセット', () => {
  const events = [
    { tool: 'Bash', target: 'x', isError: true, turnIdx: 1 },
    { tool: 'Bash', target: 'x', isError: false, turnIdx: 1 },
    { tool: 'Bash', target: 'x', isError: true, turnIdx: 2 },
  ];
  assert.strictEqual(detectRetries(events).length, 0);
});

// --- detectDrift ---
test('detectDrift: 同一ファイル反復 Read', () => {
  const ev = [];
  for (let i = 0; i < 5; i++) ev.push({ tool: 'Read', target: 'f.ts', turnIdx: 0 });
  const s = detectDrift(ev);
  assert.ok(s.some((x) => x.kind === 'repeated_read_same_file' && x.count === 5));
});

// --- pricing ---
test('costUsd: opus 概算', () => {
  const c = costUsd({ input: 1e6, output: 0, cache_read: 0, cache_creation: 0 }, 'claude-opus-4-8');
  assert.strictEqual(Math.round(c), 15);
});

// --- digest（合成レコード）---
function synthRecords() {
  return [
    { type: 'user', isMeta: false, isSidechain: false, sessionId: 'S1', cwd: '/Users/tester/proj', gitBranch: 'main', version: '2.0', entrypoint: 'cli', timestamp: '2026-07-04T00:00:00Z', message: { role: 'user', content: 'やってください' } },
    { type: 'assistant', isSidechain: false, sessionId: 'S1', attributionSkill: 'my-skill', timestamp: '2026-07-04T00:00:05Z', message: { model: 'claude-opus-4-8', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }, content: [
      { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'a.ts', old_string: 'x' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'echo hi' } },
    ] } },
    { type: 'user', isMeta: true, isSidechain: false, sessionId: 'S1', timestamp: '2026-07-04T00:00:06Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'File has not been read yet. token sk-ant-ABCDEFGHIJKLMNOP' },
      { type: 'tool_result', tool_use_id: 't2', is_error: false, content: 'hi' },
    ] } },
  ];
}
test('digestFromRecords: 基本集計', () => {
  const d = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  assert.strictEqual(d.session_id, 'S1');
  assert.strictEqual(d.turns.user_prompts, 1);          // isMeta は除外
  assert.strictEqual(d.turns.assistant_steps, 1);
  assert.strictEqual(d.tools.Edit.count, 1);
  assert.strictEqual(d.tools.Edit.errors, 1);
  assert.strictEqual(d.tools.Bash.errors, 0);
  assert.strictEqual(d.tokens.input, 1000);
  assert.ok(d.cost_usd > 0);
  assert.deepStrictEqual(d.invoked.skills, ['my-skill']);
  assert.strictEqual(d.failure_signals.tool_errors.length, 1);
  assert.strictEqual(d.failure_signals.tool_errors[0].error_class, 'file_not_read');
});
test('digestFromRecords: secret がマスクされ raw を保存しない', () => {
  const d = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  const prev = d.failure_signals.tool_errors[0].preview_masked;
  assert.ok(!/sk-ant-ABCDEFGHIJKLMNOP/.test(prev), 'secret がマスクされていない');
  assert.ok(!('raw' in d.failure_signals.tool_errors[0]), 'raw を既定で保存している');
});
test('digestFromRecords: verdict/scores を nullable 予約', () => {
  const d = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  assert.strictEqual(d.verdict, null);
  assert.strictEqual(d.scores.coverage, null);
});
test('digestFromRecords: 既存 synth に新シグナルは立たない（回帰）', () => {
  const d = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  assert.strictEqual(d.failure_signals.orphaned_tool_use.length, 0);         // t2 が last・結果あり
  assert.strictEqual(d.failure_signals.suspected_hallucinations.length, 0);
});
test('digestFromRecords: orphaned tool_use（結果なし・最後でない）を計上', () => {
  const recs = [
    { type: 'user', sessionId: 'O1', cwd: '/x', timestamp: '2026-07-04T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: 'O1', timestamp: '2026-07-04T00:00:01Z', message: { model: 'claude-opus-4-8', content: [
      { type: 'tool_use', id: 'a1', name: 'Bash', input: { command: 'echo 1' } },  // 結果なし・最後でない → orphan
      { type: 'tool_use', id: 'a2', name: 'Read', input: { file_path: 'x.ts' } },  // 結果あり・最後
    ] } },
    { type: 'user', isMeta: true, sessionId: 'O1', timestamp: '2026-07-04T00:00:02Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a2', is_error: false, content: 'ok' },
    ] } },
  ];
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/O1.jsonl' });
  assert.strictEqual(d.failure_signals.orphaned_tool_use.length, 1);
  assert.strictEqual(d.failure_signals.orphaned_tool_use[0].tool, 'Bash');
});
test('digestFromRecords: 最後の tool_use は in-flight として orphan 除外', () => {
  const recs = [
    { type: 'user', sessionId: 'O2', cwd: '/x', timestamp: '2026-07-04T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: 'O2', timestamp: '2026-07-04T00:00:01Z', message: { model: 'claude-opus-4-8', content: [
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'echo 1' } },  // 唯一＝最後 → 除外
    ] } },
  ];
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/O2.jsonl' });
  assert.strictEqual(d.failure_signals.orphaned_tool_use.length, 0);
});
test('digestFromRecords: array 形式 content の割り込みも計上', () => {
  const recs = [
    { type: 'user', sessionId: 'I1', cwd: '/x', timestamp: '2026-07-04T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'user', sessionId: 'I1', timestamp: '2026-07-04T00:00:02Z', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  ];
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/I1.jsonl' });
  assert.strictEqual(d.interruptions, 1);
});
test('digestFromRecords: assistant テキストの作話痕跡を計上', () => {
  const recs = [
    { type: 'user', sessionId: 'H1', cwd: '/x', timestamp: '2026-07-04T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: 'H1', timestamp: '2026-07-04T00:00:01Z', message: { model: 'claude-opus-4-8', content: [
      { type: 'text', text: '<result>\n<name>Read</name> ...捏造された結果...' },
    ] } },
  ];
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/H1.jsonl' });
  assert.strictEqual(d.failure_signals.suspected_hallucinations.length, 1);
  assert.strictEqual(d.failure_signals.suspected_hallucinations[0].where, 'assistant_text');
});

// --- cluster / rollup ---
function twoDigests() {
  const base = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  const other = JSON.parse(JSON.stringify(base));
  other.session_id = 'S2'; other.digest_id = 'S2';
  return [base, other];
}
test('buildClusters: error_class×tool でグルーピング＋remediation', () => {
  const clusters = buildClusters(twoDigests());
  const c = clusters.find((x) => x.cluster_id === 'file_not_read-Edit');
  assert.ok(c, 'file_not_read-Edit クラスターが無い');
  assert.strictEqual(c.count, 2);
  assert.strictEqual(c.affected_sessions, 2);
  assert.ok(/Read/.test(c.suggested_fix));
});
test('attachTrend: 前回比較', () => {
  const clusters = buildClusters(twoDigests());
  const prev = { clusters: [{ cluster_id: 'file_not_read-Edit', count: 1 }] };
  attachTrend(clusters, prev);
  assert.strictEqual(clusters.find((x) => x.cluster_id === 'file_not_read-Edit').trend, 'up');
});
test('computeKpis: 集計', () => {
  const k = computeKpis(twoDigests());
  assert.strictEqual(k.sessions, 2);
  assert.strictEqual(k.by_tool.Edit.errors, 2);
  assert.ok(k.avg_friction > 0);
});
test('computeKpis: ハーネス健全性（打ち切り/作話）の総数を集計', () => {
  const base = { tools: {}, cost_usd: 0, friction_score: 0, turns: { compactions: 0 } };
  const d1 = { ...base, failure_signals: { orphaned_tool_use: [{ tool: 'Bash' }], suspected_hallucinations: [] } };
  const d2 = { ...base, failure_signals: { orphaned_tool_use: [{ tool: 'Read' }, { tool: 'Read' }], suspected_hallucinations: [{ where: 'tool_result' }] } };
  const k = computeKpis([d1, d2]);
  assert.strictEqual(k.orphaned_total, 3);
  assert.strictEqual(k.orphaned_sessions, 2);
  assert.strictEqual(k.hallucination_total, 1);
  assert.strictEqual(k.hallucination_sessions, 1);
});

// --- charts（SVG 出力）---
const countMatches = (s, re) => (s.match(re) || []).length;
test('rankedBars: バー本数=item数・SVG', () => {
  const svg = rankedBars([{ label: 'a', value: 3 }, { label: 'b', value: 6 }]);
  assert.ok(svg.startsWith('<svg'));
  assert.strictEqual(countMatches(svg, /class="bar"/g), 2);
});
test('rankedBars: 空データはプレースホルダ', () => {
  assert.ok(/データなし/.test(rankedBars([])));
});
test('rankedBars: 最大値のバーが最長（スケール）', () => {
  // width は class="bar" の rect にのみ style="fill" が付く。100 の行の width > 10 の行の width。
  const svg = rankedBars([{ label: 'big', value: 100 }, { label: 'small', value: 10 }]);
  const widths = [...svg.matchAll(/width="([\d.]+)"[^>]*class="bar"/g)].map((m) => parseFloat(m[1]));
  assert.strictEqual(widths.length, 2);
  assert.ok(widths[0] > widths[1], '大きい値のバーが長いこと');
});
test('priorityBubbles: バブル数=点数', () => {
  const svg = priorityBubbles([{ label: 'a', x: 5, y: 2, size: 1, top: true }, { label: 'b', x: 1, y: 1, size: 0 }]);
  assert.strictEqual(countMatches(svg, /class="bubble/g), 2); // bubble と bubble-top 両方にマッチ
  assert.ok(/bubble-top/.test(svg));
});
test('priorityBubbles: 空はプレースホルダ', () => {
  assert.ok(/対象の失敗クラスターなし/.test(priorityBubbles([])));
});
test('sparkline: 2点未満は不足表示 / 2点以上は polyline', () => {
  assert.ok(/データ不足/.test(sparkline([1])));
  assert.ok(/<polyline/.test(sparkline([1, 2, 3])));
});
test('donut: parts から circle 生成', () => {
  const svg = donut([{ label: 'x', value: 3, color: 'red' }, { label: 'y', value: 1, color: 'green' }]);
  assert.ok(/<circle/.test(svg));
});

// --- prioritize / scoreOf ---
test('scoreOf: 件数×影響セッション', () => {
  assert.strictEqual(scoreOf({ count: 3, affected_sessions: 5 }), 15);
});
test('prioritize: is_defense を除外し最高スコアを hero に', () => {
  const cs = [
    { error_class: 'a', tool: 'X', count: 10, affected_sessions: 1, cost_impact_usd: 0, is_defense: false }, // 10
    { error_class: 'b', tool: 'Y', count: 3, affected_sessions: 5, cost_impact_usd: 0, is_defense: false },  // 15 → hero
    { error_class: 'guard_block', tool: 'Bash', count: 100, affected_sessions: 9, is_defense: true },         // 除外
  ];
  const { problems, defenses, hero } = prioritize(cs);
  assert.strictEqual(problems.length, 2);
  assert.strictEqual(defenses.length, 1);
  assert.strictEqual(hero.error_class, 'b');
});
test('prioritize: LLM priority が hero を上書き', () => {
  const cs = [
    { error_class: 'a', tool: 'X', count: 100, affected_sessions: 10, is_defense: false },                   // score 1000
    { error_class: 'b', tool: 'Y', count: 1, affected_sessions: 1, is_defense: false, llm: { priority: 0 } }, // LLM 最優先
  ];
  assert.strictEqual(prioritize(cs).hero.error_class, 'b');
});

// --- beforeAfterCard / wrapText / clusterDetailBlock ---
test('wrapText: 文字数で折り返し・maxLines で切り詰め', () => {
  const l = wrapText('あ'.repeat(50), 10, 3);
  assert.strictEqual(l.length, 3);
  assert.ok(l[2].endsWith('…'));
});
test('beforeAfterCard: 2パネル＋矢印', () => {
  const svg = beforeAfterCard('問題の説明', '改善の説明');
  assert.ok(svg.startsWith('<svg'));
  assert.strictEqual((svg.match(/class="ba-panel"/g) || []).length, 2);
  assert.ok(/ba-arrowhead/.test(svg));
});
test('clusterDetailBlock: LLMありで proposed_edit を表示・エスケープ', () => {
  const c = { cluster_id: 'x-Y', error_class: 'x', tool: 'Y', count: 3, affected_sessions: 2, cost_impact_usd: 1,
    suggested_fix: '直す', target_surface: 'CLAUDE.md', examples: [{ preview: '<script>alert(1)</script>' }],
    llm: { root_cause: '根因', proposed_edit: 'a < b & c', target_files: ['CLAUDE.md'], confidence: 0.8 } };
  const h = clusterDetailBlock(c, 0, {});
  assert.ok(/提案編集/.test(h));
  assert.ok(/a &lt; b &amp; c/.test(h), 'proposed_edit がエスケープされている');
  assert.ok(!/<script>alert/.test(h), 'example がエスケープされている');
  assert.ok(/ba-panel/.test(h), '画像なしなので before-after SVG フォールバック');
});
test('clusterDetailBlock: 画像インデックスありで img 埋め込み', () => {
  const c = { cluster_id: 'x-Y', error_class: 'x', tool: 'Y', count: 3, affected_sessions: 2, cost_impact_usd: 1, suggested_fix: '直す', target_surface: 'X', examples: [] };
  const h = clusterDetailBlock(c, 0, { 'x-Y': { hash: 'abc123' } });
  assert.ok(/infographics\/abc123\/image\.jpg/.test(h));
});

// --- infographic キャッシュキー ---
test('cacheKey: 数値(count/cost)が変わっても hash 不変', () => {
  const base = { error_class: 'x', tool: 'Y', count: 5, affected_sessions: 3, cost_impact_usd: 1, suggested_fix: '直す', target_surface: 'CLAUDE.md', llm: null };
  const bumped = { ...base, count: 999, affected_sessions: 100, cost_impact_usd: 50, trend: 'up' };
  assert.strictEqual(cacheKey(clusterImageFacts(base)), cacheKey(clusterImageFacts(bumped)));
});
test('cacheKey: suggested_fix 変更で hash 変化', () => {
  const a = { error_class: 'x', tool: 'Y', suggested_fix: 'A', target_surface: 's', llm: null };
  const b = { ...a, suggested_fix: 'B' };
  assert.notStrictEqual(cacheKey(clusterImageFacts(a)), cacheKey(clusterImageFacts(b)));
});
test('clusterImageFacts: 数値を含めず・secret をマスク', () => {
  const f = clusterImageFacts({ error_class: 'x', tool: 'Y', count: 5, suggested_fix: 'token sk-ant-ABCDEFGHIJKLMN を直す', target_surface: 's', llm: null });
  assert.ok(!('count' in f) && !('cost_impact_usd' in f), '数値フィールドを含まない');
  assert.ok(!/sk-ant-ABCDEFGHIJKLMN/.test(JSON.stringify(f)), 'secret がマスクされている');
});

// --- auto-refresh の stale 判定 ---
const DAY = 86400000;
test('shouldRefresh: 7日超で発火', () => {
  const now = 1000 * DAY;
  assert.strictEqual(shouldRefresh({ auto_refresh: { enabled: true, stale_days: 7, cooldown_hours: 12 } }, now - 8 * DAY, null, now), true);
});
test('shouldRefresh: 新鮮なら発火しない', () => {
  const now = 1000 * DAY;
  assert.strictEqual(shouldRefresh({ auto_refresh: { stale_days: 7 } }, now - 3 * DAY, null, now), false);
});
test('shouldRefresh: cooldown 中は発火しない', () => {
  const now = 1000 * DAY;
  assert.strictEqual(shouldRefresh({ auto_refresh: { stale_days: 7, cooldown_hours: 12 } }, now - 8 * DAY, { last_triggered_at: now - 3600000 }, now), false);
});
test('shouldRefresh: レポート未生成(=Infinity)は発火', () => {
  const now = 1000 * DAY;
  assert.strictEqual(shouldRefresh({ auto_refresh: { stale_days: 7 } }, 0, null, now), true);
});
test('shouldRefresh: 無効化で発火しない', () => {
  const now = 1000 * DAY;
  assert.strictEqual(shouldRefresh({ auto_refresh: { enabled: false, stale_days: 7 } }, now - 30 * DAY, null, now), false);
});

process.stdout.write(`\n${passed} tests passed\n`);
