import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDeps, DEPS_HINT } from './deps.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)

test('依存が揃っていれば ok', () => {
  assert.deepEqual(checkDeps(PLUGIN_ROOT), { ok: true, missing: [] })
})

test('node_modules が無ければ不足を報告する', () => {
  const empty = mkdtempSync(join(tmpdir(), 'drawio-bridge-nodeps-'))
  try {
    const result = checkDeps(empty)
    assert.equal(result.ok, false)
    assert.ok(result.missing.includes('@xmldom/xmldom'))
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('案内に npm install の実コマンドが含まれる', () => {
  assert.match(DEPS_HINT('/some/path'), /npm install --prefix "\/some\/path"/)
})

// マーケットプレイス配布では node_modules が入らない（既存プラグインも同様）。
// その状態を丸ごと再現して、CLI が回復手順つきで落ちることを確かめる。
test('依存不在のインストールを再現しても回復手順つきで落ちる', () => {
  const fake = mkdtempSync(join(tmpdir(), 'drawio-bridge-install-'))
  try {
    cpSync(join(PLUGIN_ROOT, 'scripts'), join(fake, 'scripts'), { recursive: true })
    cpSync(join(PLUGIN_ROOT, 'package.json'), join(fake, 'package.json'))
    // node_modules はコピーしない = 配布された直後の状態
    writeFileSync(join(fake, 'diagram.drawio'), '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>')

    const result = spawnSync(
      process.execPath,
      [join(fake, 'scripts', 'drawio.js'), 'validate', '--in', join(fake, 'diagram.drawio')],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 4, `stderr: ${result.stderr}`)
    assert.match(result.stderr, /npm install --prefix/)
    assert.ok(
      !result.stderr.includes('ERR_MODULE_NOT_FOUND'),
      '回復手順の分からない生のエラーが出ている',
    )
  } finally {
    rmSync(fake, { recursive: true, force: true })
  }
})
