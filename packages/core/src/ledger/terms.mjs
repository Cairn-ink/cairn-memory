/** @type {ReadonlyArray<readonly [RegExp, string]>} */
const aliases = [
  [/咖啡/u, 'coffee'], [/午餐/u, 'lunch'], [/早餐/u, 'breakfast'], [/晚餐/u, 'dinner'],
  [/飲食|餐費/u, 'food'], [/花費|花了|花多少|開銷|支出/u, 'spend'],
  [/步數|步行|(?:幾|多少)步|走[^。，！？]{0,8}步/u, 'steps'],
  [/睡眠|睡了/u, 'sleep'], [/體重/u, 'weight'], [/距離|公里/u, 'distance'],
  [/交通/u, 'transport'], [/房租/u, 'housing'], [/購物/u, 'shopping'], [/帳單/u, 'bills'],
  [/健康/u, 'health'], [/運動/u, 'fitness'], [/娛樂/u, 'entertainment'], [/工作/u, 'work'],
];

const cues = /\b(?:total|how much|how many|spent|spend(?:ing)?|budget|goal|average|most|least|over|under|met)\b|花|元|步|預算|目標|總共|多少|平均|最多|超過/iu;

/** @param {string} query */
export const hasLedgerCue = query => cues.test(query.normalize('NFKC'));

/** @param {string} text */
const words = text => text.normalize('NFKC').toLowerCase().match(/[a-z]+/g) ?? [];

/** @param {string} query @param {readonly string[]} terms */
export function readIntent(query, terms) {
  const text = query.normalize('NFKC');
  if (!cues.test(text)) return false;
  const vocabulary = new Set(terms.flatMap(words));
  return words(text).some(word => {
    if (vocabulary.has(word)) return true;
    for (let length = 4; length < word.length; length++) {
      if (vocabulary.has(word.slice(0, length))) return true;
    }
    return false;
  }) || aliases.some(([pattern, term]) => vocabulary.has(term) && pattern.test(text));
}

/** @param {string} text */
function attributionPhrase(text) {
  return (text.normalize('NFKC').toLowerCase().match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}])+|\p{N}+/gu) ?? []).join(' ');
}

/** @param {string} text @param {readonly string[]} terms */
export function receiptMatchesTerms(text, terms) {
  const phrase = ' ' + attributionPhrase(text) + ' ';
  return terms.map(attributionPhrase).some(term => term !== '' && (
    phrase.includes(' ' + term + ' ') || phrase.includes(' ' + term + 's ') || phrase.includes(' ' + term + 'es ') ||
    aliases.some(([pattern, alias]) => alias === term && pattern.test(text))
  ));
}
