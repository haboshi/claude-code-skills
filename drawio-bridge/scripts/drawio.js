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
import { join, basename, extname } from 'node:path'

import { validateDrawio } from './validate.js'
import { inlineSvg } from './svg-inline.js'
import { runExport, findDrawioBin, INSTALL_HINT } from './drawio-cli.js'

const USAGE = `drawio-bridge — .drawio の検証・変換・HTML 埋め込み整形

  validate --in <file.drawio> [--json]
      公式の AI 生成ルールに沿って機械検証する。
      error があれば exit 1（warn のみなら exit 0）。

  export --in <file.drawio> --out <file.svg> [--format svg|png|pdf|xml]
         [--border 10] [--layout verticalFlow] [--no-embed]
      draw.io Desktop CLI で変換する。既定は編集用の原本を埋め込む（-e）。

  inline --in <file.drawio|file.svg> [--out <file.svg>] [--id-prefix fig1]
         [--max-width 780] [--no-font-fallback] [--color-scheme light|dark|auto]
      HTML に inline 埋め込みできる SVG に整えて stdout（または --out）に出す。
      width/height を外して viewBox を残し、id を接頭辞で衝突回避し、
      日本語のフォントフォールバックを足す。既定で色をライト固定にする
      （draw.io の SVG は閲覧環境のダーク設定に追随し、白背景で線が消えるため）。

  共通: --help
  環境変数 DRAWIO_BIN で draw.io 実行ファイルのパスを上書きできる。
`

const OPTIONS = {
  in: { type: 'string' },
  out: { type: 'string' },
  format: { type: 'string' },
  border: { type: 'string' },
  layout: { type: 'string' },
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
  const result = validateDrawio(readFileSync(input, 'utf8'))

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

  try {
    const result = runExport({
      input,
      output: values.out,
      format: values.format || 'svg',
      border: values.border === undefined ? 10 : Number(values.border),
      embedDiagram: !values['no-embed'],
      layout: values.layout,
    })
    process.stderr.write(`変換しました: ${values.out}\n`)
    if (result.stderr) process.stderr.write(`${result.stderr}\n`)
  } catch (e) {
    fail(e.message, e.code === 'DRAWIO_CLI_NOT_FOUND' ? 3 : 1)
  }
}

/** .drawio なら CLI で SVG に変換してから、.svg ならそのまま後処理に渡す。 */
function loadSvg(input) {
  if (extname(input).toLowerCase() === '.svg') return readFileSync(input, 'utf8')

  if (!findDrawioBin()) {
    const error = new Error(INSTALL_HINT)
    error.code = 'DRAWIO_CLI_NOT_FOUND'
    throw error
  }

  const workDir = mkdtempSync(join(tmpdir(), 'drawio-bridge-'))
  const svgPath = join(workDir, 'diagram.svg')
  try {
    runExport({ input, output: svgPath, format: 'svg' })
    return readFileSync(svgPath, 'utf8')
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function cmdInline(values) {
  const input = requireIn(values)

  let svgText
  try {
    svgText = loadSvg(input)
  } catch (e) {
    fail(e.message, e.code === 'DRAWIO_CLI_NOT_FOUND' ? 3 : 1)
  }

  const { svg, warnings } = inlineSvg(svgText, {
    idPrefix: values['id-prefix'],
    maxViewBoxWidth: values['max-width'] === undefined ? undefined : Number(values['max-width']),
    fontFallback: values['no-font-fallback'] ? false : undefined,
    colorScheme: values['color-scheme'],
  })

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
