// 生成を止める側の検査。ここが 1 件でも拾ったら成果物を出さない。
// 「見た目の指標」（交差数・並走区間・経路長・密度）はここに入れない。あれは verify-layout の記録であって合否ではない。
import { normalize, edgesFor } from './normalize.mjs';
import { findAbsolutePaths, describeLeak } from './leaks.mjs';

// severity: 'stop' は生成を止める。'warn' は記録するだけで止めない。
// チケットが「生成を止める」と定めた破れだけを stop にし、注意喚起はそれと混ぜない。
const finding = (code, message, where, severity = 'stop') => ({ code, message, where, severity });

export const blocking = (findings) => findings.filter((f) => f.severity !== 'warn');

// id はビューワで DOM 属性・ファイル名・localStorage のキーになる。schema と同じ形を実行時にも要求し、
// 属性からの脱出やディレクトリの跨ぎを、使う側ではなく入口で止める。
const ID = /^[a-z0-9][a-z0-9_-]*$/;

function checkIds(out, ids, label) {
  for (const id of ids) {
    if (typeof id !== 'string' || !ID.test(id)) {
      out.push(finding('invalid-id', `${label} の id に使えない文字が含まれています（英小文字・数字・_・- のみ）: ${JSON.stringify(String(id)).slice(0, 40)}`, label));
    }
  }
}

