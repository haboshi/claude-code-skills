'use strict';
// 失敗シグナルの決定論的分類。tool_result.content（テキスト化済み）を正規表現で error_class に写像。
// LLM は一切使わない。分類は「明らかな欠落の検出」レベルの補助であり、確信度は cluster 段で扱う。

// 判定順に評価（先勝ち）。ラベルは harness-research/06 の remediation テーブルのキーに対応。
const RULES = [
  ['unavailable', /temporarily unavailable|cannot determine the safety|auto mode cannot|service unavailable|overloaded/i],
  ['permission_denied', /permission denied|permission for this action was denied|denied by the .*classifier|was blocked|\bblocked:|may only (?:list|access|read|write)|not permitted|user (?:denied|declined|rejected)|requires approval|operation not permitted/i],
  ['file_not_read', /file has not been read yet|read it first|must read the file|has not been read/i],
  ['edit_no_match', /string not found|string to replace (?:was )?not found|not find the string|old_string.*not|no match|to replace was not found|found \d+ matches/i],
  ['not_found', /\bENOENT\b|no such file or directory|file does not exist|command not found|not found:/i],
  ['timeout', /timed out|timeout|etimedout|deadline exceeded/i],
  ['test_failure', /test(?:s)? failed|assertion(?:error)?|\b\d+ failed\b|expect(?:ed)?.*received|✗|FAIL /i],
  ['type_error', /\bTS\d{3,}\b|type error|typeerror|is not assignable|cannot find name|has no exported member/i],
  ['mcp_error', /mcp error|-32\d{3}|input validation error|tool ran without|mcp__/i],
  ['command_failed', /exit code [1-9]|non-zero exit|command failed|returned error|\bstderr\b/i],
];

// tool_result のテキストと is_error から error_class を返す。エラーでなければ null。
function classifyToolResult(_toolName, text, isError) {
  if (!isError) return null;
  const t = String(text || '');
  for (const [label, re] of RULES) {
    if (re.test(t)) return label;
  }
  return 'other';
}

// リトライ検出: 同一ツール×同一ターゲットの連続失敗を数える。
// events: [{ tool, target, isError, turnIdx }] の時系列（tool_use 発火順）。
// 返り値: [{ tool, target, attempts, firstTurn, lastTurn }]（attempts>=2 のみ）。
function detectRetries(events) {
  const retries = [];
  let run = null; // { tool, target, attempts, firstTurn, lastTurn }
  for (const e of events) {
    const key = `${e.tool}::${e.target || ''}`;
    if (run && run.key === key && e.isError) {
      run.attempts++;
      run.lastTurn = e.turnIdx;
    } else if (e.isError) {
      if (run && run.attempts >= 2) retries.push(strip(run));
      run = { key, tool: e.tool, target: e.target || null, attempts: 1, firstTurn: e.turnIdx, lastTurn: e.turnIdx };
    } else {
      // 成功で連鎖リセット
      if (run && run.attempts >= 2) retries.push(strip(run));
      run = null;
    }
  }
  if (run && run.attempts >= 2) retries.push(strip(run));
  return retries;
}
function strip(run) {
  return { tool: run.tool, target: run.target, attempts: run.attempts, firstTurn: run.firstTurn, lastTurn: run.lastTurn };
}

// ドリフト兆候検出（決定論・弱シグナル）。
// - repeated_read_same_file: 同一ファイルを閾値超で Read
// - long_tool_chain_no_user: user ターンを挟まないツール連鎖が閾値超
// toolEvents: [{ tool, target, turnIdx }]、userPromptTurns: 何回 user が発話したか（連鎖長の目安）
function detectDrift(toolEvents, opts = {}) {
  const readThreshold = opts.readThreshold || 3;
  const chainThreshold = opts.chainThreshold || 25;
  const signals = [];

  const readCounts = new Map();
  for (const e of toolEvents) {
    if (e.tool === 'Read' && e.target) {
      readCounts.set(e.target, (readCounts.get(e.target) || 0) + 1);
    }
  }
  for (const [target, count] of readCounts) {
    if (count > readThreshold) signals.push({ kind: 'repeated_read_same_file', target, count });
  }

  // 最長の「user 発話なしツール連鎖」
  let maxChain = 0, chain = 0;
  for (const e of toolEvents) {
    if (e.tool === '__user__') { chain = 0; }
    else { chain++; if (chain > maxChain) maxChain = chain; }
  }
  if (maxChain > chainThreshold) signals.push({ kind: 'long_tool_chain_no_user', count: maxChain });

  return signals;
}

module.exports = { classifyToolResult, detectRetries, detectDrift, RULES };
