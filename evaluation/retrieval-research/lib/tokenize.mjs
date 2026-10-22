/** Frozen HR-1 tokenizer v1 (before fixture freeze).
 * NFKC → Unicode lowercase. Han = Unicode Script=Han; any transition between
 * Han and non-Han L/N starts a new run. All other code points (including marks,
 * punctuation, underscore, emoji and whitespace) delimit runs. Kana, Hangul,
 * Latin, digits, etc. remain together in a non-Han L/N run; stemming applies
 * only to ASCII English [a-z]+. No dictionary or query-dependent segmentation.
 * T1('ＡＢＣ資料庫x') = ['abc','資料','料庫','x']; T1('中') = ['中'];
 * T1+('資料庫 running') = ['資','料','庫','資料','料庫','run'].
 * Stopwords: explicit small English function-word list below, removed before
 * stemming in both variants. No external or mutable stopword dependency.
 */
const stopwords = new Set(('a an and are as at be been being but by can could did do does doing for from had has have ' +
  'he her hers him his how i if in into is it its me my no nor not of on or our ours she so than that the their ' +
  'theirs them then there these they this those to too us was we were what when where which who why will with would you your yours').split(' '));
for (const method of ['add', 'delete', 'clear']) Object.defineProperty(stopwords, method, {
  value() { throw new TypeError('frozen_stopwords'); }, enumerable: false,
});
export const ENGLISH_STOPWORDS = Object.freeze(stopwords);

// Exact core createQueryScore tokenization: deliberately NO NFKC here.
export function wholeRuns(text) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => match[0].toLowerCase());
}

// Original implementation of classic Porter (1980), steps 1a–5b, not Porter2.
// y is a consonant initially, then alternates according to the preceding sound.
export function porterStem(input) {
  let w = input.toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length <= 2) return w;
  const consonant = (s, i) => !'aeiou'.includes(s[i]) && (s[i] !== 'y' || i === 0 || !consonant(s, i - 1));
  const measure = s => {
    let m = 0, vowelSeen = false;
    for (let i = 0; i < s.length; i++) {
      if (!consonant(s, i)) vowelSeen = true;
      else if (vowelSeen) { m++; vowelSeen = false; }
    }
    return m;
  };
  const vowel = s => [...s].some((_, i) => !consonant(s, i));
  const double = s => s.length > 1 && s.at(-1) === s.at(-2) && consonant(s, s.length - 1);
  const cvc = s => s.length >= 3 && consonant(s, s.length - 3) && !consonant(s, s.length - 2) &&
    consonant(s, s.length - 1) && !'wxy'.includes(s.at(-1));
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies')) w = w.slice(0, -2);
  else if (!w.endsWith('ss') && w.endsWith('s')) w = w.slice(0, -1);
  if (w.endsWith('eed')) {
    if (measure(w.slice(0, -3)) > 0) w = w.slice(0, -1);
  } else {
    const suffix = w.endsWith('ed') ? 'ed' : w.endsWith('ing') ? 'ing' : null;
    if (suffix && vowel(w.slice(0, -suffix.length))) {
      w = w.slice(0, -suffix.length);
      if (/(at|bl|iz)$/.test(w)) w += 'e';
      else if (double(w) && !'lsz'.includes(w.at(-1))) w = w.slice(0, -1);
      else if (measure(w) === 1 && cvc(w)) w += 'e';
    }
  }
  if (w.endsWith('y') && vowel(w.slice(0, -1))) w = w.slice(0, -1) + 'i';
  const replace = (pairs, min) => {
    for (const [suffix, replacement] of pairs) {
      if (!w.endsWith(suffix)) continue;
      const stem = w.slice(0, -suffix.length);
      if (measure(stem) > min) w = stem + replacement;
      break;
    }
  };
  replace([['ational','ate'],['tional','tion'],['enci','ence'],['anci','ance'],['izer','ize'],
    ['abli','able'],['alli','al'],['entli','ent'],['eli','e'],['ousli','ous'],['ization','ize'],
    ['ation','ate'],['ator','ate'],['alism','al'],['iveness','ive'],['fulness','ful'],['ousness','ous'],
    ['aliti','al'],['iviti','ive'],['biliti','ble']], 0);
  replace([['icate','ic'],['ative',''],['alize','al'],['iciti','ic'],['ical','ic'],['ful',''],['ness','']], 0);
  const step4 = ['al','ance','ence','er','ic','able','ible','ant','ement','ment','ent','ion','ou','ism','ate','iti','ous','ive','ize'];
  for (const suffix of step4) {
    if (!w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    if (measure(stem) > 1 && (suffix !== 'ion' || /[st]$/.test(stem))) w = stem;
    break;
  }
  if (w.endsWith('e')) {
    const stem = w.slice(0, -1), m = measure(stem);
    if (m > 1 || m === 1 && !cvc(stem)) w = stem;
  }
  if (w.endsWith('ll') && measure(w) > 1) w = w.slice(0, -1);
  return w;
}

function tokenize(text, plus) {
  const result = [];
  const flush = (run, han) => {
    if (!run.length) return;
    if (han) {
      if (plus || run.length === 1) result.push(...run);
      for (let i = 0; i + 1 < run.length; i++) result.push(run[i] + run[i + 1]);
    } else {
      const word = run.join('');
      if (!ENGLISH_STOPWORDS.has(word)) result.push(plus ? porterStem(word) : word);
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
export const tokenizeT1 = text => tokenize(text, false);
export const tokenizeT1Plus = text => tokenize(text, true);
