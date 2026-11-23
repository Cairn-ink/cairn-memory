import { tokenizeT1 } from "../retrieval/tokenize.mjs";

const VECTOR_THRESHOLD = 0.35;
const LEXICAL_THRESHOLD = 0.5;

/** @param {import("./index.mjs").DocumentVector} left
 * @param {import("./index.mjs").DocumentVector | undefined} right
 */
function cosine(left, right) {
  if (!right || left.length !== right.length) return NaN;
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i];
    const b = right[i];
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  const denominator = Math.sqrt(normLeft) * Math.sqrt(normRight);
  return denominator > 0 && Number.isFinite(denominator)
    ? Math.max(-1, Math.min(1, dot / denominator)) : NaN;
}

/** @param {Set<string>} queryTerms @param {import("./index.mjs").DocumentCard} card */
function lexicalCoverage(queryTerms, card) {
  if (!queryTerms.size) return 0;
  const terms = new Set(tokenizeT1(`${card.title}\n${card.body}`));
  let matches = 0;
  for (const term of queryTerms) {
    if (terms.has(term)) matches++;
  }
  return matches / queryTerms.size;
}

/** @param {string} query
 * @param {readonly import("./index.mjs").DocumentCard[]} cards
 * @param {import("./index.mjs").DocumentRankingOptions} [options]
 * @returns {import("./index.mjs").DocumentCardMatch | null}
 */
export function rankDocumentCards(query, cards, { queryVector, cardVectors } = {}) {
  const semantic = queryVector !== undefined && cardVectors !== undefined;
  const threshold = semantic ? VECTOR_THRESHOLD : LEXICAL_THRESHOLD;
  const terms = semantic ? new Set() : new Set(tokenizeT1(query));
  /** @type {import("./index.mjs").DocumentCardMatch | null} */
  let best = null;
  for (const card of cards) {
    const score = semantic ? cosine(queryVector, cardVectors.get(card.id)) : lexicalCoverage(terms, card);
    if (score >= threshold && (!best || score > best.score)) {
      best = { card, score, method: semantic ? "vector" : "lexical" };
    }
  }
  return best;
}
