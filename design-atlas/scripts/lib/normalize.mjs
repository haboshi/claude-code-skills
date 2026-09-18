// model.json（人が書く形）を、配置計算とビューワが共有する内部形（D）へ変換する。
// ここで面ごとの接頭辞 s- / e- / b- を付ける。model.json 側には書かせない。
// 変換は純粋関数。ファイルも時刻も触らない（決定論のため）。
import { ModelError } from './model.mjs';

export const SCREEN = (id) => `s-${id}`;
export const ENTITY = (id) => `e-${id}`;
export const PROCESS = (id) => `b-${id}`;
export const GROUP = (id) => `g-${id}`;

const DEFAULT_LABELS = {
  status: { observed: '実装で確認', derived: '表示・概念の整理', proposed: '設計候補' },
  field_roles: { key: 'KEY', ref: 'REF', value: '' },
  weights: { 3: '強い関係', 2: '参照・依存', 1: '補助・候補' },
};

const DEFAULT_REASON = {
  3: '同じ識別子を引き継ぐ、または直接に属するデータ',
  2: 'コード・番号を介した参照、画面への移動、業務の依存',
  1: '対応づけ、または未確定の設計候補',
};

function list(value) {
  return Array.isArray(value) ? value : [];
}

/** id を持たない要素に安定した id を振る。並び順だけで決まるので再生成しても変わらない。 */
function autoId(item, prefix, index) {
  return item.id ?? `${prefix}${index}`;
}

