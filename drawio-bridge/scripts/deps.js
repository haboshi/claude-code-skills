/**
 * 依存の存在確認。
 *
 * マーケットプレイス経由で配布されたプラグインには node_modules が入らない
 * （既存の Node 系プラグインも同じ）。素の import で落とすと
 * ERR_MODULE_NOT_FOUND という回復手順の分からないエラーになるため、
 * 先に確認して直し方を案内する。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** package.json の dependencies と対応するディレクトリ名。 */
const REQUIRED = ['@xmldom/xmldom']

export const DEPS_HINT = (root) => [
  '依存パッケージが入っていません。プラグインのディレクトリで一度だけ実行してください:',
  `  npm install --prefix "${root}"`,
].join('\n')

/**
 * @param {string} pluginRoot プラグインのルート（package.json のある場所）
 * @returns {{ok: boolean, missing: string[]}}
 */
export function checkDeps(pluginRoot) {
  const missing = REQUIRED.filter((name) => !existsSync(join(pluginRoot, 'node_modules', ...name.split('/'))))
  return { ok: missing.length === 0, missing }
}
