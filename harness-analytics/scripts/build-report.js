'use strict';
// clusters/latest.json（＋任意の clusters/llm-latest.json）→ 人間が読む HTML/MD レポート。
// 視覚優先: ヒーロー→優先度マップ→内訳チャート→指摘の詳細（master-detail）→バックログ→詳細表。
// ライト既定＋トグル・レスポンシブ（横幅フル活用）。自動書き換えはしない（示唆のみ）。

const fs = require('fs');
const path = require('path');
const C = require('./common');
const CH = require('./charts');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TREND_MARK = { up: '▲', down: '▼', flat: '＝', new: '✦' };
const CRIT = 'var(--c-crit)', WARN = 'var(--c-warn)', ACCENT = 'var(--c-accent)', GOOD = 'var(--c-good)';

// llm 分析をマージ（絶対パス等を maskPaths で畳む＝path-privacy）
function mergeLlm(clusters, llm) {
  if (!llm) return clusters;
  const byId = {};
  for (const item of (llm.analyses || [])) byId[item.cluster_id] = item;
  for (const c of clusters) {
    const a = byId[c.cluster_id];
    if (!a) continue;
    c.llm = {
      ...a,
      root_cause: a.root_cause ? C.maskPaths(a.root_cause) : a.root_cause,
      proposed_edit: a.proposed_edit ? C.maskPaths(a.proposed_edit) : a.proposed_edit,
      target_files: Array.isArray(a.target_files) ? a.target_files.map((f) => C.maskPaths(f)) : a.target_files,
    };
  }
  return clusters;
}

const scoreOf = (c) => (c.count || 0) * (c.affected_sessions || 0);

function prioritize(clusters) {
  const problems = (clusters || []).filter((c) => !c.is_defense);
  const defenses = (clusters || []).filter((c) => c.is_defense);
  const byScore = [...problems].sort((a, b) => scoreOf(b) - scoreOf(a));
  const byLlm = problems.filter((c) => c.llm && c.llm.priority != null).sort((a, b) => a.llm.priority - b.llm.priority);
  const hero = byLlm[0] || byScore[0] || null;
  return { problems, defenses, byScore, hero };
}

// クラスターの「問題」テキスト（画像/before-after 用）
function problemText(c) {
  if (c.llm && c.llm.root_cause) return c.llm.root_cause;
  if (c.examples && c.examples[0] && c.examples[0].preview) return c.examples[0].preview;
  return `${c.error_class} が ${c.tool} で ${c.count} 回発生`;
}

function heroCard(hero) {
  if (!hero) {
    return `<div class="hero ok"><div class="hero-eyebrow">最優先の問題</div>
      <div class="hero-title">優先度の高い失敗は検出されませんでした 🎉</div>
      <div class="hero-body muted">窓内のセッションで、まとまった失敗クラスターはありません。</div></div>`;
  }
  const name = `${esc(hero.error_class)} <span class="muted">/ ${esc(hero.tool)}</span>`;
  const chips = [
    `${hero.count}件`, `${hero.affected_sessions} セッションに影響`,
    `コスト影響 $${(hero.cost_impact_usd || 0).toFixed(2)}`, `優先度スコア ${scoreOf(hero)}`,
  ].map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const files = hero.llm && hero.llm.target_files && hero.llm.target_files.length
    ? hero.llm.target_files.map(esc).join(', ') : esc(hero.target_surface);
  const cause = hero.llm && hero.llm.root_cause ? `<div class="hero-cause"><b>根因（推定）:</b> ${esc(hero.llm.root_cause)}</div>` : '';
  const conf = hero.llm && hero.llm.confidence != null ? `<span class="badge">確信度 ${esc(hero.llm.confidence)}</span>` : '';
  return `<div class="hero"><div class="hero-eyebrow">まず直すべき1件</div>
    <div class="hero-title">${name}</div>
    <div class="hero-chips">${chips}</div>
    <div class="hero-fix"><b>推奨対応:</b> ${esc(hero.suggested_fix)} ${conf}</div>
    <div class="hero-target">直す場所: <code>${files}</code></div>
    ${cause}</div>`;
}

