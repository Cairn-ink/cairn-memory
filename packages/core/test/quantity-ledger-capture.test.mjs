import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest, ledgerRowDeliverable, ledgerRowKey, writeLedgerQuantities } from '@cairn-ink/core/ledger';

const day = 86_400_000;
const firstDay = Date.UTC(2026, 0, 31);
const secondDay = firstDay + day;
const memoryId = 'memory';
const h1 = 'original-hash';
const h2 = 'corrected-hash';
const receipt = (receiptId, content, occurredAtMs = firstDay) =>
  ({ receiptId, messageId: receiptId, role: 'user', content, occurredAtMs });
const purchase = (category, value = 6, unit = 'USD') => ({
  item: 0, kind: 'record', measure: 'spend', value, unit,
  group: 'food', category, period: 'none', comparator: 'none',
});
const capture = (citedReceipts, quantities, textHash = h1) =>
  ({ memoryId, textHash, captureTimeMs: secondDay, citedReceipts, quantities });
const binding = (category, receiptId = 'A', date = firstDay, ordinal = 0) =>
  [category, receiptId, date, ordinal];

function createLedger() {
  const saved = new Map();
  const retained = new Set();
  const tx = {};
  const scope = {};
  let currentHash;
  const store = {
    async listForMemory(_tx, _scope, id) {
      return [...saved.values()].filter(row => row.memoryId === id);
    },
    async put(_tx, _scope, rows) {
      const before = saved.size;
      for (const row of rows) {
        const key = ledgerRowKey(row);
        if (!saved.has(key)) saved.set(key, row);
      }
      return { inserted: saved.size - before };
    },
  };
  return {
    async apply(entries) {
      const writes = [];
      for (const entry of entries) {
        currentHash = entry.textHash;
        for (const source of entry.citedReceipts) retained.add(source.receiptId);
        writes.push((await writeLedgerQuantities(tx, scope, store, entry)).inserted);
      }
      return writes;
    },
    rows: () => [...saved.values()],
    deliverable() {
      const state = {
        memoryStates: new Map([[memoryId, 'current_visible']]),
        memoryTextHashes: new Map([[memoryId, currentHash]]),
        retainedReceipts: new Map([[memoryId, retained]]),
      };
      return [...saved.values()].filter(row => ledgerRowDeliverable(row, state));
    },
  };
}

const tea = purchase('tea');
const coffee = purchase('coffee');
const cake = purchase('cake');
const teaA = receipt('A', 'Tea cost 6 USD');
const teaB = receipt('B', 'Tea cost 6 USD', secondDay);
const oneTea = capture([teaA], [tea]);
const twoTeas = capture([receipt('A', 'I bought two teas for 6 USD each')], [tea, tea]);
const bothTeas = capture([...twoTeas.citedReceipts, receipt('B', 'Yes, both teas were 6 USD each', secondDay)],
  [tea, tea]);
const teaOnA = binding('tea');
const teaOnB = binding('tea', 'B', secondDay);
const twoTeasOnA = [teaOnA, binding('tea', 'A', firstDay, 1)];
const cakeB = receipt('B', 'Cake cost 6 USD', secondDay);
const coffeeA = receipt('A', 'Coffee cost 6 USD');
const skippedCakeA = receipt('A', 'Coffee cost 6 USD. I skipped cake.');
const boughtCakeA = receipt('A', 'Coffee 6 USD and cake 4 USD');
const walkB = receipt('B', 'I went for a walk', secondDay);
const cake4 = purchase('cake', 4);
const coffeeOnA = binding('coffee');
const cakeOnB = binding('cake', 'B', secondDay);
const scenarios = [
  ['replay one tea', [oneTea, oneTea], 6, [teaOnA]],
  ['exact-dedup capture cites only the new receipt',
    [oneTea, capture([teaB], [tea])], 12, [teaOnA, teaOnB]],
  ['a new receipt corroborates two teas', [twoTeas, bothTeas], 12, twoTeasOnA],
  ['re-cite only the first receipt after corroboration', [twoTeas, bothTeas, twoTeas], 12, twoTeasOnA],
  ['a new receipt records another tea',
    [oneTea, capture([teaA, receipt('B', 'Another tea, 6 USD', secondDay)], [tea, tea])],
    12, [teaOnA, teaOnB]],
  ['add cake with the same price before coffee in extraction order',
    [capture([coffeeA, cakeB], [coffee]), capture([coffeeA, cakeB], [cake, coffee])],
    12, [coffeeOnA, cakeOnB]],
  ['add cake when the occupied coffee receipt also mentions cake',
    [capture([skippedCakeA, cakeB], [coffee]), capture([skippedCakeA, cakeB], [coffee, cake])],
    12, [coffeeOnA, cakeOnB]],
  ['keep cake on the coffee receipt after an unrelated later receipt and a narrow re-cite',
    [capture([boughtCakeA], [coffee]), capture([boughtCakeA, walkB], [coffee, cake4]),
      capture([boughtCakeA], [cake4])],
    10, [coffeeOnA, binding('cake')]],
  ['recapture a corrected memory under the new hash with its original receipt',
    [oneTea, capture([teaA], [tea], h2)], 6, [binding('tea', 'A', firstDay, 1)]],
];

