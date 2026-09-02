'use strict';
// レコード配列 → セッションダイジェスト（純関数、テスト容易）。LLM 不使用・決定論。
// 1 transcript ファイル = 1 セッション。冪等: 同じ入力から常に同じダイジェストを返す。

const C = require('./common');
const { classifyToolResult, detectRetries, detectDrift, detectHallucinationMarkers, detectModelBehavior } = require('./classify');
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
  const orphaned = [];        // 結果の無い tool_use（＝ターン打ち切り/model-side error の代理シグナル）
  const hallucinations = [];  // R8: 作話/混線の痕跡（assistant テキスト・tool_result）
  const steps = [];           // モデル挙動検知用: main thread の assistant メッセージ列 { turnIdx, tools, hasText }
  const seenFileTargets = new Set(); // main thread で Read/Edit 済み file_path（Write の全文書き直し判定用。Write→Write は生成物の再出力が多数派なので数えない）
  const rewrites = [];        // whole_file_rewrite: Read/Edit 済みファイルへの Write { target, turn_idx }
  let stepsTruncated = false; // steps の cap 到達（0 と未計測を区別するため digest に載せる）
  const CAP = 50;             // 弱シグナル配列の上限（暴走セッションでのメモリ暴発を防ぐ）
  let lastToolUseId = null;   // 最後に発火した tool_use（in-flight なので orphan 判定から除外）
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
      // 割り込み検出（content は string / array 双方あり。array 形式で来る中断を従来は取りこぼしていた）
      const rawContent = msg && msg.content;
      const cstr = typeof rawContent === 'string' ? rawContent : resultText(rawContent);
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
      // ツール使用 / テキスト（作話痕跡走査・モデル挙動検知）
      const content = msg && msg.content;
      if (Array.isArray(content)) {
        const stepTools = []; let stepHasText = false;
        for (const b of content) {
          if (!b) continue;
          // assistant テキストに内部プロトコル構文の断片（R8 混線）が漏れていないか
          if (b.type === 'text' && b.text) {
            if (b.text.trim()) stepHasText = true;
            if (hallucinations.length < CAP) {
              const h = detectHallucinationMarkers(b.text);
              if (h.suspected) hallucinations.push({ where: 'assistant_text', markers: h.markers, turn_idx: turnIdx });
            }
            continue;
          }
          // Fable 5.1 の進捗更新は text でなく thinking block として届く（公式 "Progress updates between tool calls"）。
          // 非空の thinking はユーザーに見える実況として扱う（実測 2026-09-03: Fable 5.1 のツール手番の 16% が thinking のみ）。
          if (b.type === 'thinking') { if (String(b.thinking || '').trim()) stepHasText = true; continue; }
          if (b.type !== 'tool_use') continue;
          const name = b.name || 'unknown';
          const target = extractTarget(name, b.input);
          toolUseById[b.id] = { name, target, turnIdx };
          lastToolUseId = b.id; // 発火順に更新 → 最終値が「最後に発火した tool_use」
          if (toolSeq.length < 60) toolSeq.push(name);
          stepTools.push(name);
          // main thread で既に Read/Edit したファイルへの Write ＝ 全文書き直しの代理シグナル（Fable 5.1 の既定挙動差分）。
          // 実測（2026-09-03・40 セッション）: Write→Write を含めると 72% が生成物の再出力だったため、先行操作を Read/Edit に限る。
          // sidechain（サブエージェント）の操作は steps と同じく対象外にして対称にする。
          if (!rec.isSidechain && target) {
            if (name === 'Write' && seenFileTargets.has(target) && rewrites.length < CAP) rewrites.push({ target, turn_idx: turnIdx });
            if (/^(Read|Edit|NotebookEdit|MultiEdit)$/.test(name)) seenFileTargets.add(target);
            else if (name === 'Write') seenFileTargets.delete(target); // Write 後の再 Write は数えない
          }
          if (name === 'Skill' && b.input && (b.input.skill || b.input.command)) invokedSkills.add(b.input.skill || b.input.command);
          else if (name === 'Task' && b.input && b.input.subagent_type) invokedSubagents.add(b.input.subagent_type);
          else if (name === 'Agent' && b.input && b.input.subagent_type) invokedSubagents.add(b.input.subagent_type);
          else if (name.startsWith('mcp__')) invokedMcp.add(name.split('__')[1] || 'unknown');
        }
        // Claude Code の transcript は 1 つの API 応答（message.id）を content block ごとに別レコードへ分割する
        // （実測 2026-09-03: assistant レコードの content 長は常に 1、同じ message.id が連続する）。
        // text と tool_use が別レコードに出るため、message.id で 1 ステップに束ねてから判定する。
        if (!rec.isSidechain) {
          const mid = msg && msg.id;
          const last = steps[steps.length - 1];
          if (mid && last && last.mid === mid) {
            last.tools.push(...stepTools);
            if (stepHasText) last.hasText = true;
          } else if (steps.length < 5000) {
            steps.push({ mid: mid || null, turnIdx, tools: stepTools, hasText: stepHasText });
          } else {
            stepsTruncated = true;
          }
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
    // 結果の無い tool_use＝ターン打ち切り（model-side error 等）の代理。ただし最後に発火した1件は
    // in-flight（まだ結果待ち）でありうるため除外する（増分再取込みで自然に確定する）。
    if (!res && id !== lastToolUseId && orphaned.length < CAP) {
      orphaned.push({ tool: use.name, target: use.target, turn_idx: use.turnIdx });
    }
    // tool_result 本文に作話/混線の痕跡がないか（成功結果でも走査＝R8 は is_error=false で来る）
    if (res && res.text && hallucinations.length < CAP) {
      // 出所を渡し、プロトコル構文を仕様上含むツール（TaskOutput 等）や transcript の読み取りを除外
      const h = detectHallucinationMarkers(res.text, { toolName: use.name, target: use.target });
      if (h.suspected) hallucinations.push({ where: 'tool_result', tool: use.name, markers: h.markers, turn_idx: use.turnIdx });
    }
    const isError = res ? res.isError : false;
    if (isError) {
      c.errors++;
      const errClass = classifyToolResult(use.name, res.text, true);
      if (errClass === 'permission_denied') permissionDenials++;
      const entry = {
        tool: use.name,
        error_class: errClass,
        // 先頭切り詰めでは traceback の例外名など「原因を名指しする行」が落ちるため、
        // 先頭文脈＋シグナル行を優先抽出する（2026-07-27。分類不能プレビューの解消）
        preview_masked: C.signalPreview(res.text, 480),
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
  // モデル挙動の退行（advisory・friction 非算入）。whole_file_rewrite は digest 側で数えて同じ配列に載せる。
  const behaviorSignals = detectModelBehavior(steps);
  if (rewrites.length) behaviorSignals.push({ kind: 'whole_file_rewrite', count: rewrites.length, targets: rewrites.slice(0, 10).map((r) => C.maskPaths(r.target)) });
  if (stepsTruncated) behaviorSignals.push({ kind: 'steps_truncated', count: steps.length }); // 連鎖系は過小評価の可能性（unknown 扱い）

  // friction_score（0..1 決定論合成）
  const totalToolCalls = Object.values(toolCounts).reduce((s, t) => s + t.count, 0);
  const totalToolErrors = Object.values(toolCounts).reduce((s, t) => s + t.errors, 0);
  const errorRate = totalToolCalls ? totalToolErrors / totalToolCalls : 0;
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  // 重みの合計は 1.00（0.35+0.15+0.10+0.10+0.10+0.05+0.10+0.05）。打ち切り・作話を新たに算入。
  const friction = clamp01(
    0.35 * errorRate +
    0.15 * Math.min(1, retries.length / 5) +
    0.10 * Math.min(1, permissionDenials / 3) +
    0.10 * Math.min(1, compactions / 3) +
    0.10 * Math.min(1, interruptions / 3) +
    0.05 * Math.min(1, modelRefusals / 2) +
    0.10 * Math.min(1, orphaned.length / 3) +
    0.05 * Math.min(1, hallucinations.length / 2)
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
      orphaned_tool_use: orphaned,        // 打ち切り（model-side error 等）の代理シグナル
      suspected_hallucinations: hallucinations, // R8: tool-result 作話/混線の痕跡（advisory）
      model_behavior_signals: behaviorSignals,  // v6: Fable 5.1 の既定挙動差分の退行（逐次化・無言連鎖・全文書き直し。advisory）
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
