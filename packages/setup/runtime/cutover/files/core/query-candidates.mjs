import { fail } from './validation.mjs';

export const QUERY_CANDIDATE_VERSION = 'literal-recency-keyset-overlap-v4';
export const SOURCE_QUERY_CANDIDATE_VERSION = 'literal-current-memory-source-overlap-v1';
export const SOURCE_QUERY_RECEIPT_LIMIT = 4;
export const QUERY_SCAN_BUDGET_MS = 300;
// QUERY_SCAN_BUDGET_MS bounds one recall call. A read set splits it evenly, so
// the added scan time stays within the call bound for every read-set size.
// Each namespace's newest-first floor always completes regardless.
export function namespaceScanBudgetMs(namespaceCount, totalMs = QUERY_SCAN_BUDGET_MS) {
  if (!Number.isSafeInteger(namespaceCount) || namespaceCount < 1 ||
      !Number.isSafeInteger(totalMs) || totalMs < 0) fail('invalid_input');
  return Math.floor(totalMs / namespaceCount);
}
export const QUERY_CANDIDATES = Object.freeze({
  scan: 20_000, page: 256, top: 1_024, floor: 1_024, pageMs: 25,
});
const WORDS = /[\p{L}\p{N}]+/gu;

// Score distinct whole Unicode runs, not frequency, substrings or synonyms.
export function createQueryScore(query) {
  if (typeof query !== 'string' || query.length > 4000) fail('invalid_input');
  const wanted = new Set(Array.from(query.matchAll(WORDS), (match) => match[0].toLowerCase()));
  return (content) => {
    if (typeof content !== 'string' || content.length > 4000) fail('invalid_input');
    const matched = new Set();
    for (const match of content.matchAll(WORDS)) {
      const word = match[0].toLowerCase();
      if (wanted.has(word)) matched.add(word);
    }
    return matched.size;
  };
}
