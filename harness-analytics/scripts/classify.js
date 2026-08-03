'use strict';
// 失敗シグナルの決定論的分類。tool_result.content（テキスト化済み）を正規表現で error_class に写像。
// LLM は一切使わない。分類は「明らかな欠落の検出」レベルの補助であり、確信度は cluster 段で扱う。

// 判定順に評価（先勝ち）。ラベルは harness-research/06 の remediation テーブルのキーに対応。
// 第3要素（任意）は toolName ゲート: 指定時、マッチするツールにのみそのルールを適用する。
// （実データ 2026-07-26: Edit 専用の /no match/ が zsh の「no matches found:」等 Bash 出力に誤爆し
//  edit_no_match/Bash 偽クラスター49件を生んでいた。）
const RULES = [
  // guard_block: フック/分類器が危険操作を正しく阻止した「防御成功」。失敗ではないため permission_denied より前段で捕捉し、
  // クラスターとして可視化しつつ失敗集計から分離できるようにする（secret-leak-guard / commit-test-guard / git-commit-gate /
  // 理由なし skip-gate / auto mode の Create Unsafe Agents 等）。「Blocked: sleep」等の行動起因ブロックは permission_denied に残す。
  ['guard_block', /\[Hook\]\s*BLOCKED|BLOCKED \((?:secret-leak-guard|commit-test-guard|git-commit-gate|[a-z-]*guard|[a-z-]*gate)\)|Create Unsafe Agents|dangerously-skip-permissions|に理由がありません|skip.{0,8}キーワードに理由/i],
  ['unavailable', /temporarily unavailable|cannot determine the safety|auto mode cannot|service unavailable|overloaded/i],
  ['permission_denied', /permission denied|permission for this action was denied|denied by the .*classifier|was blocked|\bblocked:|may only (?:list|access|read|write)|not permitted|user (?:denied|declined|rejected)|requires approval|operation not permitted/i],
  ['file_not_read', /file has not been read yet|read it first|must read the file|has not been read/i],
  ['edit_no_match', /string not found|string to replace (?:was )?not found|not find the string|old_string.*not|no match|to replace was not found|found \d+ matches/i, /^(Edit|Write|NotebookEdit|MultiEdit)$/],
  ['not_found', /\bENOENT\b|no such file or directory|file does not exist|command not found|not found:|no matches found/i],
  // timeout は Bash ではハーネスの kill 文言に限定する（Playwright の locator.waitFor / TLS handshake timeout /
  // commit message 内の "timeout" 文字列等の部分一致誤爆が実測 9/41=22% あったため。非 Bash は従来どおり）。
  ['timeout', /command timed out after|exit code 143/i, /^Bash$/],
  ['timeout', /timed out|timeout|etimedout|deadline exceeded/i, /^(?!Bash$)/],
  ['test_failure', /test(?:s)? failed|assertion(?:error)?|\b\d+ failed\b|expect(?:ed)?.*received|✗|FAIL /i],
  ['type_error', /\bTS\d{3,}\b|type error|typeerror|is not assignable|cannot find name|has no exported member/i],
  ['mcp_error', /mcp error|-32\d{3}|input validation error|tool ran without|mcp__/i],
  // script_error: インライン script（python -c / node -e / heredoc / zsh 展開）の構文・実行時エラー。
  // command_failed の雑多バケットから「行動で直せる失敗」（クォート崩れ・データ形状の思い込み）を分離する。
  // 2026-07-27: 素の traceback 一致は Swift コンパイル / prisma / PostgREST 由来の非 script 失敗を
  //   18% 取り込んでいた（実測）。インライン実行の痕跡（<string>/<stdin>/(eval)/-c/-e/heredoc）か、
  //   インライン script 固有の構文エラー語との組合せに限定する。
  ['script_error', /(?:traceback \(most recent call last\)[\s\S]{0,400}?(?:file "<(?:string|stdin)>"|line \d+, in <module>))|(?:^|[^\w])(?:\(eval\)|\[eval\]):\d+|bad substitution|invalid or unexpected token|json\.decoder|unexpected end of (?:file|input)|unexpected eof/i, /^Bash$/],
  ['command_failed', /exit code [1-9]|non-zero exit|command failed|returned error|\bstderr\b/i],
];

// Edit/Write 系のみで意味を持つ細分類（他ツールへ誤適用しないよう toolName でゲート）。
const EDIT_TOOLS = /^(Edit|Write|NotebookEdit|MultiEdit)$/;

// tool_result のテキストと is_error から error_class を返す。エラーでなければ null。
function classifyToolResult(toolName, text, isError) {
  if (!isError) return null;
  const t = String(text || '');
  // Edit 系の other を no_op（old==new・既適用の再送）/ stale_read（Read 後に formatter/linter/ユーザーが変更）へ細分化。
  if (EDIT_TOOLS.test(String(toolName || ''))) {
    if (/no changes to make|old_string and new_string are exactly the same/i.test(t)) return 'no_op';
    if (/has been modified since (?:you )?read|modified since read|read it again before attempt/i.test(t)) return 'stale_read';
  }
  for (const [label, re, toolGate] of RULES) {
    if (toolGate && !toolGate.test(String(toolName || ''))) continue;
    if (re.test(t)) return demoteProbe(label, toolName, t);
  }
  return 'other';
}

