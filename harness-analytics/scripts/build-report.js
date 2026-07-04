'use strict';
// clusters/latest.json（＋任意の clusters/llm-latest.json）→ 人間が読む HTML/MD レポート。
// 自動書き換えはしない。改善バックログは「示唆」であり採否は人間。

const fs = require('fs');
const path = require('path');
const C = require('./common');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TREND_MARK = { up: '▲', down: '▼', flat: '＝', new: '✦' };

// llm 分析（cluster_id -> { root_cause, target_files[], proposed_edit, confidence, priority }）をマージ
function mergeLlm(clusters, llm) {
  if (!llm) return clusters;
  const byId = {};
  for (const item of (llm.analyses || [])) byId[item.cluster_id] = item;
  for (const c of clusters) if (byId[c.cluster_id]) c.llm = byId[c.cluster_id];
  return clusters;
}

function kpiRow(kpis) {
  const cells = [
    ['セッション', kpis.sessions],
    ['総コスト(概算)', '$' + (kpis.total_cost_usd || 0).toFixed(2)],
    ['ツールエラー率', ((kpis.tool_error_rate || 0) * 100).toFixed(1) + '%'],
    ['compaction/セッション', kpis.compaction_rate],
    ['割り込み/セッション', kpis.interruption_rate],
    ['平均 friction', kpis.avg_friction],
  ];
  return cells.map(([k, v]) => `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-k">${esc(k)}</div></div>`).join('');
}

