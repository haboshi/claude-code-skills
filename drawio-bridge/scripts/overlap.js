/**
 * draw.io が export した SVG の「重なり」を機械検出する。
 *
 * 目視検品は毎回同じ箇所を見落とす（2026-09 の AWS 構成図で、線がラベルを横切る箇所を
 * 3 回連続で見逃した実測）。ここでは export 済み SVG から
 *   - ラベルの矩形（foreignObject 内の flex コンテナの位置・幅と、文字数からの幅見積り）
 *   - 辺の折れ線（fill="none" の path の d 属性）
 * を取り出し、辺 × ラベル、ラベル × ラベル の交差を列挙する。
 *
 * 幅の見積りは CJK 1 文字 = font-size、半角 = font-size × 0.56、空白 = 0.3 倍。
 * 実描画との差は数 px なので pad で吸収する（既定 2px）。
 */
import { DOMParser } from '@xmldom/xmldom'

const DEFAULTS = {
  pad: 2, // 辺 × ラベルの判定に足す余白（px）
  labelPad: 0, // ラベル × ラベルの判定に足す余白（px）
  cjkWidth: 1.0, // CJK 1 文字の幅（font-size 倍）
  latinWidth: 0.56, // 半角 1 文字の幅（font-size 倍）
  lineHeight: 1.25, // 行の高さ（font-size 倍）
}

function* walk(node) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    yield child
    yield* walk(child)
  }
}

const localName = (el) => el.localName || el.nodeName.replace(/^.*:/, '')

function elements(root, name) {
  const out = []
  for (const n of walk(root)) if (n.nodeType === 1 && localName(n) === name) out.push(n)
  return out
}

/** 文字列の描画幅を見積もる。 */
export function estimateTextWidth(text, fontSize, opts = DEFAULTS) {
  let w = 0
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (ch === ' ') w += fontSize * 0.3
    else if (code > 0x2e80) w += fontSize * opts.cjkWidth
    else w += fontSize * opts.latinWidth
  }
  return w
}

/** foreignObject 内のテキストを行に分ける。<br> と div の境界を改行とみなす。 */
function textLines(el) {
  const parts = []
  const visit = (n) => {
    if (n.nodeType === 3) {
      parts.push(n.data)
      return
    }
    if (n.nodeType !== 1) return
    const name = localName(n)
    if (name === 'br') {
      parts.push('\n')
      return
    }
    const block = name === 'div' || name === 'p'
    if (block && parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
    for (let c = n.firstChild; c; c = c.nextSibling) visit(c)
    if (block) parts.push('\n')
  }
  visit(el)
  return parts
    .join('')
    .split('\n')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

const FLEX_RE =
  /display:\s*flex;\s*align-items:\s*unsafe\s+([a-z-]+);\s*justify-content:\s*unsafe\s+([a-z-]+);\s*width:\s*(\d+(?:\.\d+)?)px;\s*height:\s*1px;\s*padding-top:\s*(\d+(?:\.\d+)?)px;\s*margin-left:\s*(\d+(?:\.\d+)?)px;/

/** 1 つのセル（g[data-cell-id]）からラベル矩形を取り出す。無ければ null。 */
function extractLabel(group, opts) {
  let flex = null
  for (const el of elements(group, 'div')) {
    const m = FLEX_RE.exec(el.getAttribute('style') || '')
    if (m) {
      flex = { el, va: m[1], ha: m[2], w: Number(m[3]), pt: Number(m[4]), ml: Number(m[5]) }
      break
    }
  }
  if (!flex) return null

  let fontSize = 12
  let inner = null
  for (const el of elements(flex.el, 'div')) {
    const style = el.getAttribute('style') || ''
    if (style.includes('display: inline-block')) {
      inner = el
      const fm = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(style)
      if (fm) fontSize = Number(fm[1])
      break
    }
  }
  const lines = inner ? textLines(inner) : []
  if (lines.length === 0) lines.push('')

  // width: 1px は「折り返さない」（辺ラベル・center 配置）。それ以外はその幅で折り返す
  const boxWidth = flex.w <= 1 ? Number.POSITIVE_INFINITY : flex.w
  let estLines = 0
  let maxWidth = 0
  for (const line of lines) {
    const lw = estimateTextWidth(line, fontSize, opts)
    maxWidth = Math.max(maxWidth, Math.min(lw, boxWidth))
    estLines += Math.max(1, Math.ceil(lw / boxWidth))
  }
  const height = estLines * fontSize * opts.lineHeight
  const width = maxWidth

  // margin-left は flex コンテナの左端。幅を持つセル（width: 152px 等）は、その幅の中で
  // 文字が寄せられる。辺ラベル（width: 1px）も同じ式で、中心 = 左端 とみなせる
  let x0
  if (flex.ha === 'center') x0 = flex.ml + (flex.w - width) / 2
  else if (flex.ha === 'flex-end') x0 = flex.ml + flex.w - width
  else x0 = flex.ml
  let y0
  if (flex.va === 'center') y0 = flex.pt - height / 2
  else if (flex.va === 'flex-end') y0 = flex.pt - height
  else y0 = flex.pt

  return { x0, y0, x1: x0 + width, y1: y0 + height, text: lines.join(' ') }
}

/** path の d から折れ線の頂点列を作る。曲線は終点だけ採り、角を落とす近似にする。 */
export function pathToPolyline(d) {
  const points = []
  const re = /([MLQCZmlqcz])\s*([^MLQCZmlqcz]*)/g
  let m
  while ((m = re.exec(d))) {
    const cmd = m[1].toUpperCase()
    const nums = (m[2].match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) || []).map(Number)
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]])
    } else if (cmd === 'Q' && nums.length >= 4) {
      points.push([nums[nums.length - 2], nums[nums.length - 1]])
    } else if (cmd === 'C' && nums.length >= 6) {
      points.push([nums[nums.length - 2], nums[nums.length - 1]])
    }
  }
  return points
}

