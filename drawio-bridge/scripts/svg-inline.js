/**
 * draw.io が export した SVG を、HTML へ inline 埋め込みできる形に整える。
 *
 * draw.io の SVG をそのまま貼ると次の問題が出る（いずれも実出力で確認済み）:
 *  - width/height が px 固定で、本文幅に追随しない
 *  - mxCell の id がそのまま SVG の id になるため、複数の図を同じ HTML に
 *    貼ると id="0" / id="1" が確実に衝突する
 *  - font-family が Helvetica だけで、日本語のフォールバックが無い
 *  - XML 宣言・DOCTYPE・コメントが付いており HTML には不要
 *  - color-scheme: light dark と light-dark(…) により閲覧環境のダーク設定に
 *    追随してしまい、白基調の文書に貼ると線が白く飛んでラベルも薄くなる
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

/** 日本語（ひらがな・カタカナ・CJK 統合漢字）を含むか。 */
const JAPANESE = /[぀-ゟ゠-ヿ一-鿿]/

/** 本文幅を超えると縮小表示され、図中文字が本文より小さくなる（bizdoc の規範）。 */
const DEFAULT_MAX_VIEWBOX_WIDTH = 780

// XML 属性値に入るため、フォント名はシングルクォートで括る（"..." だと &quot; に化けて読みにくい）
/** 白基調の文書に貼る前提。light-dark(…) がダーク値を選ぶと線が白く飛ぶ。 */
const DEFAULT_COLOR_SCHEME = 'light'

const DEFAULT_FONT_FALLBACK = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', 'Noto Sans JP', sans-serif"

function* walk(node) {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    yield child
    yield* walk(child)
  }
}

function eachElement(root, fn) {
  if (root.nodeType === 1) fn(root)
  for (const n of walk(root)) if (n.nodeType === 1) fn(n)
}

/** id と、それを指す参照（url(#x) / href="#x"）をまとめて付け替える。 */
function prefixIds(svg, prefix) {
  const renamed = new Map()

  eachElement(svg, (el) => {
    const id = el.getAttribute('id')
    if (id) {
      const next = `${prefix}-${id}`
      renamed.set(id, next)
      el.setAttribute('id', next)
    }
  })
  if (renamed.size === 0) return

  const rewriteRef = (value) => {
    let out = value.replace(/url\(#([^)]+)\)/g, (m, id) => (renamed.has(id) ? `url(#${renamed.get(id)})` : m))
    // フラグメント参照のみ書き換える（外部 URL は触らない）
    if (out.startsWith('#')) {
      const id = out.slice(1)
      if (renamed.has(id)) out = `#${renamed.get(id)}`
    }
    return out
  }

  eachElement(svg, (el) => {
    const attrs = el.attributes
    for (let i = 0; i < attrs.length; i += 1) {
      const attr = attrs.item(i)
      // content には編集用の原本 mxfile がそのまま入っている。触ると原本が壊れる
      if (attr.name === 'id' || attr.name === 'content') continue
      const next = rewriteRef(attr.value)
      // setAttribute('xlink:href', ...) は prefix 付きの名前を受け付けず
      // NamespaceError になるため、Attr の値を直接置き換える
      if (next !== attr.value) attr.value = next
    }
  })
}

/** font-family の指定に日本語フォントのフォールバックを足す。 */
function injectFontFallback(svg, fallback) {
  let injected = 0
  let found = 0

  const addTo = (value) => {
    // 既に日本語フォントらしきものが並んでいれば触らない
    if (/Hiragino|Yu Gothic|Noto Sans JP|Meiryo|MS PGothic|sans-serif$/.test(value)) return null
    return `${value.replace(/;\s*$/, '')}, ${fallback}`
  }

  eachElement(svg, (el) => {
    const fontAttr = el.getAttribute('font-family')
    if (fontAttr) {
      found += 1
      const next = addTo(fontAttr)
      if (next) {
        el.setAttribute('font-family', next)
        injected += 1
      }
    }

    const style = el.getAttribute('style')
    if (style && style.includes('font-family')) {
      const next = style.replace(/font-family:\s*([^;]+)/g, (m, fonts) => {
        found += 1
        const merged = addTo(fonts.trim())
        if (!merged) return m
        injected += 1
        return `font-family: ${merged}`
      })
      if (next !== style) el.setAttribute('style', next)
    }
  })

  return { injected, found }
}

/**
 * @param {string} svgText draw.io が export した SVG
 * @param {{idPrefix?: string, maxViewBoxWidth?: number, fontFallback?: string|false,
 *          colorScheme?: 'light'|'dark'|'auto'}} [options]
 * @returns {{svg: string, warnings: string[]}}
 */
export function inlineSvg(svgText, options = {}) {
  const {
    idPrefix,
    maxViewBoxWidth = DEFAULT_MAX_VIEWBOX_WIDTH,
    fontFallback = DEFAULT_FONT_FALLBACK,
    colorScheme = DEFAULT_COLOR_SCHEME,
  } = options

  const warnings = []
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const svg = doc.documentElement

  if (!svg || svg.nodeName !== 'svg') {
    throw new Error('SVG のルート要素が見つかりません')
  }

  // 本文幅に追随させる。viewBox が無いと width/height 除去で描画が壊れるので残す。
  const viewBox = svg.getAttribute('viewBox')
  if (!viewBox) {
    warnings.push('viewBox がないため width/height を残しました（レスポンシブになりません）')
  } else {
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    const style = svg.getAttribute('style') || ''
    if (!style.includes('max-width')) {
      svg.setAttribute('style', `${style.replace(/;\s*$/, '')}; max-width: 100%; height: auto;`.replace(/^;\s*/, ''))
    }

    const width = Number(viewBox.trim().split(/[\s,]+/)[2])
    if (Number.isFinite(width) && width > maxViewBoxWidth) {
      warnings.push(
        `viewBox 幅が ${width} で本文幅の目安 ${maxViewBoxWidth} を超えています。`
        + '縮小表示され図中文字が本文より小さくなるため、図を分割するか viewBox 座標系の font-size を上げてください',
      )
    }
  }

  // draw.io は color-scheme: light dark を書き出す。閲覧側がダークだと
  // light-dark(#000000, #ffffff) が白を選び、白背景では線が消える。
  if (colorScheme !== 'auto') {
    const style = svg.getAttribute('style') || ''
    svg.setAttribute(
      'style',
      style.includes('color-scheme')
        ? style.replace(/color-scheme:\s*[^;]+/, `color-scheme: ${colorScheme}`)
        : `${style.replace(/;\s*$/, '')}; color-scheme: ${colorScheme};`.replace(/^;\s*/, ''),
    )
  }

  if (idPrefix) prefixIds(svg, idPrefix)
  else warnings.push('--id-prefix が未指定です。同じ HTML に複数の図を貼ると id が衝突します')

  if (fontFallback && JAPANESE.test(svgText)) {
    // 指定が1つも無いときだけ警告する。指定があってフォールバック済み
    // （Mermaid 変換の出力は Trebuchet MS, …, sans-serif）なら注入不要で正常
    const { found } = injectFontFallback(svg, fontFallback)
    if (found === 0) warnings.push('日本語テキストがありますが font-family の指定が見つかりませんでした')
  }

  // HTML に貼るので XML 宣言・DOCTYPE・コメントは落とす
  const body = new XMLSerializer().serializeToString(svg)
  return { svg: body, warnings }
}
