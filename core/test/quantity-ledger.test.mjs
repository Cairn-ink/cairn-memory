import test from 'node:test';
import assert from 'node:assert/strict';

const asOf = '2026-03-18T12:00:00Z';
const record = (measure, value, unit, group, category) =>
  ({ item: 0, kind: 'record', measure, value, unit, group, category, period: 'none', comparator: 'none' });

test('calendar windows agree across languages and include the as-of day', async () => {
  const { parseWindow } = await import('../quantity-ledger.mjs');
  const pairs = [
    ['today', '今天', '2026-03-18', '2026-03-18'],
    ['yesterday', '昨天', '2026-03-17', '2026-03-17'],
    ['this week', '這週', '2026-03-16', '2026-03-18'],
    ['this week', '本週', '2026-03-16', '2026-03-18'],
    ['last week', '上週', '2026-03-09', '2026-03-15'],
    ['last 4 days', '最近 4 天', '2026-03-15', '2026-03-18'],
    ['this month', '這個月', '2026-03-01', '2026-03-18'],
    ['last month', '上個月', '2026-02-01', '2026-02-28'],
    ['last 3 months', '最近三個月', '2026-01-01', '2026-03-18'],
    ['average', '平均', '2026-03-12', '2026-03-18'],
  ];
  for (const [en, zh, from, to] of pairs) for (const query of [en, zh]) {
    const window = parseWindow(query, asOf);
    assert.deepEqual([window.from, window.to], [from, to], query);
  }
});

test('digest aggregates compatible amounts, latest daily steps and goals with provenance', async () => {
  const { rowsFrom, digest, parseWindow } = await import('../quantity-ledger.mjs');
  const rows = [
    ['a', record('spend', 12, 'USD', 'food', 'coffee'), '2026-02-28'],
    ['b', record('spend', 8, 'USD', 'food', 'coffee'), '2026-03-17'],
    ['c', record('spend', 9, 'EUR', 'food', 'coffee'), '2026-03-13'],
    ['d', record('steps', 400, 'steps', 'fitness', 'daily_steps'), '2026-03-16T10:00:00Z'],
    ['e', record('steps', 1200, 'steps', 'fitness', 'daily_steps'), '2026-03-16T22:00:00Z'],
    ['f', record('steps', 800, 'steps', 'fitness', 'daily_steps'), '2026-03-17'],
  ].flatMap(([id, quantity, date]) => rowsFrom({ id }, 1, quantity, date));
  const goals = [
    ...rowsFrom({ id: 'g' }, 1, { ...record('steps', 1100, 'steps', 'fitness', 'daily_steps'),
      kind: 'goal', period: 'day', comparator: 'at_least' }, '2026-03-01'),
    ...rowsFrom({ id: 'h' }, 1, { ...record('spend', 7, 'USD', 'food', 'coffee'),
      kind: 'goal', period: 'week', comparator: 'at_most' }, '2026-03-01'),
  ];
  const report = digest(rows, goals, parseWindow('last 20 days', asOf));
  assert.match(report.body, /\$20\.00 in 2 purchases/);
  assert.match(report.body, /EUR 9\.00 in 1 purchase/);
  assert.match(report.body, /2 daily records, total 2,000, average 1,000 per day/);
  assert.match(report.body, /under by 100/);
  assert.match(report.body, /over by \$1\.00/);
  assert.match(report.body, /2026-02-23: \$12\.00/);
  assert.match(report.body, /2026-02-01/);
  assert.deepEqual([...report.sources].sort(), ['a', 'b', 'c', 'e', 'f', 'g', 'h']);
});

test('intent requires both a matching measure, category or group and a cue', async () => {
  const { readIntent } = await import('../quantity-ledger.mjs');
  const rows = [record('spend', 10, 'TWD', 'food', 'coffee'), record('steps', 20, 'steps', 'fitness', 'daily_steps')];
  for (const query of ['Total spending', 'How much was coffee?', '今天咖啡花了多少', '這週走了幾步'])
    assert.equal(readIntent(query, rows), true, query);
  for (const query of ['coffee recipes', 'How many pencils?', '下一步要做什麼', 'next steps'])
    assert.equal(readIntent(query, rows), false, query);
});
