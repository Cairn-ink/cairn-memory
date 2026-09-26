import { fail } from './validation.mjs';

export const QUERY_CANDIDATE_VERSION = 'literal-current-memory-overlap-v2';
export const QUERY_SCAN_LIMIT = 1024;
export const SOURCE_QUERY_CANDIDATE_VERSION = 'literal-current-memory-source-overlap-v1';
export const SOURCE_QUERY_RECEIPT_LIMIT = 4;
export const BOUNDED_KEYSET_SOURCE_CANDIDATES = Object.freeze({
  version: 'bounded-keyset-v1', scan: 20_000, page: 256, top: 1_024,
  sourceReceiptLimit: SOURCE_QUERY_RECEIPT_LIMIT,
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
