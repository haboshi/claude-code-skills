import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateDrawio, countPages } from './validate.js'

/** 正常な図。各テストはここから1箇所だけ壊して、その違反が出ることを見る。 */
const VALID = `<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="v1" value="開始" style="rounded=1;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="v2" value="終了" style="rounded=1;html=1;" vertex="1" parent="1">
      <mxGeometry x="280" y="40" width="140" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="v1" target="v2">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`

const codesOf = (xml) => validateDrawio(xml).issues.map((i) => i.code)

test('正常な図はエラーも警告も出ない', () => {
  const result = validateDrawio(VALID)
  assert.equal(result.ok, true)
  assert.deepEqual(result.issues, [])
})

test('mxfile でラップした形も通る', () => {
  const wrapped = `<mxfile host="Electron"><diagram id="p1" name="Page-1">${VALID}</diagram></mxfile>`
  assert.equal(validateDrawio(wrapped).ok, true)
})

// draw.io がラベル付きセルを書き出すときの正規形。Mermaid 変換の出力がこの形になる。
// id はラッパー側、vertex/edge/parent/style は入れ子の mxCell 側に載る。
const WRAPPED = `<mxGraphModel>
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <UserObject label="開始" mermaidId="n:A" id="2">
      <mxCell parent="1" style="rounded=1;html=1;" vertex="1">
        <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
      </mxCell>
    </UserObject>
    <UserObject label="終了" id="3">
      <mxCell parent="1" style="rounded=1;html=1;" vertex="1">
        <mxGeometry x="280" y="40" width="140" height="60" as="geometry"/>
      </mxCell>
    </UserObject>
    <UserObject label="次へ" id="4">
      <mxCell parent="1" style="html=1;" edge="1" source="2" target="3">
        <mxGeometry relative="1" as="geometry"/>
      </mxCell>
    </UserObject>
  </root>
</mxGraphModel>`

test('UserObject でラップされたセルを正しく読む', () => {
  // 公式スキルの Mermaid 変換が出す形式。ここを誤ると draw.io 自身の出力を不合格にする
  const result = validateDrawio(WRAPPED)
  assert.equal(result.ok, true, `issues: ${JSON.stringify(result.issues)}`)
  assert.deepEqual(result.issues, [])
})

test('object タグでラップされた形も読む', () => {
  assert.equal(validateDrawio(WRAPPED.replace(/UserObject/g, 'object')).ok, true)
})

test('ラップされていても id 重複を検出する', () => {
  const codes = codesOf(WRAPPED.replace('id="3"', 'id="2"'))
  assert.ok(codes.includes('DUPLICATE_ID'))
})

test('ラップされていても辺の未解決端点を検出する', () => {
  const codes = codesOf(WRAPPED.replace('source="2" target="3"', 'source="2" target="nope"'))
  assert.ok(codes.includes('EDGE_DANGLING_ENDPOINT'))
})

test('ラップされていても自己閉じの辺を検出する', () => {
  const broken = WRAPPED.replace(
    /<mxCell parent="1" style="html=1;" edge="1" source="2" target="3">\s*<mxGeometry relative="1" as="geometry"\/>\s*<\/mxCell>/,
    '<mxCell parent="1" style="html=1;" edge="1" source="2" target="3"/>',
  )
  assert.notEqual(broken, WRAPPED, 'ミューテーションが効いていない')
  assert.ok(codesOf(broken).includes('EDGE_NO_GEOMETRY'))
})

test('ラップされたラベルの \\n も警告する', () => {
  const result = validateDrawio(WRAPPED.replace('label="開始"', 'label="開始\\n続き"'))
  assert.ok(result.issues.some((i) => i.code === 'LITERAL_BACKSLASH_N'))
})

// 矢印にラベルを付けると辺の子頂点として生成される。位置は relative + offset で
// 決まるので width/height を持たない。draw.io 自身が往復でこの形を保持する。
const EDGE_LABEL = VALID.replace('</root>', `    <mxCell id="e1lbl" value="はい" style="edgeLabel;html=1;resizable=0;" vertex="1" connectable="0" parent="e1">
      <mxGeometry x="-0.1" y="1" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>
    </mxCell>
  </root>`)

test('辺ラベル（width/height を持たない子頂点）を誤って落とさない', () => {
  assert.notEqual(EDGE_LABEL, VALID, 'fixture が組み立てられていない')
  const result = validateDrawio(EDGE_LABEL)
  assert.equal(result.ok, true, `issues: ${JSON.stringify(result.issues)}`)
  assert.deepEqual(result.issues, [])
})