function clustersChart(byScore) {
  const items = byScore.slice(0, 8).map((c, i) => ({
    label: `${c.error_class}/${c.tool}`, value: c.count,
    sub: c.affected_sessions ? `${c.affected_sessions} セッション` : '',
    color: i === 0 ? CRIT : i === 1 ? WARN : ACCENT,
  }));
  return CH.rankedBars(items, { unit: '' });
}
function toolChart(byTool) {
  const items = Object.entries(byTool || {})
    .map(([name, t]) => ({ name, count: t.count || 0, errors: t.errors || 0, rate: t.count ? t.errors / t.count : 0 }))
    .filter((r) => r.errors > 0).sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, 8)
    .map((r) => ({ label: r.name, value: r.rate, sub: `${r.errors}/${r.count} 回`, color: ACCENT }));
  return CH.rankedBars(items, { unit: '%', max: 1 });
}
function costChart(hotspots) {
  const items = (hotspots || []).slice(0, 8).map((h) => {
    const full = C.maskPaths(String(h.cwd_slug || '').replace(/-/g, '/'));
    const label = full.length > 34 ? '…' + full.slice(-33) : full;
    return { label, value: h.cost_usd || 0, sub: h.friction != null ? `friction ${h.friction}` : '', color: ACCENT };
  });
  return CH.rankedBars(items, { unit: '$' });
}

// ---- 指摘の詳細（master-detail）----
function clusterListItem(c, i) {
  const trend = TREND_MARK[c.trend] || '';
  return `<li class="cl-item${i === 0 ? ' active' : ''}" data-cluster="${esc(c.cluster_id)}" tabindex="0" role="button">
    <span class="cl-name">${esc(c.error_class)}<span class="muted">/${esc(c.tool)}</span></span>
    <span class="cl-meta">${c.count}件・${c.affected_sessions}s ${trend}</span></li>`;
}
function clusterDetailBlock(c, i, imageIndex) {
  const idx = imageIndex && imageIndex[c.cluster_id];
  const visual = idx && idx.hash
    ? `<img class="cl-img" loading="lazy" alt="問題→改善の図解" src="../infographics/${esc(idx.hash)}/image.jpg">`
    : CH.beforeAfterCard(problemText(c), c.suggested_fix);
  const conf = c.llm && c.llm.confidence != null ? `<span class="badge">確信度 ${esc(c.llm.confidence)}</span>` : '';
  const chips = [`${c.count}件`, `${c.affected_sessions} セッション`, `コスト影響 $${(c.cost_impact_usd || 0).toFixed(2)}`]
    .map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const rootCause = c.llm && c.llm.root_cause ? `<div class="cl-block"><h4>根因（推定）</h4><p>${esc(c.llm.root_cause)}</p></div>` : '';
  const exList = (c.examples || []).map((e) => `<div class="cl-ex">${esc(e.preview)}</div>`).join('');
  const examples = exList ? `<div class="cl-block"><h4>実例（マスク済）</h4>${exList}</div>` : '';
  const files = c.llm && c.llm.target_files && c.llm.target_files.length ? c.llm.target_files.map(esc).join(', ') : esc(c.target_surface);
  const proposed = c.llm && c.llm.proposed_edit
    ? `<div class="cl-block"><h4>提案編集 <span class="muted">（提案・未適用）</span></h4><pre class="cl-edit">${esc(c.llm.proposed_edit)}</pre></div>` : '';
  return `<article class="cl-detail${i === 0 ? ' active' : ''}" data-cluster="${esc(c.cluster_id)}"${i === 0 ? '' : ' hidden'}>
    <div class="cl-head"><h3>${esc(c.error_class)} <span class="muted">/ ${esc(c.tool)}</span> ${conf}</h3><div class="hero-chips">${chips}</div></div>
    <div class="cl-visual">${visual}</div>
    ${rootCause}
    <div class="cl-block"><h4>推奨対応</h4><p>${esc(c.suggested_fix)}</p><div class="surface">直す場所: <code>${files}</code></div></div>
    ${proposed}${examples}</article>`;
}
function renderClusterSection(problems, imageIndex) {
  const top = problems.slice(0, 12);
  if (!top.length) return '<p class="muted">指摘はありません。</p>';
  const list = top.map((c, i) => clusterListItem(c, i)).join('');
  const details = top.map((c, i) => clusterDetailBlock(c, i, imageIndex)).join('');
  return `<div class="cluster-md">
    <ul class="cl-list">${list}</ul>
    <div class="cl-panel">${details}</div>
  </div>`;
}

