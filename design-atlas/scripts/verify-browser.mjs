#!/usr/bin/env node
// verify-browser.mjs — 実ブラウザで生成物を開いて確かめる必須段。JSDOM の合格を見た目の確認の代替にしない。
// 検証対象は配布する版そのもの。--inline で 1 枚化したものを配るなら、その 1 枚を開いて確かめる。
// Chrome が起動できない環境では、別経路を探さず「未実施」として記録する（保護機構を迂回しない）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchChrome, CHROME } from './cdp.mjs';

const PROBE = `(() => {
  const out = { modes: [], errors: [] };
  if (!window.ATLAS) { out.errors.push('window.ATLAS がありません（アプリが起動していない）'); return out; }
  for (const mode of window.ATLAS.modes) {
    window.ATLAS.setMode(mode);
    const state = window.ATLAS.getState();
    const cards = [...document.querySelectorAll('#nodes .node')];
    const drawn = [...document.querySelectorAll('#edges .connection')];
    const expectedCards = Object.keys(state.positions).length;
    const expectedEdges = state.edges.length;
    // 可視性は矩形で見る。display:none だけでなく、幅か高さが 0 のカードも「出ていない」と数える。
    const invisible = cards.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 1 || r.height < 1; }).length;
    const missingPaths = drawn.filter((el) => !(el.querySelector('.edge-path')?.getAttribute('d') || '').startsWith('M')).length;
    out.modes.push({ mode, cards: cards.length, expectedCards, edges: drawn.length, expectedEdges, invisible, missingPaths, bounds: state.bounds });
  }
  out.images = [...document.images].map((img) => ({ src: img.getAttribute('src')?.slice(0, 40) ?? '', ok: img.complete && img.naturalWidth > 0 }));

  // 押しても何も開かないボタンは、DOM を数えるだけの検査では見つからない。
  // 開く仕掛けのあるものは実際に押して、中身が入ったか確かめる。
  const dialog = document.querySelector('#viewer');
  const openedBy = (el) => {
    if (!el) return null;
    try { dialog.close(); } catch { /* 開いていない */ }
    el.click();
    const filled = dialog.open && document.querySelector('#viewer-content')?.textContent.trim().length > 0;
    try { dialog.close(); } catch { /* すでに閉じている */ }
    return filled;
  };
  out.interactions = {
    guide: openedBy(document.querySelector('#guide')),
    source: openedBy(document.querySelector('.source-button[data-source]')),
  };
  return out;
})()`;