function assertDeliverable(ledger, expectedTotal, expectedBindings) {
  const rows = ledger.deliverable();
  assert.equal(rows.reduce((sum, row) => sum + row.value, 0), expectedTotal);
  assert.deepEqual(rows.map(row => binding(row.category, row.receiptId, row.date, row.ordinal)), expectedBindings);
}

for (const [index, [name, entries, expectedTotal, expectedBindings]] of scenarios.entries()) {
  test(`table ${index + 1}: ${name}`, async () => {
    const ledger = createLedger();
    await ledger.apply(entries);
    assertDeliverable(ledger, expectedTotal, expectedBindings);
  });
}

test('table 10: replay of every sequence leaves the rows unchanged', async () => {
  for (const [name, entries] of scenarios) {
    const ledger = createLedger();
    await ledger.apply(entries);
    const before = ledger.rows();
    assert.deepEqual(await ledger.apply(entries), entries.map(() => 0), name);
    assert.deepEqual(ledger.rows(), before, name);
  }
});

test('a narrow re-cite of an occupied receipt counts matching rows on uncited receipts', async () => {
  const ledger = createLedger();
  await ledger.apply([capture([teaA, teaB], [tea, tea]), twoTeas]);
  assertDeliverable(ledger, 12, [teaOnA, teaOnB]);
});

test('a receipt with only old-hash rows is new for coverage and candidate ordering', async () => {
  const ledger = createLedger();
  const teaC = receipt('C', 'Tea cost 6 USD', secondDay + day);
  await ledger.apply([
    capture([teaC], [tea]),
    capture([teaA, teaB], [tea, tea], h2),
    capture([teaA, teaC], [tea, tea], h2),
  ]);
  assertDeliverable(ledger, 18, [teaOnA, teaOnB, binding('tea', 'C', secondDay + day, 1)]);
});

test('value-only evidence and the earliest fallback outrank an unrelated new receipt', async () => {
  const ledger = createLedger();
  await ledger.apply([
    capture([coffeeA], [coffee]),
    capture([coffeeA, walkB], [cake]),
    capture([coffeeA, walkB], [cake4]),
  ]);
  assertDeliverable(ledger, 16, [coffeeOnA, binding('cake'), binding('cake')]);
});

const asRow = quantity => {
  const { item, ...amount } = quantity;
  return { ...amount, memoryId, textHash: h1, receiptId: 'A', date: firstDay, ordinal: 0 };
};
const week = { fromMs: firstDay, toMs: firstDay + 7 * day, label: 'one week' };

test('currency totals keep cents unless they would round a non-zero amount to zero', () => {
  const window = { ...week, toMs: firstDay + day };
  assert.match(digest([asRow(purchase('tea', 0.004))], [], window).body,
    /Spend: total \$0\.004 in 1 record, average \$0\.004 per day/);
  for (const [value, formatted] of [[0, '$0.00'], [0.005, '$0.01'], [6, '$6.00']]) {
    assert.ok(digest([asRow(purchase('tea', value))], [], window).body.includes(`Spend: total ${formatted} in`));
  }
  assert.match(digest([asRow(purchase('tea', -0.004, 'EUR'))], [], window).body, /Spend: total EUR -0\.004 in/);
});

test('one cent across seven days keeps its non-zero currency average', () => {
  assert.match(digest([asRow(purchase('tea', 0.01))], [], week).body,
    /Spend: total \$0\.01 in 1 record, average \$0\.00142857 per day/);
});

test('weekly and monthly currency subtotals keep non-zero amounts below half a cent', () => {
  const { body } = digest([asRow(purchase('tea', 0.004))], [], week);
  assert.match(body, /Weekly subtotals: 2026-01-26: \$0\.004\./);
  assert.match(body, /Monthly subtotals: 2026-01-01: \$0\.004\./);
});