/** model.json の相互参照。JSON Schema では書けない検査はすべてここにある。 */
export function checkModel(model) {
  const out = [];
  const D = normalize(model);

  const screenIds = new Set(D.screens.map((s) => s.id));
  const entityIds = new Set(D.entities.map((e) => e.id));
  const processIds = new Set(D.processes.map((p) => p.id));
  const areaIds = new Set(D.areas.map((a) => a.id));
  const laneIds = new Set(D.lanes.map((l) => l.id));
  const sourceIds = new Set(D.sources.map((s) => s.id));
  const fieldsOf = new Map(D.entities.map((e) => [e.id, new Set(e.fields.map((f) => f.name))]));

  const dup = (ids, label) => {
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) out.push(finding('duplicate-id', `${label} の id が重複しています: ${id}`, label));
      seen.add(id);
    }
  };
  // meta.id は保存キー、辺の id は DOM 属性になる。自動採番でない（model が書いた）ものも同じ形を要求する。
  checkIds(out, [D.meta.id], 'meta.id');
  if (D.meta.project != null) checkIds(out, [D.meta.project], 'meta.project');
  checkIds(out, D.transitions.map((t) => t.id), 'transitions');
  checkIds(out, D.relations.map((r) => r.id), 'relations');
  checkIds(out, D.processEdges.map((e) => e.id), 'process_edges');
  checkIds(out, D.extensions.flatMap((e) => [...(e.nodes ?? []).map((n) => n.id)]), 'extensions[].nodes');
  checkIds(out, D.screens.map((s) => s.key), 'screens');
  checkIds(out, D.entities.map((e) => e.key), 'entities');
  checkIds(out, D.processes.map((p) => p.key), 'processes');
  checkIds(out, D.areas.map((a) => a.id), 'areas');
  checkIds(out, D.lanes.map((l) => l.id), 'lanes');
  checkIds(out, D.sources.map((s) => s.id), 'sources');
  checkIds(out, D.groups.map((g) => g.key), 'groups');
  checkIds(out, D.scenarios.map((s) => s.id), 'meta.scenarios');
  checkIds(out, D.screens.flatMap((s) => s.images.map((i) => i.key)), 'screens[].images');
  checkIds(out, D.extensions.map((e) => e.id), 'extensions');

  dup(D.screens.map((s) => s.key), 'screens');
  dup(D.entities.map((e) => e.key), 'entities');
  dup(D.processes.map((p) => p.key), 'processes');
  dup(D.areas.map((a) => a.id), 'areas');
  dup(D.lanes.map((l) => l.id), 'lanes');
  dup(D.sources.map((s) => s.id), 'sources');
  // 辺の id は経路と DOM の対応づけに使う。重複すると片方が黙って消えるので、ここで落とす。
  dup(D.transitions.map((t) => t.id), 'transitions');
  dup(D.relations.map((r) => r.id), 'relations');
  dup(D.processEdges.map((e) => e.id), 'process_edges');
  dup(D.groups.map((g) => g.key), 'groups');
  // 画像 key は成果物では 1 つの辞書と 1 つの assets/ に集まる。画面をまたいだ重複も落とす。
  dup(D.screens.flatMap((s) => s.images.map((i) => i.key)), 'screens[].images の key（画面をまたいで一意にする）');

  const ref = (id, set, where, what) => {
    if (id != null && !set.has(id)) out.push(finding('undefined-ref', `${where} が存在しない ${what} を指しています: ${id}`, where));
  };

  for (const s of D.screens) {
    for (const e of s.entities) ref(e, entityIds, `screens[${s.key}].entities`, 'entity');
    for (const p of s.processes) ref(p, processIds, `screens[${s.key}].processes`, 'process');
    ref(s.source, sourceIds, `screens[${s.key}].source`, 'source');
    const keys = new Set();
    for (const img of s.images) {
      if (keys.has(img.key)) out.push(finding('duplicate-id', `screens[${s.key}].images の key が重複しています: ${img.key}`, `screens[${s.key}]`));
      keys.add(img.key);
    }
  }

  for (const t of D.transitions) {
    ref(t.a, screenIds, `transitions[${t.id}].from`, 'screen');
    ref(t.b, screenIds, `transitions[${t.id}].to`, 'screen');
    if (t.a === t.b) out.push(finding('self-transition', `transitions[${t.id}] の遷移元と遷移先が同じ画面です`, `transitions[${t.id}]`));
    if (t.pin) {
      const screen = D.screens.find((s) => s.id === t.a);
      const img = screen?.images.find((i) => i.key === t.pin.image);
      if (!img) out.push(finding('undefined-ref', `transitions[${t.id}].pin が存在しない画像を指しています: ${t.pin.image}`, `transitions[${t.id}]`));
      else if (img.historical) {
        // 古い画像の座標を今回の根拠に使わない。落とすのではなく、明示的に拒否する。
        out.push(finding('historical-pin', `transitions[${t.id}].pin が参考画像（historical）の座標を指しています。画面外の操作ラベルで表してください`, `transitions[${t.id}]`));
      }
    }
  }

  for (const e of D.entities) {
    ref(e.area, areaIds, `entities[${e.key}].area`, 'area');
    ref(e.source, sourceIds, `entities[${e.key}].source`, 'source');
    const names = new Set();
    for (const f of e.fields) {
      if (names.has(f.name)) out.push(finding('duplicate-id', `entities[${e.key}].fields の name が重複しています: ${f.name}`, `entities[${e.key}]`));
      names.add(f.name);
    }
  }

  for (const r of D.relations) {
    // 多重度は配置段で文字数を読む。欠けていると素の TypeError になるので、ここで落とす。
    for (const [value, side] of [[r.ca, 'from'], [r.cb, 'to']]) {
      if (typeof value !== 'string' || !value) out.push(finding('missing-cardinality', `relations[${r.id}].${side}.cardinality がありません（1 / 0..1 / 0..N など）`, `relations[${r.id}]`));
    }
    ref(r.a, entityIds, `relations[${r.id}].from.entity`, 'entity');
    ref(r.b, entityIds, `relations[${r.id}].to.entity`, 'entity');
    if (entityIds.has(r.a) && !fieldsOf.get(r.a).has(r.fa)) out.push(finding('undefined-ref', `relations[${r.id}].from.field が存在しない項目を指しています: ${r.fa}`, `relations[${r.id}]`));
    if (entityIds.has(r.b) && !fieldsOf.get(r.b).has(r.fb)) out.push(finding('undefined-ref', `relations[${r.id}].to.field が存在しない項目を指しています: ${r.fb}`, `relations[${r.id}]`));
  }

  // 設計候補の食い違い。未実装の項目・概念に繋がる関係は破線（proposed）でなければならない。
  // 逆向き（既存どうしを結ぶ関係を候補と宣言する）は正当なので通す — 関係そのものが候補のことがある。
  const proposedEntity = new Set(D.entities.filter((e) => e.status === 'proposed').map((e) => e.id));
  const proposedField = new Map(D.entities.map((e) => [e.id, new Set(e.fields.filter((f) => f.proposed).map((f) => f.name))]));
  for (const r of D.relations) {
    if (r.proposed) continue;
    for (const [entityId, fieldName, side] of [[r.a, r.fa, 'from'], [r.b, r.fb, 'to']]) {
      if (!entityIds.has(entityId)) continue;
      if (proposedEntity.has(entityId)) {
        out.push(finding('proposed-mismatch', `relations[${r.id}].${side} が設計候補のデータ概念を指しているのに、関係が候補になっていません（破線で描けません）`, `relations[${r.id}]`));
      } else if (proposedField.get(entityId)?.has(fieldName)) {
        out.push(finding('proposed-mismatch', `relations[${r.id}].${side} が設計候補の項目 ${fieldName} を指しているのに、関係が候補になっていません（破線で描けません）`, `relations[${r.id}]`));
      }
    }
  }

  // 孤立エンティティ。ER に置いたのに誰とも関係しないカードは、図の意味を薄めるので落とす。
  const connected = new Set(D.relations.flatMap((r) => [r.a, r.b]));
  for (const e of D.entities) {
    if (!connected.has(e.id)) out.push(finding('orphan-entity', `entities[${e.key}] がどの関係にも現れません`, `entities[${e.key}]`));
  }

  for (const p of D.processes) {
    ref(p.lane, laneIds, `processes[${p.key}].lane`, 'lane');
    ref(p.screen, screenIds, `processes[${p.key}].screen`, 'screen');
    ref(p.source, sourceIds, `processes[${p.key}].source`, 'source');
    for (const e of p.entities) ref(e, entityIds, `processes[${p.key}].entities`, 'entity');
  }
  for (const e of D.processEdges) {
    ref(e.a, processIds, `process_edges[${e.id}].from`, 'process');
    ref(e.b, processIds, `process_edges[${e.id}].to`, 'process');
  }

  for (const g of D.groups) {
    for (const s of g.screens) ref(s, screenIds, `groups[${g.key}].screens`, 'screen');
    for (const e of g.entities) ref(e, entityIds, `groups[${g.key}].entities`, 'entity');
    for (const p of g.processes) ref(p, processIds, `groups[${g.key}].processes`, 'process');
    if (g.primary) ref(g.primary, entityIds, `groups[${g.key}].primary_entity`, 'entity');
  }

  // 業務工程が 1 つでもあるなら、担当区分の一覧が要る。カードに空欄が出るのを防ぐ。
  if (D.processes.length && !D.lanes.length) out.push(finding('missing-lanes', 'processes[] があるのに lanes[] が空です', 'lanes'));

  const conds = new Set(D.processes.map((p) => p.cond).filter(Boolean));
  for (const s of D.scenarios) {
    for (const c of s.conditions) {
      if (!conds.has(c)) out.push(finding('undefined-ref', `meta.scenarios[${s.id}].conditions が、どの工程も持たない条件を指しています: ${c}`, `meta.scenarios[${s.id}]`));
    }
    for (const p of s.include) ref(p, processIds, `meta.scenarios[${s.id}].include`, 'process');
  }

  for (const step of D.trace?.steps ?? []) {
    const id = step.target;
    if (!screenIds.has(`s-${id}`) && !entityIds.has(`e-${id}`)) {
      out.push(finding('undefined-ref', `meta.trace.steps が存在しない画面・データ概念を指しています: ${id}`, 'meta.trace'));
    }
  }
  for (const section of D.guide) ref(section.source, sourceIds, 'meta.guide[].source', 'source');

  // 拡張面は方向・孤立・多重度を見ない代わりに、参照整合だけは見る（そう明示した以上、その範囲は実装する）。
  for (const ext of D.extensions) {
    const nodeIds = new Set((ext.nodes ?? []).map((n) => n.id));
    for (const e of ext.edges ?? []) {
      for (const [id, side] of [[e.from, 'from'], [e.to, 'to']]) {
        if (!nodeIds.has(id)) out.push(finding('undefined-ref', `extensions[${ext.id}].edges[].${side} が、この面に無いノードを指しています: ${id}`, `extensions[${ext.id}]`));
      }
    }
  }

  // 検証の証跡。空なら「未実施が無い」という主張になるので、無自覚な空配列を指摘する。
  if (!D.notVerified.length) out.push(finding('empty-not-verified', 'not_verified[] が空です。実施していない検証が本当に無いか確認してください（無いなら、その旨を 1 行書いてください）', 'not_verified', 'warn'));

  return out;
}

