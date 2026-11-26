import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest, parseWindow } from '@cairn-ink/core/ledger';

const at = date => Date.parse(date);
const saturday = at('2026-03-14T23:59:59.999Z');
const record = (memoryId, date, value, group, category) => ({
  memoryId, receiptId: memoryId, date: at(date), value, group, category, measure: 'spend', unit: 'USD',
  textHash: 'hash', ordinal: 0, kind: 'record', period: 'none', comparator: 'none',
});
const sunday = record('sunday', '2026-03-08T19:30:00Z', 5, 'transport', 'bus');
const lunch = record('saturday', '2026-03-14T23:59:59.999Z', 12, 'food', 'lunch');

test('week aliases expose a rolling week on Saturday, Sunday and Monday', () => {
  for (const [date, from, to, calendarFrom] of [
    ['2026-03-14T23:59:59.999Z', '2026-03-08', '2026-03-15', '2026-03-09'],
    ['2026-03-15T00:00:00Z', '2026-03-09', '2026-03-16', '2026-03-09'],
    ['2026-03-16T04:00:00Z', '2026-03-10', '2026-03-17', '2026-03-16'],
  ]) {
    for (const query of ['this week', '這週', '本週']) {
      const window = parseWindow(query, at(date));
      assert.deepEqual(window, { fromMs: at(from), toMs: at(to), label: 'this week, read as the last 7 days' });
      assert.deepEqual(window.calendar, { fromMs: at(calendarFrom), toMs: at(to), label: 'calendar week so far' });
    }
  }
});

test('the default Saturday digest has rolling sources and inline calendar comparisons are opt-in', () => {
  const window = parseWindow('How much did I spend this week?', saturday);
  const rows = [
    sunday, lunch,
    record('before', '2026-03-07T23:59:59.999Z', 99, 'other', ''),
    record('future', '2026-03-15', 99, 'other', ''),
  ];
  const header = 'Computed ledger for 2026-03-08 to 2026-03-14 (this week, read as the last 7 days), from the dated records you mentioned.';
  const summaries = [
    'Spend: total $17.00 in 2 records, average $2.43 per day.',
    'Transport spending: total $5.00 in 1 record, average $0.71 per day.',
    'Food spending: total $12.00 in 1 record, average $1.71 per day.',
    'Lunch: total $12.00 in 1 record, average $1.71 per day.',
    'Bus: total $5.00 in 1 record, average $0.71 per day.',
  ];
  const subtotal = 'Weekly subtotals: 2026-03-02: $5.00, 2026-03-09: $12.00.';
  const sources = ['saturday', 'sunday'];
  assert.deepEqual(digest(rows, [], window), { body: [header, ...summaries, subtotal].join(' '), sources });
  assert.deepEqual(digest(rows, [], window, true), {
    body: [
      header,
      'Calendar week so far: 2026-03-09 to 2026-03-14.',
      summaries[0], 'Spend, calendar week so far: total $12.00 in 1 record, average $2.00 per day.',
      summaries[1], 'Transport spending, calendar week so far: total $0.00 in 0 records, average $0.00 per day.',
      summaries[2], 'Food spending, calendar week so far: total $12.00 in 1 record, average $2.00 per day.',
      summaries[3], 'Lunch, calendar week so far: total $12.00 in 1 record, average $2.00 per day.',
      summaries[4], 'Bus, calendar week so far: total $0.00 in 0 records, average $0.00 per day.',
      subtotal,
    ].join(' '),
    sources,
  });
});

test('the first of a 31-day month contributes to the calendar totals and sources only when requested', () => {
  const asOf = at('2026-07-31T04:00:00Z');
  for (const query of ['this month', '這個月']) {
    const window = parseWindow(query, asOf);
    assert.deepEqual(window, { fromMs: at('2026-07-02'), toMs: at('2026-08-01'), label: 'this month, read as the last 30 days' });
    assert.deepEqual(window.calendar, { fromMs: at('2026-07-01'), toMs: at('2026-08-01'), label: 'calendar month so far' });
  }

  const first = record('first', '2026-07-01', 18, 'transport', 'bus');
  const last = record('last', '2026-07-31', 12, 'food', 'lunch');
  const goal = { ...record('budget', '2026-06-01', 1, 'food', ''),
    kind: 'goal', period: 'day', comparator: 'at_most' };
  const window = parseWindow('this month', asOf);
  const off = digest([first, last], [goal], window, false);
  const on = digest([first, last], [goal], window, true);
  assert.deepEqual(off.sources, ['budget', 'last']);
  assert.doesNotMatch(off.body, /calendar month so far|Transport spending|\$18\.00/u);
  assert.deepEqual(on.sources, ['budget', 'first', 'last']);
  assert.match(on.body, /Calendar month so far: 2026-07-01 to 2026-07-31\. Spend: total \$12\.00 in 1 record, average \$0\.40 per day\. Spend, calendar month so far: total \$30\.00 in 2 records, average \$0\.97 per day\./u);
  assert.doesNotMatch(on.body, /Transport spending|Bus/u);
  assert.equal(on.body.slice(on.body.indexOf('Weekly subtotals:')), off.body.slice(off.body.indexOf('Weekly subtotals:')));
  assert.match(on.body, /Goals: food budget goal at most \$1\.00 per day: actual \$0\.40 per day, goal met, under by \$0\.60\.$/u);

  assert.equal(digest([first], [], window), null);
  assert.equal(digest([first], [], window, true), null);
});