// command_failed(Bash) の後処理: 診断プローブの「期待どおりの非ゼロ」を probe_nonzero に分離する。
// 実測（2026-07-26・14日窓）: 失敗 Bash の61.3%がプローブ形（===/--- バナー・末尾 grep/wc/test/diff）で、
// `;` 連鎖の終了コードを最終段の「問い」（空振り=1）が決めて is_error 化していた。件数≠ミス数。
// ヒューリスティック: エラーらしいトークンが無く、(a) 実質的な出力がある（プローブは成果を出している）か
// (b) 出力ゼロの bare exit（bare grep 空振りの典型）なら probe_nonzero。誤爆코스트は低い（良性クラスとして
// hero/優先度から外れるだけで、詳細表には残る）。
// 2026-07-27 精度検収（実データ156件の目視サンプル）で12%の誤分類が判明したため語彙を拡張:
// daemon 不達（"not running" / "closed the connection"）・クォート崩れ（"unmatched"）・
// テスト結果の混入（"Test Suites:"）は良性ではなく本物の失敗。
const ERRORISH = /error|fatal|denied|refused|conflict|abort|exception|traceback|failed|ignored by|did not match|cannot|unable|missing|invalid|unmatched|not running|closed the connection|test suites:|parse error|no such/i;
function demoteProbe(label, toolName, t) {
  if (label !== 'command_failed' || !/^Bash$/.test(String(toolName || ''))) return label;
  if (ERRORISH.test(t)) return label;
  const body = String(t).replace(/exit code \d+/gi, '').trim();
  if (body.length === 0 || body.length > 40) return 'probe_nonzero';
  return label;
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

// R8: tool_result の作話/混線（tool-result hallucination）の痕跡検出（決定論・弱シグナル）。
// 実データ検証（2026-07-12）で、低精度マーカー（<invoke>・<parameter name=・%{...}）は skill/agent/hook を
// オーサリングする正当なテキストと区別できず誤検知支配になることが判明（assistant_text 284件が全て低精度由来）。
// そのため suspected 判定は「高精度マーカー（HP）のみ」に限定する。低精度は診断用に markers へ記録するが
// 単独では suspected にしない（rules: verification-integrity R4/R5・hook-authoring R3=ノイズ advisory の禁止）。
const HALLUC_MARKERS = [
  ['result_name_combo', /<result>\s*\n?\s*<name>/],       // 高精度: 漏洩した tool_result エンコード（<result><name>…）
  ['tool_use_id_leak', /"tool_use_id"\s*:/],              // 高精度: 内部フィールドの漏洩
  ['invoke_tag', /<\/?(?:antml:)?invoke\b/],              // 低精度: <invoke> タグ断片（オーサリングで頻出＝診断のみ）
  ['parameter_tag', /<(?:antml:)?parameter\s+name=/],     // 低精度: <parameter name=…> 断片（診断のみ）
  ['format_specifier_output', /%\{http_code\}|%\{[a-z_]+\}/], // 低精度: フォーマット指定子（curl -w 等で正当に出る＝診断のみ）
];
const HALLUC_HP = new Set(['result_name_combo', 'tool_use_id_leak']);

// プロトコル構文を「仕様上」含むツール結果の出所か（2026-07-27 追加）。
// 実測: 作話疑い9件中6件が (a) TaskOutput（サブエージェント transcript をそのまま返す）と
// (b) transcript/ログファイルの Read で、いずれも tool_use_id を含むのが正常動作＝誤検知だった。
// これらを除外しないと「作話疑い」KPI が観測行為そのものに反応して膨らむ（自己言及ノイズ）。
const PROTOCOL_BEARING_TOOLS = /^(TaskOutput|TaskGet|TaskList)$/;
const TRANSCRIPT_TARGET = /\.jsonl$|[/\\](?:projects|logs|tasks|transcripts?)[/\\]|transcript|guard-activity|harness-analytics/i;
function isProtocolBearingSource(toolName, target) {
  if (PROTOCOL_BEARING_TOOLS.test(String(toolName || ''))) return true;
  return TRANSCRIPT_TARGET.test(String(target || ''));
}

// text から作話痕跡マーカーを検出。{ suspected, markers } を返す（markers はマッチした kind の配列）。
// suspected は高精度マーカーが1つ以上あるときのみ true（低精度は誤検知源のため単独では立てない）。
// opts.toolName / opts.target を渡すと、プロトコル構文を仕様上含む出所（TaskOutput・transcript の
// Read/Bash）を suspected から除外する（markers は診断用に残す）。
function detectHallucinationMarkers(text, opts = {}) {
  const t = String(text || '');
  const markers = [];
  for (const [kind, re] of HALLUC_MARKERS) if (re.test(t)) markers.push(kind);
  let suspected = markers.some((m) => HALLUC_HP.has(m));
  if (suspected && isProtocolBearingSource(opts.toolName, opts.target)) suspected = false;
  return { suspected, markers };
}

module.exports = { classifyToolResult, detectRetries, detectDrift, detectHallucinationMarkers, RULES };
