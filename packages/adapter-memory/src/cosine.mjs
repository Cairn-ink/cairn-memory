/** @typedef {number[] | Float32Array} Vector */

/**
 * Scale each vector before accumulating in float64 so finite inputs also work
 * when squaring their components directly would over- or underflow.
 * @param {Vector} a @param {Vector} b
 * @returns {number | undefined}
 */
export function cosineDistance(a, b) {
  if (a.length !== b.length) return undefined;
  let scaleA = 0;
  let scaleB = 0;
  for (let i = 0; i < a.length; i++) {
    scaleA = Math.max(scaleA, Math.abs(a[i]));
    scaleB = Math.max(scaleB, Math.abs(b[i]));
  }
  if (!scaleA || !scaleB) return undefined;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] / scaleA;
    const y = b[i] / scaleB;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const similarity = dot / Math.sqrt(normA * normB);
  return 1 - Math.max(-1, Math.min(1, similarity));
}
