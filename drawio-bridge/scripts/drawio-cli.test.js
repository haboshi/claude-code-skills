import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findDrawioBin, runExport, INSTALL_HINT } from './drawio-cli.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'drawio.js')

const MINIMAL = `<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="v1" value="テスト" style="rounded=1;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`

/** 一時ディレクトリに .drawio を1つ置いて fn に渡す。 */
function withDiagram(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'drawio-bridge-test-'))
  try {
    const path = join(dir, 'diagram.drawio')
    writeFileSync(path, MINIMAL)
    return fn({ dir, path })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const runCli = (args, env = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })

test('DRAWIO_BIN が実在しなければ検出は null を返す', () => {
  assert.equal(findDrawioBin({ DRAWIO_BIN: '/nonexistent/drawio' }), null)
})

test('DRAWIO_BIN が実在すればそれを最優先する', () => {
  assert.equal(findDrawioBin({ DRAWIO_BIN: process.execPath }), process.execPath)
})

test('CLI 不在時に runExport は無音で成功せず例外にする', () => {
  assert.throws(
    () => runExport({ input: 'x.drawio', output: 'x.svg', bin: null }),
    (e) => e.code === 'DRAWIO_CLI_NOT_FOUND' && e.message.includes('brew install --cask drawio'),
  )
})

test('導入案内に実際の導入コマンドが含まれる', () => {
  assert.match(INSTALL_HINT, /brew install --cask drawio/)
  assert.match(INSTALL_HINT, /DRAWIO_BIN/)
})

test('CLI 不在時の export は exit 3 で落ち、出力ファイルを作らない', () => {
  withDiagram(({ dir, path }) => {
    const out = join(dir, 'out.svg')
    const result = runCli(['export', '--in', path, '--out', out], { DRAWIO_BIN: '/nonexistent/drawio' })
    assert.equal(result.status, 3, `stderr: ${result.stderr}`)
    assert.match(result.stderr, /brew install --cask drawio/)
    assert.equal(existsSync(out), false, '失敗したのに出力ファイルができている')
  })
})

test('CLI 不在時の inline も exit 3 で落ちる', () => {
  withDiagram(({ path }) => {
    const result = runCli(['inline', '--in', path], { DRAWIO_BIN: '/nonexistent/drawio' })
    assert.equal(result.status, 3)
    assert.equal(result.stdout, '', '失敗したのに stdout に出力している')
  })
})

test('validate は不正な図で exit 1 にする', () => {
  withDiagram(({ dir }) => {
    const broken = join(dir, 'broken.drawio')
    writeFileSync(broken, MINIMAL.replace('<mxCell id="0"/>', ''))
    const result = runCli(['validate', '--in', broken])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /MISSING_ROOT_CELL/)
  })
})

test('validate は正しい図で exit 0 にする', () => {
  withDiagram(({ path }) => {
    assert.equal(runCli(['validate', '--in', path]).status, 0)
  })
})

test('--json で機械可読な結果を返す', () => {
  withDiagram(({ path }) => {
    const result = runCli(['validate', '--in', path, '--json'])
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, true)
    assert.ok(Array.isArray(parsed.issues))
  })
})

