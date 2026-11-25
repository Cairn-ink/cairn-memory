const decimal = String.raw`(?:(?:[0-9]{1,3}(?:,[0-9]{3})+(?![0-9])|[0-9]+)(?:\.[0-9]+)?|\.[0-9]+)`;
const hanDigits = '零一二三四五六七八九';
const hanUnits = '十百千萬万億亿';
const hanFigure = `[${hanDigits}〇兩两${hanUnits}]`;
const figures = new RegExp(String.raw`((?<![0-9])[+−-])?(?:(\bNT\$|\p{Sc}|\bUSD)[ \t]*([+−-])?)?` +
  String.raw`((?:${decimal}|${hanFigure})+)(?:(?:[ \t]*(thousand|million|billion|bn)|(k|m))(?![a-z0-9_]))?`, 'giu');
const decimalOnly = new RegExp(`^${decimal}$`, 'u');
const scales = new Map([['k', 1e3], ['thousand', 1e3], ['million', 1e6], ['m', 1e6], ['billion', 1e9], ['bn', 1e9]]);

const ones = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const wordValues = new Map([
  ...['zero', ...ones, ...teens].map((word, value) => /** @type {const} */ ([word, value])),
  ...tens.map((word, index) => /** @type {const} */ ([word, (index + 2) * 10])),
  ['a', 1],
]);
const under100 = `(?:${tens.join('|')})(?:(?:-|[ \t]+)(?:${ones.join('|')}))?|${[...ones, ...teens].join('|')}`;
const under1000 = `(?:(?:${ones.join('|')}|a)[ \t]+hundred(?:[ \t]+(?:and[ \t]+)?(?:${under100}))?|${under100})`;
let wordAmount = under1000;
for (const scale of ['thousand', 'million', 'billion|bn']) {
  wordAmount = `(?:(?:${under1000}|a)[ \t]+(?:${scale})(?:[ \t]+(?:and[ \t]+)?${wordAmount})?|${wordAmount})`;
}
const words = new RegExp(`\\b(?:${wordAmount}|zero)\\b`, 'giu');

const lowUnits = new Map([['千', 1e3], ['百', 1e2], ['十', 10]]);
const highUnits = new Map([['亿', 1e8], ['万', 1e4]]);
const cents = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false });

/** @param {number} value */
export function roundReceiptNumber(value) {
  return Number(cents.format(value));
}

/** @param {string} text */
function readDecimal(text) {
  return decimalOnly.test(text) ? Number(text.replaceAll(',', '')) : NaN;
}

/** @param {string} text @param {boolean} beforeScale */
function readHanSection(text, beforeScale) {
  const parts = text.split(/([千百十])/u);
  let lastUnit = Infinity;
  let value = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const unit = lowUnits.get(parts[i]) ?? 0;
    const implicitOne = i === 1 && (unit === 10 || (beforeScale && parts.length === 3 && !parts[2]));
    const coefficient = parts[i - 1] === '' && implicitOne ? 1 : readDecimal(parts[i - 1]);
    if (unit >= lastUnit || !(coefficient > 0)) return NaN;
    value += coefficient * unit;
    lastUnit = unit;
  }
  const tail = parts.at(-1) ?? '';
  return value + (tail ? readDecimal(tail) : 0);
}

/** @param {string} text */
function readHanAmount(text) {
  const normalized = text.replace(/[〇零一二兩两三四五六七八九萬億]/gu, char => {
    if (char === '萬') return '万';
    if (char === '億') return '亿';
    if (char === '〇') return '0';
    if (char === '兩' || char === '两') return '2';
    return String(hanDigits.indexOf(char));
  });
  const parts = normalized.split(/([亿万])/u);
  let lastUnit = Infinity;
  let value = 0;
  for (let i = 1; i < parts.length; i += 2) {
    const unit = highUnits.get(parts[i]) ?? 0;
    const section = readHanSection(parts[i - 1], true);
    if (unit >= lastUnit || !(section > 0)) return NaN;
    value += section * unit;
    lastUnit = unit;
  }
  return value + readHanSection(parts.at(-1) ?? '', false);
}

/** @param {string} text */
function readWordAmount(text) {
  let total = 0;
  let section = 0;
  for (const word of text.split(/[- \t]+/u)) {
    const scale = scales.get(word);
    if (scale) {
      total += section * scale;
      section = 0;
    } else if (word === 'hundred') {
      section *= 100;
    } else {
      section += wordValues.get(word) ?? 0;
    }
  }
  return total + section;
}

/** Read explicit numbers from one receipt, rounded to two decimal places. @param {string} content */
export function readReceiptNumbers(content) {
  const text = content.normalize('NFKC').toLowerCase();
  const values = new Set();
  for (const [, sign, currency, currencySign, amount, wordScale, shortScale] of text.matchAll(figures)) {
    const scale = scales.get(wordScale ?? shortScale);
    const decimalValue = readDecimal(amount);
    const value = Number.isNaN(decimalValue) ? readHanAmount(amount)
      : decimalValue * (shortScale === 'm' && !currency ? 1 : scale ?? 1);
    if (Number.isFinite(value)) values.add(roundReceiptNumber(/^[−-]$/u.test(sign ?? currencySign) ? -value : value));
  }
  for (const [amount] of text.matchAll(words)) values.add(readWordAmount(amount));
  return values;
}
