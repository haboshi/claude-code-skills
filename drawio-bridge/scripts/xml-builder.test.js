import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DrawioBuilder, escapeLabel, AWS_CATEGORY } from './xml-builder.js'
import { validateDrawio } from './validate.js'
import { checkOverlap, formatIssues } from './overlap.js'
import { findDrawioBin, runExport } from './drawio-cli.js'
import { buildExample } from '../references/examples/aws-architecture.example.js'

test('escapeLabel: 改行は <br> にしてから XML エスケープする', () => {
  assert.equal(escapeLabel('一行目\n二行目'), '一行目&lt;br&gt;二行目')
  assert.equal(escapeLabel('a & "b" <c>'), 'a &amp; &quot;b&quot; &lt;c&gt;')
})

test('node: アンカー・アイコン・ラベルの 3 セルを作り、ラベル幅は列幅に固定する', () => {
  const b = new DrawioBuilder()
  b.node('web', { col: 100, y: 50, resIcon: 'ecs', category: 'compute', label: 'ECS\n2 タスク' })
  const xml = b.toXml()
  assert.match(xml, /id="web" value="" style="rounded=0;html=1;strokeColor=none;fillColor=none;"/)
  assert.match(xml, /id="web_i" value="" style="[^"]*resIcon=mxgraph\.aws4\.ecs;"/)
  assert.match(xml, /id="web_l" value="ECS&lt;br&gt;2 タスク" style="text;html=1;[^"]*whiteSpace=wrap;[^"]*"[^>]*><mxGeometry x="100" y="98" width="150" height="52"/)
})

test('node: labelPos=right ではアンカーがアイコンと同じ矩形になる', () => {
  const b = new DrawioBuilder()
  b.node('alb', { col: 235, y: 195, resIcon: 'application_load_balancer', category: 'network', label: 'ALB', labelPos: 'right' })
  const xml = b.toXml()
  assert.match(xml, /id="alb" [^>]*><mxGeometry x="289" y="195" width="42" height="42"/)
})

test('edge: 既定は edgeStyle=orthogonalEdgeStyle、points があれば edgeStyle=none', () => {
  const b = new DrawioBuilder()
  b.anchor('a', { x: 0, y: 0, w: 10, h: 10 })
  b.anchor('b', { x: 100, y: 100, w: 10, h: 10 })
  b.edge('e1', 'a', 'b', { exit: [0.5, 1], entry: [0.5, 0] })
  b.edge('e2', 'a', 'b', { points: [[50, 5], [50, 105]], label: '迂回' })
  const xml = b.toXml()
  assert.match(xml, /id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;[^"]*exitX=0.5;exitY=1;/)
  assert.match(xml, /id="e2" value="迂回" style="edgeStyle=none;[^"]*"[^>]*><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="50" y="5"\/><mxPoint x="50" y="105"\/><\/Array>/)
})

test('id の重複と未知のカテゴリは例外', () => {
  const b = new DrawioBuilder()
  b.anchor('a', { x: 0, y: 0, w: 1, h: 1 })
  assert.throws(() => b.anchor('a', { x: 0, y: 0, w: 1, h: 1 }), /重複/)
  assert.throws(() => b.icon('x', { x: 0, y: 0, resIcon: 'ecs', category: 'nope' }), /未知のカテゴリ/)
  assert.ok(Object.keys(AWS_CATEGORY).length >= 9)
})

test('toXml の出力は validate を通る', () => {
  const b = new DrawioBuilder({ name: 'テスト' })
  b.node('n', { col: 20, y: 20, resIcon: 's3', category: 'storage', label: 'S3' })
  const result = validateDrawio(b.toXml())
  assert.equal(result.ok, true, JSON.stringify(result.issues))
})

test('生成例: validate を通り、export できる環境では check-overlap が 0 件', { timeout: 120000 }, (t) => {
  const xml = buildExample()
  const result = validateDrawio(xml)
  assert.equal(result.ok, true, JSON.stringify(result.issues))

  if (!findDrawioBin()) return t.skip('draw.io Desktop なし')
  const dir = mkdtempSync(join(tmpdir(), 'drawio-bridge-example-'))
  try {
    const input = join(dir, 'example.drawio')
    const output = join(dir, 'example.svg')
    writeFileSync(input, xml)
    runExport({ input, output, format: 'svg', embedDiagram: false })
    const overlap = checkOverlap(readFileSync(output, 'utf8'))
    assert.ok(overlap.labels.length > 30, 'ラベルが取れていない')
    assert.ok(overlap.edges.length >= 5, '辺が取れていない')
    assert.equal(overlap.issues.length, 0, formatIssues(overlap))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
