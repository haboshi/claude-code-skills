'use strict';
// ダイジェスト集合 → KPI 集計（純関数）。cluster.js / build-report.js が利用。

// digests: セッションダイジェスト配列
function computeKpis(digests) {
  const n = digests.length;
  let totalCost = 0, toolCalls = 0, toolErrors = 0, compactions = 0, interruptions = 0, frictionSum = 0;
  let orphanTotal = 0, orphanSessions = 0, hallucTotal = 0, hallucSessions = 0;
  const byTool = {}; // name -> { count, errors }
  const costBySession = [];
  const compactionBySession = [];

  for (const d of digests) {
    totalCost += d.cost_usd || 0;
    compactions += (d.turns && d.turns.compactions) || 0;
    interruptions += d.interruptions || 0;
    frictionSum += d.friction_score || 0;
    const fsig = d.failure_signals || {};
    const on = (fsig.orphaned_tool_use || []).length;
    const hn = (fsig.suspected_hallucinations || []).length;
    orphanTotal += on; if (on) orphanSessions++;
    hallucTotal += hn; if (hn) hallucSessions++;
    for (const [name, t] of Object.entries(d.tools || {})) {
      const bt = byTool[name] || { count: 0, errors: 0 };
      bt.count += t.count || 0; bt.errors += t.errors || 0; byTool[name] = bt;
      toolCalls += t.count || 0; toolErrors += t.errors || 0;
    }
    costBySession.push({ session_id: d.session_id, cwd_slug: d.cwd_slug, cost_usd: d.cost_usd || 0, friction: d.friction_score || 0 });
    if ((d.turns && d.turns.compactions) || 0) {
      compactionBySession.push({ session_id: d.session_id, cwd_slug: d.cwd_slug, compactions: d.turns.compactions });
    }
  }

  costBySession.sort((a, b) => b.cost_usd - a.cost_usd);
  compactionBySession.sort((a, b) => b.compactions - a.compactions);

  return {
    sessions: n,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
    tool_calls: toolCalls,
    tool_errors: toolErrors,
    tool_error_rate: toolCalls ? Math.round((toolErrors / toolCalls) * 1000) / 1000 : 0,
    compaction_rate: n ? Math.round((compactions / n) * 100) / 100 : 0,
    interruption_rate: n ? Math.round((interruptions / n) * 100) / 100 : 0,
    avg_friction: n ? Math.round((frictionSum / n) * 100) / 100 : 0,
    // ハーネス健全性（v3 新規）: 従来 digest で不可視だった打ち切り・作話の可視化
    orphaned_total: orphanTotal,
    orphaned_sessions: orphanSessions,
    hallucination_total: hallucTotal,
    hallucination_sessions: hallucSessions,
    by_tool: byTool,
    cost_hotspots: costBySession.slice(0, 10),
    compaction_hotspots: compactionBySession.slice(0, 10),
  };
}

module.exports = { computeKpis };
