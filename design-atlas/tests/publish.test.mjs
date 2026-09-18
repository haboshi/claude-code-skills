import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withHub(fn) {
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'design-atlas-hub-'));
  const prev = process.env.DOC_HUB_DIR;
  process.env.DOC_HUB_DIR = hub;
  // publish.mjs は読み込み時に DOC_HUB_DIR を固定するため、毎回別モジュールとして読む。
  const { publish } = await import(`../scripts/publish.mjs?hub=${encodeURIComponent(hub)}`);
  try {
    return await fn({ hub, publish });
  } finally {
    if (prev === undefined) delete process.env.DOC_HUB_DIR; else process.env.DOC_HUB_DIR = prev;
  }
}

function artifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-atlas-out-'));
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ meta: { id: 'demo', project: 'demo', title: 'デモ設計マップ' } }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>atlas</body></html>');
  fs.writeFileSync(path.join(dir, 'browser-verification.json'), '{}');
  return dir;
}

test('doc-hub の公開契約どおりに manifest を置く', async () => {
  await withHub(async ({ hub, publish }) => {
    const dir = artifact();
    const r = publish(path.join(dir, 'model.json'), dir);
    const man = JSON.parse(fs.readFileSync(path.join(path.dirname(r.doc), 'manifest.json'), 'utf8'));
    assert.equal(man.entry, 'index.html');
    assert.equal(man.source_skill, 'design-atlas');
    assert.equal(man.project_id, 'demo');
    assert.equal(man.schema_version, 1);
    assert.ok(fs.existsSync(path.join(hub, 'projects', 'demo', 'docs')));
  });
});

test('model.json と layout.json は公開物に含めない', async () => {
  await withHub(async ({ publish }) => {
    const dir = artifact();
    fs.writeFileSync(path.join(dir, 'layout.json'), '{}');
    const r = publish(path.join(dir, 'model.json'), dir);
    const files = fs.readdirSync(path.dirname(r.doc));
    assert.ok(!files.includes('model.json'));
    assert.ok(!files.includes('layout.json'));
    assert.ok(files.includes('browser-verification.json'), '検証結果は一緒に渡す');
  });
});

test('同じ slug への二重登録は --update を要求する', async () => {
  await withHub(async ({ publish }) => {
    const dir = artifact();
    publish(path.join(dir, 'model.json'), dir);
    assert.throws(() => publish(path.join(dir, 'model.json'), dir), /--update/);
    assert.doesNotThrow(() => publish(path.join(dir, 'model.json'), dir, { update: true }));
  });
});

test('reindex を実行していないときは、それを伝える', async () => {
  await withHub(async ({ publish }) => {
    const dir = artifact();
    const prev = process.env.DESIGN_ATLAS_HUB_CLI;
    process.env.DESIGN_ATLAS_HUB_CLI = path.join(dir, 'does-not-exist.mjs');
    try {
      const r = publish(path.join(dir, 'model.json'), dir);
      // bizdoc が同居していれば reindex は走る。走らなかったときに黙らないことを確かめる。
      if (!r.reindexed) assert.match(r.note, /reindex は実行していません/);
    } finally {
      if (prev === undefined) delete process.env.DESIGN_ATLAS_HUB_CLI; else process.env.DESIGN_ATLAS_HUB_CLI = prev;
    }
  });
});