test('calendar step averages use the latest cumulative record on each recorded day', () => {
  const steps = { measure: 'steps', unit: 'steps', group: 'fitness', category: 'walking' };
  const rows = [
    { ...sunday, ...steps, value: 6000 },
    { ...lunch, ...steps, value: 12000 },
    { ...lunch, ...steps, memoryId: 'morning', date: at('2026-03-14T08:00:00Z'), value: 1000 },
  ];
  const result = digest(rows, [], parseWindow('this week', saturday), true);
  assert.match(result.body, /Steps: total 18,000 in 2 records, average 9,000 per day\. Steps, calendar week so far: total 12,000 in 1 record, average 12,000 per day\./u);
  assert.match(result.body, /Walking: total 18,000 in 2 records, average 9,000 per day\. Walking, calendar week so far: total 12,000 in 1 record, average 12,000 per day\./u);
  assert.deepEqual(result.sources, ['saturday', 'sunday']);
});

const rows = [
  sunday, lunch,
  record('friday', '2026-03-13T12:00:00Z', 7, 'food', 'lunch'),
  record('february', '2026-02-16', 30, 'food', 'lunch'),
  record('january', '2026-01-01', 80, 'food', 'lunch'),
];
// These digests are the core-next outputs for the same records and as-of day.
for (const [query, body, sources] of [
  ['Total spending?', [
    'Computed ledger for 2026-03-08 to 2026-03-14 (last 7 days), from the dated records you mentioned.',
    'Spend: total $24.00 in 3 records, average $3.43 per day.',
    'Transport spending: total $5.00 in 1 record, average $0.71 per day.',
    'Food spending: total $19.00 in 2 records, average $2.71 per day.',
    'Lunch: total $19.00 in 2 records, average $2.71 per day.',
    'Bus: total $5.00 in 1 record, average $0.71 per day.',
    'Weekly subtotals: 2026-03-02: $5.00, 2026-03-09: $19.00.',
  ], ['friday', 'saturday', 'sunday']],
  ['today', [
    'Computed ledger for 2026-03-14 to 2026-03-14 (today), from the dated records you mentioned.',
    'Spend: total $12.00 in 1 record, average $12.00 per day.',
    'Food spending: total $12.00 in 1 record, average $12.00 per day.',
    'Lunch: total $12.00 in 1 record, average $12.00 per day.',
  ], ['saturday']],
  ['yesterday', [
    'Computed ledger for 2026-03-13 to 2026-03-13 (yesterday), from the dated records you mentioned.',
    'Spend: total $7.00 in 1 record, average $7.00 per day.',
    'Food spending: total $7.00 in 1 record, average $7.00 per day.',
    'Lunch: total $7.00 in 1 record, average $7.00 per day.',
  ], ['friday']],
  ['last week', [
    'Computed ledger for 2026-03-02 to 2026-03-08 (last week), from the dated records you mentioned.',
    'Spend: total $5.00 in 1 record, average $0.71 per day.',
    'Transport spending: total $5.00 in 1 record, average $0.71 per day.',
    'Bus: total $5.00 in 1 record, average $0.71 per day.',
  ], ['sunday']],
  ['last month', [
    'Computed ledger for 2026-02-01 to 2026-02-28 (last month), from the dated records you mentioned.',
    'Spend: total $30.00 in 1 record, average $1.07 per day.',
    'Food spending: total $30.00 in 1 record, average $1.07 per day.',
    'Lunch: total $30.00 in 1 record, average $1.07 per day.',
    'Weekly subtotals: 2026-02-16: $30.00.',
  ], ['february']],
  ['last 3 months', [
    'Computed ledger for 2026-01-01 to 2026-03-14 (last 3 months), from the dated records you mentioned.',
    'Spend: total $134.00 in 5 records, average $1.84 per day.',
    'Transport spending: total $5.00 in 1 record, average $0.07 per day.',
    'Food spending: total $129.00 in 4 records, average $1.77 per day.',
    'Lunch: total $129.00 in 4 records, average $1.77 per day.',
    'Bus: total $5.00 in 1 record, average $0.07 per day.',
    'Weekly subtotals: 2025-12-29: $80.00, 2026-02-16: $30.00, 2026-03-02: $5.00, 2026-03-09: $19.00.',
    'Monthly subtotals: 2026-01-01: $80.00, 2026-02-01: $30.00, 2026-03-01: $24.00.',
  ], ['february', 'friday', 'january', 'saturday', 'sunday']],
  ['last 2 days', [
    'Computed ledger for 2026-03-13 to 2026-03-14 (last 2 days), from the dated records you mentioned.',
    'Spend: total $19.00 in 2 records, average $9.50 per day.',
    'Food spending: total $19.00 in 2 records, average $9.50 per day.',
    'Lunch: total $19.00 in 2 records, average $9.50 per day.',
  ], ['friday', 'saturday']],
]) {
  test(`"${query}" preserves the original digest bytes with either option value`, () => {
    const window = parseWindow(query, saturday);
    assert.equal(window.calendar, undefined);
    for (const enabled of [false, true]) {
      assert.deepEqual(digest(rows, [], window, enabled), { body: body.join(' '), sources });
    }
  });
}