/**
 * 辺の可視線を取り出す。draw.io は辺の線に pointer-events="stroke" を付け、矢じりや頂点の
 * 図形には "all" を付ける。ラベル付きの辺はラベル背景の rect を同じセルに持つので、
 * rect の有無では辺を判定できない。
 */
function extractEdge(group) {
  const paths = elements(group, 'path')
  const isLine = (p) => {
    const fill = p.getAttribute('fill')
    const stroke = p.getAttribute('stroke')
    return fill === 'none' && stroke && stroke !== 'none' && /[LQC]/i.test(p.getAttribute('d') || '')
  }
  // 1) pointer-events="stroke" が付いた線（draw.io の export はこれ）
  let line = paths.find((p) => p.getAttribute('pointer-events') === 'stroke' && isLine(p))
  // 2) 付いていない SVG（手書きや他ツール）は、頂点図形を持たないセルの線を辺とみなす
  if (!line && !elements(group, 'rect').length && !elements(group, 'image').length && !elements(group, 'ellipse').length) {
    line = paths.find(isLine)
  }
  if (!line) return null
  const points = pathToPolyline(line.getAttribute('d') || '')
  return points.length >= 2 ? { points } : null
}

/** 線分と矩形の交差（Liang–Barsky）。 */
export function segmentIntersectsRect([px, py], [qx, qy], rect, pad = 0) {
  const x0 = rect.x0 - pad
  const y0 = rect.y0 - pad
  const x1 = rect.x1 + pad
  const y1 = rect.y1 + pad
  const dx = qx - px
  const dy = qy - py
  let t0 = 0
  let t1 = 1
  const checks = [
    [-dx, px - x0],
    [dx, x1 - px],
    [-dy, py - y0],
    [dy, y1 - py],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
    }
  }
  return t0 <= t1
}

function rectsOverlap(a, b, pad = 0) {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad
}

/**
 * @param {string} svgText draw.io が export した SVG（data-cell-id 付き）
 * @param {{pad?: number, labelPad?: number, cjkWidth?: number, latinWidth?: number, lineHeight?: number}} [options]
 * @returns {{labels: Array, edges: Array, issues: Array}}
 */
export function checkOverlap(svgText, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const doc = new DOMParser({ onError: () => {} }).parseFromString(svgText, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || localName(root) !== 'svg') throw new Error('SVG のルート要素が見つかりません')

  const labels = []
  const edges = []
  for (const g of elements(root, 'g')) {
    const cellId = g.getAttribute('data-cell-id')
    if (!cellId || cellId === '0' || cellId === '1') continue
    const label = extractLabel(g, opts)
    if (label) labels.push({ cellId, ...label })
    const edge = extractEdge(g)
    if (edge) edges.push({ cellId, ...edge })
  }

  const issues = []
  for (const edge of edges) {
    for (const label of labels) {
      if (label.cellId === edge.cellId) continue
      const pts = edge.points
      for (let i = 0; i + 1 < pts.length; i += 1) {
        if (segmentIntersectsRect(pts[i], pts[i + 1], label, opts.pad)) {
          issues.push({ kind: 'edge-label', a: edge.cellId, b: label.cellId, text: label.text })
          break
        }
      }
    }
  }
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      if (rectsOverlap(labels[i], labels[j], opts.labelPad)) {
        issues.push({
          kind: 'label-label',
          a: labels[i].cellId,
          b: labels[j].cellId,
          text: `${labels[i].text} | ${labels[j].text}`,
        })
      }
    }
  }

  return { labels, edges, issues }
}

/** 人が読む形式。 */
export function formatIssues(result) {
  const lines = [`labels ${result.labels.length} / edges ${result.edges.length} / issues ${result.issues.length}`]
  for (const it of result.issues) {
    lines.push(`  ${it.kind === 'edge-label' ? '辺×ラベル' : 'ラベル×ラベル'}  ${it.a} × ${it.b}  ${it.text}`)
  }
  return lines.join('\n')
}
