'use strict';
// 失敗クラスター集計（決定論・LLM 不使用）。窓内のセッションダイジェストを読み、
// failure_signals を (error_class × tool) でグルーピングし、頻度・影響セッション・代表例・
// トレンド・コスト影響・remediation（改善対象面）を付与して clusters/latest.json を書く。
// あわせて KPI(rollups) を保存し、高シグナルを FetchDB outbox に queue する。

const fs = require('fs');
const path = require('path');
const C = require('./common');
const { computeKpis } = require('./rollup');
const { FetchDbOutboxSink } = require('./sinks');

// error_class → 改善示唆（fix）と改善対象面（surface）。harness-research/06 の remediation テーブル準拠。
const REMEDIATION = {
  file_not_read: { fix: 'Edit/Write の前に必ず Read で対象を読む', surface: 'CLAUDE.md / rules(surgical-changes, coding-style)' },
  edit_no_match: { fix: 'Edit の old_string を一意・十分な文脈付きにし、失敗時は Read で再確認', surface: '作業手順 / Edit 粒度' },
  permission_denied: { fix: '反復する許可対象を settings.json の allow に追加、または操作方針を見直す', surface: '.claude/settings.json (permissions)' },
  not_found: { fix: 'パス/コマンドの存在を事前確認（ls / which）', surface: '作業手順' },
  timeout: { fix: '長時間コマンドは run_in_background 化、タイムアウト値を見直す', surface: 'コマンド実行方針' },
  test_failure: { fix: 'テスト失敗の根因を修正（テストを甘くしない）', surface: '実装 / テスト' },
  type_error: { fix: '型不一致・未 export を解消してから進める', surface: '実装 / 型' },
  mcp_error: { fix: 'MCP スキーマドリフト対応（サーバ再起動 / 引数見直し）', surface: 'rules(mcp-schema-drift)' },
  command_failed: { fix: 'コマンドの引数・前提条件を確認', surface: 'コマンド実行方針' },
  unavailable: { fix: '一時的な不可用（モデル/auto mode）。リトライ、または auto mode の許可設定を見直す', surface: 'auto mode / settings.json' },
  other: { fix: '個別調査が必要', surface: '—' },
};

// 窓内のダイジェストを読み込む
function loadDigests(cutoffMs) {
  const digests = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) {
        const d = C.readJson(full, null);
        if (!d || !d.session_id) continue;
        const endMs = d.ended_at ? Date.parse(d.ended_at) : 0;
        if (endMs && endMs < cutoffMs) continue;
        digests.push(d);
      }
    }
  };
  walk(C.DIGESTS_DIR);
  return digests;
}

function buildClusters(digests) {
  const groups = new Map(); // key -> cluster
  for (const d of digests) {
    const errs = (d.failure_signals && d.failure_signals.tool_errors) || [];
    for (const e of errs) {
      const cls = e.error_class || 'other';
      const tool = e.tool || 'unknown';
      const key = `${cls}::${tool}`;
      let g = groups.get(key);
      if (!g) {
        const rem = REMEDIATION[cls] || REMEDIATION.other;
        g = {
          cluster_id: key.replace(/::/g, '-'),
          error_class: cls, tool,
          count: 0,
          affected_sessions: new Set(),
          cost_impact_usd: 0,
          examples: [],
          suggested_fix: rem.fix,
          target_surface: rem.surface,
        };
        groups.set(key, g);
      }
      g.count++;
      g.affected_sessions.add(d.session_id);
      if (g.examples.length < 3) {
        g.examples.push({ session_id: d.session_id, cwd_slug: d.cwd_slug, turn_idx: e.turn_idx, preview: C.sanitize(e.preview_masked || '', 200) });
      }
    }
    // コスト影響: 当該セッションに該当クラスがあれば加算（重複加算を避けるためセッション単位で）
  }
  // コスト影響をセッション単位で加算
  for (const d of digests) {
    const errs = (d.failure_signals && d.failure_signals.tool_errors) || [];
    const seen = new Set();
    for (const e of errs) {
      const key = `${e.error_class || 'other'}::${e.tool || 'unknown'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const g = groups.get(key);
      if (g) g.cost_impact_usd += d.cost_usd || 0;
    }
  }
  const clusters = [...groups.values()].map((g) => ({
    cluster_id: g.cluster_id,
    error_class: g.error_class,
    tool: g.tool,
    count: g.count,
    affected_sessions: g.affected_sessions.size,
    cost_impact_usd: Math.round(g.cost_impact_usd * 10000) / 10000,
    suggested_fix: g.suggested_fix,
    target_surface: g.target_surface,
    examples: g.examples,
    llm: null, // Phase2: SKILL が subagent 分析を後埋め
  }));
  clusters.sort((a, b) => b.count - a.count || b.affected_sessions - a.affected_sessions);
  return clusters;
}

// 前回 rollup と比較してトレンド矢印を付ける
function attachTrend(clusters, prevRollup) {
  const prevCounts = {};
  if (prevRollup && Array.isArray(prevRollup.clusters)) {
    for (const c of prevRollup.clusters) prevCounts[c.cluster_id] = c.count;
  }
  for (const c of clusters) {
    const prev = prevCounts[c.cluster_id];
    if (prev === undefined) c.trend = 'new';
    else if (c.count > prev) c.trend = 'up';
    else if (c.count < prev) c.trend = 'down';
    else c.trend = 'flat';
  }
  return clusters;
}

function main() {
  const args = process.argv.slice(2);
  const config = C.loadConfig();
  const win = C.getFlag(args, 'window', true, (config.analysis && config.analysis.window) || '14d');
  const cutoffMs = Date.now() - C.windowToMs(win);

  const digests = loadDigests(cutoffMs);
  const kpis = computeKpis(digests);

  const prevRollup = C.readJson(path.join(C.ROLLUPS_DIR, 'latest.json'), null);
  let clusters = buildClusters(digests);
  clusters = attachTrend(clusters, prevRollup);

  const out = {
    generated_at: C.nowIso(),
    window: win,
    kpis,
    clusters,
  };
  C.writeJson(path.join(C.CLUSTERS_DIR, 'latest.json'), out);
  C.writeJson(path.join(C.ROLLUPS_DIR, `daily-${C.today()}.json`), { generated_at: out.generated_at, window: win, kpis, clusters });
  C.writeJson(path.join(C.ROLLUPS_DIR, 'latest.json'), { generated_at: out.generated_at, window: win, kpis, clusters });

  // 高シグナルを FetchDB outbox に queue（config で ON のときのみ）
  const fetchSink = new FetchDbOutboxSink(config);
  if (fetchSink.available()) {
    const topK = (config.analysis && config.analysis.top_k_clusters) || 8;
    for (const c of clusters.slice(0, topK)) {
      fetchSink.emit({
        type: 'failure',
        peer: 'assistant',
        content: `[${c.error_class}/${c.tool}] ${c.suggested_fix}（${c.count}件 / ${c.affected_sessions}セッション）`,
        tags: ['harness-analytics', `cluster:${c.cluster_id}`],
        impact_scope: 'local',
        tool_source: 'claude_code',
        severity: 'failure',
      });
    }
    fetchSink.flush();
  }

  process.stdout.write(JSON.stringify({
    sessions: kpis.sessions, clusters: clusters.length,
    top: clusters.slice(0, 5).map((c) => ({ id: c.cluster_id, count: c.count, trend: c.trend })),
  }) + '\n');
}

module.exports = { buildClusters, attachTrend, loadDigests, REMEDIATION };

if (require.main === module) main();
