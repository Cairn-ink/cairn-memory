const hanDigits = '零一二三四五六七八九';
const digits = '0-9' + hanDigits + '〇兩两';
const hanUnits = '十百千萬万億亿';
const hyphen = '[-‐‑‒–—―−]';
const figureHead = '[' + digits + hanUnits + ']';
const currencyPrefix = String.raw`(\bnt\$|\p{Sc}|\busd)[ \t]*(?:(?:\+|${hyphen})[ \t]*)?`;
const figureStarts = new RegExp(String.raw`(?:${currencyPrefix}(?=${figureHead}|\.[0-9])|` +
  String.raw`(\bv(?:ersion[ \t]+)?)(?=[0-9])|(?=${figureHead}|(?<![a-z0-9_.])\.[0-9]))`, 'gu');
const integer = new RegExp(String.raw`[0-9]{1,3}(?:,[0-9]{3}(?![0-9]))+|[${digits}]+`, 'y');
const fraction = new RegExp('[' + digits + ']+', 'y');
const dottedPart = /\.[0-9]+/y;
const scaleSuffix = /(?:[ \t]*(thousand|million|billion|bn)(?![a-z0-9_])|(k|m)(?=(\p{L})?))/uy;
const scales = new Map([['k', 3], ['thousand', 3], ['million', 6], ['m', 6], ['billion', 9], ['bn', 9]]);

const ones = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const wordValues = new Map([
  ...['zero', ...ones, ...teens].map((word, value) => /** @type {const} */ ([word, value])),
  ...tens.map((word, index) => /** @type {const} */ ([word, (index + 2) * 10])),
  ['a', 1],
]);
const wordGap = '(?:[ \t]+|' + hyphen + ')';
const under100 = '(?:' + tens.join('|') + ')(?:' + wordGap + '(?:' + ones.join('|') + '))?|' + [...ones, ...teens].join('|');
const under1000 = '(?:(?:' + ones.join('|') + '|a)' + wordGap + 'hundred(?:' + wordGap +
  '(?:and' + wordGap + ')?(?:' + under100 + '))?|' + under100 + ')';
let wordAmount = under1000;
for (const scale of ['thousand', 'million', 'billion|bn']) {
  wordAmount = '(?:(?:' + under1000 + '|a)' + wordGap + '(?:' + scale + ')(?:' + wordGap +
    '(?:and' + wordGap + ')?' + wordAmount + ')?|' + wordAmount + ')';
}
const words = new RegExp('\\b(?:' + wordAmount + '|zero)\\b', 'gu');
const wordSeparators = new RegExp('[ \t]+|' + hyphen, 'u');

const lowUnits = new Map([['千', 3], ['百', 2], ['十', 1]]);
const cents = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false });
// Capture admits 20,000 UTF-16 units. NFKC can expand each unit up to 18-fold.
const maxReceiptLength = 20_000 * 18;
const maxCombiningRunLength = 20_000;

/** @param {number} value */
export function roundReceiptNumber(value) {
  const magnitude = Math.abs(value);
  return Number.isInteger(magnitude) ? magnitude : Number(cents.format(magnitude));
}

/** @param {string} text */
function decimalDigits(text) {
  return text.replace(/[,〇兩两零一二三四五六七八九]/gu, char => {
    if (char === ',') return '';
    if (char === '〇') return '0';
    if (char === '兩' || char === '两') return '2';
    return String(hanDigits.indexOf(char));
  });
}

/** @param {string} text @param {number} start */
function readCoefficient(text, start) {
  integer.lastIndex = start;
  const whole = integer.exec(text)?.[0] ?? '';
  let end = start + whole.length;
  const point = text[end];
  let decimals = '';
  if (point === '.' || point === '點' || point === '点') {
    fraction.lastIndex = end + 1;
    decimals = fraction.exec(text)?.[0] ?? '';
    if (decimals) end = fraction.lastIndex;
  }
  return whole || decimals ? { whole, decimals, end } : null;
}

/** @typedef {{ digits: string, exponent: number }} DecimalTerm */

/** @param {NonNullable<ReturnType<typeof readCoefficient>>} coefficient @param {number} power @returns {DecimalTerm} */
function decimalTerm({ whole, decimals }, power) {
  return { digits: decimalDigits(whole + decimals), exponent: power - decimals.length };
}

/** @param {DecimalTerm[]} terms @param {number} start @param {number} power */
function shiftSection(terms, start, power) {
  for (let i = start; i < terms.length; i++) terms[i].exponent += power;
}

/** @param {DecimalTerm[]} terms */
function sumTerms(terms) {
  if (!terms.length) return NaN;
  if (terms.length === 1) {
    const [{ digits, exponent }] = terms;
    return Number(digits + 'e' + exponent);
  }
  // Align the decimal terms before summing. The grammar bounds the number of terms.
  let lowest = Infinity;
  let highest = -Infinity;
  for (const { digits, exponent } of terms) {
    lowest = Math.min(lowest, exponent);
    highest = Math.max(highest, exponent + digits.length);
  }
  const columns = new Uint8Array(highest - lowest + 2);
  for (const { digits, exponent } of terms) {
    const offset = exponent - lowest;
    for (let i = 0; i < digits.length; i++) {
      columns[offset + i] += digits.charCodeAt(digits.length - i - 1) - 48;
    }
  }
  let carry = 0;
  for (let i = 0; i < columns.length; i++) {
    carry += columns[i];
    columns[i] = 48 + carry % 10;
    carry = Math.floor(carry / 10);
  }
  // Decode the summed digits in most-significant-first order without spreading.
  const digits = new TextDecoder().decode(columns.reverse());
  return Number(digits + 'e' + lowest);
}

