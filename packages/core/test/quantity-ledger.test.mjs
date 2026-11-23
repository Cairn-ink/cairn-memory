import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertAdapterCapabilities, capabilities, OPTIONAL_PORTS } from '@cairn-ink/core';
import { digest, ledgerRowDeliverable, ledgerRowInRange, parseWindow, readIntent } from '@cairn-ink/core/ledger';

const at = date => Date.parse(date);
const record = (id, date, fields = {}) => ({
  memoryId: id, receiptId: 'receipt-' + id, date: typeof date === 'string' ? at(date) : date,
  ordinal: 0, kind: 'record', measure: 'spend', value: 6, unit: 'USD', group: 'food',
  category: 'coffee', period: 'none', comparator: 'none', ...fields,
});

test('the optional ledger port and capability must be configured together', () => {
  assert.equal(OPTIONAL_PORTS.quantityLedger, 'quantityLedger');
  const disabled = capabilities({});
  const enabled = capabilities({ quantityLedger: true });
  assert.equal(disabled.quantityLedger, false);
  assertAdapterCapabilities({ capabilities: disabled });
  assertAdapterCapabilities({ capabilities: enabled, quantityLedger: {} });
  for (const adapter of [{ capabilities: enabled }, { capabilities: disabled, quantityLedger: {} }]) {
    assert.throws(() => assertAdapterCapabilities(adapter), { code: 'capability_unavailable' });
  }
});

test('delivery requires positive current visibility and receipt retention for the same memory', () => {
  const row = record('memory', '2026-01-05');
  const retainedReceipts = new Map([[row.memoryId, new Set([row.receiptId])]]);
  const visibility = status => new Map([[row.memoryId, status]]);
  const memoryStates = visibility('current_visible');
  assert.equal(ledgerRowDeliverable(row, { memoryStates, retainedReceipts }), true);
  for (const state of ['forgotten', 'superseded', 'hidden', 'unknown']) {
    assert.equal(ledgerRowDeliverable(row, { memoryStates: visibility(state), retainedReceipts }), false, state);
  }
  for (const absent of [null, new Map()]) {
    assert.equal(ledgerRowDeliverable(row, { memoryStates: absent, retainedReceipts }), false);
    assert.equal(ledgerRowDeliverable(row, { memoryStates, retainedReceipts: absent }), false);
  }
  const retired = new Map([['other-memory', new Set([row.receiptId])], [row.memoryId, new Set(['replacement'])]]);
  assert.equal(ledgerRowDeliverable(row, { memoryStates, retainedReceipts: retired }), false);
});

test('intent needs a cue and matching terms, including count questions and CJK aliases', () => {
  const terms = ['coffee', 'spend', 'food', 'steps', 'sleep_hours'];
  assert.equal(readIntent('How many coffees today?', terms), true);
  assert.equal(readIntent('How many pencils?', terms), false);
  assert.equal(readIntent('How many coffees today?', []), false);
  assert.equal(readIntent('Coffee sounds good.', terms), false);
  assert.equal(readIntent('Total spending on food?', terms), true);
  assert.equal(readIntent('今天咖啡花了多少？', ['coffee']), true);
  assert.equal(readIntent('這週走了幾步？', ['steps']), true);
  assert.equal(readIntent('下一步要做什麼？', ['steps']), false);
  assert.equal(readIntent('What are the next steps?', ['steps']), false);
});

const asOf = at('2026-03-11T14:00:00Z');
for (const [query, from, to, label] of [
  ['Coffee spending', '2026-03-05', '2026-03-12', 'last 7 days'],
  ['today', '2026-03-11', '2026-03-12', 'today'],
  ['昨天', '2026-03-10', '2026-03-11', 'yesterday'],
  ['this week', '2026-03-09', '2026-03-12', 'this week'],
  ['本週', '2026-03-09', '2026-03-12', 'this week'],
  ['上週', '2026-03-02', '2026-03-09', 'last week'],
  ['last 2 days', '2026-03-10', '2026-03-12', 'last 2 days'],
  ['最近 ２ 天', '2026-03-10', '2026-03-12', 'last 2 days'],
  ['this month', '2026-03-01', '2026-03-12', 'this month'],
  ['上個月', '2026-02-01', '2026-03-01', 'last month'],
  ['最近三個月', '2026-01-01', '2026-03-12', 'last 3 months'],
]) {
  test(`parses the UTC calendar window for "${query}"`, () => {
    assert.deepEqual(parseWindow(query, asOf), { fromMs: at(from), toMs: at(to), label });
  });
}

