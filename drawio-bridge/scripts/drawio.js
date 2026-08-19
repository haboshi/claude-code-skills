#!/usr/bin/env node
/**
 * drawio-bridge CLI。
 *
 * 他スキル（bizdoc などの HTML 生成側）から決定論的に呼ばれることを想定した
 * 部品。図の内容そのものを考えるのは公式 drawio スキルの仕事で、ここは
 * 「検証する・画像にする・HTML に貼れる形にする」だけを担う。
 *
 *   node drawio.js validate --in diagram.drawio
 *   node drawio.js export   --in diagram.drawio --out diagram.svg
 *   node drawio.js inline   --in diagram.drawio --id-prefix fig1
 */
import { parseArgs } from 'node:util'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDeps, DEPS_HINT } from './deps.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// 依存が無いまま下の import を評価すると ERR_MODULE_NOT_FOUND で落ちる。
// 直し方の分かるメッセージを先に出す。
const deps = checkDeps(PLUGIN_ROOT)
if (!deps.ok) {
  process.stderr.write(`${DEPS_HINT(PLUGIN_ROOT)}\n  不足: ${deps.missing.join(', ')}\n`)
  process.exit(4)
}

const { validateDrawio, countPages } = await import('./validate.js')
const { inlineSvg } = await import('./svg-inline.js')
const { runExport, findDrawioBin, INSTALL_HINT } = await import('./drawio-cli.js')

const USAGE = `drawio-bridge — .drawio の検証・変換・HTML 埋め込み整形

  validate --in <file.drawio> [--json]
      公式の AI 生成ルールに沿って機械検証する。
      error があれば exit 1（warn のみなら exit 0）。

  export --in <file.drawio> --out <file.svg> [--format svg|png|pdf|xml]
         [--border 10] [--layout verticalFlow] [--page 2] [--no-embed]
      draw.io Desktop CLI で変換する。既定は編集用の原本を埋め込む（-e）。
      複数ページの図は既定で1ページ目のみ。--page（1 始まり）で選ぶ。

  inline --in <file.drawio|file.svg> [--out <file.svg>] [--id-prefix fig1]
         [--page 2] [--max-width 780] [--no-font-fallback]
         [--color-scheme light|dark|auto]
      HTML に inline 埋め込みできる SVG に整えて stdout（または --out）に出す。
      width/height を外して viewBox を残し、id を接頭辞で衝突回避し、
      日本語のフォントフォールバックを足す。既定で色をライト固定にする
      （draw.io の SVG は閲覧環境のダーク設定に追随し、白背景で線が消えるため）。

  共通: --help
  環境変数 DRAWIO_BIN で draw.io 実行ファイルのパスを上書きできる。

  終了コード: 0 成功 / 1 検証エラー・変換失敗 / 2 引数不正
              3 draw.io Desktop が無い / 4 npm 依存が入っていない
`

