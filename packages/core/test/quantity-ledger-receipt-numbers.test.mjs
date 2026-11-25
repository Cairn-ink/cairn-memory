import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readReceiptNumbers, roundReceiptNumber } from '../src/ledger/receipt-numbers.mjs';

const examples = [
  ['３０００', 3000], ['10,000', 10_000], ['8.53', 8.53],
  ['$8', 8], ['NT$8', 8], ['-NT$8', -8], ['¥8', 8], ['8元', 8], ['8USD', 8],
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
  assert.deepEqual([...readReceiptNumbers('NT$8.534 and -¥1.005')], [8.53, -1.01]);
  assert.ok(readReceiptNumbers('$8.534').has(roundReceiptNumber(8.529)));
});

test('only a currency amount takes the attached m suffix', () => {
  for (const text of ['4.2m', '4.2 m', '$4.2 m', '$4.2mm']) assert.deepEqual([...readReceiptNumbers(text)], [4.2], text);
  assert.deepEqual([...readReceiptNumbers('$4.2km')], [4.2]);
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
