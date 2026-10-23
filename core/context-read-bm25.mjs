import { tokenizeT1, termFrequencies } from './context-read-tokenize.mjs';

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
const binary = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
export function canonicalTuple(row) {
  const ref = row.ref ?? row, ns = ref.namespace ?? {};
  return [ns.ownerId ?? '', ns.scope ?? '', ns.projectId ?? '', ref.type ?? 'memory',
    ref.memoryId ?? ref.cardId ?? row.id ?? row.memoryId];
}
export const canonicalKey = row => JSON.stringify(canonicalTuple(row));
export function compareCanonical(a, b) {
  const left = canonicalTuple(a), right = canonicalTuple(b);
  for (let i = 0; i < left.length; i++) { const order = binary(left[i], right[i]); if (order) return order; }
  return 0;
}
export const rankScores = rows => rows.sort((a, b) => b.score - a.score || compareCanonical(a, b));

/** Shared scoring primitive for persisted postings and the in-memory parity port.
 * N/totalLength/df must belong to exactly the requested eligible projection.
 */
export function scoreBM25(terms, document, { N, totalLength, df }) {
  let score = 0, matched = false;
  const avgLength = totalLength / (N || 1);
  for (const term of new Set(terms)) {
    const f = document.frequencies.get(term) ?? 0;
    if (!f) continue;
    matched = true;
    const idf = Math.log(1 + (N - df.get(term) + 0.5) / (df.get(term) + 0.5));
    score += idf * f * (BM25_K1 + 1) /
      (f + BM25_K1 * (1 - BM25_B + BM25_B * document.length / avgLength));
  }
  return matched ? score : null;
}

export function createBM25(documents) {
  const df = new Map(), seen = new Set();
  const docs = documents.map(doc => {
    const key = canonicalKey(doc);
    if (seen.has(key)) throw new TypeError('duplicate_document');
    seen.add(key);
    const tokens = termFrequencies(doc.text);
    for (const term of tokens.frequencies.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return { ...doc, ...tokens };
  });
  const N = docs.length, totalLength = docs.reduce((sum, doc) => sum + doc.length, 0);
  return { N, totalLength, avgLength: totalLength / (N || 1), df, search(text, depth = 24) {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > 24) throw new TypeError('invalid_depth');
    const terms = tokenizeT1(text), rows = [];
    for (const doc of docs) {
      const score = scoreBM25(terms, doc, { N, totalLength, df });
      if (score !== null) {
        const { text: _text, length: _length, frequencies: _frequencies, ...identity } = doc;
        rows.push({ ...identity, score });
      }
    }
    return rankScores(rows).slice(0, depth);
  } };
}
