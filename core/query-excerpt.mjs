import { fail } from './validation.mjs';

export const QUERY_EXCERPT_VERSION = 'literal-word-window-v1';
const WIDTH = 120;
const WORDS = /[\p{L}\p{N}]+/gu;

// Literal navigation only: maximal Unicode letter/number runs, lowercased
// without normalization, stemming or stopword removal. CJK runs are whole
// tokens, not dictionary-segmented words; substrings do not match. Existing
// admission/query validation has already normalized the contract's inputs.
// Distinct query tokens wholly inside each 120-code-point window score once.
// Earliest start wins ties; no overlap or a short body preserves the prefix.
// Tokenization and sliding pointers are linear in the bounded input lengths.
export function createQueryExcerpt(query) {
  if (typeof query !== 'string' || query.length > 4000) fail('invalid_input');
  const wanted = new Set(Array.from(query.matchAll(WORDS), (match) => match[0].toLowerCase()));
  return (content) => {
    if (typeof content !== 'string' || content.length > 4000) fail('invalid_input');
    const points = [...content];
    const prefix = points.slice(0, WIDTH).join('');
    if (points.length <= WIDTH || wanted.size === 0) return prefix;

    // Regex offsets are UTF-16; window bounds are original Unicode code points.
    const pointOffsets = new Uint32Array(content.length + 1);
    let offset = 0;
    for (let index = 0; index < points.length; index++) {
      pointOffsets[offset] = index;
      offset += points[index].length;
    }
    pointOffsets[offset] = points.length;
    const matches = [];
    for (const match of content.matchAll(WORDS)) {
      const word = match[0].toLowerCase();
      const start = pointOffsets[match.index];
      const end = pointOffsets[match.index + match[0].length];
      if (wanted.has(word) && end - start <= WIDTH) matches.push({ word, start, end });
    }
    if (matches.length === 0) return prefix;

    const counts = new Map();
    let added = 0;
    let removed = 0;
    let bestStart = 0;
    let bestScore = 0;
    for (let start = 0; start <= points.length - WIDTH; start++) {
      while (added < matches.length && matches[added].end <= start + WIDTH) {
        const { word } = matches[added++];
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
      while (removed < added && matches[removed].start < start) {
        const { word } = matches[removed++];
        const count = counts.get(word) - 1;
        if (count === 0) counts.delete(word);
        else counts.set(word, count);
      }
      if (counts.size > bestScore) {
        bestScore = counts.size;
        bestStart = start;
      }
    }
    return points.slice(bestStart, bestStart + WIDTH).join('');
  };
}
