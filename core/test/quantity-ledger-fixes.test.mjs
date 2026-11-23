import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, parseWindow, rowsFrom } from '../quantity-ledger.mjs';

const asOf = '2026-03-18T12:00:00.000Z';
const sleep = { item: 0, kind: 'record', measure: 'sleep_hours', value: 10, unit: 'hours',
  group: 'health', category: 'sleep', period: 'none', comparator: 'none' };
const goal = (comparator, value) => ({ ...sleep, kind: 'goal', period: 'day', comparator, value });

test('a sleep goal retains both bounds when only one is met', () => {
  const records = rowsFrom({ id: 'night' }, 1, sleep, asOf);
  const goals = [goal('at_least', 6), goal('at_most', 9)]
    .flatMap(quantity => rowsFrom({ id: 'target' }, 1, quantity, asOf));
  const { body } = digest(records, goals, parseWindow('today', asOf));
  assert.match(body, /goal 6 hours per day: actual 10 hours per day, goal met/);
  assert.match(body, /goal 9 hours per day: actual 10 hours per day, goal missed, over by 1 hours/);
});

test('both kinds of goal report an empty window without judging it', () => {
  const records = rowsFrom({ id: 'night' }, 1, sleep, '2026-03-17T12:00:00.000Z');
  const goals = [goal('at_least', 6), goal('at_most', 9)]
    .flatMap(quantity => rowsFrom({ id: 'target' }, 1, quantity, '2026-03-16T12:00:00.000Z'));
  const { body, sources } = digest(records, goals, parseWindow('today', asOf));
  assert.match(body, /goal 6 hours per day: no records in this window/);
  assert.match(body, /goal 9 hours per day: no records in this window/);
  assert.doesNotMatch(body, /actual|goal met|goal missed|over by|under by/);
  assert.deepEqual(sources, ['target']);
});