/** @param {string} text @param {number} start @param {ReturnType<typeof readCoefficient>} coefficient */
function readHanAmount(text, start, coefficient) {
  /** @type {DecimalTerm[]} */
  const terms = [];
  let end = coefficient?.end ?? start;
  let sectionStart = 0;
  let lastLow = Infinity;
  let seenWan = false;
  let seenYi = false;
  let valid = true;
  while (end < text.length && hanUnits.includes(text[end])) {
    const unit = text[end];
    const low = lowUnits.get(unit);
    if (valid && low !== undefined) {
      const placeholder = coefficient && !coefficient.decimals && /^[零〇]+$/u.test(coefficient.whole);
      const implicitOne = low === 1 || (lastLow === Infinity && /[萬万億亿]/u.test(text[end + 1] ?? ''));
      if (low >= lastLow || ((!coefficient || placeholder) && !implicitOne)) {
        valid = false;
      } else {
        terms.push(coefficient && !placeholder ? decimalTerm(coefficient, low) : { digits: '1', exponent: low });
        lastLow = low;
      }
    } else if (valid) {
      if (coefficient) terms.push(decimalTerm(coefficient, 0));
      if (unit === '萬' || unit === '万') {
        valid = !seenWan && terms.length > sectionStart;
        if (valid) shiftSection(terms, sectionStart, 4);
        seenWan = true;
      } else {
        valid = !seenYi && terms.length > 0;
        if (valid) shiftSection(terms, 0, 8);
        seenYi = true;
        seenWan = false;
      }
      sectionStart = terms.length;
      lastLow = Infinity;
    }
    end++;
    coefficient = readCoefficient(text, end);
    end = coefficient?.end ?? end;
  }
  if (valid && coefficient) terms.push(decimalTerm(coefficient, 0));
  return { end, terms: valid ? terms : [] };
}

/** @param {string} text */
function readWordAmount(text) {
  let total = 0;
  let section = 0;
  for (const word of text.split(wordSeparators)) {
    const scale = scales.get(word);
    if (scale !== undefined) {
      total += section * 10 ** scale;
      section = 0;
    } else if (word === 'hundred') {
      section *= 100;
    } else {
      section += wordValues.get(word) ?? 0;
    }
  }
  return total + section;
}

/** @param {Set<number>} values @param {number} value */
function addReading(values, value) {
  if (Number.isFinite(value)) values.add(roundReceiptNumber(value));
}

/** Read explicit number magnitudes from one receipt, rounded to two decimal places. @param {string} content */
export function readReceiptNumbers(content) {
  /** @type {Set<number>} */
  const values = new Set();
  if (content.length > maxReceiptLength) return values;
  // Canonical reordering works on decomposed marks. Include the halfwidth
  // voiced marks in each run and count marks that decompose into two as two.
  for (const [marks] of content.matchAll(/[\p{M}\uff9e\uff9f]+/gu)) {
    const extraMarks = marks.match(/[\u0344\u0f73\u0f75\u0f81]/gu)?.length ?? 0;
    if (marks.length + extraMarks > maxCombiningRunLength) return values;
  }
  const text = content.normalize('NFKC').toLowerCase();
  figureStarts.lastIndex = 0;
  let figure;
  while ((figure = figureStarts.exec(text))) {
    const [, currency, version] = figure;
    const start = figureStarts.lastIndex;
    const coefficient = readCoefficient(text, start);
    if (coefficient?.decimals && /^[0-9]+$/u.test(coefficient.decimals) &&
        text[coefficient.end - coefficient.decimals.length - 1] === '.') {
      const next = text[coefficient.end + 1];
      if (version || (text[coefficient.end] === '.' && next >= '0' && next <= '9')) {
        addReading(values, Number(decimalDigits(coefficient.whole)));
        addReading(values, Number(coefficient.decimals));
        dottedPart.lastIndex = coefficient.end;
        let end = coefficient.end;
        let part;
        while ((part = dottedPart.exec(text))) {
          addReading(values, Number(part[0].slice(1)));
          end = dottedPart.lastIndex;
        }
        figureStarts.lastIndex = end;
        continue;
      }
    }
    const { end, terms } = readHanAmount(text, start, coefficient);
    scaleSuffix.lastIndex = end;
    const [, wordScale, shortScale, followingLetter] = scaleSuffix.exec(text) ?? [];
    const scale = shortScale === 'm' && !currency ? 0 : scales.get(wordScale ?? shortScale ?? '') ?? 0;
    if (scale) {
      if (followingLetter) addReading(values, sumTerms(terms));
      shiftSection(terms, 0, scale);
    }
    addReading(values, sumTerms(terms));
    figureStarts.lastIndex = scale ? scaleSuffix.lastIndex : end;
  }
  for (const [amount] of text.matchAll(words)) values.add(readWordAmount(amount));
  return values;
}
