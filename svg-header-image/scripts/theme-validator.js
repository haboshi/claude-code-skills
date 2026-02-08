/**
 * Theme Color Validator
 *
 * カスタムテーマJSONの色値をバリデーションし、SVGインジェクションを防止する。
 * 有効な形式: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 */

const COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/;

/**
 * 色値が有効な16進カラーコードか検証する。
 * @param {string|null|undefined} color
 * @returns {boolean}
 */
export function validateColor(color) {
  if (!color || typeof color !== "string") return false;
  if (!COLOR_PATTERN.test(color)) return false;
  // 有効な長さ: 4(#RGB), 5(#RGBA), 7(#RRGGBB), 9(#RRGGBBAA)
  const validLengths = [4, 5, 7, 9];
  return validLengths.includes(color.length);
}

/**
 * テーマオブジェクトの全色値を検証する。
 * 不正な値が見つかった場合はErrorを投げる。
 * @param {object} theme
 * @throws {Error}
 */
export function validateThemeColors(theme) {
  const colorFields = [
    { key: "text", value: theme.text },
    { key: "subText", value: theme.subText },
  ];

  for (const { key, value } of colorFields) {
    if (value && !validateColor(value)) {
      throw new Error(`Invalid color value for "${key}": ${value}`);
    }
  }

  const arrayFields = [
    { key: "bg", values: theme.bg },
    { key: "accent", values: theme.accent },
  ];

  for (const { key, values } of arrayFields) {
    if (Array.isArray(values)) {
      for (let i = 0; i < values.length; i++) {
        if (!validateColor(values[i])) {
          throw new Error(`Invalid color value for "${key}[${i}]": ${values[i]}`);
        }
      }
    }
  }
}
