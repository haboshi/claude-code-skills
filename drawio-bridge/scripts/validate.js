/**
 * .drawio (mxGraphModel) XML の機械検証。
 *
 * 検査項目は draw.io 公式の AI 生成ルール
 * (https://www.drawio.com/docs/reference/diagram-generation/) を
 * 機械検査可能な形に落としたもの。LLM が生成した XML が「開けるが空」
 * 「辺が描画されない」といった静かな失敗をする経路を潰すのが目的。
 */
import { DOMParser, onErrorStopParsing } from '@xmldom/xmldom'

/** 構造セル。図の内容ではなくページの骨格。 */
const ROOT_CELL_ID = '0'
const LAYER_CELL_ID = '1'

/**
 * ラベルやカスタム属性を持つセルは <UserObject>/<object> でラップされ、
 * id はラッパー側に載って mxCell が入れ子の子になる（Mermaid 変換の出力がこの形）。
 * 検査ではラッパーと中身を1つのセルとして扱う。
 */
const WRAPPER_TAGS = new Set(['UserObject', 'object'])

const err = (code, message) => ({ severity: 'error', code, message })
const warn = (code, message) => ({ severity: 'warn', code, message })

/** 子孫を深さ優先で辿る（xmldom の NodeList は配列ではない）。 */
function* walk(node) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    yield child
    yield* walk(child)
  }
}

function elementsByTag(node, tagName) {
  const found = []
  for (const n of walk(node)) {
    if (n.nodeType === 1 && n.nodeName === tagName) found.push(n)
  }
  return found
}

/** mxGraphModel 要素を全ページ分取り出す。取り出せない理由は issues に積む。 */
function collectModels(doc, issues) {
  const root = doc.documentElement
  if (!root) {
    issues.push(err('NO_ROOT_ELEMENT', 'ルート要素がありません'))
    return []
  }

  if (root.nodeName === 'mxGraphModel') return [root]

  if (root.nodeName !== 'mxfile') {
    issues.push(err(
      'UNEXPECTED_ROOT',
      `ルート要素は mxfile か mxGraphModel である必要があります（実際: ${root.nodeName}）`,
    ))
    return []
  }

  const diagrams = elementsByTag(root, 'diagram')
  if (diagrams.length === 0) {
    issues.push(err('NO_DIAGRAM', 'mxfile に diagram 要素がありません'))
    return []
  }

  const models = []
  for (const diagram of diagrams) {
    const nested = elementsByTag(diagram, 'mxGraphModel')
    if (nested.length > 0) {
      models.push(...nested)
      continue
    }
    // 子要素が無くテキストだけ = deflate+base64 で圧縮された図。
    // 公式は AI 生成に圧縮を使わないよう明示している。
    const text = (diagram.textContent || '').trim()
    if (text.length > 0) {
      issues.push(err(
        'COMPRESSED_DIAGRAM',
        `diagram "${diagram.getAttribute('name') || diagram.getAttribute('id') || '?'}" が圧縮されています。`
        + '平文の mxGraphModel を使ってください（公式は AI 生成での圧縮を禁止）',
      ))
    } else {
      issues.push(err('EMPTY_DIAGRAM', 'diagram の中身が空です'))
    }
  }
  return models
}

/**
 * root 直下の内容セルを集める。UserObject/object でラップされたものは
 * 「id はラッパー、属性は入れ子の mxCell」という合成ビューにして返す。
 */
function collectCells(root) {
  const cells = []

  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1) continue

    if (node.nodeName === 'mxCell') {
      cells.push({ el: node, attrEl: node, geometryHost: node })
      continue
    }

    if (WRAPPER_TAGS.has(node.nodeName)) {
      const inner = elementsByTag(node, 'mxCell')[0]
      if (inner) {
        // id はラッパー、vertex/edge/parent/style は内側の mxCell にある
        cells.push({ el: node, attrEl: inner, geometryHost: inner, wrapper: node })
      } else {
        cells.push({ el: node, attrEl: node, geometryHost: node, wrapper: node })
      }
    }
  }
  return cells
}

