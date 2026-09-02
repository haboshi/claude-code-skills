'use strict';
// harness-analytics 純関数のテスト（依存ゼロ・node scripts/harness-analytics.test.js で実行）。
const assert = require('assert');
const { classifyToolResult, detectRetries, detectDrift, detectHallucinationMarkers, detectModelBehavior } = require('./classify');
const { digestFromRecords } = require('./digest');
const { buildClusters, attachTrend } = require('./cluster');
const { computeKpis, reviewCoverage } = require('./rollup');
const { costUsd } = require('./pricing');
const { rankedBars, priorityBubbles, sparkline, donut, beforeAfterCard, wrapText } = require('./charts');
const C = require('./common');
const { prioritize, scoreOf, clusterDetailBlock, mergeLlm } = require('./build-report');
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
test('classifyToolResult: zsh の glob 空振りは not_found（edit_no_match に誤爆しない）', () => {
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 (eval):1: no matches found: lib/**/verify*', true), 'not_found');
});
test('classifyToolResult: edit_no_match は Edit 系のみ（Bash の grep 出力等に適用しない）', () => {
  assert.strictEqual(classifyToolResult('Edit', 'String to replace not found in file.', true), 'edit_no_match');
  assert.notStrictEqual(classifyToolResult('Bash', 'grep output: ... found 3 matches ...', true), 'edit_no_match');
});
test('classifyToolResult: script_error（インライン script の traceback/構文崩れ・Bash のみ）', () => {
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 Traceback (most recent call last):\n  File "<string>", line 3, in <module>\nKeyError: \'findings\'', true), 'script_error');
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 (eval):1: bad substitution', true), 'script_error');
  // Bash 以外にはゲートで適用しない
  assert.notStrictEqual(classifyToolResult('Read', 'Traceback (most recent call last)', true), 'script_error');
});
test('classifyToolResult: script_error はインライン実行痕跡なしの traceback を取り込まない', () => {
  // 実測18%の誤取り込み: Swift コンパイル / prisma / PostgREST 等が出力に traceback を含むだけのケース
  const swift = 'Exit code 1 [3/6] Compiling plan_dump main.swift\nerror: cannot find type in scope';
  assert.notStrictEqual(classifyToolResult('Bash', swift, true), 'script_error');
  // .py ファイル実行の traceback（インライン script ではない）も対象外
  const filetb = 'Exit code 1 Traceback (most recent call last):\n  File "scripts/run.py", line 10, in main\n    x()\nValueError: bad';
  assert.notStrictEqual(classifyToolResult('Bash', filetb, true), 'script_error');
});

