import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReceiptNumbers, roundReceiptNumber } from '../src/ledger/receipt-numbers.mjs';

const examples = [
  ['３０００', 3000], ['10,000', 10_000], ['8.53', 8.53],
  ['$8', 8], ['NT$8', 8], ['-NT$8', 8], ['¥8', 8], ['8元', 8], ['8USD', 8],
  ['3k', 3000], ['3K', 3000], ['12 thousand', 12_000],
  ['$4.2 million', 4_200_000], ['$4.2m', 4_200_000],
  ['4.2 billion', 4_200_000_000], ['4.2bn', 4_200_000_000],
  ['三千', 3000], ['3千', 3000], ['一萬兩千', 12_000], ['1.2萬', 12_000],
  ['兩百五十', 250], ['五十', 50], ['十二', 12], ['二万', 20_000],
  ['二億', 200_000_000], ['二亿', 200_000_000], ['百萬', 1_000_000],
  ['〇', 0], ['零', 0], ['二〇二六', 2026], ['一千零五', 1005],
  ['zero', 0], ['one', 1], ['nineteen', 19], ['twenty-five', 25], ['ninety nine', 99],
  ['two hundred', 200], ['a hundred', 100], ['a thousand', 1000],
  ['twelve thousand', 12_000], ['one million', 1_000_000],
  ['one million two hundred and twenty-five thousand six', 1_225_006],
];

test('receipt figures, scale words and Chinese numerals read as whole amounts', () => {
  for (const [text, value] of examples) assert.deepEqual([...readReceiptNumbers(text)], [value], text);
});

test('receipts and extracted values round to cents, including decimal ties', () => {
  assert.deepEqual([...readReceiptNumbers('NT$8.534 and -¥1.005')], [8.53, 1.01]);
  assert.ok(readReceiptNumbers('$8.534').has(roundReceiptNumber(8.529)));
});

test('only a currency amount takes the attached m suffix', () => {
  for (const text of ['4.2m', '4.2 m', '$4.2 m']) assert.deepEqual([...readReceiptNumbers(text)], [4.2], text);
  assert.deepEqual([...readReceiptNumbers('$4.2mm')], [4_200_000]);
  assert.deepEqual([...readReceiptNumbers('$4.2km')], [4200]);
});

test('plain prose, unequal amounts and computed totals do not ground records', () => {
  assert.deepEqual([...readReceiptNumbers('No, just the coffee.')], []);
  assert.equal(readReceiptNumbers('$8').has(roundReceiptNumber(9)), false);
  const coffeeNumbers = readReceiptNumbers('Two coffees at $4');
  assert.deepEqual([...coffeeNumbers].sort((a, b) => a - b), [2, 4]);
  assert.equal(coffeeNumbers.has(roundReceiptNumber(8)), false);
  assert.deepEqual([...readReceiptNumbers('twenty - five')], [20, 5]);
});

test('dates and times can ground records', () => {
  assert.deepEqual([...readReceiptNumbers('2026-11-25 at 08:53')], [2026, 11, 25, 8, 53]);
});

test('review probe: signs and range separators leave magnitudes', () => {
  for (const text of ['$3k-$5k', '3k–5k', '3k−5k']) {
    assert.deepEqual([...readReceiptNumbers(text)], [3000, 5000], text);
  }
  assert.deepEqual([...readReceiptNumbers('-$20 refund and NT$-30 fee')], [20, 30]);
  assert.equal(roundReceiptNumber(-20), roundReceiptNumber(20));
});

test('review probe: adjacent units preserve the scale of the whole amount', () => {
  for (const [text, value] of [
    ['3kUSD', 3000], ['3K元', 3000], ['6ksteps', 6000], ['$4.2mUSD', 4_200_000],
    ['4.2mUSD', 4.2], ['$4.2m元', 4_200_000], ['USD -4.2mUSD', 4_200_000],
  ]) {
    assert.deepEqual([...readReceiptNumbers(text)], [value], text);
  }
});

test('review probe: dotted dates and versions contribute integer components', () => {
  assert.deepEqual([...readReceiptNumbers('2026.11.25')], [2026, 11, 25]);
  assert.deepEqual([...readReceiptNumbers('Version 1.2.3 and v4.5-rc.6 cost $7.89.')], [1, 2, 3, 4, 5, 6, 7.89]);
  assert.deepEqual([...readReceiptNumbers('7, 1..2.3.4, 5.67')], [7, 1, 2, 3, 4, 5.67]);
});

test('review probe: each number-word hyphen joins the whole amount', () => {
  for (const hyphen of '-‐‑‒–—―−') {
    assert.deepEqual([...readReceiptNumbers(`twenty${hyphen}five`)], [25], hyphen);
    assert.deepEqual([...readReceiptNumbers(`two hundred and twenty${hyphen}five thousand six`)], [225_006], hyphen);
  }
});

test('review probe: Chinese sections, placeholders and mixed decimals read whole', () => {
  for (const [text, value] of [
    ['一萬零十二', 10_012], ['一万〇十二', 10_012], ['一千零十二', 1012], ['一萬億', 1_000_000_000_000],
    ['一万两千亿三万零四', 1_200_000_030_004], ['一億零一萬零兩', 100_010_002],
    ['十二', 12], ['十萬', 100_000], ['三點五萬', 35_000], ['三点五万', 35_000],
    ['3千', 3000], ['1.2萬', 12_000], ['3萬5千', 35_000], ['兩萬二千零五', 22_005],
    ['三點〇〇五', 3.01],
  ]) {
    assert.deepEqual([...readReceiptNumbers(text)], [value], text);
  }
  assert.deepEqual([...readReceiptNumbers('三萬萬 and 42')], [42]);
});

test('review probe: scaling rounds decimal ties exactly as their literals', () => {
  for (const [text, literal, rounded] of [
    ['1.000065k', 1000.065, 1000.07], ['.001005k', 1.005, 1.01],
    ['-1.000075K', 1000.075, 1000.08], ['$1.000000005m', 1_000_000.005, 1_000_000.01],
    ['0.000000001005bn', 1.005, 1.01], ['1.000065千', 1000.065, 1000.07],
    ['三萬5.005', 30_005.005, 30_005.01],
  ]) {
    assert.equal(roundReceiptNumber(literal), rounded, text);
    assert.deepEqual([...readReceiptNumbers(String(literal))], [rounded], text);
    assert.deepEqual([...readReceiptNumbers(text)], [rounded], text);
  }
});

test('review probe: millions of dotted components stay readable', () => {
  assert.deepEqual([...readReceiptNumbers('1.'.repeat(4_000_000))], [1]);
});

test('over-limit receipts yield no readings, including at the beginning', () => {
  assert.deepEqual([...readReceiptNumbers('42' + ' '.repeat(15_999_999))], []);
});
