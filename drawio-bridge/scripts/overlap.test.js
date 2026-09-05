import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkOverlap, estimateTextWidth, pathToPolyline, segmentIntersectsRect, formatIssues } from './overlap.js'

/** draw.io export のラベル構造（foreignObject 内の flex コンテナ）を模す。 */
const label = (id, { text, x, y, w = 1, va = 'center', ha = 'center', fontSize = 16 }) =>
  `<g data-cell-id="${id}"><g><switch><foreignObject pointer-events="none" width="100%" height="100%" requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" style="overflow: visible; text-align: left;">` +
  `<div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; align-items: unsafe ${va}; justify-content: unsafe ${ha}; width: ${w}px; height: 1px; padding-top: ${y}px; margin-left: ${x}px;">` +
  `<div style="box-sizing: border-box; font-size: 0px; text-align: center;"><div style="display: inline-block; font-size: ${fontSize}px; font-family: Helvetica; color: rgb(0, 0, 0); line-height: 1.2; pointer-events: all; white-space: normal; overflow-wrap: normal;">${text}</div></div></div>` +
  `</foreignObject><text x="${x}" y="${y}" fill="#000000" font-family="Helvetica" font-size="${fontSize}px" text-anchor="middle">${text.replace(/<br\s*\/?>/g, ' ')}</text></switch></g></g>`

/** 辺（可視線 + 矢じり）。 */
const edge = (id, d) =>
  `<g data-cell-id="${id}"><g><path d="${d}" fill="none" stroke="#1F6FEB" stroke-width="2" stroke-miterlimit="10" pointer-events="stroke"/>` +
  `<path d="M 1 1 L 2 2 Z" fill="#1F6FEB" stroke="#1F6FEB" stroke-miterlimit="10" pointer-events="all"/></g></g>`

/** 頂点（rect を持つセルは辺と見なさない）。 */
const box = (id, x, y, w, h) =>
  `<g data-cell-id="${id}"><g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" pointer-events="all"/></g></g>`

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" viewBox="0 0 400 300">` +
  `<g data-cell-id="0"><g data-cell-id="1">${body}</g></g></svg>`

test('文字幅の見積り: CJK は 1em、半角は 0.56em', () => {
  assert.equal(estimateTextWidth('会員', 16), 32)
  assert.equal(Math.round(estimateTextWidth('ECS', 16)), Math.round(16 * 0.56 * 3))
})

test('path の d から折れ線を取る（曲線は終点のみ）', () => {
  assert.deepEqual(pathToPolyline('M 10 20 L 30 20 L 30 40'), [[10, 20], [30, 20], [30, 40]])
  assert.deepEqual(pathToPolyline('M 0 0 L 10 0 Q 20 0 20 10 L 20 30'), [[0, 0], [10, 0], [20, 10], [20, 30]])
})

test('線分と矩形の交差判定', () => {
  const r = { x0: 10, y0: 10, x1: 20, y1: 20 }
  assert.equal(segmentIntersectsRect([0, 15], [30, 15], r), true)
  assert.equal(segmentIntersectsRect([0, 0], [5, 5], r), false)
  assert.equal(segmentIntersectsRect([0, 25], [30, 25], r, 6), true, 'pad で余白を足す')
})

test('辺がラベルを横切ると edge-label を報告する', () => {
  const doc = svg(label('t1', { text: 'ラベル', x: 100, y: 50 }) + edge('e1', 'M 0 50 L 200 50'))
  const r = checkOverlap(doc)
  assert.equal(r.labels.length, 1)
  assert.equal(r.edges.length, 1)
  assert.deepEqual(r.issues.map((i) => [i.kind, i.a, i.b]), [['edge-label', 'e1', 't1']])
})

test('自分のラベルは除外し、離れた辺は報告しない', () => {
  const doc = svg(edge('e1', 'M 0 50 L 200 50') + `<g data-cell-id="e1">${label('e1', { text: '辺ラベル', x: 100, y: 50 }).replace(/^<g data-cell-id="e1">|<\/g>$/g, '')}</g>` + label('t2', { text: '遠い', x: 100, y: 200 }))
  const r = checkOverlap(doc)
  assert.equal(r.issues.length, 0, formatIssues(r))
})

test('ラベル同士の重なりを label-label で報告する', () => {
  const doc = svg(label('a', { text: '重なる', x: 100, y: 50 }) + label('b', { text: '重なる', x: 110, y: 52 }))
  const r = checkOverlap(doc)
  assert.deepEqual(r.issues.map((i) => i.kind), ['label-label'])
})

test('labelPad が負なら隣接する凡例行のような接触は報告しない', () => {
  const doc = svg(label('a', { text: '行1', x: 40, y: 50, ha: 'flex-start', w: 100 }) + label('b', { text: '行2', x: 40, y: 70, ha: 'flex-start', w: 100 }))
  assert.equal(checkOverlap(doc, { labelPad: -2 }).issues.length, 0)
})

test('rect を持つセルは辺として扱わない', () => {
  const doc = svg(box('v1', 0, 0, 50, 50) + label('t1', { text: 'x', x: 25, y: 25 }))
  assert.equal(checkOverlap(doc).edges.length, 0)
})

test('<br> を改行として行数を数える（幅 1px は折り返さない）', () => {
  const doc = svg(label('t1', { text: '一行目<br />二行目', x: 100, y: 50, va: 'flex-start' }))
  const [l] = checkOverlap(doc).labels
  assert.equal(Math.round(l.y1 - l.y0), Math.round(2 * 16 * 1.25))
})

test('SVG でないものは例外', () => {
  assert.throws(() => checkOverlap('<html></html>'), /ルート要素/)
})

test('pointer-events="stroke" が無い SVG でも、頂点図形を持たないセルの線は辺とみなす', () => {
  const doc = svg(`<g data-cell-id="e9"><g><path d="M 0 50 L 200 50" fill="none" stroke="#000" stroke-width="1"/></g></g>` + label('t1', { text: 'x', x: 100, y: 50 }))
  const r = checkOverlap(doc)
  assert.equal(r.edges.length, 1)
  assert.equal(r.issues.length, 1)
})

test('ラベル付きの辺（ラベル背景の rect を同じセルに持つ）も辺として取る', () => {
  const doc = svg(
    `<g data-cell-id="e5"><g><path d="M 0 50 L 200 50" fill="none" stroke="#000" stroke-width="2" pointer-events="stroke"/>` +
      `<path d="M 1 1 L 2 2 Z" fill="#000" stroke="#000" pointer-events="all"/></g>` +
      `<g><rect x="90" y="42" width="20" height="16" fill="#ffffff" stroke="none"/>` +
      label('e5', { text: '辺', x: 100, y: 50 }).replace(/^<g data-cell-id="e5">|<\/g>$/g, '') + `</g></g>` +
      label('t2', { text: '横切られる', x: 150, y: 50 }),
  )
  const r = checkOverlap(doc)
  assert.equal(r.edges.length, 1)
  assert.deepEqual(r.issues.map((i) => [i.kind, i.a, i.b]), [['edge-label', 'e5', 't2']])
})