test('relative でない通常の頂点は width/height 必須のまま', () => {
  const codes = codesOf(VALID.replace('width="140" height="60"', ''))
  assert.ok(codes.includes('VERTEX_NO_SIZE'))
})

test('relative な頂点でも負の寸法は落とす', () => {
  const codes = codesOf(EDGE_LABEL.replace(
    '<mxGeometry x="-0.1" y="1" relative="1" as="geometry">',
    '<mxGeometry x="-0.1" y="1" width="-10" relative="1" as="geometry">',
  ))
  assert.ok(codes.includes('NEGATIVE_SIZE'))
})

test('countPages がページ数を数える', () => {
  assert.equal(countPages(VALID), 1)
  assert.equal(countPages(`<mxfile><diagram id="a">${VALID}</diagram><diagram id="b">${VALID}</diagram></mxfile>`), 2)
  assert.equal(countPages('<not-xml'), 0)
})

test('1: 整形式でない XML を落とす', () => {
  const result = validateDrawio('<mxGraphModel><root><mxCell id="0"/></mxGraphModel>')
  assert.equal(result.ok, false)
  assert.deepEqual(result.issues.map((i) => i.code), ['XML_MALFORMED'])
})

test('2: ルート要素が mxfile / mxGraphModel でなければ落とす', () => {
  const result = validateDrawio('<svg><root/></svg>')
  assert.equal(result.ok, false)
  assert.ok(codesOf('<svg><root/></svg>').includes('UNEXPECTED_ROOT'))
})

test('2: 圧縮された diagram を落とす', () => {
  const compressed = '<mxfile><diagram id="p1" name="Page-1">7VbBcpswEP0aHZsBhLFzTOykOfSQNjP9AAUtoIlgVSHHdr++khEYbNJJZtLDdHwx+3ZXsO/tsiAWl82D5m39DTlIEid8T9iaJEmaLezVAYceyMS8ByojeA+BAXgUvyGACc+3gkM3STSI0oh2CuaoFOTGY8CzYnrfDVBQ8oi0vIIz4DHn8hz9KbipezRZLAb8HkRVh0dHwbHhIRUeujjSAeE7ArICNaZ3zf4GpKMt8HFsef2C6/hUGpR5TcH1PXvbrn+wLdt1v5Ynxbe5+RSq7Lh8Ccz6bs0hUKa4rp2N7uW1qLPD9pGe+kBArwPBd0BjB+7NFZeiUtbOod++A203PtnCiFxL2AlThZQEbAiSGkOhFwK7QSqhldyMjm27dXKQlBftaKajZg61vHW+SDcOKa9kUXBk96mvfw+H0V6l6RtsX3Fp07AJNS4nSZ7A0V0Yl+B5CyH0EZ+bAcU/n3M/mTdjczRSC4NDf2yG0jbcaS3rjLNzhbqUwjnDrO2ELiehyMjkNGWvGXlR/HOEo4LNZlbBaFYw6iyhwsK4WabMHydW+RcHkyR75wyc07nBH+dwo8/vT/lVWL/2XhWmQOSMPy4T2A44qi3lb1XJmMj1FeXvMuLuwHYtaCu86kL7Iuxq4TfCpz5R33mmr5RJc6RvmA4nz+dGnLh6vLR6/lm37GwGX7GT/qXsjF+2/rn7tt7X6Us4dxUOX4b+CzT+vGZ3fwA=</diagram></mxfile>'
  const result = validateDrawio(compressed)
  assert.equal(result.ok, false)
  assert.ok(result.issues.map((i) => i.code).includes('COMPRESSED_DIAGRAM'))
})

test('3: 構造セル id=0 が欠けていれば落とす', () => {
  const codes = codesOf(VALID.replace('<mxCell id="0"/>', ''))
  assert.ok(codes.includes('MISSING_ROOT_CELL'))
})

test('3: 構造セル id=1 が欠けていれば落とす', () => {
  const codes = codesOf(VALID.replace('<mxCell id="1" parent="0"/>', ''))
  assert.ok(codes.includes('MISSING_LAYER_CELL'))
})

