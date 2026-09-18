#!/usr/bin/env node
// verify-structure.mjs — 生成を止める側の検査。1 件でも拾ったら exit 1 で、成果物を渡さない。
// 見た目の指標はここでは扱わない（verify-layout が記録する）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadModel, ModelError } from './lib/model.mjs';
import { checkModel, checkManifest, checkLayout, checkArtifacts } from './lib/checks.mjs';

const require = createRequire(import.meta.url);
const routing = require('./routing.cjs');

export function verifyStructure(modelPath, { artifactDir, extra = [] } = {}) {
  const { model, dir } = loadModel(modelPath);
  const base = artifactDir ?? dir;
  const performed = [];
  let findings = [];

  findings = findings.concat(checkModel(model));
  performed.push('model.json の相互参照・重複・孤立');

  const layoutPath = path.join(dir, 'layout.json');
  if (fs.existsSync(layoutPath)) {
    findings = findings.concat(checkLayout(JSON.parse(fs.readFileSync(layoutPath, 'utf8')), routing, model));
    performed.push('layout.json のカード重複・貫通・ラベル衝突・ER の参照順');
  }

  const manifestPath = path.join(base, 'source-manifest.json');
  if (fs.existsSync(manifestPath)) {
    findings = findings.concat(checkManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))));
    performed.push('入力の sha256 と宣言値の一致');
  }

  const artifacts = {};
  for (const name of ['index.html', 'source-manifest.json', 'layout-verification.json', 'browser-verification.json']) {
    const p = path.join(base, name);
    if (fs.existsSync(p)) artifacts[name] = fs.readFileSync(p, 'utf8');
  }
  if (Object.keys(artifacts).length) {
    findings = findings.concat(checkArtifacts(artifacts, { extra }));
    performed.push('生成物への絶対パス混入');
  }

  return {
    schema: 'design-atlas/structure-verification/1',
    verified_at: new Date().toISOString(),
    performed,
    not_performed: [
      'ブラウザでの描画・JS エラー・要素の可視性（verify-browser が行う）',
      '交差数・並走区間・経路長・カード密度（verify-layout が記録する。合否ではない）',
    ],
    findings,
    passed: findings.length === 0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const [modelPath] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out' && argv[i - 1] !== '--artifacts' && argv[i - 1] !== '--forbid');
  if (!modelPath) {
    console.error('usage: verify-structure.mjs <model.json> [--artifacts <dir>] [--out <file>] [--forbid <語,語>]');
    process.exit(2);
  }
  try {
    const report = verifyStructure(modelPath, {
      artifactDir: get('--artifacts'),
      extra: (get('--forbid') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    });
    const out = get('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    for (const f of report.findings) console.error(`  ✗ [${f.code}] ${f.message}`);
    console.log(JSON.stringify({ passed: report.passed, findings: report.findings.length, performed: report.performed.length }));
    process.exit(report.passed ? 0 : 1);
  } catch (e) {
    console.error(e instanceof ModelError ? e.message : e);
    process.exit(1);
  }
}
