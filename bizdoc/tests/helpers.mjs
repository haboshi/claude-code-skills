import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HUB_MJS = fileURLToPath(new URL('../scripts/hub.mjs', import.meta.url));

export function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-')));
  const hub = path.join(base, 'hub');
  const proj = path.join(base, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(
    path.join(base, 'doc.html'),
    '<!doctype html><html><head><title>テスト文書</title></head><body><p>本文</p></body></html>'
  );
  return { base, hub, proj, doc: path.join(base, 'doc.html') };
}

export function runHub(hub, args) {
  return execFileSync(process.execPath, [HUB_MJS, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DOC_HUB_DIR: hub },
  });
}
