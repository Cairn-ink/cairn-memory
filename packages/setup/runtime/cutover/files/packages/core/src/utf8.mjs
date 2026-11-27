// Canonical id ordering: UTF-8 byte order (TextEncoder only; works in Workers and Node).
const encoder = new TextEncoder();

/** @param {string} a @param {string} b @returns {-1 | 0 | 1} */
export function compareUtf8(a, b) {
  if (a === b) return 0;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/**
 * Exact sort keys: microseconds since the epoch as bigint. Hosted keeps PostgreSQL's
 * microsecond precision; engine stores derive it from milliseconds (ms * 1000n).
 * @param {bigint} a @param {bigint} b @returns {-1 | 0 | 1}
 */
export function compareSortKey(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}