function clusterRows(clusters) {
  if (!clusters.length) return '<tr><td colspan="7" class="muted">失敗クラスターは検出されませんでした。</td></tr>';
  return clusters.map((c) => {
    const trend = TREND_MARK[c.trend] || '';
    const surface = esc(c.target_surface);
    const fix = esc(c.suggested_fix);
    const conf = c.llm && c.llm.confidence != null ? ` <span class="badge">conf ${esc(c.llm.confidence)}</span>` : '';
    const files = c.llm && c.llm.target_files ? `<div class="files">→ ${c.llm.target_files.map(esc).join(', ')}</div>` : '';
    const cause = c.llm && c.llm.root_cause ? `<div class="cause">根因: ${esc(c.llm.root_cause)}</div>` : '';
    return `<tr>
      <td><code>${esc(c.error_class)}</code><br><span class="muted">${esc(c.tool)}</span></td>
      <td class="num">${esc(c.count)}</td>
      <td class="num">${esc(c.affected_sessions)}</td>
      <td class="num">${trend}</td>
      <td class="num">$${(c.cost_impact_usd || 0).toFixed(2)}</td>
      <td>${fix}${conf}<div class="surface">面: ${surface}</div>${cause}${files}</td>
      <td class="ex">${(c.examples || []).map((e) => `<div>${esc(e.preview)}</div>`).join('') || '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
}

function toolRows(byTool) {
  const rows = Object.entries(byTool || {})
    .map(([name, t]) => ({ name, count: t.count, errors: t.errors, rate: t.count ? t.errors / t.count : 0 }))
    .sort((a, b) => b.errors - a.errors || b.count - a.count)
    .slice(0, 15);
  if (!rows.length) return '<tr><td colspan="4" class="muted">—</td></tr>';
  return rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${r.errors}</td><td class="num">${(r.rate * 100).toFixed(1)}%</td></tr>`).join('');
}

function hotspotRows(hotspots) {
  if (!hotspots || !hotspots.length) return '<tr><td colspan="3" class="muted">—</td></tr>';
  return hotspots.slice(0, 8).map((h) => `<tr><td class="mono">${esc((h.cwd_slug || '').replace(/^-/, '').slice(0, 40))}</td><td class="num">$${(h.cost_usd || 0).toFixed(2)}</td><td class="num">${h.friction != null ? h.friction : ''}</td></tr>`).join('');
}

function backlog(clusters) {
  // LLM priority があればそれ順、無ければ count 順
  const items = [...clusters].sort((a, b) => {
    const pa = a.llm && a.llm.priority != null ? a.llm.priority : 99;
    const pb = b.llm && b.llm.priority != null ? b.llm.priority : 99;
    if (pa !== pb) return pa - pb;
    return b.count - a.count;
  });
  if (!items.length) return '<li class="muted">改善候補なし</li>';
  return items.slice(0, 12).map((c) => {
    const target = c.llm && c.llm.target_files && c.llm.target_files.length ? c.llm.target_files.join(', ') : c.target_surface;
    return `<li><b>${esc(c.suggested_fix)}</b> <span class="muted">（${esc(c.error_class)}/${esc(c.tool)}・${c.count}件）</span><br><span class="surface">対象: ${esc(target)}</span></li>`;
  }).join('');
}

function html(data) {
  const { window: win, generated_at, kpis, clusters } = data;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness-analytics レポート</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#777; --line:#e3e3e3; --card:#f7f7f8; --accent:#3b5bdb; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16171a; --fg:#e8e8e8; --muted:#999; --line:#2c2e33; --card:#1e2024; --accent:#748ffc; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font-family:-apple-system,"Hiragino Sans","Segoe UI",sans-serif; line-height:1.6; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:15px; margin:28px 0 10px; border-left:3px solid var(--accent); padding-left:8px; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:16px; }
  .kpis { display:flex; flex-wrap:wrap; gap:10px; }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; min-width:120px; flex:1; }
  .kpi-v { font-size:22px; font-weight:700; } .kpi-k { font-size:11px; color:var(--muted); }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  td.num { text-align:right; white-space:nowrap; } td.mono,.mono { font-family:ui-monospace,monospace; font-size:11px; }
  code { background:var(--card); padding:1px 5px; border-radius:4px; font-size:12px; }
  .muted { color:var(--muted); } .surface { color:var(--muted); font-size:11px; margin-top:2px; }
  .cause { font-size:12px; margin-top:3px; } .files { font-family:ui-monospace,monospace; font-size:11px; color:var(--accent); margin-top:2px; }
  .badge { background:var(--accent); color:#fff; border-radius:4px; padding:0 5px; font-size:10px; }
  .ex div { font-family:ui-monospace,monospace; font-size:10px; color:var(--muted); border-bottom:1px dashed var(--line); padding:2px 0; }
  ol.backlog { padding-left:20px; } ol.backlog li { margin:8px 0; }
  .note { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 14px; font-size:12px; color:var(--muted); margin-top:24px; }
</style></head><body>
<h1>harness-analytics レポート</h1>
<div class="meta">窓: ${esc(win)}　生成: ${esc(generated_at)}　※コストは概算・改善は示唆（自動適用なし）</div>
<h2>KPI</h2><div class="kpis">${kpiRow(kpis)}</div>
<h2>失敗クラスター（改善対象の示唆）</h2><div class="scroll"><table>
<thead><tr><th>クラス/ツール</th><th>件数</th><th>影響<br>session</th><th>傾向</th><th>コスト影響</th><th>改善示唆</th><th>例(マスク済)</th></tr></thead>
<tbody>${clusterRows(clusters)}</tbody></table></div>
<h2>改善バックログ（優先度順・採否は人間）</h2><ol class="backlog">${backlog(clusters)}</ol>
<h2>ツール別信頼性</h2><div class="scroll"><table>
<thead><tr><th>ツール</th><th>回数</th><th>エラー</th><th>エラー率</th></tr></thead>
<tbody>${toolRows(kpis.by_tool)}</tbody></table></div>
<h2>コストホットスポット（セッション）</h2><div class="scroll"><table>
<thead><tr><th>プロジェクト</th><th>コスト</th><th>friction</th></tr></thead>
<tbody>${hotspotRows(kpis.cost_hotspots)}</tbody></table></div>
<div class="note">harness-analytics は Claude Code の transcript を機械可読ダイジェストに集約し、失敗パターンを分析して改善対象を示唆します。生ログの secret/パスはマスク済み。このレポートはローカル生成です。</div>
</body></html>`;
}

function markdown(data) {
  const { window: win, generated_at, kpis, clusters } = data;
  const lines = [];
  lines.push(`# harness-analytics レポート`, ``, `- 窓: ${win}`, `- 生成: ${generated_at}`, `- 注: コストは概算、改善は示唆（自動適用なし）`, ``);
  lines.push(`## KPI`, ``);
  lines.push(`| 指標 | 値 |`, `|---|---|`);
  lines.push(`| セッション | ${kpis.sessions} |`);
  lines.push(`| 総コスト(概算) | $${(kpis.total_cost_usd || 0).toFixed(2)} |`);
  lines.push(`| ツールエラー率 | ${((kpis.tool_error_rate || 0) * 100).toFixed(1)}% |`);
  lines.push(`| compaction/セッション | ${kpis.compaction_rate} |`);
  lines.push(`| 割り込み/セッション | ${kpis.interruption_rate} |`);
  lines.push(`| 平均 friction | ${kpis.avg_friction} |`, ``);
  lines.push(`## 失敗クラスター`, ``);
  lines.push(`| クラス/ツール | 件数 | 影響 | 傾向 | 改善示唆 | 対象面 |`, `|---|---|---|---|---|---|`);
  for (const c of clusters) {
    lines.push(`| ${c.error_class}/${c.tool} | ${c.count} | ${c.affected_sessions} | ${c.trend || ''} | ${c.suggested_fix} | ${c.target_surface} |`);
  }
  lines.push(``, `## 改善バックログ（採否は人間）`, ``);
  for (const c of [...clusters].slice(0, 12)) {
    const target = c.llm && c.llm.target_files ? c.llm.target_files.join(', ') : c.target_surface;
    lines.push(`- **${c.suggested_fix}**（${c.error_class}/${c.tool}・${c.count}件）→ 対象: ${target}`);
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  const clustersPath = C.getFlag(args, 'clusters', true, path.join(C.CLUSTERS_DIR, 'latest.json'));
  const llmPath = C.getFlag(args, 'llm', true, path.join(C.CLUSTERS_DIR, 'llm-latest.json'));
  const data = C.readJson(clustersPath, null);
  if (!data) { process.stderr.write('clusters が見つかりません。先に cluster.js を実行してください。\n'); process.exit(1); }
  const llm = fs.existsSync(llmPath) ? C.readJson(llmPath, null) : null;
  data.clusters = mergeLlm(data.clusters || [], llm);

  const htmlPath = path.join(C.REPORTS_DIR, 'latest.html');
  const mdPath = path.join(C.REPORTS_DIR, 'latest.md');
  C.writeText(htmlPath, html(data));
  C.writeText(mdPath, markdown(data));
  // 履歴
  C.writeText(path.join(C.HISTORY_DIR, C.today(), 'report.html'), html(data));

  process.stdout.write(JSON.stringify({ html: htmlPath, md: mdPath, clusters: (data.clusters || []).length }) + '\n');
}

module.exports = { html, markdown, mergeLlm };

if (require.main === module) main();