test('the ledger range and digest include the first millisecond and exclude the end', () => {
  const window = parseWindow('today', asOf);
  const rows = [
    record('before', window.fromMs - 1), record('first', window.fromMs),
    record('last', window.toMs - 1), record('after', window.toMs),
  ];
  assert.deepEqual(rows.map(row => ledgerRowInRange(row, window)), [false, true, true, false]);
  const result = digest(rows, [], window);
  assert.deepEqual(result.sources, ['first', 'last']);
  assert.match(result.body, /Coffee: total \$12\.00 in 2 records, average \$12\.00 per day/);
});

test('digest keeps units separate and reports measure, category and calendar subtotals', () => {
  const rows = [
    record('feb', '2026-02-28'), record('mar', '2026-03-04', { value: 12 }),
    record('other-unit', '2026-03-04', { unit: 'EUR', value: 4 }),
  ];
  const window = { fromMs: at('2026-02-28'), toMs: at('2026-03-06'), label: 'last 6 days' };
  const result = digest(rows, [], window);
  assert.match(result.body, /Spend: total \$18\.00 in 2 records, average \$3\.00 per day/);
  assert.match(result.body, /Coffee: total \$18\.00 in 2 records, average \$3\.00 per day/);
  assert.match(result.body, /Coffee: total EUR 4\.00 in 1 record, average EUR 0\.67 per day/);
  assert.match(result.body, /Weekly subtotals: 2026-02-23: \$6\.00, 2026-03-02: \$12\.00/);
  assert.match(result.body, /Monthly subtotals: 2026-02-01: \$6\.00, 2026-03-01: \$12\.00/);
});

test('digest uses the latest cumulative steps each day and reports both goal bounds', () => {
  const fields = { measure: 'steps', unit: 'steps', group: 'fitness', category: 'daily_steps' };
  const rows = [
    record('morning', '2026-03-10T08:00:00Z', { ...fields, value: 1000 }),
    record('evening', '2026-03-10T20:00:00Z', { ...fields, value: 8000 }),
    record('today', '2026-03-11T12:00:00Z', { ...fields, value: 12000 }),
  ];
  const goals = [
    record('lower', '2026-03-01', { ...fields, kind: 'goal', period: 'day', comparator: 'at_least', value: 7000 }),
    record('upper', '2026-03-01', { ...fields, kind: 'goal', period: 'day', comparator: 'at_most', value: 9000 }),
  ];
  const result = digest(rows, goals, parseWindow('this week', asOf));
  assert.match(result.body, /Steps: total 20,000 in 2 records, average 10,000 per day/);
  assert.match(result.body, /at least 7,000 per day: actual 10,000 per day, goal met, over by 3,000/);
  assert.match(result.body, /at most 9,000 per day: actual 10,000 per day, goal missed, over by 1,000/);
  assert.deepEqual(result.sources, ['evening', 'lower', 'today', 'upper']);
});

test('goals without matching records in the window report neither an actual nor a judgment', () => {
  const rows = [record('past', '2026-03-10')];
  const goals = [
    record('lower', '2026-03-01', { kind: 'goal', period: 'week', comparator: 'at_least', value: 4 }),
    record('upper', '2026-03-01', { kind: 'goal', period: 'week', comparator: 'at_most', value: 20 }),
  ];
  const window = parseWindow('today', asOf);
  const result = digest(rows, goals, window);
  assert.match(result.body, /at least \$4\.00 per week: no records in this window/);
  assert.match(result.body, /at most \$20\.00 per week: no records in this window/);
  assert.doesNotMatch(result.body, /actual|goal met|goal missed|over by|under by/);
  assert.deepEqual(result.sources, ['lower', 'upper']);
  assert.equal(digest([], [], window), null);
});

test('a calendar goal uses supplied period-to-date records and the latest target', () => {
  const rows = [record('earlier', '2026-03-10'), record('current', '2026-03-11')];
  const goals = [
    record('old-goal', '2026-02-01', { kind: 'goal', period: 'month', comparator: 'at_least', value: 30 }),
    record('new-goal', '2026-03-01', { kind: 'goal', period: 'month', comparator: 'at_least', value: 20 }),
    record('future-goal', '2026-03-12', { kind: 'goal', period: 'month', comparator: 'at_least', value: 5 }),
  ];
  const result = digest(rows, goals, parseWindow('today', asOf));
  assert.match(result.body, /at least \$20\.00 per month: actual \$12\.00 per month, goal missed, under by \$8\.00/);
  assert.deepEqual(result.sources, ['current', 'earlier', 'new-goal']);
});