/** ラッパーを優先して属性を引く（id・value はラッパー、それ以外は mxCell 側）。 */
function attr(cell, name) {
  if (name === 'id') return cell.el.getAttribute('id')
  if (name === 'value') {
    return cell.el.getAttribute('value')
      ?? cell.el.getAttribute('label')
      ?? cell.attrEl.getAttribute('value')
  }
  return cell.attrEl.getAttribute(name) ?? cell.el.getAttribute(name)
}

function checkComments(doc, issues) {
  for (const n of walk(doc)) {
    if (n.nodeType === 8) {
      issues.push(err(
        'XML_COMMENT',
        'XML コメントが含まれています。公式はパースエラーの原因として明示的に禁止しています',
      ))
      return
    }
  }
}

function checkCompressedAttr(doc, issues) {
  for (const n of walk(doc)) {
    if (n.nodeType === 1 && n.getAttribute && n.getAttribute('compressed') === 'true') {
      issues.push(err('COMPRESSED_ATTR', `${n.nodeName} に compressed="true" が付いています`))
    }
  }
}

/** 1 ページ分の mxGraphModel を検査する。 */
function checkModel(model, issues, pageLabel) {
  const at = (msg) => (pageLabel ? `[${pageLabel}] ${msg}` : msg)

  const roots = elementsByTag(model, 'root')
  if (roots.length === 0) {
    issues.push(err('NO_ROOT_TAG', at('mxGraphModel に root 要素がありません')))
    return
  }

  const cells = collectCells(roots[0])
  const ids = new Set()

  for (const cell of cells) {
    const id = attr(cell, 'id')
    if (id === null || id === '') {
      issues.push(err('CELL_NO_ID', at('id を持たない mxCell があります')))
      continue
    }
    if (ids.has(id)) {
      issues.push(err('DUPLICATE_ID', at(`id="${id}" が重複しています`)))
    }
    ids.add(id)
  }

  if (!ids.has(ROOT_CELL_ID)) {
    issues.push(err('MISSING_ROOT_CELL', at(`<mxCell id="${ROOT_CELL_ID}"/> がありません。図が空で開きます`)))
  }
  const layer = cells.find((c) => attr(c, 'id') === LAYER_CELL_ID)
  if (!layer) {
    issues.push(err('MISSING_LAYER_CELL', at(`<mxCell id="${LAYER_CELL_ID}" parent="0"/> がありません。図が空で開きます`)))
  } else if (attr(layer, 'parent') !== ROOT_CELL_ID) {
    issues.push(err(
      'LAYER_BAD_PARENT',
      at(`id="${LAYER_CELL_ID}" の parent は "${ROOT_CELL_ID}" である必要があります`),
    ))
  }

  // 頂点 id を先に集める（辺の参照解決に要る）
  const vertexIds = new Set()
  for (const cell of cells) {
    if (attr(cell, 'vertex') === '1') vertexIds.add(attr(cell, 'id'))
  }

  for (const cell of cells) {
    const id = attr(cell, 'id')
    if (id === ROOT_CELL_ID || id === LAYER_CELL_ID) continue

    const isVertex = attr(cell, 'vertex') === '1'
    const isEdge = attr(cell, 'edge') === '1'

    if (isVertex && isEdge) {
      issues.push(err('VERTEX_AND_EDGE', at(`id="${id}" が vertex と edge を両方 1 にしています（排他）`)))
    }
    if (!isVertex && !isEdge) {
      issues.push(warn('NEITHER_VERTEX_NOR_EDGE', at(`id="${id}" が vertex でも edge でもありません`)))
    }

    const parent = attr(cell, 'parent')
    if (parent === null || parent === '') {
      issues.push(err('CELL_NO_PARENT', at(`id="${id}" に parent がありません`)))
    } else if (!ids.has(parent)) {
      issues.push(err('DANGLING_PARENT', at(`id="${id}" の parent="${parent}" が存在しません`)))
    }

    const geometries = elementsByTag(cell.geometryHost, 'mxGeometry')
    const geometry = geometries[0]

    if (isEdge) {
      // 自己閉じの辺（mxGeometry 無し）は draw.io で描画が壊れる
      if (!geometry) {
        issues.push(err(
          'EDGE_NO_GEOMETRY',
          at(`id="${id}" は edge ですが <mxGeometry relative="1" as="geometry"/> がありません`),
        ))
      } else if (geometry.getAttribute('relative') !== '1') {
        issues.push(warn('EDGE_GEOMETRY_NOT_RELATIVE', at(`id="${id}" の mxGeometry に relative="1" がありません`)))
      }

      for (const end of ['source', 'target']) {
        const ref = attr(cell, end)
        if (ref === null || ref === '') {
          issues.push(warn(
            'EDGE_ENDPOINT_MISSING',
            at(`id="${id}" に ${end} がありません。端点が (0,0) に落ちます`),
          ))
        } else if (!ids.has(ref)) {
          issues.push(err('EDGE_DANGLING_ENDPOINT', at(`id="${id}" の ${end}="${ref}" が存在しません`)))
        } else if (!vertexIds.has(ref)) {
          issues.push(warn(
            'EDGE_ENDPOINT_NOT_VERTEX',
            at(`id="${id}" の ${end}="${ref}" は頂点ではありません`),
          ))
        }
      }
    }

    if (isVertex) {
      if (!geometry) {
        issues.push(err('VERTEX_NO_GEOMETRY', at(`id="${id}" は vertex ですが mxGeometry がありません`)))
      } else {
        // 辺ラベル（矢印に付けたラベル）は辺の子頂点で、位置を relative + offset で
        // 決めるため width/height を持たない。draw.io 自身がこの形で保持する正規形。
        const isRelative = geometry.getAttribute('relative') === '1'

        for (const dim of ['width', 'height']) {
          const raw = geometry.getAttribute(dim)
          if (raw === null || raw === '') {
            if (!isRelative) {
              issues.push(err('VERTEX_NO_SIZE', at(`id="${id}" の mxGeometry に ${dim} がありません`)))
            }
          } else if (Number(raw) < 0) {
            issues.push(err('NEGATIVE_SIZE', at(`id="${id}" の ${dim} が負の値です（${raw}）`)))
          }
        }
      }
    }

    // value に生タグが入っているのに html=1 が無いと、タグがそのまま表示される
    const value = attr(cell, 'value') || ''
    const style = attr(cell, 'style') || ''
    if (/<[a-zA-Z/]/.test(value) && !/(^|;)\s*html\s*=\s*1/.test(style)) {
      issues.push(warn(
        'HTML_LABEL_WITHOUT_FLAG',
        at(`id="${id}" の value に HTML タグがありますが style に html=1 がありません`),
      ))
    }
    // \n はリテラルのバックスラッシュ+n として表示される（改行にならない）
    if (value.includes('\\n')) {
      issues.push(warn(
        'LITERAL_BACKSLASH_N',
        at(`id="${id}" の value に \\n があります。改行は &#xa; か <br> を使ってください`),
      ))
    }
  }
}

