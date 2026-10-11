import { fail } from './validation.mjs';

export const QUERY_CANDIDATE_VERSION = 'literal-current-memory-overlap-v2';
export const QUERY_SCAN_LIMIT = 1024;
export const SOURCE_QUERY_CANDIDATE_VERSION = 'literal-current-memory-source-overlap-v1';
export const SOURCE_QUERY_RECEIPT_LIMIT = 4;
export const BOUNDED_KEYSET_SOURCE_CANDIDATES = Object.freeze({
  version: 'bounded-keyset-v1', scan: 20_000, page: 256, top: 1_024,
  sourceReceiptLimit: SOURCE_QUERY_RECEIPT_LIMIT,
});
export const MOC_PRIOR_SOURCE_CANDIDATES = Object.freeze({
  ...BOUNDED_KEYSET_SOURCE_CANDIDATES, version: 'moc-prior-keyset-v1',
  topics: 64, titleBindings: 64, priorTopics: 2, priorMembers: 3,
  lexicalBatch: 2, priorBatch: 1,
});

// Only reorder the already eligible rows; hints cannot add a candidate or text.
export function mixMocPriorCandidates(rows, prior) {
  if (!prior.length) return rows;
  const id = row => row.item.type === 'ref' ? row.item.ref.childId : row.item.ref.memoryId;
  const eligible = new Map(rows.map(row => [id(row), row]));
  const queue = prior.map(row => eligible.get(id(row))).filter(Boolean);
  if (!queue.length) return rows;
  const seen = new Set(), mixed = [];
  let lexical = 0, hinted = 0;
  const emit = row => { if (!seen.has(id(row))) { seen.add(id(row)); mixed.push(row); return true; } return false; };
  while (hinted < queue.length) {
    let used = 0;
    while (lexical < rows.length && used < MOC_PRIOR_SOURCE_CANDIDATES.lexicalBatch) {
      if (emit(rows[lexical++])) used++;
    }
    while (hinted < queue.length) if (emit(queue[hinted++])) break;
  }
  while (lexical < rows.length) emit(rows[lexical++]);
  return mixed;
}
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
