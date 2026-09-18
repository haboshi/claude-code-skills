// 配布用の 1 枚化で使う画像変換。新しい依存を足さないため、必須段でどのみち起動する Chrome の
// canvas.toDataURL('image/webp') を使う（sharp も pillow も入れない）。
// 参照実装は PNG の base64 をそのまま埋めて 4.7MB のうち 86% を画像が占めていた。
import fs from 'node:fs';
import path from 'node:path';
import { launchChrome } from '../cdp.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export function dataUri(file) {
  const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * 画像を WEBP の data URI へ変換する。変換できなかったものは元の形式のまま返す。
 * @param {Record<string,string>} files key → 絶対パス
 */
export async function toWebpDataUris(files, { quality = 0.85 } = {}) {
  const entries = Object.entries(files);
  const convertible = entries.filter(([, p]) => ['.png', '.jpg', '.jpeg'].includes(path.extname(p).toLowerCase()));
  const out = Object.fromEntries(entries.map(([k, p]) => [k, dataUri(p)]));
  if (!convertible.length) return { images: out, converted: 0, note: null };

  let session;
  try {
    session = await launchChrome();
  } catch (e) {
    // 変換できないだけで成果物は作れる。黙って PNG を埋め、理由を返す。
    return { images: out, converted: 0, note: `Chrome を起動できなかったため WEBP へ変換していません: ${e.message}` };
  }
  try {
    const { cdp, sessionId, navigate } = session;
    // cdp.mjs の evaluate は awaitPromise を渡さないため、async 式の戻り値は Promise のまま
    // 値化されて {} になる。画像のデコードを待つ必要があるので、ここでは自前で送る。
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'ページ側で例外');
      return result.value;
    };
    await navigate('about:blank');
    let converted = 0;
    for (const [key, file] of convertible) {
      // 元画像は data URI で渡す。about:blank は不透明な生成元なので file:// の画像を読めず、
      // img.decode() が EncodingError になる（--allow-file-access-from-files を足すより副作用が小さい）。
      const src = out[key];
      const result = await evaluate(`(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(src)};
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const uri = c.toDataURL('image/webp', ${quality});
        return uri.startsWith('data:image/webp') ? uri : null;
      })()`);
      if (result) { out[key] = result; converted++; }
    }
    return { images: out, converted, note: converted === convertible.length ? null : `${convertible.length - converted} 件は WEBP に変換できず元の形式のまま埋め込みました` };
  } finally {
    await session.close();
  }
}
