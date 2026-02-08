/**
 * Color Utilities for mermaid-to-webp
 *
 * 独立したカラーパース関数。svg-to-webp への依存なし。
 * Mermaid図の背景は白がデフォルトのため、不正値のフォールバックは white。
 */

/**
 * Parse background color string to RGBA object.
 * @param {string} bg - Color string: transparent, white, black, #RGB, #RRGGBB, #RRGGBBAA
 * @returns {{ r: number, g: number, b: number, alpha: number }}
 */
export function parseBackground(bg) {
  if (bg === "transparent") {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }
  if (bg === "white") {
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }
  if (bg === "black") {
    return { r: 0, g: 0, b: 0, alpha: 1 };
  }

  // #RGB shorthand
  if (bg.startsWith("#") && bg.length === 4) {
    const r = parseInt(bg[1] + bg[1], 16);
    const g = parseInt(bg[2] + bg[2], 16);
    const b = parseInt(bg[3] + bg[3], 16);
    return { r, g, b, alpha: 1 };
  }

  // #RRGGBB
  if (bg.startsWith("#") && bg.length === 7) {
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    return { r, g, b, alpha: 1 };
  }

  // #RRGGBBAA
  if (bg.startsWith("#") && bg.length === 9) {
    const r = parseInt(bg.slice(1, 3), 16);
    const g = parseInt(bg.slice(3, 5), 16);
    const b = parseInt(bg.slice(5, 7), 16);
    const alpha = parseInt(bg.slice(7, 9), 16) / 255;
    return { r, g, b, alpha };
  }

  console.warn(`Warning: Invalid background color "${bg}". Using white.`);
  return { r: 255, g: 255, b: 255, alpha: 1 };
}
