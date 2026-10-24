// Frozen before the first rendering. Candidate order is never performance driven.
export const VERSION = 'hr2b-fixture-v1';
export const PRNG = 'mulberry32';
export const CANDIDATE_SEEDS = Object.freeze([
  0x72b4a191, 0x1dd6c047, 0x8c319e65, 0xb42f7803,
  0x34a7d259, 0xe6910bc7, 0x56c38af1, 0x902de46b,
  0x2ac781d3, 0xd58b309f, 0x6fe04219, 0xa1375c8d,
  0x489de267, 0xf0326ab5, 0x0b65d9e1, 0xc73a148f,
]);
export const DOMAINS = Object.freeze(['engineering', 'work-preferences', 'operations', 'finance', 'product', 'everyday']);
export const LANGS = Object.freeze(['zh', 'en', 'mixed']);
export const BODY_BANDS = Object.freeze([[120, 180, .30], [180, 260, .40], [260, 400, .30]]);
export const RECEIPT_BANDS = Object.freeze([[40, 70, .35], [70, 130, .40], [130, 200, .25]]);
export const RECEIPT_COUNTS = Object.freeze([[1, .20], [2, .25], [3, .25], [4, .30]]);
export const PLACEMENTS = Object.freeze([['body', .45], ['first-receipt', .25], ['later-receipt', .30]]);
export const LANGUAGE_SHARES = Object.freeze([['zh', .55], ['en', .30], ['mixed', .15]]);
// Four independently extracted episodes: old decision, adopted decision,
// explanation/adjacent attribute, and an operational confirmation.
// Decision/reason and primary/near-miss assignments never share a memory.
export const HAND_EPISODES = Object.freeze([[0, 3, 5], [1, 3, 4], [2, 5, 6], [3, 4, 6]]);
export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let n = Math.imul(value ^ (value >>> 15), 1 | value);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
// Largest remainder, ties in declared order; used before shuffling.
export function apportioned(n, shares) {
  const entries = shares.map(([key, share], index) => ({ key, count: Math.floor(n * share), remainder: n * share % 1, index }));
  let left = n - entries.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...entries].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) if (left-- > 0) row.count++;
  return entries.flatMap(({ key, count }) => Array(count).fill(key));
}