// --- signalPreview（プレビューの切り詰めで診断情報を落とさない）---
test('signalPreview: 長い traceback でも例外名（最終行）を残す', () => {
  const lines = ['Exit code 1', 'Traceback (most recent call last):'];
  for (let i = 0; i < 40; i++) lines.push(`  File "<string>", line ${i}, in <module>`);
  lines.push("KeyError: 'findings'");
  const out = C.signalPreview(lines.join('\n'), 480);
  assert.ok(/KeyError/.test(out), '例外名が残っていない');
  assert.ok(out.length <= 520, '長さ上限を大きく超えている');
  // 旧方式（先頭切り詰め）では落ちることの対比
  assert.ok(!/KeyError/.test(C.sanitize(lines.join('\n'), 240)));
});
test('signalPreview: 短い入力はそのまま返す', () => {
  assert.strictEqual(C.signalPreview('short output', 480), 'short output');
});
test('signalPreview: secret と絶対パスはマスクされる', () => {
  const long = 'token sk-ant-ABCDEFGHIJKLMNOP\n' + 'x'.repeat(600) + '\nerror: boom';
  const out = C.signalPreview(long, 200);
  assert.ok(!/sk-ant-ABCDEFGHIJKLMNOP/.test(out), 'secret が漏れている');
  const p = '/Users/tester/secret/path/file.ts\n' + 'y'.repeat(600) + '\nfatal: nope';
  assert.ok(!/\/Users\/tester/.test(C.signalPreview(p, 200)), 'ユーザパスが漏れている');
});
test('classifyToolResult: probe_nonzero（診断プローブの期待どおりの非ゼロを分離）', () => {
  // bare exit（出力なし）＝ bare grep 空振りの典型
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1', true), 'probe_nonzero');
  // 実質出力あり・エラートークンなし＝プローブは成果を出している
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 === 本番未適用マイグレーション7件 === 20260714084140_add_market_delivery_fee_config 20260716090000_scope_delivery_metrics', true), 'probe_nonzero');
  // エラートークンがあれば command_failed のまま
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 error: pathspec \'apps/web/x.tsx\' did not match any file(s) known to git', true), 'command_failed');
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 1 1428 fable-playbook.md The following paths are ignored by one of your .gitignore files', true), 'command_failed');
});
test('classifyToolResult: probe_nonzero に本物の失敗を取り込まない（2026-07-27 精度検収）', () => {
  // daemon 不達（同一リトライしても直らない環境起因）
  assert.notStrictEqual(classifyToolResult('Bash', 'Exit code 1 The Orca runtime closed the connection before responding. Orca is not running.', true), 'probe_nonzero');
  // クォート崩れ（インライン script の構文エラー）
  assert.notStrictEqual(classifyToolResult('Bash', 'Exit code 1 (eval): unmatched "', true), 'probe_nonzero');
  // テスト結果の混入
  assert.notStrictEqual(classifyToolResult('Bash', 'Exit code 1 === 全件テスト === Test Suites: 2 skipped, 392 passed', true), 'probe_nonzero');
});
test('classifyToolResult: timeout は Bash ではハーネス kill 文言に限定（部分一致誤爆の是正）', () => {
  assert.strictEqual(classifyToolResult('Bash', 'Exit code 143 Command timed out after 2m 0s', true), 'timeout');
  // Playwright の waitFor timeout / TLS handshake timeout は Bash では timeout に分類しない
  assert.notStrictEqual(classifyToolResult('Bash', 'Exit code 1 locator.waitFor: Timeout 30000ms exceeded', true), 'timeout');
  assert.notStrictEqual(classifyToolResult('Bash', 'Exit code 1 net/http: TLS handshake timeout', true), 'timeout');
  // 非 Bash（MCP 等）は従来どおり広く拾う
  assert.strictEqual(classifyToolResult('mcp__chrome-devtools__wait_for', 'Request timed out', true), 'timeout');
});