export function normalize(model) {
  if (!model || typeof model !== 'object') throw new ModelError('model.json がオブジェクトではありません');
  const meta = model.meta ?? {};
  const labels = {
    status: { ...DEFAULT_LABELS.status, ...(meta.labels?.status ?? {}) },
    field_roles: { ...DEFAULT_LABELS.field_roles, ...(meta.labels?.field_roles ?? {}) },
    weights: { ...DEFAULT_LABELS.weights, ...(meta.labels?.weights ?? {}) },
  };

  const screens = list(model.screens).map((s, i) => ({
    id: SCREEN(s.id),
    key: s.id,
    code: `S${String(i + 1).padStart(2, '0')}`,
    name: s.name,
    role: s.role ?? '',
    desc: s.description ?? '',
    note: s.note ?? '',
    version: s.version ?? null,
    entities: list(s.entities).map(ENTITY),
    processes: list(s.processes).map(PROCESS),
    source: s.source ?? null,
    mock: s.mock ?? null,
    images: list(s.images).map((img) => ({
      key: img.key,
      label: img.label ?? img.key,
      path: img.path,
      captured_at: img.captured_at ?? null,
      historical: img.historical === true,
      width: img.width ?? null,
      height: img.height ?? null,
    })),
  }));

  const entities = list(model.entities).map((e) => ({
    id: ENTITY(e.id),
    key: e.id,
    name: e.name,
    area: e.area,
    status: e.status ?? 'observed',
    origin: e.origin ?? '',
    source: e.source ?? null,
    note: e.note ?? '',
    fields: list(e.fields).map((f) => ({
      name: f.name,
      label: f.label ?? f.name,
      role: f.role ?? 'value',
      proposed: f.proposed === true,
    })),
  }));

  const transitions = list(model.transitions).map((t, i) => ({
    id: autoId(t, 't', i),
    a: SCREEN(t.from),
    b: SCREEN(t.to),
    label: t.trigger,
    desc: t.description ?? '',
    selector: t.selector ?? null,
    carry: t.carry ?? '',
    pin: t.pin ?? null,
    kind: 'navigation',
    type: 'navigation',
    // 太さの既定は「引き継ぎがあるか」。model 側で weight を書けば上書きできる。
    strength: t.weight ?? (t.carry ? 3 : 2),
    reason: t.reason ?? DEFAULT_REASON[t.weight ?? (t.carry ? 3 : 2)],
  }));

  const relations = list(model.relations).map((r, i) => {
    const weight = r.weight ?? (r.proposed ? 1 : 2);
    return {
      id: autoId(r, 'r', i),
      a: ENTITY(r.from.entity),
      b: ENTITY(r.to.entity),
      fa: r.from.field,
      fb: r.to.field,
      ca: r.from.cardinality,
      cb: r.to.cardinality,
      label: r.label ?? '',
      proposed: r.proposed === true,
      type: r.proposed ? 'proposed' : 'relation',
      sourcePort: r.from.field,
      targetPort: r.to.field,
      strength: r.proposed ? 1 : weight,
      reason: r.reason ?? DEFAULT_REASON[r.proposed ? 1 : weight],
    };
  });

  const processes = list(model.processes).map((p) => ({
    id: PROCESS(p.id),
    key: p.id,
    number: p.number ?? null,
    name: p.name,
    lane: p.lane ?? null,
    cond: p.condition ?? null,
    desc: p.description ?? '',
    screen: p.screen ? SCREEN(p.screen) : null,
    entities: list(p.entities).map(ENTITY),
    reads: p.reads ?? '',
    writes: p.writes ?? '',
    lt: p.lead_time ?? '',
    sys: p.system ?? '',
    source: p.source ?? null,
    extra: p.supplement === true,
  }));

  const processEdges = list(model.process_edges).map((e, i) => {
    const kind = e.kind ?? 'normal';
    const weight = e.weight ?? (kind === 'exception' ? 3 : 2);
    return {
      id: autoId(e, 'pe', i),
      a: PROCESS(e.from),
      b: PROCESS(e.to),
      label: e.label ?? '',
      kind,
      primary: e.primary === true,
      type: kind === 'exception' ? 'exception' : 'business',
      strength: weight,
      reason: e.reason ?? DEFAULT_REASON[weight],
    };
  });

  const groups = list(model.groups).map((g) => ({
    id: GROUP(g.id),
    key: g.id,
    name: g.label,
    sub: g.subtitle ?? '',
    screens: list(g.screens).map(SCREEN),
    entities: list(g.entities).map(ENTITY),
    processes: list(g.processes).map(PROCESS),
    primary: g.primary_entity ? ENTITY(g.primary_entity) : (list(g.entities).map(ENTITY)[0] ?? null),
  }));

  const scenarios = list(meta.scenarios).map((s) => ({
    id: s.id,
    label: s.label,
    conditions: list(s.conditions),
    include: list(s.include).map(PROCESS),
  }));

  return {
    meta: {
      id: meta.id,
      title: meta.title,
      subtitle: meta.subtitle ?? '',
      description: meta.description ?? '',
      project: meta.project ?? null,
      model_version: meta.model_version ?? 1,
      accent: meta.accent ?? null,
    },
    labels,
    scenarios,
    guide: list(meta.guide),
    trace: meta.trace ?? null,
    lanes: list(model.lanes),
    areas: list(model.areas),
    screens,
    entities,
    transitions,
    relations,
    processes,
    processEdges,
    groups,
    openQuestions: list(model.open_questions),
    notVerified: list(model.not_verified),
    extensions: list(model.extensions),
    sources: list(model.sources),
  };
}

/** 配置計算が使う辺の集合。面ごとに形を揃える。 */
export function edgesFor(D, mode) {
  if (mode === 'er') return D.relations;
  if (mode === 'flow') return D.processEdges;
  if (mode === 'screens') return D.transitions.map((t) => ({ ...t, sourcePort: t.id }));
  if (mode === 'overview') return overviewEdges(D);
  throw new ModelError(`未知の面: ${mode}`);
}

/** 俯瞰ビューの辺は他の面から導出する。model.json には書かせない。 */
export function overviewEdges(D) {
  const edges = [];
  D.groups.forEach((g, i) => {
    for (const sid of g.screens) {
      edges.push({ id: `gs-${sid}`, a: g.id, b: sid, label: '担当画面', type: 'mapping', strength: 1, reason: '業務と担当画面の対応づけ' });
      if (g.primary && D.screens.find((s) => s.id === sid)?.entities.includes(g.primary)) {
        edges.push({ id: `se-${sid}`, a: sid, b: g.primary, label: 'データの対応', type: 'mapping', strength: 2, reason: '画面で扱う代表データ' });
      }
    }
    const next = D.groups[i + 1];
    if (next) edges.push({ id: `gg-${i}`, a: g.id, b: next.id, label: '業務の流れ', type: 'business', strength: 2, reason: '業務の前後関係' });
  });
  return edges;
}