/**
 * @param {string} xml .drawio の中身
 * @returns {{ok: boolean, issues: Array<{severity: string, code: string, message: string}>}}
 */
export function validateDrawio(xml) {
  const issues = []

  let doc
  try {
    doc = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'text/xml')
  } catch (e) {
    return { ok: false, issues: [err('XML_MALFORMED', `整形式ではありません: ${e.message}`)] }
  }

  checkComments(doc, issues)
  checkCompressedAttr(doc, issues)

  const models = collectModels(doc, issues)
  models.forEach((model, i) => {
    checkModel(model, issues, models.length > 1 ? `page ${i + 1}` : '')
  })

  return { ok: !issues.some((i) => i.severity === 'error'), issues }
}

/**
 * .drawio のページ数を数える。裸の mxGraphModel は 1 ページ。
 * @param {string} xml
 * @returns {number} 数えられないときは 0
 */
export function countPages(xml) {
  try {
    const doc = new DOMParser({ onError: onErrorStopParsing }).parseFromString(xml, 'text/xml')
    const root = doc.documentElement
    if (!root) return 0
    if (root.nodeName === 'mxGraphModel') return 1
    if (root.nodeName === 'mxfile') return elementsByTag(root, 'diagram').length
    return 0
  } catch {
    return 0
  }
}
