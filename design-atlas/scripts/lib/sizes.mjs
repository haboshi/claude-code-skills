// カード寸法。ブラウザを開かずに再配置するため、ビューワの CSS から式で出す。
// ブラウザ描画時には実寸で測り直されるので、ここは層割当と初期経路のための近似。
// 近似がずれていても図は壊れないが、ずれたまま放置すると初期配置の余白が不自然になる。

export function entitySize(entity, cards) {
  const c = cards.entity;
  return { w: c.width, h: c.head + c.field * entity.fields.length };
}

export function entityCompactSize(cards) {
  return { w: cards.entityCompact.width, h: cards.entityCompact.height };
}

export function screenSize(screen, cards, { portCount = 0 } = {}) {
  const c = cards.screen;
  const image = Math.round(c.width * imageRatio(screen, c));
  const rows = portCount ? Math.ceil(portCount / c.portsPerRow) : 0;
  return { w: c.width, h: c.head + image + c.footer + rows * c.portRow };
}

function imageRatio(screen, c) {
  const first = screen.images?.[0];
  if (first?.width && first?.height) return first.height / first.width;
  return c.imageRatio;
}

export function flowSize(process, cards) {
  const c = cards.flow;
  // 見出しが折り返す分だけ背が伸びる。文字数での近似で、CJK と半角を区別しない。
  const wraps = (process.name ?? '').length > c.wrapAt;
  return { w: c.width, h: c.height + (wraps ? c.wrapExtra : 0) };
}

export function groupSize(cards) {
  return { w: cards.group.width, h: cards.group.height };
}