/** source-manifest.json 側で宣言 sha256 と実体が食い違ったら止める。 */
export function checkManifest(manifest) {
  const out = [];
  for (const s of manifest.sources ?? []) {
    if (s.matches_declared === false) {
      out.push(finding('sha256-mismatch', `sources[${s.id}] の宣言 sha256 が実ファイルと一致しません。入力が入れ替わっています`, `sources[${s.id}]`));
    }
  }
  return out;
}

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 配置の破れ。指標ではなく、図として読めなくなる状態だけを見る。 */
export function checkLayout(layout, routing, model) {
  const out = [];
  const D = normalize(model);
  for (const [mode, view] of Object.entries(layout.views ?? {})) {
    const nodes = view.nodes ?? {};
    const ids = Object.keys(nodes);

    // カード重複。1px でも重なったら読めないので、面積ではなく矩形の交差で見る。
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (overlaps(nodes[ids[i]], nodes[ids[j]])) {
          out.push(finding('card-overlap', `${mode}: カードが重なっています: ${ids[i]} / ${ids[j]}`, mode));
        }
      }
    }

    const edges = edgesFor(D, mode);
    for (const e of edges) {
      const route = view.edges?.[e.id];
      if (!route) {
        out.push(finding('missing-route', `${mode}: 辺 ${e.id} の経路がありません`, mode));
        continue;
      }
      // カード貫通。両端のカードは端点が辺上に乗るため除外する。
      if (routing.blocked(route.points, nodes, [e.a, e.b])) {
        out.push(finding('card-pierced', `${mode}: 辺 ${e.id} が無関係なカードを貫通しています`, mode));
      }
    }

    // ラベルとカードの重なり／ラベル同士の重なり。
    const boxes = [];
    for (const [id, route] of Object.entries(view.edges ?? {})) {
      if (!route.labelBox) continue;
      for (const nid of ids) {
        if (overlaps(route.labelBox, nodes[nid])) out.push(finding('label-over-card', `${mode}: 辺 ${id} の説明ラベルがカード ${nid} に重なっています`, mode));
      }
      for (const prev of boxes) {
        if (overlaps(route.labelBox, prev.box)) out.push(finding('label-over-label', `${mode}: 説明ラベルが重なっています: ${prev.id} / ${id}`, mode));
      }
      boxes.push({ id, box: route.labelBox });
    }

    // ER は左→右の参照順。逆行は「参照元が右にある」という読み違いを生むので止める。
    if (mode === 'er') {
      for (const r of D.relations) {
        const a = nodes[r.a];
        const b = nodes[r.b];
        if (!a || !b) continue;
        if (b.x + b.w / 2 < a.x + a.w / 2) {
          out.push(finding('reversed-reference', `er: 参照順が逆行しています（参照先が参照元より左）: ${r.id}`, 'er'));
        }
      }
    }
  }
  return out;
}

/** 成果物に個人の絶対パスが混入していないか。値そのものは報告に出さない。 */
export function checkArtifacts(files, { extra = [] } = {}) {
  const out = [];
  for (const [name, text] of Object.entries(files)) {
    for (const hit of findAbsolutePaths(text, { extra })) {
      // --forbid で渡した語と、環境由来の絶対パスは別の話。まとめて「絶対パス」と呼ばない。
      const isPath = hit.kind !== '指定文字列';
      out.push(finding(isPath ? 'absolute-path' : 'forbidden-term',
        `${name} に${isPath ? '絶対パスが' : '持ち出し禁止の語が'}混入しています: ${describeLeak(hit)}`, name));
    }
  }
  return out;
}
