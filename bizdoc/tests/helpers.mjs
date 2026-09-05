import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { launchChrome, CHROME } from '../scripts/cdp.mjs';

export { CHROME };

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

// ── tokens.css の counter-reset 宣言（v0.11.2・Issue #55）──
// コメントを除き、@media 等の入れ子ブロックは中身を最上位へ展開してから（1 段。tokens.css は print の 1 ブロック）、
// counter-reset を持つ宣言を [{selector, value}] で返す。カンマ区切りのセレクタは 1 つずつに分ける。
export function counterResets(source) {
  let css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  css = css.replace(/@media[^{]*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g, (_m, inner) => inner);
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    for (const d of m[2].matchAll(/counter-reset\s*:\s*([^;]+)/g)) {
      for (const selector of selectors) out.push({ selector, value: d[1].trim() });
    }
  }
  return out;
}
// セレクタが body 要素そのものを対象にするか（`body` / `html body` / `html > body`。`body::before` は別要素なので含めない）
export const targetsBody = (selector) => /(^|[\s>+~])body$/.test(selector);

// ── 描画テスト（v0.11.2）──
// Chrome を 1 つ起動して使い回す。Chrome が無ければ null を返し、呼び出し側は t.skip する（既存テストの慣行）。
export async function openRenderer(prefix = 'bizdoc-render-') {
  if (!fs.existsSync(CHROME)) return null;
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const { cdp, sessionId, navigate, evaluate, close } = await launchChrome({ prefix });
  await cdp.send('DOM.enable', {}, sessionId);
  await cdp.send('DOMSnapshot.enable', {}, sessionId);
  let n = 0;
  // input は { html } か { file }。media に 'print' を渡すと印刷メディアとして描画する（navigate は load を待つ）
  const load = async (input, media) => {
    const file = input.file ?? path.join(dir, `doc-${++n}.html`);
    if (!input.file) fs.writeFileSync(file, input.html);
    await cdp.send('Emulation.setEmulatedMedia', { media: media ?? '' }, sessionId);
    await navigate('file://' + file);
  };
  return {
    // ::before の生成テキスト（カウンタ解決後）を、親要素名 → 文書順の配列で返す。
    // getComputedStyle の content は counter() を未解決のまま返し、Accessibility ツリーは数字を落とすため、
    // DOMSnapshot の layout テキストを読む。1 つの生成テキストは複数の layout ノード（"図" / "1" / " ｜ "）に
    // 分かれるので、擬似ノード単位で連結する。
    async beforeText(input, { media } = {}) {
      await load(input, media);
      const snap = await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [] }, sessionId);
      const d = snap.documents[0];
      const S = snap.strings;
      const pseudo = new Map();
      (d.nodes.pseudoType?.index ?? []).forEach((ni, k) => pseudo.set(ni, S[d.nodes.pseudoType.value[k]]));
      const byNode = new Map();
      d.layout.nodeIndex.forEach((ni, k) => {
        const t = d.layout.text[k];
        if (t < 0 || pseudo.get(ni) !== 'before') return;
        byNode.set(ni, (byNode.get(ni) ?? '') + S[t]);
      });
      const out = {};
      for (const [ni, text] of byNode) {
        const parent = S[d.nodes.nodeName[d.nodes.parentIndex[ni]]];
        (out[parent] ??= []).push(text);
      }
      return out;
    },
    async evaluate(input, expression, { media } = {}) {
      await load(input, media);
      return evaluate(expression);
    },
    close() {
      close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const tokensDoc = (css, body) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
