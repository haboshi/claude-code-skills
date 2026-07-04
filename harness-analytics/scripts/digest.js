'use strict';
// レコード配列 → セッションダイジェスト（純関数、テスト容易）。LLM 不使用・決定論。
// 1 transcript ファイル = 1 セッション。冪等: 同じ入力から常に同じダイジェストを返す。

const C = require('./common');
const { classifyToolResult, detectRetries, detectDrift } = require('./classify');
const { costUsd } = require('./pricing');

// tool_use.input から短い target 文字列を抽出（Read/Edit/Write→file_path, Bash→cmd先頭, Grep→pattern）
function extractTarget(name, input) {
  if (!input || typeof input !== 'object') return null;
  if (input.file_path) return String(input.file_path);
  if (input.path) return String(input.path);
  if (input.notebook_path) return String(input.notebook_path);
  if (name === 'Bash' && input.command) return String(input.command).split(/\s+/).slice(0, 2).join(' ');
  if (input.pattern) return String(input.pattern);
  if (input.url) return String(input.url);
  return null;
}

// tool_result.content を平文テキスト化（配列ブロック対応）
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).join('\n');
  }
  if (content && typeof content === 'object' && content.text) return content.text;
  return '';
}

// 実ユーザー発話か（tool_result 運搬でなく・メタでもない）
function isRealUserPrompt(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isSidechain) return false;
  const content = rec.message && rec.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) return content.some((b) => b && b.type !== 'tool_result');
  return false;
}