test('3: レイヤーの parent が 0 でなければ落とす', () => {
  const codes = codesOf(VALID.replace('<mxCell id="1" parent="0"/>', '<mxCell id="1" parent="9"/>'))
  assert.ok(codes.includes('LAYER_BAD_PARENT'))
})

test('4: id が重複していれば落とす', () => {
  const codes = codesOf(VALID.replace('id="v2"', 'id="v1"'))
  assert.ok(codes.includes('DUPLICATE_ID'))
})

test('4: 存在しない parent を指していれば落とす', () => {
  const codes = codesOf(VALID.replace('vertex="1" parent="1"', 'vertex="1" parent="99"'))
  assert.ok(codes.includes('DANGLING_PARENT'))
})

test('5: vertex と edge を両方 1 にしていれば落とす', () => {
  const codes = codesOf(VALID.replace('edge="1" parent="1"', 'edge="1" vertex="1" parent="1"'))
  assert.ok(codes.includes('VERTEX_AND_EDGE'))
})

test('5: vertex でも edge でもないセルは警告する', () => {
  const result = validateDrawio(VALID.replace('vertex="1" parent="1"', 'parent="1"'))
  assert.ok(result.issues.some((i) => i.code === 'NEITHER_VERTEX_NOR_EDGE' && i.severity === 'warn'))
})

test('6: 辺が存在しない頂点を指していれば落とす', () => {
  const codes = codesOf(VALID.replace('source="v1" target="v2"', 'source="v1" target="nope"'))
  assert.ok(codes.includes('EDGE_DANGLING_ENDPOINT'))
})

test('6: 辺の端点が無ければ警告する（端点が原点に落ちる）', () => {
  const result = validateDrawio(VALID.replace(' source="v1" target="v2"', ''))
  assert.ok(result.issues.some((i) => i.code === 'EDGE_ENDPOINT_MISSING' && i.severity === 'warn'))
})

test('7: 自己閉じの辺（mxGeometry 無し）を落とす', () => {
  const broken = VALID.replace(
    /<mxCell id="e1"([^>]*)>\s*<mxGeometry relative="1" as="geometry"\/>\s*<\/mxCell>/,
    '<mxCell id="e1"$1/>',
  )
  const codes = codesOf(broken)
  assert.ok(codes.includes('EDGE_NO_GEOMETRY'))
})

test('7: 頂点に width/height が無ければ落とす', () => {
  const codes = codesOf(VALID.replace('width="140" height="60"', ''))
  assert.ok(codes.includes('VERTEX_NO_SIZE'))
})

test('9: 寸法が負なら落とす', () => {
  const codes = codesOf(VALID.replace('width="140"', 'width="-140"'))
  assert.ok(codes.includes('NEGATIVE_SIZE'))
})

test('公式が禁じる XML コメントを落とす', () => {
  const codes = codesOf(VALID.replace('<root>', '<root>\n    <!-- ここに図を置く -->'))
  assert.ok(codes.includes('XML_COMMENT'))
})

test('compressed="true" 属性を落とす', () => {
  const codes = codesOf(VALID.replace('<mxGraphModel ', '<mxGraphModel compressed="true" '))
  assert.ok(codes.includes('COMPRESSED_ATTR'))
})

test('8: html=1 が無いのに value にタグがあれば警告する', () => {
  const result = validateDrawio(VALID.replace('value="開始" style="rounded=1;html=1;"', 'value="&lt;b&gt;開始&lt;/b&gt;" style="rounded=1;"'))
  assert.ok(result.issues.some((i) => i.code === 'HTML_LABEL_WITHOUT_FLAG'))
})

test('リテラルの \\n は改行にならないので警告する', () => {
  const result = validateDrawio(VALID.replace('value="開始"', 'value="開始\\n続き"'))
  assert.ok(result.issues.some((i) => i.code === 'LITERAL_BACKSLASH_N'))
})

test('警告だけなら ok は true のまま', () => {
  const result = validateDrawio(VALID.replace('value="開始"', 'value="開始\\n続き"'))
  assert.equal(result.ok, true)
})

test('複数ページはページ番号つきで報告する', () => {
  const multi = `<mxfile>
    <diagram id="p1" name="Page-1">${VALID}</diagram>
    <diagram id="p2" name="Page-2">${VALID.replace('<mxCell id="0"/>', '')}</diagram>
  </mxfile>`
  const result = validateDrawio(multi)
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.code === 'MISSING_ROOT_CELL' && i.message.includes('page 2')))
})
