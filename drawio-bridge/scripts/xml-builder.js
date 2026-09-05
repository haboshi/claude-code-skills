/**
 * 確定座標で .drawio（mxGraphModel）XML を組み立てる部品。
 *
 * 図の内容を考えるのは公式 drawio スキルの仕事で、ここは「レイアウトを座標で確定させて
 * 描く」ための最小のビルダー。AWS 構成図のように列と帯で並べる図に向く。
 * 規約は references/layout-rules.md が正（この実装はそれを機械的に守らせる側）。
 *
 * 守らせていること:
 *  - ラベルは別の text セル。アイコン下のラベルは幅を制限しないと横に伸びて隣と重なる
 *  - 縦の接続は「アイコン＋ラベルを覆う透明矩形（anchor）」に、横の接続はアイコンに繋ぐ
 *    （矩形の下辺から出れば、線がラベルを縦断しない）
 *  - 直交ルーティングは edgeStyle=orthogonalEdgeStyle を明示する
 *  - 属性値の改行は <br> を &lt;br&gt; にエスケープする（\n は html=1 では無視される）
 */

/** AWS アーキテクチャアイコン（mxgraph.aws4.resourceIcon）のカテゴリ色。 */
export const AWS_CATEGORY = {
  compute: 'fillColor=#D05C17;gradientColor=#F78E04',
  database: 'fillColor=#3334B9;gradientColor=#4D72F3',
  storage: 'fillColor=#277116;gradientColor=#60A337',
  network: 'fillColor=#4D27AA;gradientColor=#945DF2',
  security: 'fillColor=#BD0816;gradientColor=#FF5252',
  appint: 'fillColor=#B0084D;gradientColor=#FF4F8B',
  ml: 'fillColor=#01A88D;gradientColor=#4AB29A',
  mgmt: 'fillColor=#BC1356;gradientColor=#F34482',
  analytics: 'fillColor=#4D27AA;gradientColor=#945DF2',
}

/** 線の色の既定。流れの種別ごとに 1 色、補助は灰の破線。 */
export const LINE = {
  blue: '#1F6FEB',
  orange: '#C2570F',
  green: '#1E7A12',
  magenta: '#B0084D',
  grey: '#8A94A6',
}

export const INK = '#1F2937'
export const INK2 = '#4B5563'

/** XML 属性値のエスケープ。ラベル中の改行 \n は <br> にしてからエスケープする。 */
export function escapeLabel(text) {
  return String(text)
    .replace(/\r?\n/g, '<br>')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))

export class DrawioBuilder {
  /**
   * @param {{name?: string, width?: number, height?: number, iconSize?: number, cellWidth?: number,
   *          cellHeight?: number, fontSize?: number}} [options]
   */
  constructor(options = {}) {
    this.name = options.name || 'diagram'
    this.width = options.width || 1050
    this.height = options.height || 900
    this.iconSize = options.iconSize || 42
    this.cellWidth = options.cellWidth || 150 // ラベル幅 = 列の幅
    this.cellHeight = options.cellHeight || 100 // アイコン 42 + 隙間 6 + ラベル 2 行 40 + 余白（辺の始点をラベルから離す）
    this.fontSize = options.fontSize || 16
    this.cells = []
    this.ids = new Set()
  }

  _cell(id, value, style, x, y, w, h) {
    if (this.ids.has(id)) throw new Error(`id が重複しています: ${id}`)
    this.ids.add(id)
    this.cells.push(
      `<mxCell id="${id}" value="${escapeLabel(value)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" as="geometry"/></mxCell>`,
    )
    return id
  }

  /** AWS 製品タイル。ラベルは持たせない（別セルにする）。 */
  icon(id, { x, y, resIcon, category, size = this.iconSize }) {
    const color = AWS_CATEGORY[category]
    if (!color) throw new Error(`未知のカテゴリ: ${category}（${Object.keys(AWS_CATEGORY).join(' / ')}）`)
    const style =
      `sketch=0;outlineConnect=0;gradientDirection=north;${color};strokeColor=#ffffff;dashed=0;` +
      'verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=1;aspect=fixed;' +
      `shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${resIcon};`
    return this._cell(id, '', style, x, y, size, size)
  }

  /** 枠も塗りも無いテキスト。幅を持つので折り返しが制御できる。 */
  text(id, text, { x, y, w, h, size = this.fontSize, color = INK, bold = false, align = 'center', valign = 'top' }) {
    const style =
      `text;html=1;strokeColor=none;fillColor=none;align=${align};verticalAlign=${valign};whiteSpace=wrap;` +
      `fontSize=${size};fontColor=${color};fontStyle=${bold ? 1 : 0};spacing=0;spacingTop=0;spacingLeft=0;spacingRight=0;`
    return this._cell(id, text, style, x, y, w, h)
  }

  /** 透明な矩形。辺の接続先にだけ使う。 */
  anchor(id, { x, y, w, h }) {
    return this._cell(id, '', 'rounded=0;html=1;strokeColor=none;fillColor=none;', x, y, w, h)
  }

