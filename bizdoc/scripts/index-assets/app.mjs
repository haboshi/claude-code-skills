// app.mjs — index.html に埋め込むクライアントスクリプト。
// データ（window.__DOC_HUB__）から DOM を組み立てる。テキストは createTextNode 経由でのみ入れる
// （ユーザー由来のタイトル・タグ・パスを innerHTML に流さない）。
// 外部ライブラリ・fetch は使わない。相対日付だけは実行時に計算する
// （HTML に現在時刻を埋めると reindex の冪等性が壊れるため、描画時に求める）。
export const APP_JS = `
(function () {
  var D = window.__DOC_HUB__ || { projects: [], groups: [] };
  var LS_KEY = 'doc-hub:view:1';
  var TYPE_LIMIT = 8, TAG_LIMIT = 10, TAGS_IN_ROW = 3;
  var PERIODS = [{ label: '今週', days: 7 }, { label: '今月', days: 30 }, { label: '3か月', days: 90 }];

  var state = {
    scope: 'all', q: '', qTokens: [], types: [], tags: [], period: null, sort: 'updated',
    showHidden: false, collapsed: {}, typesOpen: false, tagsOpen: false, cursor: -1,
    focusKey: null, sideFocusKey: null
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    ['scope', 'sort'].forEach(function (k) { if (typeof saved[k] === 'string') state[k] = saved[k]; });
    if (saved.showHidden === true) state.showHidden = true;
    if (saved.collapsed && typeof saved.collapsed === 'object') state.collapsed = saved.collapsed;
  } catch (e) { /* localStorage が使えない環境でも動く */ }
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        scope: state.scope, sort: state.sort, showHidden: state.showHidden, collapsed: state.collapsed
      }));
    } catch (e) { /* 保存できなくても動作は変わらない */ }
  }

  // 並び順・月見出し・日付表示はすべて同じ時刻（t）から導く。updated が無い破損文書だけ
  // ディレクトリ名の日付にフォールバックする（両者を文字列のまま比べると順序が壊れる）。
  var ALL = [];
  D.projects.forEach(function (p) {
    (p.docs || []).forEach(function (d) {
      var tags = d.tags || [];
      var fromDir = /^\\d{8}/.test(d.dir)
        ? Date.parse(d.dir.slice(0, 4) + '-' + d.dir.slice(4, 6) + '-' + d.dir.slice(6, 8) + 'T00:00:00')
        : NaN;
      var t = d.updated ? Date.parse(d.updated) : NaN;
      if (!isFinite(t)) t = fromDir;
      ALL.push({
        proj: p, title: d.title, type: d.type, tags: tags, broken: !!d.broken,
        t: isFinite(t) ? t : -Infinity,
        href: 'projects/' + encodeURIComponent(p.dir) + '/docs/' + encodeURIComponent(d.dir) + '/index.html',
        hay: (d.title + ' ' + d.type + ' ' + tags.join(' ') + ' ' + p.label).toLowerCase()
      });
    });
  });

  function groupOf(key) { for (var i = 0; i < D.groups.length; i++) if (D.groups[i].key === key) return D.groups[i]; return null; }
  function visibleProjects() { return D.projects.filter(function (p) { return state.showHidden || !p.hidden; }); }
  function visible(doc) { return state.showHidden || !doc.proj.hidden; }
  function inScope(doc) {
    if (state.scope === 'all') return true;
    if (state.scope.indexOf('p:') === 0) return doc.proj.id === state.scope.slice(2);
    if (state.scope.indexOf('g:') === 0) return doc.proj.group === state.scope.slice(2);
    return true;
  }
  // 空白区切りは AND（「kata 仕様書」で絞れる）。語順には依存しない。
  function matchQuery(doc) {
    for (var i = 0; i < state.qTokens.length; i++) if (doc.hay.indexOf(state.qTokens[i]) < 0) return false;
    return true;
  }
  function matchPeriod(doc) {
    if (!state.period) return true;
    var from = new Date(); from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - state.period);
    return doc.t >= from.getTime();
  }
  // 種別は「いずれか」（1文書1種別なので AND では常に空になる）、タグは「すべて含む」
  function matchTypes(doc) { return !state.types.length || state.types.indexOf(doc.type) >= 0; }
  function matchTags(doc) {
    for (var i = 0; i < state.tags.length; i++) if (doc.tags.indexOf(state.tags[i]) < 0) return false;
    return true;
  }
  function passFacets(doc) { return matchPeriod(doc) && matchTypes(doc) && matchTags(doc); }
  function inScopeDocs() { return ALL.filter(function (d) { return visible(d) && inScope(d); }); }
  function afterQuery() { return inScopeDocs().filter(matchQuery); }
  function filtered() { return afterQuery().filter(passFacets); }
  function narrowed() { return state.qTokens.length > 0 || state.types.length > 0 || state.tags.length > 0 || !!state.period; }
  // 左のスコープ一覧に出す件数。スコープだけ外し、検索とファセットは効かせる。
  // 絞り込みながら「どのプロジェクトに何件あるか」が同時に読めるようにするため。
  function countsByProject() {
    var m = Object.create(null);
    ALL.forEach(function (d) {
      if (visible(d) && matchQuery(d) && passFacets(d)) m[d.proj.id] = (m[d.proj.id] || 0) + 1;
    });
    return m;
  }
  function tally(docs, pick) {
    var m = Object.create(null);
    docs.forEach(function (d) { pick(d).forEach(function (v) { m[v] = (m[v] || 0) + 1; }); });
    return Object.keys(m).map(function (k) { return { v: k, n: m[k] }; })
      .sort(function (a, b) { return b.n - a.n || a.v.localeCompare(b.v, 'ja'); });
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.appendChild(document.createTextNode(String(text)));
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  // 検索語に一致した箇所だけ mark で包む（テキストノード操作なので HTML 混入はしない）。
  // 複数トークンのときは、各位置で最も手前に来るトークンを優先して包む。
  function highlight(parent, text) {
    var toks = state.qTokens;
    if (!toks.length) { parent.appendChild(document.createTextNode(text)); return; }
    var lower = String(text).toLowerCase();
    var i = 0;
    for (;;) {
      var at = -1, len = 0;
      for (var k = 0; k < toks.length; k++) {
        var p = lower.indexOf(toks[k], i);
        if (p >= 0 && (at < 0 || p < at || (p === at && toks[k].length > len))) { at = p; len = toks[k].length; }
      }
      if (at < 0) break;
      if (at > i) parent.appendChild(document.createTextNode(text.slice(i, at)));
      parent.appendChild(el('mark', null, text.slice(at, at + len)));
      i = at + len;
    }
    if (i < text.length) parent.appendChild(document.createTextNode(text.slice(i)));
  }

  function fmtDay(t) { if (!isFinite(t)) return '—'; var d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function fmtMonth(t) { if (!isFinite(t)) return '日付なし'; var d = new Date(t); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月'; }
  // 経過時間ではなく暦日の差で数える（8/7 の文書を 8/8 に見て「今日」と出さないため）
  function fmtAgo(t) {
    if (!isFinite(t)) return '';
    var a = new Date(t); a.setHours(0, 0, 0, 0);
    var b = new Date(); b.setHours(0, 0, 0, 0);
    var days = Math.round((b - a) / 86400000);
    if (days <= 0) return '今日';
    if (days === 1) return '昨日';
    if (days < 30) return days + '日前';
    var mo = Math.floor(days / 30);
    return mo < 12 ? mo + 'か月前' : Math.floor(days / 365) + '年前';
  }

  var side = document.querySelector('.scopes');
  var sideEl = document.querySelector('.side');
  var narrowMq = window.matchMedia('(max-width: 820px)');
  var crumb = document.querySelector('.crumb');
  var facets = document.querySelector('.facets');
  var list = document.querySelector('.list');
  var input = document.querySelector('.search input');
  var sortBtn = document.querySelector('.sortbtn');

  function setScope(next) {
    state.scope = next; state.cursor = -1;
    state.types = []; state.tags = []; state.period = null;
    state.typesOpen = false; state.tagsOpen = false; state.focusKey = null;
    state.sideFocusKey = 'scope:' + next;
    try {
      var hash = next.indexOf('p:') === 0 ? '#p-' + next.slice(2) : next.indexOf('g:') === 0 ? '#g-' + next.slice(2) : '#all';
      history.replaceState(null, '', hash);
    } catch (e) { /* file:// で replaceState が拒否されても表示には影響しない */ }
    save(); renderAll();
    if (list) list.scrollTop = 0;
    if (narrowMq.matches) sideEl.classList.add('collapsed');
  }

  function scopeButton(label, key, n, extraCls) {
    var b = el('button', 'scope' + (extraCls ? ' ' + extraCls : ''));
    b.type = 'button';
    b.dataset.key = 'scope:' + key;
    b.appendChild(el('span', 'nm', label));
    b.appendChild(el('span', 'n', n));
    if (state.scope === key) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', function () { setScope(key); });
    return b;
  }
  // 左の一覧も作り直すので、直前に押していたボタンへフォーカスを戻す
  function restoreSideFocus() {
    if (!state.sideFocusKey) return;
    var all = side.querySelectorAll('[data-key]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].dataset.key === state.sideFocusKey) { all[i].focus(); return; }
    }
  }

  function renderSide() {
    var keepScroll = side.scrollTop; // 作り直しで位置が飛ばないように保持する
    clear(side);
    var vis = visibleProjects();
    var cnt = countsByProject();
    var num = function (p) { return cnt[p.id] || 0; };
    var sum = function (list) { return list.reduce(function (a, p) { return a + num(p); }, 0); };
    var dim = narrowed();
    side.appendChild(scopeButton('すべて', 'all', sum(vis)));

    var buckets = D.groups.map(function (g) {
      return { key: g.key, label: g.label, members: vis.filter(function (p) { return p.group === g.key; }) };
    }).filter(function (b) { return b.members.length > 0; });
    var loose = vis.filter(function (p) { return !p.group || !groupOf(p.group); });
    if (loose.length) buckets.push({ key: null, label: '未分類', members: loose });

    buckets.forEach(function (b) {
      var wrap = el('div', 'grp');
      var open = !state.collapsed[b.key || '_'];
      var n = sum(b.members);
      // 見出し行は「開閉（caret）」と「グループ全体を絞り込む（ラベル）」の 2 つの操作に分かれる
      var h = el('div', 'grp-h');
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
      var caret = el('button', 'caret', '▾');
      caret.type = 'button';
      caret.dataset.key = 'caret:' + (b.key || '_');
      caret.setAttribute('aria-label', (open ? '畳む' : '開く') + '：' + b.label);
      caret.addEventListener('click', function () {
        state.collapsed[b.key || '_'] = open;
        state.sideFocusKey = 'caret:' + (b.key || '_');
        save(); renderSide();
      });
      h.appendChild(caret);
      if (b.key) {
        var gl = el('button', 'gl', b.label);
        gl.type = 'button';
        if (state.scope === 'g:' + b.key) gl.setAttribute('aria-current', 'true');
        gl.addEventListener('click', function () { setScope('g:' + b.key); });
        h.appendChild(gl);
      } else {
        h.appendChild(el('span', 'gl', b.label));
      }
      h.appendChild(el('span', 'gn', n));
      wrap.appendChild(h);
      var body = el('div', 'grp-b');
      b.members.forEach(function (p) {
        body.appendChild(scopeButton(p.label, 'p:' + p.id, num(p),
          (p.broken ? 'is-broken ' : '') + (p.hidden ? 'is-hidden ' : '') + (dim && !num(p) ? 'is-zero' : '')));
      });
      wrap.appendChild(body);
      side.appendChild(wrap);
    });
    side.scrollTop = keepScroll;
    restoreSideFocus();
  }

  function renderHead() {
    clear(crumb);
    var proj = null, grp = null;
    if (state.scope.indexOf('p:') === 0) {
      proj = D.projects.filter(function (p) { return p.id === state.scope.slice(2); })[0] || null;
      if (proj && proj.group) grp = groupOf(proj.group);
    } else if (state.scope.indexOf('g:') === 0) grp = groupOf(state.scope.slice(2));
    if (grp) crumb.appendChild(el('span', 'grp-of', grp.label));
    crumb.appendChild(el('span', 'nm', proj ? proj.label : grp ? grp.label + ' 全体' : 'すべてのドキュメント'));

    var shown = filtered().length, base = inScopeDocs().length;
    var cnt = el('span', 'cnt');
    cnt.appendChild(el('b', null, shown));
    cnt.appendChild(document.createTextNode(shown === base ? '件' : ' / ' + base + '件'));
    crumb.appendChild(cnt);
    if (proj && proj.path) crumb.appendChild(el('span', 'path', proj.path));
    sortBtn.textContent = state.sort === 'updated' ? '更新日順 ▾' : 'タイトル順 ▾';
  }

  function chip(label, n, active, onClick, cls, key) {
    var b = el('button', 'chip' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', active ? 'true' : 'false');
    b.appendChild(document.createTextNode(label));
    if (n !== null && n !== undefined) b.appendChild(el('span', 'n', n));
    if (key) b.dataset.key = key;
    // 再描画で DOM が作り直されるので、押したチップと同じものへフォーカスを戻す
    b.addEventListener('click', function () { state.focusKey = key || null; onClick(); });
    return b;
  }
  function restoreFocus(root) {
    if (!state.focusKey) return;
    var all = root.querySelectorAll('.chip');
    for (var i = 0; i < all.length; i++) {
      if (all[i].dataset.key === state.focusKey) { all[i].focus(); return; }
    }
  }
  // 選択中の値は件数 0 でも残す（解除できなくなるため）。並びは「選択中 → 件数の多い順」
  function withSelected(items, selected) {
    var have = Object.create(null);
    items.forEach(function (t) { have[t.v] = true; });
    var out = items.slice();
    selected.forEach(function (v) { if (!have[v]) out.push({ v: v, n: 0 }); });
    var sel = [], rest = [];
    out.forEach(function (t) { (selected.indexOf(t.v) >= 0 ? sel : rest).push(t); });
    return sel.concat(rest);
  }

  // 軸ごとに 1 行。ラベル位置を縦に揃える（混ざると境界が読めない）
  function facetLine(label, hint, items, limit, isOpen, openAll, active, onPick, prefix) {
    var line = el('div', 'facet-line');
    var lb = el('span', 'facet-label', label);
    lb.title = hint;
    line.appendChild(lb);
    var box = el('div', 'facet-chips');
    var shown = isOpen ? items : items.slice(0, limit);
    shown.forEach(function (t) {
      box.appendChild(chip(t.v, t.n, active.indexOf(t.v) >= 0, function () { onPick(t.v); }, null, prefix + t.v));
    });
    if (items.length > shown.length) {
      box.appendChild(chip('他 ' + (items.length - shown.length), null, false, openAll, 'more', prefix + '__more'));
    }
    line.appendChild(box);
    return line;
  }

  function renderFacets() {
    clear(facets);
    var base = afterQuery();
    // 件数は「そのチップを押したときに何件になるか」を表す。
    // 期間（排他）と種別（いずれか）は自分の軸を外して数え、タグ（すべて含む）は
    // 選択済みタグを適用したまま数える（= 共起するタグだけが候補に残る）。
    var forPeriod = base.filter(function (d) { return matchTypes(d) && matchTags(d); });
    var forTypes = base.filter(function (d) { return matchPeriod(d) && matchTags(d); });
    var forTags = base.filter(passFacets);
    if (!base.length && !narrowed()) return;

    var periods = PERIODS.map(function (p) {
      var saved = state.period; state.period = p.days;
      var n = forPeriod.filter(matchPeriod).length;
      state.period = saved;
      return { v: p.label, n: n, days: p.days };
    }).filter(function (p) { return p.n > 0 || state.period === p.days; });
    if (periods.length) {
      var pl = el('div', 'facet-line');
      var plb = el('span', 'facet-label', '期間');
      plb.title = '更新日が新しいものだけに絞る';
      pl.appendChild(plb);
      var pbox = el('div', 'facet-chips');
      periods.forEach(function (p) {
        pbox.appendChild(chip(p.v, p.n, state.period === p.days, function () {
          state.period = state.period === p.days ? null : p.days;
          state.cursor = -1; renderAll();
        }, null, 'period:' + p.v));
      });
      pl.appendChild(pbox);
      facets.appendChild(pl);
    }

    var types = withSelected(tally(forTypes, function (d) { return [d.type]; }), state.types);
    if (types.length) {
      facets.appendChild(facetLine('種別', '選んだ種別のいずれかに当てはまる文書', types, TYPE_LIMIT, state.typesOpen,
        function () { state.typesOpen = true; renderFacets(); }, state.types,
        function (v) {
          var i = state.types.indexOf(v);
          if (i >= 0) state.types.splice(i, 1); else state.types.push(v);
          state.cursor = -1; renderAll();
        }, 'type:'));
    }

    var tags = withSelected(tally(forTags, function (d) { return d.tags; }), state.tags);
    if (tags.length) {
      var line = facetLine('タグ', '選んだタグをすべて持つ文書', tags, TAG_LIMIT, state.tagsOpen,
        function () { state.tagsOpen = true; renderFacets(); }, state.tags, toggleTag, 'tag:');
      facets.appendChild(line);
    }

    if (narrowed()) {
      var last = el('div', 'facet-line');
      last.appendChild(el('span', 'facet-label', ''));
      var box = el('div', 'facet-chips');
      box.appendChild(chip('絞り込みを解除', null, false, clearFilters, 'clear', 'clear'));
      last.appendChild(box);
      facets.appendChild(last);
    }
    restoreFocus(facets);
  }

  function toggleTag(v) {
    var i = state.tags.indexOf(v);
    if (i >= 0) state.tags.splice(i, 1); else state.tags.push(v);
    state.cursor = -1; renderAll();
  }

  function docRow(d, idx) {
    var a = el('a', 'doc' + (d.broken ? ' broken' : ''));
    if (!d.broken) a.href = d.href;
    a.dataset.i = idx;
    var when = el('div', 'when');
    when.appendChild(el('b', null, fmtDay(d.t)));
    when.appendChild(document.createTextNode(fmtAgo(d.t)));
    a.appendChild(when);
    var body = el('div', 'body');
    var t = el('div', 'ttl');
    t.title = d.title;
    highlight(t, d.title);
    body.appendChild(t);
    var meta = el('div', 'meta');
    meta.appendChild(el('span', 'kind', d.type));
    if (state.scope === 'all' || state.scope.indexOf('g:') === 0) meta.appendChild(el('span', 'of', d.proj.label));
    body.appendChild(meta);
    a.appendChild(body);
    var tw = el('div', 'tags');
    d.tags.slice(0, TAGS_IN_ROW).forEach(function (tag) {
      var s = el('button', 'tag', tag);
      s.type = 'button';
      // Tab の停留点にはしない（74行×3タグ分の停留は移動を壊す）。
      // キーボードから同じ操作をするときは上のタグチップを使う。
      s.tabIndex = -1;
      s.title = 'タグ「' + tag + '」で絞り込む';
      s.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); toggleTag(tag); });
      if (state.tags.indexOf(tag) >= 0) s.setAttribute('data-on', '1');
      tw.appendChild(s);
    });
    if (d.tags.length > TAGS_IN_ROW) {
      var rest = d.tags.slice(TAGS_IN_ROW);
      var more = el('span', 'tag more', '+' + rest.length);
      more.title = rest.join('、');
      tw.appendChild(more);
    }
    a.appendChild(tw);
    return a;
  }

  function renderList() {
    clear(list);
    var docs = filtered().slice();
    docs.sort(state.sort === 'title'
      ? function (a, b) { return a.title.localeCompare(b.title, 'ja'); }
      : function (a, b) { return b.t - a.t || a.title.localeCompare(b.title, 'ja'); });

    if (!docs.length) {
      var e = el('div', 'empty');
      e.appendChild(el('b', null, '該当するドキュメントがありません'));
      e.appendChild(el('div', null,
        state.q ? '「' + state.q + '」に一致する文書は、この範囲にありません。' : '絞り込み条件を外すか、範囲を「すべて」に広げてください。'));
      var btn = el('button', null, '条件をすべて解除');
      btn.type = 'button';
      btn.addEventListener('click', clearFilters);
      e.appendChild(btn);
      list.appendChild(e);
      return;
    }

    var lastMonth = null;
    docs.forEach(function (d, i) {
      if (state.sort === 'updated') {
        var m = fmtMonth(d.t);
        if (m !== lastMonth) { list.appendChild(el('div', 'month', m)); lastMonth = m; }
      }
      list.appendChild(docRow(d, i));
    });
    var hint = el('div', 'hint');
    hint.appendChild(document.createTextNode('検索は '));
    hint.appendChild(el('kbd', null, '/'));
    hint.appendChild(document.createTextNode('、移動は '));
    hint.appendChild(el('kbd', null, '↑'));
    hint.appendChild(el('kbd', null, '↓'));
    hint.appendChild(document.createTextNode('、開くのは '));
    hint.appendChild(el('kbd', null, 'Enter'));
    hint.appendChild(document.createTextNode('。'));
    list.appendChild(hint);
    applyCursor();
  }

  function rows() { return list.querySelectorAll('.doc'); }
  function applyCursor() {
    var rs = rows();
    for (var i = 0; i < rs.length; i++) rs[i].removeAttribute('data-cursor');
    if (state.cursor >= 0 && rs[state.cursor]) {
      rs[state.cursor].setAttribute('data-cursor', '1');
      rs[state.cursor].scrollIntoView({ block: 'nearest' });
    }
  }
  function moveCursor(delta) {
    var n = rows().length;
    if (!n) return;
    state.cursor = state.cursor < 0 ? (delta > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, state.cursor + delta));
    applyCursor();
  }

  function renderAll() { renderSide(); renderHead(); renderFacets(); renderList(); }

  function clearFilters() {
    state.q = ''; state.qTokens = []; state.types = []; state.tags = []; state.period = null;
    state.typesOpen = false; state.tagsOpen = false; state.cursor = -1; state.focusKey = null;
    input.value = '';
    renderAll();
  }

  function applyQuery() {
    state.q = input.value.trim().toLowerCase();
    state.qTokens = state.q.split(/[\\s\\u3000]+/).filter(Boolean);
    state.cursor = -1; state.typesOpen = false; state.tagsOpen = false; state.focusKey = null;
    renderAll();
  }
  // 打鍵ごとの全再構築を避ける（文書が増えたときに効く）
  var qTimer = null;
  input.addEventListener('input', function () {
    clearTimeout(qTimer);
    qTimer = setTimeout(applyQuery, 70);
  });
  sortBtn.addEventListener('click', function () {
    state.sort = state.sort === 'updated' ? 'title' : 'updated';
    state.cursor = -1; save(); renderHead(); renderList();
    if (list) list.scrollTop = 0;
  });
  document.querySelector('.side-foot input').addEventListener('change', function (ev) {
    state.showHidden = ev.target.checked; save(); renderAll();
  });
  if (narrowMq.matches) sideEl.classList.add('collapsed'); // 狭い画面では一覧を優先し、最初は畳んでおく
  document.querySelector('.brand').addEventListener('click', function () {
    if (narrowMq.matches) sideEl.classList.toggle('collapsed');
  });

  document.addEventListener('keydown', function (ev) {
    var typing = document.activeElement === input;
    if (ev.key === '/' && !typing) { ev.preventDefault(); input.focus(); input.select(); return; }
    if (ev.key === 'Escape') {
      if (narrowed()) { clearTimeout(qTimer); clearFilters(); }
      input.blur();
      return;
    }
    if (ev.key === 'ArrowDown' || (ev.key === 'n' && ev.ctrlKey)) { ev.preventDefault(); moveCursor(1); return; }
    if (ev.key === 'ArrowUp' || (ev.key === 'p' && ev.ctrlKey)) { ev.preventDefault(); moveCursor(-1); return; }
    if (ev.key === 'Enter' && state.cursor >= 0) {
      var r = rows()[state.cursor];
      if (r && r.href) { ev.preventDefault(); window.location.href = r.href; }
    }
  });

  function fromHash() {
    var h = decodeURIComponent(location.hash || '');
    if (h.indexOf('#p-') === 0) return 'p:' + h.slice(3);
    if (h.indexOf('#g-') === 0) return 'g:' + h.slice(3);
    if (h === '#all') return 'all';
    return null;
  }
  function validScope(s) {
    if (!s || s === 'all') return s;
    if (s.indexOf('p:') === 0) return D.projects.some(function (p) { return p.id === s.slice(2); }) ? s : null;
    return groupOf(s.slice(2)) ? s : null;
  }
  window.addEventListener('hashchange', function () {
    var s = validScope(fromHash());
    if (s && s !== state.scope) { state.scope = s; state.types = []; state.tags = []; state.cursor = -1; save(); renderAll(); }
  });

  // hidden 指定のプロジェクトを名指しで開いたときは、隠したままだと空振りするので表示に切り替える
  state.scope = validScope(fromHash()) || validScope(state.scope) || 'all';
  if (state.scope.indexOf('p:') === 0) {
    var target = D.projects.filter(function (p) { return p.id === state.scope.slice(2); })[0];
    if (target && target.hidden) state.showHidden = true;
  }
  document.querySelector('.side-foot input').checked = state.showHidden;
  renderAll();
})();
`;