function digestFromRecords(records, opts = {}) {
  const filePath = opts.filePath || '';
  const storeRaw = opts.storeRawToolResult === true;

  let sessionId = null, cwd = null, gitBranch = null, ccVersion = null, entrypoint = null;
  let startedAt = null, endedAt = null;

  let userPrompts = 0, assistantSteps = 0, compactions = 0, interruptions = 0;
  const tokens = { input: 0, output: 0, cache_read: 0, cache_creation: 0, by_model: {} };
  let costTotal = 0;

  const toolCounts = {};      // name -> { count, errors }
  const toolSeq = [];         // 表示用のツール名列（cap）
  const toolUseById = {};     // id -> { name, target, turnIdx }
  const toolEvents = [];      // 時系列（retry/drift 用）: { tool, target, isError, turnIdx }
  const toolErrors = [];      // { tool, error_class, preview_masked, turn_idx, raw? }
  const hookErrors = [];
  let modelRefusals = 0, permissionDenials = 0;

  const invokedSkills = new Set(), invokedSubagents = new Set(), invokedCommands = new Set(), invokedMcp = new Set();

  let turnIdx = -1;
  const CMD_RE = /<command-name>\s*\/?([^<]+?)\s*<\/command-name>/;

  // 1st pass の途中で tool_result を確定するには id→result を後で照合する必要がある。
  // tool_use と tool_result は別レコードに出るため、全走査で id マップを作ってから確定。
  const toolResultById = {}; // id -> { isError, text }

  for (const rec of records) {
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : 0;
    if (ts) {
      if (startedAt === null || ts < startedAt) startedAt = ts;
      if (endedAt === null || ts > endedAt) endedAt = ts;
    }
    if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
    if (!cwd && rec.cwd) cwd = rec.cwd;
    if (!gitBranch && rec.gitBranch) gitBranch = rec.gitBranch;
    if (!ccVersion && rec.version) ccVersion = rec.version;
    if (!entrypoint && rec.entrypoint) entrypoint = rec.entrypoint;

    const msg = rec.message;

    if (rec.type === 'user') {
      // 割り込み検出
      const cstr = typeof (msg && msg.content) === 'string' ? msg.content : '';
      if (/\[Request interrupted/i.test(cstr)) interruptions++;
      // コマンド発火
      if (cstr.indexOf('<command-name>') !== -1) {
        const m = CMD_RE.exec(cstr);
        if (m) invokedCommands.add(m[1].trim());
      }
      if (isRealUserPrompt(rec)) {
        userPrompts++;
        turnIdx++;
        toolEvents.push({ tool: '__user__', turnIdx });
      }
      // tool_result 収集
      const content = msg && msg.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b && b.type === 'tool_result') {
            toolResultById[b.tool_use_id] = { isError: b.is_error === true, text: resultText(b.content) };
          }
        }
      }
    } else if (rec.type === 'assistant') {
      if (!rec.isSidechain) assistantSteps++;
      // 帰属スキル/プラグイン
      if (rec.attributionSkill) invokedSkills.add(rec.attributionSkill);
      // トークン/コスト
      const u = msg && msg.usage;
      const model = (msg && msg.model) || 'unknown';
      if (u) {
        const rowInput = (u.input_tokens || 0);
        const rowOutput = (u.output_tokens || 0);
        const rowCr = (u.cache_read_input_tokens || 0);
        const rowCw = (u.cache_creation_input_tokens || 0);
        tokens.input += rowInput; tokens.output += rowOutput;
        tokens.cache_read += rowCr; tokens.cache_creation += rowCw;
        const bm = tokens.by_model[model] || { input: 0, output: 0 };
        bm.input += rowInput; bm.output += rowOutput; tokens.by_model[model] = bm;
        costTotal += costUsd({ input: rowInput, output: rowOutput, cache_read: rowCr, cache_creation: rowCw }, model);
      }
      // ツール使用
      const content = msg && msg.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (!b || b.type !== 'tool_use') continue;
          const name = b.name || 'unknown';
          const target = extractTarget(name, b.input);
          toolUseById[b.id] = { name, target, turnIdx };
          if (toolSeq.length < 60) toolSeq.push(name);
          if (name === 'Skill' && b.input && (b.input.skill || b.input.command)) invokedSkills.add(b.input.skill || b.input.command);
          else if (name === 'Task' && b.input && b.input.subagent_type) invokedSubagents.add(b.input.subagent_type);
          else if (name === 'Agent' && b.input && b.input.subagent_type) invokedSubagents.add(b.input.subagent_type);
          else if (name.startsWith('mcp__')) invokedMcp.add(name.split('__')[1] || 'unknown');
        }
      }
    } else if (rec.type === 'system') {
      if (rec.subtype === 'compact_boundary') compactions++;
      if (rec.subtype === 'model_refusal_fallback') modelRefusals++;
      if (Array.isArray(rec.hookErrors) && rec.hookErrors.length) {
        hookErrors.push({ subtype: rec.subtype || null, count: rec.hookErrors.length });
      }
    }
  }

  // tool_use と tool_result を照合してエラー確定・カウント
  for (const [id, use] of Object.entries(toolUseById)) {
    const res = toolResultById[id];
    const c = toolCounts[use.name] || { count: 0, errors: 0 };
    c.count++;
    const isError = res ? res.isError : false;
    if (isError) {
      c.errors++;
      const errClass = classifyToolResult(use.name, res.text, true);
      if (errClass === 'permission_denied') permissionDenials++;
      const entry = {
        tool: use.name,
        error_class: errClass,
        preview_masked: C.sanitize(res.text, 240),
        turn_idx: use.turnIdx,
      };
      if (storeRaw) entry.raw = res.text; // 既定 false（漏洩面を作らない）
      toolErrors.push(entry);
    }
    toolCounts[use.name] = c;
    toolEvents.push({ tool: use.name, target: use.target, isError, turnIdx: use.turnIdx });
  }

  // retry / drift
  const retryEvents = toolEvents.filter((e) => e.tool !== '__user__');
  const retries = detectRetries(retryEvents);
  const driftSignals = detectDrift(toolEvents);

  // friction_score（0..1 決定論合成）
  const totalToolCalls = Object.values(toolCounts).reduce((s, t) => s + t.count, 0);
  const totalToolErrors = Object.values(toolCounts).reduce((s, t) => s + t.errors, 0);
  const errorRate = totalToolCalls ? totalToolErrors / totalToolCalls : 0;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const friction = clamp01(
    0.40 * errorRate +
    0.20 * Math.min(1, retries.length / 5) +
    0.15 * Math.min(1, permissionDenials / 3) +
    0.10 * Math.min(1, compactions / 3) +
    0.10 * Math.min(1, interruptions / 3) +
    0.05 * Math.min(1, modelRefusals / 2)
  );

  return {
    schema: `harness-digest/${C.DIGEST_VERSION}`,
    digest_id: sessionId || 'unknown',
    session_id: sessionId || 'unknown',
    cwd: cwd || null,
    cwd_slug: filePath ? C.cwdSlugOf(filePath) : 'unknown',
    project_hash: C.projectHash(cwd),
    git_branch: gitBranch || null,
    cc_version: ccVersion || null,
    entrypoint: entrypoint || null,
    started_at: startedAt ? new Date(startedAt).toISOString() : null,
    ended_at: endedAt ? new Date(endedAt).toISOString() : null,
    duration_ms: (startedAt && endedAt) ? (endedAt - startedAt) : 0,
    turns: { user_prompts: userPrompts, assistant_steps: assistantSteps, compactions },
    tokens,
    cost_usd: Math.round(costTotal * 10000) / 10000,
    cost_is_estimate: true,
    tools: toolCounts,
    tool_sequence_digest: toolSeq,
    invoked: {
      skills: [...invokedSkills].sort(),
      subagents: [...invokedSubagents].sort(),
      commands: [...invokedCommands].sort(),
      mcp_servers: [...invokedMcp].sort(),
    },
    failure_signals: {
      tool_errors: toolErrors,
      permission_denials: permissionDenials,
      model_refusals: modelRefusals,
      hook_errors: hookErrors,
      retries,
      drift_signals: driftSignals,
    },
    interruptions,
    friction_score: Math.round(friction * 100) / 100,
    // harness-research 互換のため予約（将来 evaluator が後埋め）
    verdict: null,
    scores: { coverage: null, preservation: null, faithfulness: null, usefulness: null, risk: null },
    digest_version: C.DIGEST_VERSION,
    generated_at: C.nowIso(),
  };
}

module.exports = { digestFromRecords, extractTarget, resultText, isRealUserPrompt };
