/** Frozen HR-1 T1, ported from evaluation/retrieval-research/lib/tokenize.mjs.
 * No stemming or Han-unigram fallback: query 中 intentionally misses 中文.
 * Version changes require a new sidecar representation, never an in-place edit.
 */
export const TOKENIZER_VERSION = 'hr1-t1-v1';
export const REPRESENTATION_VERSION = 'candidate-text-v1';
const stopwords = new Set(('a an and are as at be been being but by can could did do does doing for from had has have ' +
  'he her hers him his how i if in into is it its me my no nor not of on or our ours she so than that the their ' +
  'theirs them then there these they this those to too us was we were what when where which who why will with would you your yours').split(' '));
for (const method of ['add', 'delete', 'clear']) Object.defineProperty(stopwords, method, {
  value() { throw new TypeError('frozen_stopwords'); }, enumerable: false,
});
export const ENGLISH_STOPWORDS = Object.freeze(stopwords);

export function tokenizeT1(text) {
  const result = [];
  const flush = (run, han) => {
    if (!run.length) return;
    if (han) {
      if (run.length === 1) result.push(...run);
      for (let i = 0; i + 1 < run.length; i++) result.push(run[i] + run[i + 1]);
    } else {
      const word = run.join('');
      if (!stopwords.has(word)) result.push(word);
    }
  };
  let run = [], previous;
  for (const c of text.normalize('NFKC').toLowerCase()) {
    const han = /\p{Script=Han}/u.test(c);
    if (!/[\p{L}\p{N}]/u.test(c)) { flush(run, previous); run = []; previous = undefined; continue; }
    if (run.length && han !== previous) { flush(run, previous); run = []; }
    run.push(c); previous = han;
  }
  flush(run, previous);
  return result;
}

export function termFrequencies(text) {
  const tokens = tokenizeT1(text), frequencies = new Map();
  for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  return { length: tokens.length, frequencies };
}
