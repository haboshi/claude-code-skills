// 生成物に個人の絶対パスが混入していないかを機械で落とす。
// Atlas は社外に渡る成果物なので、ホームディレクトリや一時ディレクトリの実パスを含めない。
// 「記録のみ」ではなく「生成を止める」側の検査に使う。

// 先頭が境界（行頭・引用符・空白・括弧など）であることを要求し、URL の path 部分を誤検知しない。
const PATTERNS = [
  { name: 'macOS ホーム', re: /(^|[^\w/:])(\/Users\/[^\s"'`<>)\]]+)/g },
  { name: 'Linux ホーム', re: /(^|[^\w/:])(\/home\/[^\s"'`<>)\]]+)/g },
  { name: 'macOS 一時領域', re: /(^|[^\w/:])(\/(?:private\/)?(?:tmp|var\/folders)\/[^\s"'`<>)\]]+)/g },
  { name: 'Windows ドライブ', re: /(^|[^\w])([A-Za-z]:\\\\?[^\s"'`<>)\]]+)/g },
];

/**
 * @param {string} text 検査対象の本文
 * @param {{extra?: string[]}} [opts] extra に渡した文字列も「混入」として扱う（ワークスペース名など）
 * @returns {{kind: string, value: string, index: number}[]}
 */
export function findAbsolutePaths(text, { extra = [] } = {}) {
  const hits = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      hits.push({ kind: name, value: m[2], index: m.index + m[1].length });
    }
  }
  for (const needle of extra) {
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) break;
      hits.push({ kind: '指定文字列', value: needle, index: at });
      from = at + needle.length;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** 人が読む 1 行にまとめる。値そのものは出さず、種別と位置と長さだけ報告する。 */
export function describeLeak(hit) {
  return `${hit.kind}（${hit.value.length} 文字 / 位置 ${hit.index}）`;
}