  /**
   * アイコン + ラベルのノード。id はアンカー、`${id}_i` がアイコン、`${id}_l` がラベル。
   * labelPos: 'below'（既定。縦の辺は id に、横の辺は `${id}_i` に繋ぐ）/ 'right' / 'left'
   * （横にラベルを置くとアンカーはアイコンと同じ矩形になる）
   */
  node(id, { col, y, resIcon, category, label, labelPos = 'below', labelWidth = 200, size = this.fontSize }) {
    const iw = this.iconSize
    const ix = col + Math.round((this.cellWidth - iw) / 2)
    if (labelPos === 'below') {
      this.anchor(id, { x: col, y, w: this.cellWidth, h: this.cellHeight })
      this.icon(`${id}_i`, { x: ix, y, resIcon, category })
      this.text(`${id}_l`, label, { x: col, y: y + iw + 6, w: this.cellWidth, h: this.cellHeight - iw - 6, size })
    } else if (labelPos === 'right') {
      this.anchor(id, { x: ix, y, w: iw, h: iw })
      this.icon(`${id}_i`, { x: ix, y, resIcon, category })
      this.text(`${id}_l`, label, { x: ix + iw + 6, y, w: labelWidth, h: iw, size, align: 'left', valign: 'middle' })
    } else if (labelPos === 'left') {
      this.anchor(id, { x: ix, y, w: iw, h: iw })
      this.icon(`${id}_i`, { x: ix, y, resIcon, category })
      this.text(`${id}_l`, label, { x: ix - 6 - labelWidth, y, w: labelWidth, h: iw, size, align: 'right', valign: 'middle' })
    } else {
      throw new Error(`labelPos は below / right / left（指定値: ${labelPos}）`)
    }
    return id
  }

  /** 枠（VPC・サブネット・クラスタ）。見出しは左上か、valign='bottom' で左下。 */
  box(id, title, { x, y, w, h, stroke, fill = 'none', dashed = false, size = 15, align = 'left', valign = 'top' }) {
    const style =
      `rounded=1;arcSize=4;html=1;whiteSpace=wrap;fontSize=${size};fontStyle=1;strokeColor=${stroke};fillColor=${fill};` +
      `verticalAlign=${valign};align=${align};spacingLeft=14;spacingRight=14;spacingTop=5;spacingBottom=5;` +
      `fontColor=${stroke};dashed=${dashed ? 1 : 0};strokeWidth=1.6;`
    return this._cell(id, title, style, x, y, w, h)
  }

  /** 注記行（アクセント色の小さな正方形 + 文）。図の下に 0〜数行。 */
  note(id, text, { x, y, w, accent = '#2563EB', size = this.fontSize }) {
    this._cell(`${id}_q`, '', `rounded=0;strokeColor=none;fillColor=${accent};`, x, y + 7, 7, 7)
    return this.text(`${id}_t`, text, { x: x + 16, y, w, h: 22, size, color: INK2, align: 'left', valign: 'middle' })
  }

  /**
   * 辺。source / target はセル id。exit / entry は [x, y] の相対位置（0〜1）。
   * points を与えると edgeStyle=none の折れ線になる（長い迂回はこちらで確定させる）。
   * offset はラベルの絶対オフセット [dx, dy]。
   */
  edge(id, source, target, { label = '', color = LINE.grey, dashed = false, width = 1.6, exit, entry, offset, points, size = 14 } = {}) {
    if (this.ids.has(id)) throw new Error(`id が重複しています: ${id}`)
    this.ids.add(id)
    let style =
      (points ? 'edgeStyle=none;' : 'edgeStyle=orthogonalEdgeStyle;') +
      `rounded=1;html=1;endArrow=block;endFill=1;strokeColor=${color};strokeWidth=${width};fontSize=${size};` +
      `fontColor=${color};labelBackgroundColor=#FFFFFF;dashed=${dashed ? 1 : 0};jumpStyle=arc;jumpSize=8;verticalAlign=middle;`
    if (exit) style += `exitX=${exit[0]};exitY=${exit[1]};exitDx=0;exitDy=0;`
    if (entry) style += `entryX=${entry[0]};entryY=${entry[1]};entryDx=0;entryDy=0;`
    let geometry = '<mxGeometry relative="1" as="geometry">'
    if (offset) geometry += `<mxPoint x="${num(offset[0])}" y="${num(offset[1])}" as="offset"/>`
    if (points) geometry += '<Array as="points">' + points.map(([px, py]) => `<mxPoint x="${num(px)}" y="${num(py)}"/>`).join('') + '</Array>'
    geometry += '</mxGeometry>'
    this.cells.push(
      `<mxCell id="${id}" value="${escapeLabel(label)}" style="${style}" edge="1" parent="1" source="${source}" target="${target}">${geometry}</mxCell>`,
    )
    return id
  }

  toXml() {
    return (
      `<mxfile host="drawio-bridge"><diagram name="${escapeLabel(this.name)}"><mxGraphModel dx="${this.width}" dy="${this.height}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${this.width}" pageHeight="${this.height}" math="0" shadow="0"><root>` +
      '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
      this.cells.join('') +
      '</root></mxGraphModel></diagram></mxfile>'
    )
  }
}
