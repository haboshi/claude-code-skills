'use strict';
// harness-analytics 純関数のテスト（依存ゼロ・node scripts/harness-analytics.test.js で実行）。
const assert = require('assert');
const { classifyToolResult, detectRetries, detectDrift } = require('./classify');
const { digestFromRecords } = require('./digest');
const { buildClusters, attachTrend } = require('./cluster');
const { computeKpis } = require('./rollup');
const { costUsd } = require('./pricing');

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

process.stdout.write(`\n${passed} tests passed\n`);
