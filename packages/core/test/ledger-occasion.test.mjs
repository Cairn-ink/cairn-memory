import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLedgerOccasion } from '../src/ledger/occasion.mjs';

for (const message of [
  'I just spent 7.5 on tea this morning, part of my daily routine',
  'Paid 12 for lunch',
  '走了 9000 步',
  'ＰＡＩＤ １２ for lunch',
]) {
  test(`recognizes an occasion in ${message}`, () => {
    assert.equal(isLedgerOccasion(message), true);
  });
}

for (const message of [
  'I usually spend about 8 a day on tea',
  'my daily budget is 50',
  'I spend 20monthly on streaming',
  '8/day on snacks',
  '平均每天花 50',
  'I spend 8 on tea',
  'I paid 20monthly for streaming',
  'I paid 8／day for snacks',
  'I paid 4perweek for storage',
  'I paid 8 each weekday',
  'I reached my weekly goal of 50',
  'I usually bought tea for 8',
  '我每天走了 9000 步',
  'I prepaid 12 for lunch',
  'Pagué 12 por el almuerzo',
]) {
  test(`rejects an occasion in ${message}`, () => {
    assert.equal(isLedgerOccasion(message), false);
  });
}