test('--in が無ければ使い方を出して exit 2', () => {
  const result = runCli(['validate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--in が必要です/)
})

test('不明なコマンドは exit 2', () => {
  assert.equal(runCli(['nope']).status, 2)
})

test('--page が不正なら exit 2 で落とす', () => {
  withDiagram(({ dir, path }) => {
    for (const bad of ['0', 'abc', '1.5']) {
      const result = runCli(['export', '--in', path, '--out', join(dir, 'o.svg'), '--page', bad])
      assert.equal(result.status, 2, `--page ${bad} が弾かれていない`)
      assert.match(result.stderr, /1 以上の整数/)
    }
  })
})

test('--page に負数を渡しても変換せずに落とす', () => {
  // '-1' は parseArgs 側が「オプションの引数が無い」と解釈して先に弾く。
  // メッセージは違うが、変換を実行せず exit 2 になることが要件
  withDiagram(({ dir, path }) => {
    const out = join(dir, 'o.svg')
    const result = runCli(['export', '--in', path, '--out', out, '--page', '-1'])
    assert.equal(result.status, 2)
    assert.equal(existsSync(out), false, '不正な指定なのに出力を作っている')
  })
})

test('runExport は不正な pageIndex を例外にする', () => {
  assert.throws(
    () => runExport({ input: 'x.drawio', output: 'x.svg', pageIndex: 0, bin: process.execPath }),
    (e) => e.code === 'DRAWIO_BAD_PAGE',
  )
})

// 以下は draw.io Desktop がある環境でのみ実行する
const bin = findDrawioBin()

test('実 CLI で .drawio を SVG に変換できる', { skip: bin ? false : 'draw.io Desktop 未導入' }, () => {
  withDiagram(({ dir, path }) => {
    const out = join(dir, 'out.svg')
    const result = runExport({ input: path, output: out, format: 'svg' })
    assert.equal(result.ok, true)
    const svg = readFileSync(out, 'utf8')
    assert.match(svg, /<svg/)
    assert.match(svg, /content="/, '編集用の原本が埋め込まれていない')
  })
})

test('実 CLI 経由の inline が HTML に貼れる SVG を返す', { skip: bin ? false : 'draw.io Desktop 未導入' }, () => {
  withDiagram(({ path }) => {
    const result = runCli(['inline', '--in', path, '--id-prefix', 'fig1'])
    assert.equal(result.status, 0, `stderr: ${result.stderr}`)
    assert.ok(result.stdout.startsWith('<svg'), 'svg 要素で始まっていない')
    const rootTag = result.stdout.slice(0, result.stdout.indexOf('>') + 1)
    assert.ok(!/\swidth="/.test(rootTag), `root の width が残っている: ${rootTag.slice(0, 120)}`)
    assert.match(result.stdout, /viewBox=/)
  })
})

/** 2 ページの .drawio。ページごとに違う図形を置いて出し分けを検証する。 */
const TWO_PAGES = `<mxfile host="Electron">
  <diagram id="p1" name="Page-1">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="a" value="1ページ目" style="rounded=1;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="600" height="60" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram id="p2" name="Page-2">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="b" value="2ページ目" style="ellipse;html=1;" vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="120" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

test('--page で出力するページを選べる', { skip: bin ? false : 'draw.io Desktop 未導入' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawio-bridge-pages-'))
  try {
    const src = join(dir, 'two.drawio')
    writeFileSync(src, TWO_PAGES)

    const p1 = join(dir, 'p1.svg')
    const p2 = join(dir, 'p2.svg')
    runExport({ input: src, output: p1, format: 'svg', pageIndex: 1 })
    runExport({ input: src, output: p2, format: 'svg', pageIndex: 2 })

    assert.match(readFileSync(p1, 'utf8'), /1ページ目/)
    assert.match(readFileSync(p2, 'utf8'), /2ページ目/)
    // 出し分けができていないと両方が同じ内容になる
    assert.ok(!readFileSync(p2, 'utf8').includes('1ページ目'), 'ページの出し分けができていない')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inline も --page を尊重する', { skip: bin ? false : 'draw.io Desktop 未導入' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'drawio-bridge-inline-page-'))
  try {
    const src = join(dir, 'two.drawio')
    writeFileSync(src, TWO_PAGES)
    const result = runCli(['inline', '--in', src, '--id-prefix', 'fig', '--page', '2'])
    assert.equal(result.status, 0, `stderr: ${result.stderr}`)
    assert.match(result.stdout, /2ページ目/)
    assert.ok(!result.stdout.includes('1ページ目'), 'inline がページ指定を無視している')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
