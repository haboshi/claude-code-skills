// draw.io の export SVG を白基調の 1 枚 HTML へ貼るための整形。
// 3 つの壊れ方（ダーク追随・id 衝突・日本語フォント欠落）は実 export で確認済みのもの。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldLightDark,
  fixFonts,
  prefixIds,
  normalizeRoot,
  retint,
  stripEmbeddedXml,
  prepareForEmbed,
} from '../scripts/drawio-embed.mjs';

test('foldLightDark: 入れ子の rgb() を含む値でもライト側へ畳む', () => {
  // draw.io の実 export は light-dark(rgb(51, 51, 51), rgb(255, 255, 255)) の形で出る。
  // 引数に括弧が入るため正規表現では扱えず、括弧の深さを数える実装にしている。
  assert.equal(
    foldLightDark('fill: light-dark(rgb(51, 51, 51), rgb(255, 255, 255));'),
    'fill: rgb(51, 51, 51);'
  );
  assert.equal(foldLightDark('stroke: light-dark(#000000, #ffffff)'), 'stroke: #000000');
  assert.equal(foldLightDark('a light-dark(red, blue) b light-dark(#111, #eee) c'), 'a red b #111 c');
  assert.equal(foldLightDark('色指定なし'), '色指定なし');
  // 閉じ括弧が無い壊れた入力は、落とさずそのまま残す
  assert.equal(foldLightDark('fill: light-dark(#000, #fff'), 'fill: light-dark(#000, #fff');
});

test('prefixIds: id と参照をまとめて付け替える（同一文書に 2 枚貼れる）', () => {
  const svg = '<svg><defs><marker id="0"/><clipPath id="1"/></defs>'
    + '<path marker-end="url(#0)" clip-path="url(#1)"/><use xlink:href="#1"/></svg>';
  const a = prefixIds(svg, 'dg1');
  const b = prefixIds(svg, 'dg2');
  assert.ok(a.includes('id="dg1-0"') && a.includes('url(#dg1-0)'), '参照が追随していない');
  assert.ok(a.includes('xlink:href="#dg1-1"'), 'xlink:href が追随していない');
  assert.ok(!/\sid="0"/.test(a), '素の id が残っている');
  // 2 枚分を結合しても id が衝突しない
  const merged = a + b;
  assert.equal((merged.match(/id="dg1-0"/g) || []).length, 1);
  assert.equal((merged.match(/id="dg2-0"/g) || []).length, 1);
});

test('fixFonts: 日本語フォールバックの無い指定だけ差し替える', () => {
  assert.match(fixFonts('font-family: Helvetica;'), /Hiragino Sans/);
  // 既に日本語対応なら触らない
  const ok = "font-family: 'Hiragino Sans', sans-serif;";
  assert.equal(fixFonts(ok), ok);
});

test('normalizeRoot: 幅指定を外し、ライト固定・role・title を持たせる', () => {
  const svg = '<svg width="800" height="600" style="background: transparent; color-scheme: light dark" viewBox="0 0 800 600"><g/></svg>';
  const out = normalizeRoot(svg, '図の説明');
  assert.ok(!/<svg[^>]*\swidth=/.test(out), 'width が残っている（figure svg{width:100%} が効かない）');
  assert.ok(!out.includes('light dark'), 'ダーク追随が残っている');
  assert.match(out, /color-scheme: light/, 'ライト固定になっていない');
  assert.match(out, /role="img"/);
  assert.match(out, /<title>図の説明<\/title>/);
  assert.match(out, /viewBox="0 0 800 600"/, 'viewBox が失われている');
});

test('normalizeRoot: title は XML エスケープする', () => {
  const out = normalizeRoot('<svg viewBox="0 0 10 10"><g/></svg>', 'A & B <危険>');
  assert.match(out, /<title>A &amp; B &lt;危険&gt;<\/title>/);
});

test('stripEmbeddedXml: content 属性（編集用 mxfile）を落とす', () => {
  const svg = '<svg viewBox="0 0 10 10" content="&lt;mxfile&gt;width=99 id=&quot;x&quot;&lt;/mxfile&gt;"><g/></svg>';
  const out = stripEmbeddedXml(svg);
  assert.ok(!out.includes('content='), 'content が残っている');
  assert.match(out, /viewBox="0 0 10 10"/, '他の属性まで落ちている');
});

test('prepareForEmbed: 一連の整形を通しても XML の骨格を保つ', () => {
  const svg = '<?xml version="1.0"?>\n<svg width="400" height="300" viewBox="0 0 400 300" '
    + 'style="color-scheme: light dark" content="&lt;mxfile/&gt;" xmlns="http://www.w3.org/2000/svg">'
    + '<defs><marker id="0"/></defs>'
    + '<g style="font-family: Helvetica; fill: light-dark(rgb(0, 0, 0), rgb(255, 255, 255))">'
    + '<path marker-end="url(#0)"/></g></svg>';
  const out = prepareForEmbed(svg, { idPrefix: 'dg1', title: 'テスト図' });
  assert.ok(!out.includes('<?xml'), 'XML 宣言が残っている');
  assert.ok(!out.includes('light-dark('), 'ダーク追随が残っている');
  assert.ok(!out.includes('content='), 'content が残っている');
  assert.ok(!/<svg[^>]*\swidth=/.test(out), 'width が残っている');
  assert.match(out, /id="dg1-0"/);
  assert.match(out, /url\(#dg1-0\)/);
  assert.match(out, /Hiragino Sans/);
  assert.match(out, /role="img"/);
  assert.match(out, /<title>テスト図<\/title>/);
  assert.match(out, /viewBox="0 0 400 300"/);
});

test('retint: drawio 既定の紫を文書のアクセント色へ寄せる', () => {
  // Mermaid 変換で付く既定スタイル（#9370db / #ececff）のままだと、
  // 文書のアクセント1色の原則が崩れる。線と面だけ置き換え、文字色は残す。
  const svg = '<g stroke="rgb(147, 112, 219)" fill="rgb(236, 236, 255)"/><text fill="rgb(51, 51, 51)">文字</text>';
  const out = retint(svg, '#2563eb', '#eef3fd');
  assert.ok(!out.includes('147, 112, 219'), '線色が残っている');
  assert.ok(!out.includes('236, 236, 255'), '面色が残っている');
  assert.match(out, /stroke="#2563eb"/);
  assert.match(out, /fill="#eef3fd"/);
  assert.match(out, /fill="rgb\(51, 51, 51\)"/, '文字色まで置き換えている');
  // hex 表記でも効く
  assert.match(retint('<g stroke="#9370db"/>', '#2563eb', '#eef3fd'), /#2563eb/);
});

test('retint: accent 未指定なら何もしない', () => {
  const svg = '<g stroke="rgb(147, 112, 219)"/>';
  assert.equal(retint(svg, '', ''), svg);
});