// --- detectHallucinationMarkers（R8 混線検出）---
test('detectHallucinationMarkers: 高精度マーカー単独で suspected', () => {
  assert.strictEqual(detectHallucinationMarkers('<result>\n<name>Read</name>').suspected, true);
  assert.strictEqual(detectHallucinationMarkers('"tool_use_id": "abc"').suspected, true);
});
test('detectHallucinationMarkers: 通常散文は非検出', () => {
  assert.strictEqual(detectHallucinationMarkers('普通の説明文です。ツールを実行しました。').suspected, false);
});
test('detectHallucinationMarkers: プロトコル構文を仕様上含む出所は誤検知にしない（2026-07-27）', () => {
  const leak = '{"tool_use_id": "toolu_123"}';
  // 出所を渡さなければ従来どおり suspected（後方互換）
  assert.strictEqual(detectHallucinationMarkers(leak).suspected, true);
  // TaskOutput はサブエージェント transcript をそのまま返すため仕様上含む＝除外
  assert.strictEqual(detectHallucinationMarkers(leak, { toolName: 'TaskOutput' }).suspected, false);
  // transcript / ログファイルの読み取りも除外
  assert.strictEqual(detectHallucinationMarkers(leak, { toolName: 'Read', target: '~/.claude/projects/x/abc.jsonl' }).suspected, false);
  assert.strictEqual(detectHallucinationMarkers(leak, { toolName: 'Bash', target: 'cat ~/.claude/logs/guard-activity.jsonl' }).suspected, false);
  // 通常のソースファイル読み取りで漏れていれば従来どおり検出
  assert.strictEqual(detectHallucinationMarkers(leak, { toolName: 'Read', target: 'src/app/page.tsx' }).suspected, true);
  // markers 自体は診断用に残る
  assert.deepStrictEqual(detectHallucinationMarkers(leak, { toolName: 'TaskOutput' }).markers, ['tool_use_id_leak']);
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

// --- detectModelBehavior（Fable 5.1 の既定挙動差分の退行）---
test('detectModelBehavior: 読取ツール 1 件ずつの連鎖が閾値以上で serial_single_tool_calls', () => {
  const steps = [];
  for (let i = 0; i < 6; i++) steps.push({ turnIdx: 0, tools: ['Read'], hasText: true });
  const s = detectModelBehavior(steps);
  const sig = s.find((x) => x.kind === 'serial_single_tool_calls');
  assert.ok(sig, 'serial_single_tool_calls が立たない');
  assert.strictEqual(sig.count, 6);
  assert.strictEqual(sig.turn_idx, 0);
});
test('detectModelBehavior: 複数ツール同時呼び出し・書き込み系・user ターン跨ぎで連鎖がリセットされる', () => {
  const run = (n) => Array.from({ length: n }, () => ({ turnIdx: 0, tools: ['Grep'], hasText: true }));
  // 5 連の途中に並列呼び出しが挟まる → 最長 3
  assert.strictEqual(detectModelBehavior([...run(3), { turnIdx: 0, tools: ['Read', 'Read'], hasText: true }, ...run(3)]).length, 0);
  // Edit（書き込み系）は逐次化の対象外
  assert.strictEqual(detectModelBehavior(Array.from({ length: 8 }, () => ({ turnIdx: 0, tools: ['Edit'], hasText: true }))).length, 0);
  // user ターンを跨ぐと 0 から数え直す（3 + 3）
  assert.strictEqual(detectModelBehavior([...run(3), ...run(3).map((s) => ({ ...s, turnIdx: 1 }))]).length, 0);
});
test('detectModelBehavior: 本文なしのツール連鎖が閾値（20）以上で silent_tool_run、本文があれば切れる', () => {
  const silent = (n, turn = 0) => Array.from({ length: n }, () => ({ turnIdx: turn, tools: ['Bash', 'Read'], hasText: false }));
  const s = detectModelBehavior(silent(20));
  assert.ok(s.some((x) => x.kind === 'silent_tool_run' && x.count === 20));
  assert.ok(!detectModelBehavior(silent(19)).some((x) => x.kind === 'silent_tool_run'), '19 連は閾値未満');
  const cut = detectModelBehavior([...silent(15), { turnIdx: 0, tools: ['Bash'], hasText: true }, ...silent(15)]);
  assert.ok(!cut.some((x) => x.kind === 'silent_tool_run'));
  // 閾値は opts で変えられる
  assert.ok(detectModelBehavior(silent(4), { silentThreshold: 4 }).some((x) => x.kind === 'silent_tool_run'));
  // serial も境界を両側から
  const rd = (n) => Array.from({ length: n }, () => ({ turnIdx: 0, tools: ['Read'], hasText: true }));
  assert.ok(!detectModelBehavior(rd(5)).some((x) => x.kind === 'serial_single_tool_calls'), '5 連は閾値未満');
  assert.ok(detectModelBehavior(rd(6)).some((x) => x.kind === 'serial_single_tool_calls'));
});
test('digestFromRecords: 非空 thinking block は実況として扱う（Fable 5.1 の進捗更新は thinking で届く）', () => {
  const recs = [{ type: 'user', sessionId: 'T1', cwd: '/x', timestamp: '2026-09-03T00:00:00Z', message: { role: 'user', content: 'go' } }];
  for (let i = 0; i < 25; i++) {
    recs.push({ type: 'assistant', sessionId: 'T1', timestamp: '2026-09-03T00:00:01Z', message: { id: `m${i}`, model: 'claude-fable-5-1', content: [{ type: 'thinking', thinking: `checking ${i}` }] } });
    recs.push({ type: 'assistant', sessionId: 'T1', timestamp: '2026-09-03T00:00:01Z', message: { id: `m${i}`, model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: 'true' } }] } });
    recs.push({ type: 'user', isMeta: true, sessionId: 'T1', timestamp: '2026-09-03T00:00:02Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, is_error: false, content: '' }] } });
  }
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/T1.jsonl' });
  assert.ok(!d.failure_signals.model_behavior_signals.some((x) => x.kind === 'silent_tool_run'));
  // thinking が空文字なら無言扱い
  for (const r of recs) if (r.type === 'assistant' && r.message.content[0].type === 'thinking') r.message.content[0].thinking = '';
  const d2 = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/T1.jsonl' });
  assert.ok(d2.failure_signals.model_behavior_signals.some((x) => x.kind === 'silent_tool_run' && x.count === 25));
});
test('digestFromRecords: 既に Read/Edit したファイルへの Write を whole_file_rewrite として計上（新規ファイルは除外）', () => {
  const recs = [
    { type: 'user', sessionId: 'W1', cwd: '/x', timestamp: '2026-09-03T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: 'W1', timestamp: '2026-09-03T00:00:01Z', message: { model: 'claude-fable-5-1', content: [
      { type: 'tool_use', id: 'w1', name: 'Read', input: { file_path: '/Users/tester/proj/a.ts' } },
      { type: 'tool_use', id: 'w2', name: 'Write', input: { file_path: '/Users/tester/proj/new.ts', content: 'x' } }, // 新規 → 対象外
    ] } },
    { type: 'user', isMeta: true, sessionId: 'W1', timestamp: '2026-09-03T00:00:02Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'w1', is_error: false, content: 'ok' },
      { type: 'tool_result', tool_use_id: 'w2', is_error: false, content: 'ok' },
    ] } },
    { type: 'assistant', sessionId: 'W1', timestamp: '2026-09-03T00:00:03Z', message: { model: 'claude-fable-5-1', content: [
      { type: 'text', text: '直します' },
      { type: 'tool_use', id: 'w3', name: 'Write', input: { file_path: '/Users/tester/proj/a.ts', content: 'y' } }, // Read 済み → 全文書き直し
    ] } },
    { type: 'user', isMeta: true, sessionId: 'W1', timestamp: '2026-09-03T00:00:04Z', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'w3', is_error: false, content: 'ok' },
    ] } },
  ];
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/W1.jsonl' });
  const sig = d.failure_signals.model_behavior_signals.find((x) => x.kind === 'whole_file_rewrite');
  assert.ok(sig, 'whole_file_rewrite が立たない');
  assert.strictEqual(sig.count, 1);
  assert.ok(/^~\/proj\/a\.ts$/.test(sig.targets[0]), `パスがマスクされていない: ${sig.targets[0]}`);
  assert.strictEqual(d.schema, 'harness-digest/6');
  // Write→Write（生成物の再出力）は数えない。sidechain の Read は先行操作にならない。
  const recs2 = [
    { type: 'user', sessionId: 'W2', cwd: '/x', timestamp: '2026-09-03T00:00:00Z', message: { role: 'user', content: 'go' } },
    { type: 'assistant', sessionId: 'W2', timestamp: '2026-09-03T00:00:01Z', message: { id: 'a', model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: 'x1', name: 'Write', input: { file_path: '/x/out.html', content: '1' } }] } },
    { type: 'assistant', sessionId: 'W2', isSidechain: true, timestamp: '2026-09-03T00:00:02Z', message: { id: 'b', model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: 'x2', name: 'Read', input: { file_path: '/x/side.ts' } }] } },
    { type: 'assistant', sessionId: 'W2', timestamp: '2026-09-03T00:00:03Z', message: { id: 'c', model: 'claude-fable-5-1', content: [
      { type: 'tool_use', id: 'x3', name: 'Write', input: { file_path: '/x/out.html', content: '2' } },   // Write→Write → 対象外
      { type: 'tool_use', id: 'x4', name: 'Write', input: { file_path: '/x/side.ts', content: '2' } },    // sidechain Read → 対象外
    ] } },
    { type: 'user', isMeta: true, sessionId: 'W2', timestamp: '2026-09-03T00:00:04Z', message: { role: 'user', content: ['x1', 'x2', 'x3', 'x4'].map((id) => ({ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' })) } },
  ];
  const d2 = digestFromRecords(recs2, { filePath: '/x/projects/-Users-t-proj/W2.jsonl' });
  assert.ok(!d2.failure_signals.model_behavior_signals.some((x) => x.kind === 'whole_file_rewrite'));
});
test('maskPaths: cwd スラッグ形式（-Users-<name>-）も畳む', () => {
  assert.strictEqual(C.maskPaths('/private/tmp/claude-501/-Users-tester-Projects-x/scratch/a.js'), '/private/tmp/claude-501/-Users-~-Projects-x/scratch/a.js');
  assert.strictEqual(C.maskPaths('/Users/tester/proj/a.ts'), '~/proj/a.ts');
});
test('digestFromRecords: 同じ message.id に分割された text と tool_use は 1 ステップに束ねる（実 transcript の形）', () => {
  // 実 transcript: 1 API 応答が content block ごとに別レコード。text → tool_use → tool_use が同じ message.id で連続する。
  const recs = [{ type: 'user', sessionId: 'M1', cwd: '/x', timestamp: '2026-09-03T00:00:00Z', message: { role: 'user', content: 'go' } }];
  for (let i = 0; i < 14; i++) {
    const mid = `msg_${i}`;
    recs.push({ type: 'assistant', sessionId: 'M1', timestamp: `2026-09-03T00:00:${String(10 + i).padStart(2, '0')}Z`, message: { id: mid, model: 'claude-fable-5-1', content: [{ type: 'text', text: `step ${i}` }] } });
    recs.push({ type: 'assistant', sessionId: 'M1', timestamp: `2026-09-03T00:00:${String(10 + i).padStart(2, '0')}Z`, message: { id: mid, model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: `r${i}a`, name: 'Read', input: { file_path: `/x/f${i}.ts` } }] } });
    recs.push({ type: 'assistant', sessionId: 'M1', timestamp: `2026-09-03T00:00:${String(10 + i).padStart(2, '0')}Z`, message: { id: mid, model: 'claude-fable-5-1', content: [{ type: 'tool_use', id: `r${i}b`, name: 'Grep', input: { pattern: 'x' } }] } });
    recs.push({ type: 'user', isMeta: true, sessionId: 'M1', timestamp: `2026-09-03T00:00:${String(10 + i).padStart(2, '0')}Z`, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: `r${i}a`, is_error: false, content: 'ok' }, { type: 'tool_result', tool_use_id: `r${i}b`, is_error: false, content: 'ok' },
    ] } });
  }
  const d = digestFromRecords(recs, { filePath: '/x/projects/-Users-t-proj/M1.jsonl' });
  // 束ねれば「本文あり・ツール 2 件」のステップが 14 個 → 逐次化も無言連鎖も立たない。束ねなければ両方が誤検知する。
  assert.deepStrictEqual(d.failure_signals.model_behavior_signals, []);
});
test('digestFromRecords: 既存 synth にモデル挙動シグナルは立たない（回帰）', () => {
  const d = digestFromRecords(synthRecords(), { filePath: '/x/projects/-Users-tester-proj/S1.jsonl' });
  assert.deepStrictEqual(d.failure_signals.model_behavior_signals, []);
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
test('computeKpis: refusal とモデル挙動シグナルを集計し、旧 digest（配列なし）も壊れない', () => {
  const base = { tools: {}, cost_usd: 0, friction_score: 0, turns: { compactions: 0 } };
  const old = { ...base, failure_signals: { orphaned_tool_use: [], suspected_hallucinations: [], model_refusals: 1 } }; // v5 以前
  const d2 = { ...base, failure_signals: { orphaned_tool_use: [], suspected_hallucinations: [], model_refusals: 0, model_behavior_signals: [
    { kind: 'serial_single_tool_calls', count: 7 }, { kind: 'whole_file_rewrite', count: 2, targets: ['~/p/a.ts'] }, { kind: 'unknown_kind', count: 9 },
  ] } };
  const k = computeKpis([old, d2]);
  assert.strictEqual(k.model_refusals_total, 1);
  assert.strictEqual(k.model_refusals_sessions, 1);
  assert.deepStrictEqual(k.behavior_signals.serial_single_tool_calls, { max: 7, total: 7, sessions: 1 });
  assert.deepStrictEqual(k.behavior_signals.whole_file_rewrite, { max: 2, total: 2, sessions: 1 });
  assert.deepStrictEqual(k.behavior_signals.silent_tool_run, { max: 0, total: 0, sessions: 0 });
  assert.strictEqual(k.behavior_unmeasured_sessions, 1); // old は配列なし＝未計測
  // 連鎖系は最長（max）で見る。同一 kind の重複と steps_truncated はセッション数を二重に数えない。
  const d3 = { ...base, failure_signals: { model_behavior_signals: [{ kind: 'silent_tool_run', count: 6 }, { kind: 'silent_tool_run', count: 10 }, { kind: 'steps_truncated', count: 5000 }] } };
  const k2 = computeKpis([d3]);
  assert.deepStrictEqual(k2.behavior_signals.silent_tool_run, { max: 10, total: 16, sessions: 1 });
  assert.strictEqual(k2.behavior_truncated_sessions, 1);
});

// --- reviewCoverage（自動レビューのカバレッジ欠損）---
test('reviewCoverage: sdk-py の無所見率とステップ数の対照を出す', () => {
  const mk = (ep, hasOut, steps) => ({ entrypoint: ep, turns: { assistant_steps: steps }, tools: hasOut ? { StructuredOutput: { count: 1, errors: 0 } } : { Read: { count: 3, errors: 0 } } });
  const ds = [mk('sdk-py', true, 10), mk('sdk-py', true, 12), mk('sdk-py', false, 18), mk('cli', false, 40)];
  const rc = reviewCoverage(ds);
  assert.strictEqual(rc.sessions, 3);           // cli は対象外
  assert.strictEqual(rc.no_output, 1);
  assert.strictEqual(rc.no_output_rate, 0.333);
  assert.strictEqual(rc.avg_steps_no_output, 18);
  assert.strictEqual(rc.avg_steps_with_output, 11);
});
test('reviewCoverage: sdk-py が無ければ null（KPI を出さない）', () => {
  assert.strictEqual(reviewCoverage([{ entrypoint: 'cli', turns: {}, tools: {} }]), null);
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
test('prioritize: stale な LLM priority は hero を上書きしない', () => {
  const cs = [
    { error_class: 'a', tool: 'X', count: 100, affected_sessions: 10, is_defense: false },
    { error_class: 'b', tool: 'Y', count: 1, affected_sessions: 1, is_defense: false, llm: { priority: 0, stale: true } },
  ];
  assert.strictEqual(prioritize(cs).hero.error_class, 'a');
});

// --- mergeLlm（鮮度ガード）---
test('mergeLlm: 7日以内は fresh・7日超は stale＋analyzed_at 付与', () => {
  const llm = { generated_at: '2026-07-12T00:00:00Z', analyses: [{ cluster_id: 'x-Y', root_cause: 'r', count: 322 }] };
  const mk = () => [{ cluster_id: 'x-Y', count: 261, llm: null }];
  const fresh = mergeLlm(mk(), llm, '2026-07-15T00:00:00Z');
  assert.strictEqual(fresh[0].llm.stale, false);
  const stale = mergeLlm(mk(), llm, '2026-07-26T00:00:00Z');
  assert.strictEqual(stale[0].llm.stale, true);
  assert.strictEqual(stale[0].llm.analyzed_at, '2026-07-12T00:00:00Z');
  assert.strictEqual(stale[0].llm.count, 322); // 分析時点の件数を保持（現在の count 261 とは別）
});
test('mergeLlm: generated_at 欠落は stale 扱い（鮮度を証明できない）', () => {
  const llm = { analyses: [{ cluster_id: 'x-Y', root_cause: 'r' }] };
  const out = mergeLlm([{ cluster_id: 'x-Y', count: 1, llm: null }], llm, '2026-07-26T00:00:00Z');
  assert.strictEqual(out[0].llm.stale, true);
});

// --- buildClusters（コスト按分）---
test('buildClusters: 関連コストはセッション内按分で二重計上しない', () => {
  const mkErr = (cls, tool) => ({ tool, error_class: cls, preview_masked: 'x', turn_idx: 0 });
  const dA = { session_id: 'A', cwd_slug: 'a', cost_usd: 10, failure_signals: { tool_errors: [mkErr('x', 'T')] } };
  const dB = { session_id: 'B', cwd_slug: 'b', cost_usd: 20, failure_signals: { tool_errors: [mkErr('x', 'T'), mkErr('y', 'T'), mkErr('y', 'T'), mkErr('y', 'T')] } };
  const cs = buildClusters([dA, dB]);
  const x = cs.find((c) => c.cluster_id === 'x-T');
  const y = cs.find((c) => c.cluster_id === 'y-T');
  assert.strictEqual(x.cost_impact_usd, 15);  // 10 + 20×(1/4)
  assert.strictEqual(y.cost_impact_usd, 15);  // 20×(3/4)
  const total = cs.reduce((s, c) => s + c.cost_impact_usd, 0);
  assert.strictEqual(total, 30);              // クラスター合計 = エラーセッションの総コスト（≤ 全体総コスト）
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