export async function verifyBrowser(htmlPath, { shotDir, timeoutMs = 60000 } = {}) {
  const abs = path.resolve(htmlPath);
  const report = {
    schema: 'design-atlas/browser-verification/1',
    verified_at: new Date().toISOString(),
    artifact: path.basename(abs),
    artifact_sha256: null,
    chrome: null,
    performed: [],
    // この版で実行できなかった検査だけを入れる。常に当てはまる但し書きは caveat へ。
    not_performed: [],
    caveat: 'この段はブラウザが描画した DOM と画像を機械で見ただけで、読みやすさは人が見ていない。',
    findings: [],
    screenshots: [],
    passed: false,
  };
  const { createHash } = await import('node:crypto');
  report.artifact_sha256 = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');

  let session;
  try {
    session = await launchChrome({ timeoutMs });
  } catch (e) {
    // 迂回しない。起動できなかったという事実をそのまま残す。
    // ただし「未実施」は合格ではないので、指摘としても 1 件立てる（CLI は exit 1 になる）。
    report.not_performed.push(`Chrome を起動できなかったため、実ブラウザ検証は未実施: ${e.message}`);
    report.findings.push({ code: 'chrome-unavailable', message: `Chrome を起動できないため、この版は実ブラウザ検証を通していません: ${e.message}` });
    return report;
  }

  const consoleErrors = [];
  const failedRequests = [];
  try {
    const { cdp, sessionId, navigate, close } = session;
    // Promise を返す式を待つ。cdp.mjs の evaluate は awaitPromise を渡さないので、
    // 描画待ちがその場で通り抜けてしまう（待っているつもりで待っていない状態になる）。
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (exceptionDetails) throw new Error(`Runtime.evaluate: ${exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'ページ側で例外'}`);
      return result.value;
    };
    try {
      cdp.on((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.exceptionThrown') {
          consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '例外');
        } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else if (m.method === 'Network.loadingFailed') {
          failedRequests.push(m.params.errorText);
        }
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Network.enable', {}, sessionId);
      const version = await cdp.send('Browser.getVersion');
      report.chrome = version.product;

      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
      await navigate(pathToFileURL(abs).href, 20000);
      // 画像の読み込みと初回描画を待つ。requestAnimationFrame 2 回分で settleRoutes 後の DOM が確定する。
      await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');

      const probe = await evaluate(PROBE);
      report.performed.push('ページが描画される', 'JS エラーが出ない', '全カード・全関係線が DOM にあり可視', '外部画像が読み込める');

      for (const e of probe.errors ?? []) report.findings.push({ code: 'app-not-started', message: e });
      for (const m of probe.modes ?? []) {
        if (m.cards !== m.expectedCards) report.findings.push({ code: 'missing-card', message: `${m.mode}: カードが ${m.expectedCards} 件のうち ${m.cards} 件しか出ていません` });
        if (m.edges !== m.expectedEdges) report.findings.push({ code: 'missing-edge', message: `${m.mode}: 関係線が ${m.expectedEdges} 本のうち ${m.edges} 本しか出ていません` });
        if (m.invisible) report.findings.push({ code: 'invisible-card', message: `${m.mode}: 大きさが 0 のカードが ${m.invisible} 件あります` });
        if (m.missingPaths) report.findings.push({ code: 'empty-path', message: `${m.mode}: 経路が空の関係線が ${m.missingPaths} 本あります` });
      }
      for (const [name, ok] of Object.entries(probe.interactions ?? {})) {
        // null = そのボタン自体が無い（モデルにガイドも根拠も無いだけ）。false = あるのに開かない。
        if (ok === false) report.findings.push({ code: 'dead-control', message: `${name} のボタンを押しても中身が開きません` });
      }
      report.performed.push('開く仕掛けのあるボタンを実際に押して中身が入ることを確認');
      const brokenImages = (probe.images ?? []).filter((i) => !i.ok).length;
      if (brokenImages) report.findings.push({ code: 'broken-image', message: `読み込めない画像が ${brokenImages} 件あります` });
      report.views = probe.modes ?? [];

      if (shotDir) {
        fs.mkdirSync(shotDir, { recursive: true });
        for (const m of probe.modes ?? []) {
          await evaluate(`window.ATLAS.setMode(${JSON.stringify(m.mode)})`);
          // 証跡としては全体が写っている方が読める。初期倍率は「読める倍率」で寄っているので見渡しに切り替える。
          await evaluate("document.querySelector('#fit').click()");
          await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
          const name = `view-${m.mode}.png`;
          fs.writeFileSync(path.join(shotDir, name), Buffer.from(shot.data, 'base64'));
          report.screenshots.push(name);
        }
      }
    } finally {
      await close();
    }
  } catch (e) {
    report.findings.push({ code: 'browser-failure', message: `ブラウザ検証の途中で失敗しました: ${e.message}` });
  }

  for (const e of consoleErrors) report.findings.push({ code: 'js-error', message: `JS エラー: ${String(e).slice(0, 200)}` });
  for (const e of failedRequests) report.findings.push({ code: 'request-failed', message: `読み込みに失敗しました: ${e}` });
  report.passed = report.findings.length === 0 && report.chrome !== null;
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue; }
    positional.push(argv[i]);
  }
  const htmlPath = positional[0];
  if (!htmlPath) {
    console.error('usage: verify-browser.mjs <index.html> [--shots <dir>] [--out <file>]');
    process.exit(2);
  }
  const report = await verifyBrowser(htmlPath, { shotDir: get('--shots') });
  const out = get('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  for (const f of report.findings) console.error(`  ✗ [${f.code}] ${f.message}`);
  for (const n of report.not_performed) console.error(`  · 未実施: ${n}`);
  console.error(`  · 但し書き: ${report.caveat}`);
  console.log(JSON.stringify({ passed: report.passed, chrome: report.chrome, findings: report.findings.length, screenshots: report.screenshots.length }));
  process.exit(report.passed ? 0 : 1);
}