function backlog(clusters) {
  const items = [...clusters].filter((c) => !c.is_defense).sort((a, b) => {
    const pa = a.llm && a.llm.priority != null ? a.llm.priority : 99;
    const pb = b.llm && b.llm.priority != null ? b.llm.priority : 99;
    if (pa !== pb) return pa - pb;
    return scoreOf(b) - scoreOf(a);
  });
  if (!items.length) return '<li class="muted">改善候補なし</li>';
  return items.slice(0, 10).map((c) => {
    const target = c.llm && c.llm.target_files && c.llm.target_files.length ? c.llm.target_files.join(', ') : c.target_surface;
    return `<li><b>${esc(c.suggested_fix)}</b> <span class="muted">（${esc(c.error_class)}/${esc(c.tool)}・${c.count}件・${c.affected_sessions}セッション）</span><br><span class="surface">対象: ${esc(target)}</span></li>`;
  }).join('');
}

function clusterRows(clusters) {
  if (!clusters.length) return '<tr><td colspan="7" class="muted">失敗クラスターは検出されませんでした。</td></tr>';
  return clusters.map((c) => {
    const trend = TREND_MARK[c.trend] || '';
    const tag = c.is_defense ? ' <span class="badge good">防御成功</span>' : '';
    const files = c.llm && c.llm.target_files ? `<div class="files">→ ${c.llm.target_files.map(esc).join(', ')}</div>` : '';
    return `<tr><td><code>${esc(c.error_class)}</code>${tag}<br><span class="muted">${esc(c.tool)}</span></td>
      <td class="num">${esc(c.count)}</td><td class="num">${esc(c.affected_sessions)}</td><td class="num">${trend}</td>
      <td class="num">$${(c.cost_impact_usd || 0).toFixed(2)}</td>
      <td>${esc(c.suggested_fix)}<div class="surface">面: ${esc(c.target_surface)}</div>${files}</td>
      <td class="ex">${(c.examples || []).map((e) => `<div>${esc(e.preview)}</div>`).join('') || '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
}
function toolTableRows(byTool) {
  const rows = Object.entries(byTool || {}).map(([name, t]) => ({ name, count: t.count, errors: t.errors, rate: t.count ? t.errors / t.count : 0 }))
    .sort((a, b) => b.errors - a.errors || b.count - a.count).slice(0, 15);
  if (!rows.length) return '<tr><td colspan="4" class="muted">—</td></tr>';
  return rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.count}</td><td class="num">${r.errors}</td><td class="num">${(r.rate * 100).toFixed(1)}%</td></tr>`).join('');
}
function kpiRow(kpis) {
  const cells = [
    ['セッション', kpis.sessions], ['総コスト(概算)', '$' + (kpis.total_cost_usd || 0).toFixed(2)],
    ['ツールエラー率', ((kpis.tool_error_rate || 0) * 100).toFixed(1) + '%'], ['compaction/session', kpis.compaction_rate],
    ['割り込み/session', kpis.interruption_rate], ['平均 friction', kpis.avg_friction],
  ];
  return cells.map(([k, v]) => `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-k">${esc(k)}</div></div>`).join('');
}

// ハーネス健全性（v3）: 従来 digest で不可視だった打ち切り・作話を可視化する。
function harnessHealth(kpis) {
  const ot = kpis.orphaned_total || 0, os = kpis.orphaned_sessions || 0;
  const ht = kpis.hallucination_total || 0, hs = kpis.hallucination_sessions || 0;
  const cells = [
    ['打ち切り (orphaned tool_use)', `${ot}件`, `${os} セッション`],
    ['作話疑い (tool-result R8)', `${ht}件`, `${hs} セッション`],
  ];
  const cellHtml = cells.map(([k, v, s]) =>
    `<div class="kpi"><div class="kpi-v">${esc(v)}</div><div class="kpi-k">${esc(k)}<br><span class="muted">${esc(s)}</span></div></div>`).join('');
  return `<h2>ハーネス健全性 — 打ち切り・作話の可視化</h2>
    <div class="kpis" style="grid-template-columns:repeat(2,1fr);max-width:760px">${cellHtml}</div>
    <div class="meta">従来 digest で不可視だった「静かな失敗」。<b>打ち切り</b>＝ツール結果が返る前にターンが切れた回数（model-side error 等の代理シグナル）。<b>作話疑い</b>＝tool_result に内部プロトコル構文が混入した痕跡（advisory・メタ議論由来の誤検知を含みうる）。件数&gt;0 は該当セッションが存在することを示す。</div>`;
}

const STYLE = `
  :root { color-scheme: light;
    --bg:#f4f7f8; --fg:#16242d; --muted:#5b6a74; --line:#dfe6e9; --card:#ffffff; --card2:#eef3f5;
    --c-accent:#0d7d88; --c-crit:#c94a4a; --c-warn:#b9781a; --c-good:#2f8f6b;
    --c-track:#eef3f5; --c-grid:#e6ecee; --c-axis:#7c8b93; --c-tick:#9aa7ae; }
  :root[data-theme="dark"] { color-scheme: dark;
    --bg:#0e1316; --fg:#e6edf1; --muted:#93a2ac; --line:#2a343b; --card:#161d22; --card2:#1b242a;
    --c-accent:#38b8c4; --c-crit:#e2706f; --c-warn:#d59a48; --c-good:#45c48d;
    --c-track:#20272c; --c-grid:#252d33; --c-axis:#8a99a3; --c-tick:#6f7f89; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family:-apple-system,"Hiragino Sans","Segoe UI",sans-serif; line-height:1.6; }
  .wrap { max-width:1720px; margin:0 auto; padding:20px clamp(16px,3vw,44px) 80px; }
  .topbar { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  h1 { font-size:22px; margin:0 0 2px; } h2 { font-size:15px; margin:34px 0 12px; border-left:3px solid var(--c-accent); padding-left:8px; }
  h3 { font-size:14px; margin:0 0 8px; } h4 { font-size:12px; margin:0 0 6px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .meta { color:var(--muted); font-size:12px; margin-bottom:18px; }
  code { background:var(--card2); padding:1px 6px; border-radius:5px; font-size:12px; font-family:ui-monospace,monospace; }
  .muted { color:var(--muted); } svg text { font-family:-apple-system,"Hiragino Sans",sans-serif; }
  .theme-btn { background:var(--card); border:1px solid var(--line); color:var(--fg); border-radius:999px; padding:5px 14px; font-size:12px; cursor:pointer; }

  .kpis { display:grid; grid-template-columns:repeat(2,1fr); gap:10px; margin-bottom:10px; }
  @media (min-width:720px){ .kpis{ grid-template-columns:repeat(3,1fr);} }
  @media (min-width:1100px){ .kpis{ grid-template-columns:repeat(6,1fr);} }
  .kpi { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; }
  .kpi-v { font-size:20px; font-weight:700; } .kpi-k { font-size:10px; color:var(--muted); }

  .top-grid { display:grid; gap:14px; grid-template-columns:1fr; }
  @media (min-width:1100px){ .top-grid{ grid-template-columns:1fr 1.15fr; align-items:start; } }
  .hero { background:var(--card); border:1px solid var(--line); border-left:5px solid var(--c-crit); border-radius:12px; padding:18px 20px; }
  .hero.ok { border-left-color:var(--c-good); }
  .hero-eyebrow { font-family:ui-monospace,monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--c-crit); }
  .hero.ok .hero-eyebrow { color:var(--c-good); }
  .hero-title { font-size:24px; font-weight:750; margin:4px 0 12px; }
  .hero-chips { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .chip { font-family:ui-monospace,monospace; font-size:12px; background:var(--card2); border:1px solid var(--line); border-radius:999px; padding:3px 11px; }
  .hero-fix { font-size:14px; margin:6px 0; } .hero-target { font-size:13px; color:var(--muted); } .hero-cause { font-size:13px; margin-top:8px; }
  .badge { background:var(--c-accent); color:#fff; border-radius:5px; padding:1px 6px; font-size:10px; } .badge.good { background:var(--c-good); }
  .fig { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .fignote,.c-note { font-size:11px; color:var(--muted); margin-top:6px; }

  .grid { display:grid; gap:14px; grid-template-columns:1fr; }
  @media (min-width:720px){ .grid{ grid-template-columns:repeat(2,1fr);} }
  @media (min-width:1600px){ .grid{ grid-template-columns:repeat(4,1fr);} }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
  .legend { display:flex; gap:14px; font-size:12px; color:var(--muted); margin-top:8px; justify-content:center; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:middle; }
  .spark-row { display:flex; align-items:center; gap:10px; margin:6px 0; } .spark-k { font-size:11px; color:var(--muted); width:96px; flex:none; }

  /* master-detail 指摘の詳細 */
  .cluster-md { display:grid; grid-template-columns:1fr; gap:14px; }
  @media (min-width:1100px){ .cluster-md{ grid-template-columns:340px 1fr; align-items:start; } .cl-list{ position:sticky; top:12px; max-height:calc(100vh - 40px); overflow:auto; } }
  .cl-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
  .cl-item { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:9px 12px; cursor:pointer; display:flex; justify-content:space-between; gap:8px; align-items:center; }
  .cl-item.active { border-color:var(--c-accent); box-shadow:inset 3px 0 0 var(--c-accent); }
  .cl-item:hover { border-color:var(--c-accent); } .cl-name { font-family:ui-monospace,monospace; font-size:12.5px; } .cl-meta { font-size:11px; color:var(--muted); white-space:nowrap; }
  .cl-panel { min-width:0; } .cl-detail { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
  .cl-detail[hidden] { display:none; } .cl-head h3 { font-size:17px; } .cl-visual { margin:12px 0; }
  .cl-img { width:100%; max-width:720px; height:auto; border-radius:10px; border:1px solid var(--line); display:block; }
  .cl-block { margin-top:14px; } .cl-block p { margin:0; font-size:13.5px; } .cl-ex { font-family:ui-monospace,monospace; font-size:11px; color:var(--muted); border-bottom:1px dashed var(--line); padding:3px 0; }
  .cl-edit { background:var(--card2); border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:11.5px; overflow-x:auto; white-space:pre-wrap; }
  .surface { color:var(--muted); font-size:11.5px; }

  ol.backlog { padding-left:20px; } ol.backlog li { margin:9px 0; }
  details { margin-top:14px; } summary { cursor:pointer; font-size:13px; color:var(--muted); padding:6px 0; }
  .scroll { overflow-x:auto; } table { width:100%; border-collapse:collapse; font-size:13px; margin-top:10px; }
  th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:11px; color:var(--muted); text-transform:uppercase; } td.num { text-align:right; white-space:nowrap; }
  .ex div { font-family:ui-monospace,monospace; font-size:10px; color:var(--muted); } .files { font-family:ui-monospace,monospace; font-size:11px; color:var(--c-accent); }
  .foot { color:var(--muted); font-size:12px; margin-top:32px; border-top:1px solid var(--line); padding-top:16px; }

  /* SVG chart 要素 */
  .c-label { font-size:12px; fill:var(--fg); } .c-sub { font-size:10px; fill:var(--muted); font-family:ui-monospace,monospace; }
  .c-value { font-size:12px; fill:var(--fg); font-family:ui-monospace,monospace; } .c-track { fill:var(--c-track); }
  .c-grid { stroke:var(--c-grid); stroke-width:1; } .c-tick { font-size:10px; fill:var(--c-tick); } .c-axis { font-size:10px; fill:var(--c-axis); }
  .bubble { fill:var(--c-accent); fill-opacity:.45; stroke:var(--c-accent); stroke-opacity:.7; } .bubble-top { fill:var(--c-crit); fill-opacity:.55; stroke:var(--c-crit); }
  .c-toplabel { font-size:12px; font-weight:600; fill:var(--c-crit); } .c-empty { font-size:12px; fill:var(--muted); }
  .spark { stroke-width:2; } .c-donut-v { font-size:20px; font-weight:700; fill:var(--fg); } .c-donut-k { font-size:9px; fill:var(--muted); }
  .ba-panel { fill:var(--card2); stroke-width:1.5; } .ba-title { font-size:13px; font-weight:600; } .ba-body { font-size:12px; fill:var(--fg); }
  .ba-arrow { stroke:var(--c-accent); stroke-width:2; } .ba-arrowhead { fill:var(--c-accent); }`;

const SCRIPT = `
  (function(){
    var root=document.documentElement, KEY='ha-theme';
    var saved=localStorage.getItem(KEY)||'light'; root.setAttribute('data-theme',saved);
    var btn=document.getElementById('themeBtn');
    function label(){ btn.textContent = root.getAttribute('data-theme')==='dark'?'☀ ライト':'🌙 ダーク'; }
    if(btn){ label(); btn.addEventListener('click',function(){ var t=root.getAttribute('data-theme')==='dark'?'light':'dark'; root.setAttribute('data-theme',t); localStorage.setItem(KEY,t); label(); }); }
    function activate(id){
      document.querySelectorAll('.cl-item').forEach(function(el){ el.classList.toggle('active', el.dataset.cluster===id); });
      document.querySelectorAll('.cl-detail').forEach(function(el){ var on=el.dataset.cluster===id; el.hidden=!on; el.classList.toggle('active',on); });
    }
    document.querySelectorAll('.cl-item').forEach(function(el){
      el.addEventListener('click',function(){ activate(el.dataset.cluster); });
      el.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); activate(el.dataset.cluster); } });
    });
  })();`;

function html(data) {
  const { window: win, generated_at, kpis, clusters } = data;
  const trend = data.trend || { friction: [], err: [] };
  const imageIndex = data.imageIndex || {};
  const { problems, defenses, byScore, hero } = prioritize(clusters);

  const points = problems.slice(0, 30).map((c) => ({ label: `${c.error_class}/${c.tool}`, x: c.count || 0, y: c.affected_sessions || 0, size: c.cost_impact_usd || 0, top: c === hero }));
  const realCount = problems.reduce((s, c) => s + (c.count || 0), 0);
  const defenseCount = defenses.reduce((s, c) => s + (c.count || 0), 0);
  const donutCard = (realCount + defenseCount) > 0 ? `<div class="card"><h3>実失敗 vs 防御成功</h3>
      ${CH.donut([{ label: '実失敗', value: realCount, color: CRIT }, { label: '防御成功', value: defenseCount, color: GOOD }], { centerLabel: String(realCount), centerSub: '実失敗件数' })}
      <div class="legend"><span><i style="background:var(--c-crit)"></i>実失敗 ${realCount}</span><span><i style="background:var(--c-good)"></i>防御成功 ${defenseCount}</span></div></div>` : '';
  const trendCard = `<div class="card"><h3>トレンド（日次）</h3>
      <div class="spark-row"><span class="spark-k">平均 friction</span>${CH.sparkline(trend.friction)}</div>
      <div class="spark-row"><span class="spark-k">ツールエラー率</span>${CH.sparkline(trend.err)}</div>
      <div class="c-note">末尾ドット: 赤=悪化 / 緑=改善</div></div>`;

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness-analytics レポート</title>
<style>${STYLE}</style></head><body><div class="wrap">
<div class="topbar"><h1>harness-analytics レポート</h1><button id="themeBtn" class="theme-btn" type="button">🌙 ダーク</button></div>
<div class="meta">窓: ${esc(win)}　生成: ${esc(generated_at)}　※コストは概算・改善は示唆（自動適用なし）</div>

<div class="kpis">${kpiRow(kpis)}</div>

<div class="top-grid">
  ${heroCard(hero)}
  <div class="fig"><h3>優先度マップ — どれを先に直すか</h3>${CH.priorityBubbles(points)}
    <div class="fignote">右上ほど「何度も・広く」起きている＝優先。円の大きさ＝コスト影響。赤＝最優先。</div></div>
</div>

${harnessHealth(kpis)}

<h2>内訳チャート</h2>
<div class="grid">
  <div class="card"><h3>失敗クラスター Top（件数）</h3>${clustersChart(byScore)}</div>
  <div class="card"><h3>ツール別エラー率</h3>${toolChart(kpis.by_tool)}</div>
  <div class="card"><h3>コストホットスポット（セッション）</h3>${costChart(kpis.cost_hotspots)}</div>
  ${trendCard}${donutCard}
</div>

<h2>指摘の詳細（上位）</h2>
${renderClusterSection(problems, imageIndex)}

<h2>改善バックログ（優先度順・採否は人間）</h2>
<ol class="backlog">${backlog(clusters)}</ol>

<details><summary>詳細データ（全クラスターの表）を開く</summary>
  <div class="scroll"><table><thead><tr><th>クラス/ツール</th><th>件数</th><th>影響</th><th>傾向</th><th>コスト影響</th><th>改善示唆</th><th>例(マスク済)</th></tr></thead>
  <tbody>${clusterRows(clusters)}</tbody></table></div>
  <div class="scroll"><table><thead><tr><th>ツール</th><th>回数</th><th>エラー</th><th>エラー率</th></tr></thead>
  <tbody>${toolTableRows(kpis.by_tool)}</tbody></table></div></details>

<div class="foot">harness-analytics は Claude Code の transcript を機械可読ダイジェストに集約し、失敗パターンを分析して改善対象を示唆します。生ログの secret/パスはマスク済み。ローカル生成。</div>
</div><script>${SCRIPT}</script></body></html>`;
}

function markdown(data) {
  const { window: win, generated_at, kpis, clusters } = data;
  const { hero } = prioritize(clusters);
  const lines = [`# harness-analytics レポート`, ``, `- 窓: ${win}`, `- 生成: ${generated_at}`, `- 注: コストは概算、改善は示唆（自動適用なし）`, ``, `## まず直すべき1件`, ``];
  if (hero) {
    lines.push(`**${hero.error_class}/${hero.tool}** — ${hero.count}件 / ${hero.affected_sessions}セッション / コスト影響 $${(hero.cost_impact_usd || 0).toFixed(2)}`, ``, `- 推奨対応: ${hero.suggested_fix}`);
    const files = hero.llm && hero.llm.target_files ? hero.llm.target_files.join(', ') : hero.target_surface;
    lines.push(`- 直す場所: ${files}`);
    if (hero.llm && hero.llm.root_cause) lines.push(`- 根因(推定): ${hero.llm.root_cause}`);
  } else { lines.push(`優先度の高い失敗は検出されませんでした。`); }
  lines.push(``, `## KPI`, ``, `| 指標 | 値 |`, `|---|---|`, `| セッション | ${kpis.sessions} |`, `| 総コスト(概算) | $${(kpis.total_cost_usd || 0).toFixed(2)} |`, `| ツールエラー率 | ${((kpis.tool_error_rate || 0) * 100).toFixed(1)}% |`, `| 平均 friction | ${kpis.avg_friction} |`, ``,
    `## ハーネス健全性（打ち切り/作話の可視化）`, ``, `| 指標 | 件数 | 影響セッション |`, `|---|---|---|`,
    `| 打ち切り(orphaned tool_use) | ${kpis.orphaned_total || 0} | ${kpis.orphaned_sessions || 0} |`,
    `| 作話疑い(tool-result R8) | ${kpis.hallucination_total || 0} | ${kpis.hallucination_sessions || 0} |`,
    ``, `## 失敗クラスター`, ``, `| クラス/ツール | 件数 | 影響 | 傾向 | 改善示唆 | 対象面 |`, `|---|---|---|---|---|---|`);
  for (const c of clusters) lines.push(`| ${c.error_class}/${c.tool}${c.is_defense ? '(防御)' : ''} | ${c.count} | ${c.affected_sessions} | ${c.trend || ''} | ${c.suggested_fix} | ${c.target_surface} |`);
  return lines.join('\n') + '\n';
}

function loadTrend() {
  let files = [];
  try { files = fs.readdirSync(C.ROLLUPS_DIR).filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { files = []; }
  const friction = [], err = [];
  for (const f of files.slice(-30)) {
    const j = C.readJson(path.join(C.ROLLUPS_DIR, f), null);
    if (!j || !j.kpis) continue;
    friction.push(j.kpis.avg_friction || 0); err.push(j.kpis.tool_error_rate || 0);
  }
  return { friction, err };
}
function loadImageIndex() {
  return C.readJson(path.join(C.HA_DIR, 'infographics', 'index.json'), {}) || {};
}

async function main() {
  const args = process.argv.slice(2);
  const clustersPath = C.getFlag(args, 'clusters', true, path.join(C.CLUSTERS_DIR, 'latest.json'));
  const llmPath = C.getFlag(args, 'llm', true, path.join(C.CLUSTERS_DIR, 'llm-latest.json'));
  const noOpen = C.getFlag(args, 'no-open');
  const data = C.readJson(clustersPath, null);
  if (!data) { process.stderr.write('clusters が見つかりません。先に cluster.js を実行してください。\n'); process.exit(1); }
  const llm = fs.existsSync(llmPath) ? C.readJson(llmPath, null) : null;
  data.clusters = mergeLlm(data.clusters || [], llm);
  data.trend = loadTrend();
  data.imageIndex = loadImageIndex();

  const htmlPath = path.join(C.REPORTS_DIR, 'latest.html');
  const mdPath = path.join(C.REPORTS_DIR, 'latest.md');
  const htmlStr = html(data);
  C.writeText(htmlPath, htmlStr);
  C.writeText(mdPath, markdown(data));
  C.writeText(path.join(C.HISTORY_DIR, C.today(), 'report.html'), htmlStr);

  let opened = false, url = null;
  if (!noOpen) { const r = await C.openReport(); opened = r.opened; url = r.url; }
  process.stdout.write(JSON.stringify({ html: htmlPath, md: mdPath, clusters: (data.clusters || []).length, opened, url }) + '\n');
}

module.exports = { html, markdown, mergeLlm, prioritize, scoreOf, clusterDetailBlock, renderClusterSection };

if (require.main === module) main().catch((e) => { process.stderr.write('build-report fatal: ' + e.message + '\n'); process.exit(1); });
