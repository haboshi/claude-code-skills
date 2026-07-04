'use strict';
// model → token 単価から概算コスト(USD)を算出する。
// 注意: これは概算。厳密なコストは telemetry(OTel) の実測で上書きする前提（Phase 2）。
// 単価は USD / 1M tokens。モデル世代の代表値で、細かな 1M-context 割増等は無視する。

// [input, output, cache_read, cache_write]（USD / 1M tokens）
const RATES = {
  opus:   [15, 75, 1.5, 18.75],
  sonnet: [3, 15, 0.3, 3.75],
  haiku:  [0.8, 4, 0.08, 1],
  fable:  [3, 15, 0.3, 3.75], // 未公開のため sonnet 相当で暫定
};
const FALLBACK = RATES.sonnet;

// model 文字列（"claude-opus-4-8[1m]" 等）から世代を推定
function rateFor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return RATES.opus;
  if (m.includes('sonnet')) return RATES.sonnet;
  if (m.includes('haiku')) return RATES.haiku;
  if (m.includes('fable')) return RATES.fable;
  return FALLBACK;
}

// { input, output, cache_read, cache_creation } → USD（概算）
function costUsd(usage, model) {
  const [ri, ro, rcr, rcw] = rateFor(model);
  const input = usage.input || 0;
  const output = usage.output || 0;
  const cacheRead = usage.cache_read || 0;
  const cacheCreate = usage.cache_creation || 0;
  return (input * ri + output * ro + cacheRead * rcr + cacheCreate * rcw) / 1e6;
}

module.exports = { rateFor, costUsd, RATES };
