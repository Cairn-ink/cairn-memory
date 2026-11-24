import { compareUtf8 } from "../utf8.mjs";
import { tokenizeT1, termFrequencies } from "./tokenize.mjs";

/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {ItemRef | { ref: ItemRef }} RefRow */
/** @typedef {ReturnType<typeof termFrequencies>} Terms */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

const MAX_DEPTH = 24;

/** @param {RefRow} row @returns {[ItemRef["namespace"], ItemRef["type"], string]} */
export function canonicalTuple(row) {
  const ref = "ref" in row ? row.ref : row;
  return [ref.namespace, ref.type, ref.id];
}

/** @param {RefRow} row */
export const canonicalKey = row => JSON.stringify(canonicalTuple(row));

/** @param {RefRow} a @param {RefRow} b */
export function compareCanonical(a, b) {
  const [leftNamespace, leftType, leftId] = canonicalTuple(a);
  const [rightNamespace, rightType, rightId] = canonicalTuple(b);
  const order = leftNamespace === rightNamespace ? 0 : leftNamespace === null ? -1 :
    rightNamespace === null ? 1 : compareUtf8(leftNamespace, rightNamespace);
  return order || compareUtf8(leftType, rightType) || compareUtf8(leftId, rightId);
}

/** @template {RefRow & { score: number }} T @param {T[]} rows */
export const rankScores = rows => rows.sort((a, b) => b.score - a.score || compareCanonical(a, b));

/**
 * @param {Iterable<string>} terms
 * @param {Terms} document
 * @param {{ N: number, totalLength: number, df: ReadonlyMap<string, number> }} stats
 */
export function scoreBM25(terms, document, { N, totalLength, df }) {
  let score = 0, matched = false;
  const avgLength = totalLength / (N || 1);
  for (const term of new Set(terms)) {
    const f = document.frequencies.get(term) ?? 0;
    if (!f) continue;
    matched = true;
    const dfTerm = /** @type {number} */ (df.get(term));
    const idf = Math.log(1 + (N - dfTerm + 0.5) / (dfTerm + 0.5));
    score += idf * f * (BM25_K1 + 1) /
      (f + BM25_K1 * (1 - BM25_B + BM25_B * document.length / avgLength));
  }
  return matched ? score : null;
}

/** @template {RefRow & { text: string }} T @param {readonly T[]} documents */
export function createBM25(documents) {
  /** @type {Map<string, number>} */
  const df = new Map();
  const seen = new Set();
  const docs = documents.map(doc => {
    const key = canonicalKey(doc);
    if (seen.has(key)) throw new TypeError("duplicate_document");
    seen.add(key);
    const tokens = termFrequencies(doc.text);
    for (const term of tokens.frequencies.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    return { ...doc, ...tokens };
  });
  const N = docs.length, totalLength = docs.reduce((sum, doc) => sum + doc.length, 0);
  /** @param {string} text @param {number} depth */
  function searchWithCount(text, depth = MAX_DEPTH) {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_DEPTH) throw new TypeError("invalid_depth");
    const terms = tokenizeT1(text), matches = [];
    for (const doc of docs) {
      const score = scoreBM25(terms, doc, { N, totalLength, df });
      if (score !== null) matches.push({ ...doc, score });
    }
    return {
      rows: rankScores(matches).slice(0, depth).map(({ text, length, frequencies, ...identity }) => identity),
      matched: matches.length,
    };
  }
  const index = { N, totalLength, avgLength: totalLength / (N || 1), df,
    searchWithCount,
    /** @param {string} text */
    search(text, depth = MAX_DEPTH) {
      return searchWithCount(text, depth).rows;
    },
  };
  // Keep the count method out of legacy callers' enumerable index statistics.
  return Object.defineProperty(index, "searchWithCount", { enumerable: false });
}
