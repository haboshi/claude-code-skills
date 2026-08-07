// overrides.mjs — プロジェクトのグループ名寄せ・表示名・非表示を扱う非破壊オーバーライド層。
//
// 保存先は <HUB>/overrides.json。turn-review は HOME 直下に置くが、doc-hub は DOC_HUB_DIR で
// hub ごと差し替え・持ち運びできる必要があるため hub ルートに置く（意図的な差異）。
// projects/** の project.json は書き換えない。プロジェクト検出（project-id.mjs / resolveProject）も
// 無改変のまま、collectIndex の結果に後段でのみ適用する。パス由来の推定をグルーピングの機構に
// しないのは、パス配置が案件の帰属と一致しないケース（Projects 直下にある JBR 案件など）を
// 中央定義で上書きできるようにするため。
import fs from 'node:fs';
import path from 'node:path';

const GROUP_KEY_RE = /^g_\d+$/;

export function emptyOverrides() {
  return { version: 1, groups: {}, projects: {} };
}

export function overridesPath(hubDir) {
  return path.join(hubDir, 'overrides.json');
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// 破損 JSON は「空」として扱う（ファイルは残すので手で直せる）。
// onWarn は hub.mjs 側で stderr 出力に使う。
export function loadOverrides(hubDir, onWarn) {
  const file = overridesPath(hubDir);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return emptyOverrides();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    onWarn?.(`overrides.json が JSON として読めません（グループ設定を無視して続行）: ${file}`);
    return emptyOverrides();
  }
  const groups = {};
  if (isPlainObject(parsed.groups)) {
    for (const [k, g] of Object.entries(parsed.groups)) {
      if (!GROUP_KEY_RE.test(k)) continue;
      groups[k] = { label: typeof g?.label === 'string' && g.label.trim() ? g.label : k };
    }
  }
  const projects = {};
  if (isPlainObject(parsed.projects)) {
    for (const [pid, o] of Object.entries(parsed.projects)) {
      if (!isPlainObject(o)) continue;
      const entry = {};
      if (typeof o.group === 'string' && groups[o.group]) entry.group = o.group;
      if (typeof o.label === 'string' && o.label.trim()) entry.label = o.label;
      if (o.hidden === true) entry.hidden = true;
      if (Object.keys(entry).length) projects[pid] = entry;
    }
  }
  return { version: parsed.version || 1, groups, projects };
}

export function saveOverrides(hubDir, ov) {
  fs.mkdirSync(hubDir, { recursive: true });
  const tmp = path.join(hubDir, `.overrides-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(ov, null, 2) + '\n');
  fs.renameSync(tmp, overridesPath(hubDir)); // 原子書き込み（iCloud 同期・並行実行への防御）
}

// collectIndex の結果に overrides を適用する（入力は書き換えず新しい配列を返す）。
export function applyOverrides(projects, ov) {
  const groups = Object.entries(ov.groups)
    .map(([key, g]) => ({ key, label: g.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
  const applied = projects.map((p) => {
    const o = ov.projects[p.id] || {};
    return {
      ...p,
      label: o.label || p.label,
      group: o.group || null,
      hidden: o.hidden === true,
    };
  });
  return { projects: applied, groups };
}

// グループ参照をキー（g_N）へ解決する。キー完全一致 → ラベル完全一致の順。
export function resolveGroupKey(ov, ref) {
  if (!ref) return null;
  if (ov.groups[ref]) return ref;
  const hit = Object.entries(ov.groups).find(([, g]) => g.label === ref);
  return hit ? hit[0] : null;
}

export function nextGroupKey(groups) {
  const nums = Object.keys(groups)
    .map((k) => Number((k.match(/^g_(\d+)$/) || [])[1]))
    .filter((n) => Number.isFinite(n));
  return `g_${(nums.length ? Math.max(...nums) : 0) + 1}`;
}

export function createGroup(ov, label) {
  const key = nextGroupKey(ov.groups);
  return { key, next: { ...ov, groups: { ...ov.groups, [key]: { label } } } };
}

export function renameGroup(ov, key, label) {
  return { ...ov, groups: { ...ov.groups, [key]: { ...ov.groups[key], label } } };
}

// グループ削除。所属していたプロジェクトは「未分類」へ戻す（プロジェクト側の設定は消さない）。
export function deleteGroup(ov, key) {
  const groups = { ...ov.groups };
  delete groups[key];
  const projects = {};
  for (const [pid, o] of Object.entries(ov.projects)) {
    const { group, ...rest } = o;
    const kept = group === key ? rest : o;
    if (Object.keys(kept).length) projects[pid] = kept;
  }
  return { ...ov, groups, projects };
}

// プロジェクト単位の上書き。値に null / '' を渡すとそのキーを消す。undefined は無変更。
export function setProjectOverride(ov, pid, { group, label, hidden } = {}) {
  const cur = { ...(ov.projects[pid] || {}) };
  const assign = (key, value) => {
    if (value === undefined) return;
    if (value === null || value === false || (typeof value === 'string' && !value.trim())) delete cur[key];
    else cur[key] = value;
  };
  assign('group', group);
  assign('label', label);
  assign('hidden', hidden);
  const projects = { ...ov.projects };
  if (Object.keys(cur).length) projects[pid] = cur;
  else delete projects[pid];
  return { ...ov, projects };
}

// 実在しないプロジェクト id のエントリを落とす。グループ定義は空でも残す（割当先として選べるため）。
export function pruneOrphans(ov, existingIds) {
  const set = new Set(existingIds);
  const projects = {};
  for (const [pid, o] of Object.entries(ov.projects)) if (set.has(pid)) projects[pid] = o;
  return { ...ov, projects };
}

// パス階層からグループ候補を作る（表示専用。自動適用しない）。
// 判定: 親ディレクトリを 2 つ以上のプロジェクトが共有していれば候補。ただし他の候補ディレクトリの
// 祖先にあたるものは「汎用の置き場」（~/Projects 等）とみなして除外する。
// 親ディレクトリ自体がプロジェクトとして登録されていれば、それもメンバーに含める（jbr とその配下）。
export function suggestGroups(projects) {
  const byParent = new Map();
  const byPath = new Map();
  for (const p of projects) {
    if (!p.abs_path) continue;
    byPath.set(p.abs_path, p);
    const parent = path.dirname(p.abs_path);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(p);
  }
  const candidates = [...byParent.entries()].filter(([, members]) => members.length >= 2).map(([dir]) => dir);
  const isAncestorOfCandidate = (dir) =>
    candidates.some((other) => other !== dir && other.startsWith(dir + path.sep));
  return candidates
    .filter((dir) => !isAncestorOfCandidate(dir))
    .map((dir) => {
      const members = [...byParent.get(dir)];
      const self = byPath.get(dir);
      if (self && !members.includes(self)) members.unshift(self);
      return { label: path.basename(dir), dir, members };
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'));
}
