import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildData, renderHtml } from '../scripts/build.mjs';
import { buildLayout, loadRules } from '../scripts/layout.mjs';
import { spawnSync } from 'node:child_process';
import { findAbsolutePaths } from '../scripts/lib/leaks.mjs';

const hasDot = spawnSync('dot', ['-V']).status === 0;
const withDot = { skip: hasDot ? false : 'Graphviz の dot が未導入' };
const model = () => JSON.parse(fs.readFileSync(new URL('./fixtures/library/model.json', import.meta.url), 'utf8'));
const rules = () => loadRules(new URL('./fixtures/library/', import.meta.url).pathname);
const data = () => buildData(model(), buildLayout(model(), rules()), { modelSha: 'a'.repeat(64) });

test('埋め込みデータに 4 面すべての配置と辺が入る', withDot, () => {
  const d = data();
  assert.deepEqual(Object.keys(d.layouts).sort(), ['er', 'flow', 'overview', 'screens']);
  for (const mode of Object.keys(d.layouts)) assert.ok(d.edges[mode].length > 0, `${mode} に辺がある`);
});

test('未実施の検証と未確定事項はそのまま埋め込む', withDot, () => {
  const d = data();
  assert.equal(d.notVerified.length, model().not_verified.length);
  assert.equal(d.openQuestions.length, model().open_questions.length);
});

test('条件コードの表示名は最も絞り込みの強い経路から取る', withDot, () => {
  // 'overdue' は全経路と延滞の両方に属する。表示名は延滞側を使う。
  assert.equal(data().conditionLabels.overdue, '延滞');
});

test('生成した HTML に絶対パスが入らない', withDot, () => {
  const html = renderHtml(data(), model());
  assert.deepEqual(findAbsolutePaths(html), []);
});

test('HTML にプレースホルダが残らない', withDot, () => {
  assert.doesNotMatch(renderHtml(data(), model()), /\/\*ATLAS_[A-Z_]+\*\//);
});

test('同じ入力からは同じバイト列が出る（時刻を埋め込まない）', withDot, () => {
  const m = model();
  const layout = buildLayout(m, rules());
  const a = renderHtml(buildData(m, layout, { modelSha: 'a'.repeat(64) }), m);
  const b = renderHtml(buildData(m, layout, { modelSha: 'a'.repeat(64) }), m);
  assert.equal(a, b);
  assert.doesNotMatch(a, /"generated_at"/);
});

test('埋め込み JSON がスクリプトを閉じない', withDot, () => {
  const m = model();
  m.meta.description = 'closing </script> inside text';
  const html = renderHtml(buildData(m, buildLayout(m, rules())), m);
  const between = html.split('<script id="atlas-data" type="application/json">')[1].split('</script>')[0];
  assert.ok(between.includes('<\\/script>'), '本文中の </script> が退避されている');
});

test('撮影サイズの分からない画像の操作位置は埋め込まない', withDot, () => {
  // 幅・高さが無いと座標を割合に直せず、位置の意味が決まらない。
  // （参考画像に付いた操作位置の方は、構造検査が model の時点で撥ねる — checks.test.mjs 参照）
  const m = model();
  m.screens[0].images = [{ key: 'top', path: 'shot.png' }];
  m.transitions[1].pin = { image: 'top', x: 100, y: 200, w: 40, h: 20 };
  const d = buildData(m, buildLayout(m, rules()));
  assert.equal(d.transitions.find((t) => t.id === 't1').pin, null);
});

test('trace が無いモデルではヘッダーのボタンごと出ない', withDot, () => {
  const m = model();
  delete m.meta.trace;
  const html = renderHtml(buildData(m, buildLayout(m, rules())), m);
  assert.doesNotMatch(html, /id="trace-example"/);
});

test('根拠ソースの本文は既定で同梱しない', withDot, () => {
  const d = data();
  assert.equal(d.embedsSourceText, false, '既定で本文を載せない');
  assert.deepEqual(d.sourceBodies, {});
  assert.ok(d.sources.every((s) => s.embedded === false));
});

test('構造が破れているモデルでは書き出さない', withDot, async () => {
  const fsMod = await import('node:fs');
  const osMod = await import('node:os');
  const pathMod = await import('node:path');
  const { build } = await import('../scripts/build.mjs');
  const dir = fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'design-atlas-broken-'));
  const m = model();
  m.screens[0].entities.push('ghost');
  fsMod.writeFileSync(pathMod.join(dir, 'model.json'), JSON.stringify(m));
  fsMod.writeFileSync(pathMod.join(dir, 'layout.json'), JSON.stringify(buildLayout(model(), rules())));
  const out = pathMod.join(dir, 'index.html');
  await assert.rejects(() => build(pathMod.join(dir, 'model.json'), out), /生成しません/);
  assert.equal(fsMod.existsSync(out), false, '壊れた成果物が手元に残ってしまう');
});

test('groups[] の無いモデルでは俯瞰の面ごと出さない', withDot, () => {
  const m = model();
  delete m.groups;
  const layout = buildLayout(m, rules());
  assert.equal(layout.views.overview, undefined, '描けない面の配置を作らない');
  const html = renderHtml(buildData(m, layout), m);
  assert.doesNotMatch(html, /data-view="overview"/, '押しても何も起きないボタンを出さない');
  assert.match(html, /data-view="er"/);
});

test('面の切り替えボタンは実在する面の数だけ出る', withDot, () => {
  // 「見る順番」の導線はビューワが実行時に組むので、HTML に出るのはヘッダーのボタンだけ。
  const header = (html) => html.split('</nav>')[0];
  assert.equal([...header(renderHtml(data(), model())).matchAll(/data-view="/g)].length, 4);
  const m = model();
  delete m.processes;
  delete m.process_edges;
  delete m.meta.scenarios;
  m.screens.forEach((s) => { delete s.processes; });
  m.groups.forEach((g) => { delete g.processes; });
  assert.equal([...header(renderHtml(buildData(m, buildLayout(m, rules())), m)).matchAll(/data-view="/g)].length, 3);
});

test('モデルの文字列が差し込み口として展開されない', withDot, () => {
  const m = model();
  // 題名に差し込み口の並びを書いても、それは題名の文字として出るだけで、
  // 埋め込み JSON やスクリプト本体には化けない。
  m.meta.title = '/*ATLAS_DATA*/';
  m.meta.description = '/*ATLAS_JS*/';
  const html = renderHtml(buildData(m, buildLayout(m, rules())), m);
  const title = html.match(/<title>([\s\S]*?)<\/title>/)[1];
  assert.equal(title, '/*ATLAS_DATA*/', '題名が JSON に置き換わっている');
  const desc = html.match(/name="description" content="([\s\S]*?)"/)[1];
  assert.equal(desc, '/*ATLAS_JS*/', '説明がスクリプト本体に置き換わっている');
  assert.equal([...html.matchAll(/<script id="atlas-data"/g)].length, 1);
});