const OPTIONS = {
  in: { type: 'string' },
  out: { type: 'string' },
  format: { type: 'string' },
  border: { type: 'string' },
  layout: { type: 'string' },
  page: { type: 'string' },
  'id-prefix': { type: 'string' },
  'max-width': { type: 'string' },
  'color-scheme': { type: 'string' },
  'no-embed': { type: 'boolean' },
  'no-font-fallback': { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/** CLI が受け付ける値。外れたものを黙って CLI に渡さない。 */
const FORMATS = ['svg', 'png', 'pdf', 'jpg', 'xml']
const COLOR_SCHEMES = ['light', 'dark', 'auto']

/** 数値オプションを読む。NaN を素通りさせると検査が無音で消える。 */
function parseNumber(values, key, { min = 0 } = {}) {
  if (values[key] === undefined) return undefined
  const num = Number(values[key])
  if (!Number.isFinite(num) || num < min) {
    fail(`--${key} は ${min} 以上の数値で指定してください（指定値: ${values[key]}）`, 2)
  }
  return num
}

/** 列挙オプションを読む。 */
function parseChoice(values, key, allowed) {
  const value = values[key]
  if (value === undefined) return undefined
  if (!allowed.includes(value)) {
    fail(`--${key} は ${allowed.join(' / ')} のいずれかです（指定値: ${value}）`, 2)
  }
  return value
}

/**
 * --page が実在するページを指しているか確かめる。
 * draw.io CLI は範囲外を渡されると黙って1ページ目を出すため、ここで止める。
 */
function assertPageInRange(input, pageIndex) {
  if (pageIndex === undefined) return
  let pages
  try {
    pages = countPages(readFileSync(input, 'utf8'))
  } catch {
    return // 読めない場合は後続の変換側でエラーになる
  }
  if (pages > 0 && pageIndex > pages) {
    fail(`--page ${pageIndex} は範囲外です（このファイルは ${pages} ページ）`, 2)
  }
}

/** --page を 1 始まりの整数として読む。未指定なら undefined。 */
function parsePage(values) {
  if (values.page === undefined) return undefined
  const page = Number(values.page)
  if (!Number.isInteger(page) || page < 1) {
    fail(`--page は 1 以上の整数で指定してください（指定値: ${values.page}）`, 2)
  }
  return page
}

function requireIn(values) {
  if (!values.in) fail('--in が必要です\n\n' + USAGE, 2)
  return values.in
}

function reportIssues(issues) {
  for (const issue of issues) {
    const mark = issue.severity === 'error' ? 'ERROR' : 'WARN '
    process.stderr.write(`${mark} [${issue.code}] ${issue.message}\n`)
  }
}

function cmdValidate(values) {
  const input = requireIn(values)

  let source
  try {
    source = readFileSync(input, 'utf8')
  } catch (e) {
    fail(`入力を読めません: ${e.message}`, 1)
  }
  const result = validateDrawio(source)

  if (values.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    reportIssues(result.issues)
    const errors = result.issues.filter((i) => i.severity === 'error').length
    const warns = result.issues.length - errors
    process.stderr.write(
      result.ok
        ? `OK: ${basename(input)}（警告 ${warns} 件）\n`
        : `NG: ${basename(input)}（エラー ${errors} 件 / 警告 ${warns} 件）\n`,
    )
  }
  process.exit(result.ok ? 0 : 1)
}

function cmdExport(values) {
  const input = requireIn(values)
  if (!values.out) fail('--out が必要です', 2)

  const pageIndex = parsePage(values)
  assertPageInRange(input, pageIndex)

  try {
    const result = runExport({
      input,
      output: values.out,
      format: parseChoice(values, 'format', FORMATS) || 'svg',
      border: parseNumber(values, 'border') ?? 10,
      embedDiagram: !values['no-embed'],
      layout: values.layout,
      pageIndex,
    })
    process.stderr.write(`変換しました: ${values.out}\n`)
    if (result.stderr) process.stderr.write(`${result.stderr}\n`)
  } catch (e) {
    fail(e.message, e.code === 'DRAWIO_CLI_NOT_FOUND' ? 3 : 1)
  }
}

/** .drawio なら CLI で SVG に変換してから、.svg ならそのまま後処理に渡す。 */
function loadSvg(input, pageIndex) {
  if (extname(input).toLowerCase() === '.svg') return readFileSync(input, 'utf8')

  // 壊れた .drawio は draw.io が「空の SVG」を返すため、変換前に検証する。
  // ここを通さないと、図が抜けた HTML が黙って出来上がる
  const check = validateDrawio(readFileSync(input, 'utf8'))
  if (!check.ok) {
    reportIssues(check.issues)
    const error = new Error('入力の .drawio に検証エラーがあります（validate で詳細を確認してください）')
    error.code = 'DRAWIO_INVALID_INPUT'
    throw error
  }

  if (!findDrawioBin()) {
    const error = new Error(INSTALL_HINT)
    error.code = 'DRAWIO_CLI_NOT_FOUND'
    throw error
  }

  const workDir = mkdtempSync(join(tmpdir(), 'drawio-bridge-'))
  const svgPath = join(workDir, 'diagram.svg')
  try {
    runExport({ input, output: svgPath, format: 'svg', pageIndex })
    return readFileSync(svgPath, 'utf8')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function cmdInline(values) {
  const input = requireIn(values)

  const pageIndex = parsePage(values)
  if (extname(input).toLowerCase() !== '.svg') assertPageInRange(input, pageIndex)
  // 変換の前に引数を検査する。不正な指定で draw.io CLI を起動しない
  parseNumber(values, 'max-width', { min: 1 })
  parseChoice(values, 'color-scheme', COLOR_SCHEMES)

  let svgText
  try {
    svgText = loadSvg(input, pageIndex)
  } catch (e) {
    fail(e.message, e.code === 'DRAWIO_CLI_NOT_FOUND' ? 3 : 1)
  }

  let result
  try {
    result = inlineSvg(svgText, {
      idPrefix: values['id-prefix'],
      maxViewBoxWidth: parseNumber(values, 'max-width', { min: 1 }),
      fontFallback: values['no-font-fallback'] ? false : undefined,
      colorScheme: parseChoice(values, 'color-scheme', COLOR_SCHEMES),
    })
  } catch (e) {
    // xmldom は整形式でない入力で自ら throw する（内部スタックを見せない）
    fail(`SVG として読めません: ${e.message}`, 1)
  }
  const { svg, warnings } = result

  for (const w of warnings) process.stderr.write(`WARN ${w}\n`)

  if (values.out) {
    writeFileSync(values.out, svg)
    process.stderr.write(`書き出しました: ${values.out}\n`)
  } else {
    process.stdout.write(svg)
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(USAGE)
    process.exit(command ? 0 : 2)
  }

  let values
  try {
    ;({ values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false }))
  } catch (e) {
    fail(`${e.message}\n\n${USAGE}`, 2)
  }
  if (values.help) {
    process.stdout.write(USAGE)
    process.exit(0)
  }

  switch (command) {
    case 'validate': return cmdValidate(values)
    case 'export': return cmdExport(values)
    case 'inline': return cmdInline(values)
    default: return fail(`不明なコマンド: ${command}\n\n${USAGE}`, 2)
  }
}

main()
