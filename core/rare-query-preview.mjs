import { denseArray, fail } from './validation.mjs';

export const RARE_QUERY_WINDOW_VERSION = 'rare-query-window-v1';
const WORDS = /[\p{L}\p{N}]+/gu;
const WIDTH = 120;
const terms = text => new Set(Array.from(text.matchAll(WORDS), match => match[0].toLowerCase()));

// Pure ephemeral labels, independent of candidate ranking and rank-text packing.
// documents are already-authorized top memories: body, then up to four validated
// receipts in stable ID order. Each memory contributes at most once per term.
export function createRareQueryLabels(query) {
  if (typeof query !== 'string' || query.length > 4000) fail('invalid_input');
  const wanted = terms(query);
  return documents => {
    denseArray(documents, 0, 1024);
    const frequency = new Map();
    for (const sources of documents) {
      denseArray(sources, 1, 5);
      const present = new Set();
      for (const source of sources) {
        if (typeof source !== 'string' || source.length > 4000) fail('invalid_input');
        for (const word of terms(source)) if (wanted.has(word)) present.add(word);
      }
      for (const word of present) frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
    const weights = new Map([...frequency].map(([word, df]) => [word, documents.length + 1 - df]));
    return documents.map(sources => {
      let best = { label: [...sources[0]].slice(0, WIDTH).join(''), score: 0 };
      for (const source of sources) {
        const current = weightedWindow(source, weights);
        if (current.score > best.score) best = current;
      }
      return best.label;
    });
  };
}

function weightedWindow(content, weights) {
  const points = [...content];
  const width = Math.min(WIDTH, points.length);
  const offsets = new Uint32Array(content.length + 1);
  let offset = 0;
  for (let index = 0; index < points.length; index++) {
    offsets[offset] = index;
    offset += points[index].length;
  }
  offsets[offset] = points.length;
  const matches = [];
  for (const match of content.matchAll(WORDS)) {
    const word = match[0].toLowerCase();
    const start = offsets[match.index], end = offsets[match.index + match[0].length];
    if (weights.has(word) && end - start <= width) matches.push({ word, start, end });
  }
  const counts = new Map();
  let added = 0, removed = 0, score = 0, bestScore = 0, bestStart = 0;
  for (let start = 0; start <= points.length - width; start++) {
    while (added < matches.length && matches[added].end <= start + width) {
      const { word } = matches[added++];
      const previous = counts.get(word) ?? 0;
      if (previous === 0) score += weights.get(word);
      counts.set(word, previous + 1);
    }
    while (removed < added && matches[removed].start < start) {
      const { word } = matches[removed++];
      const count = counts.get(word) - 1;
      counts.set(word, count);
      if (count === 0) score -= weights.get(word);
    }
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  return { label: points.slice(bestStart, bestStart + width).join(''), score: bestScore };
}
