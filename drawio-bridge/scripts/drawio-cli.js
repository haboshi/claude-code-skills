/**
 * draw.io Desktop CLI の検出と呼び出し。
 *
 * SVG/PNG/PDF への変換・Mermaid の取り込み・ELK レイアウトは、いずれも
 * draw.io 本体のレンダラでしか行えない（2026 時点で純 Node/Python の
 * 代替ライブラリは存在しない）。CLI が無いときに無音で成功扱いにせず、
 * 必ず非ゼロで落として導入手順を案内する。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Electron の起動を含むため、変換1回あたりの上限。 */
const EXPORT_TIMEOUT_MS = 120_000

const MACOS_APP_BIN = '/Applications/draw.io.app/Contents/MacOS/draw.io'

export const INSTALL_HINT = [
  'draw.io Desktop が見つかりません。SVG/PNG/PDF export と ELK レイアウトには本体が要ります。',
  '  macOS: brew install --cask drawio',
  '  すでに導入済みなら DRAWIO_BIN に実行ファイルのパスを指定してください。',
].join('\n')

/**
 * 実行ファイルを探す。DRAWIO_BIN > PATH > macOS の既定パス の順。
 * DRAWIO_BIN を最優先にしているのは、導入済み環境でも「CLI 不在」を
 * テストから再現できるようにするため。
 * @returns {string|null}
 */
export function findDrawioBin(env = process.env) {
  const override = env.DRAWIO_BIN
  if (override) return existsSync(override) ? override : null

  const which = spawnSync('which', ['drawio'], { encoding: 'utf8' })
  if (which.status === 0) {
    const found = which.stdout.trim()
    if (found) return found
  }

  return existsSync(MACOS_APP_BIN) ? MACOS_APP_BIN : null
}

/**
 * .drawio / .mmd を指定フォーマットへ変換する。
 * @param {{input: string, output: string, format?: string, border?: number,
 *          embedDiagram?: boolean, layout?: string, pageIndex?: number, bin?: string}} options
 * @returns {{ok: boolean, bin: string, args: string[], stderr: string}}
 */
export function runExport(options) {
  const {
    input,
    output,
    format = 'svg',
    border = 10,
    embedDiagram = true,
    layout,
    pageIndex,
    bin = findDrawioBin(),
  } = options

  if (!bin) {
    const error = new Error(INSTALL_HINT)
    error.code = 'DRAWIO_CLI_NOT_FOUND'
    throw error
  }

  const args = ['-x', '-f', format, '-b', String(border)]
  // 埋め込みは PNG/SVG/PDF のみ。xml 出力（Mermaid 変換・レイアウト）に付けると無意味
  if (embedDiagram && format !== 'xml') args.push('-e')
  if (layout) args.push('--layout', layout)
  // 複数ページの .drawio は既定で1ページ目だけが出る。-p は 1 始まり
  if (pageIndex !== undefined) {
    if (!Number.isInteger(pageIndex) || pageIndex < 1) {
      const error = new Error(`--page は 1 以上の整数で指定してください（指定値: ${pageIndex}）`)
      error.code = 'DRAWIO_BAD_PAGE'
      throw error
    }
    args.push('-p', String(pageIndex))
  }
  args.push('-o', output, input)

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: EXPORT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.error) {
    const error = new Error(`draw.io CLI の実行に失敗しました: ${result.error.message}`)
    error.code = 'DRAWIO_CLI_FAILED'
    throw error
  }
  if (result.status !== 0 || !existsSync(output)) {
    const error = new Error(
      `draw.io CLI が変換に失敗しました (exit=${result.status})\n${(result.stderr || '').trim()}`,
    )
    error.code = 'DRAWIO_CLI_FAILED'
    throw error
  }

  return { ok: true, bin, args, stderr: (result.stderr || '').trim() }
}
