import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateDrawio } from './validate.js'

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
