import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort } from '../quantity-ledger.mjs';
import { counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const now = '2026-03-18T12:00:00.000Z';
const earlier = message('cafe', 'I stopped at the café', 8);
const tea = message('tea', 'Tea cost 6 USD', 9);
const secondTea = message('second-tea', 'I bought another tea for 6 USD', 10);
const teaAmount = amount('tea', 6);

test('a later matching receipt leaves the amount on the first matching receipt', async t => {
  const { capture, digest, rows } = fixture(t, tea.content);
  await capture('first', [earlier, tea], [teaAmount]);
  await capture('with-support', [earlier, tea, message('price', 'The price was 6 USD', 10)], [teaAmount]);
  assert.match(await digest(), /\$6\.00 in 1 purchase\b/);
  assert.deepEqual(rows().map(row => JSON.parse(row.sourceKey).at(-1)), [tea.id]);
});

test('equal amounts on separate receipts add once and a replay adds nothing', async t => {
  const { capture, digest, rows } = fixture(t, tea.content);
  await capture('first', [tea], [teaAmount]);
  // Provide the later receipt first so extraction order cannot choose the receipt order.
  const messages = [secondTea, tea], quantities = [teaAmount, teaAmount];
  await capture('both', messages, quantities);
  assert.match(await digest(), /\$12\.00 in 2 purchases/);
  const stored = rows();
  assert.deepEqual(stored.map(row => JSON.parse(row.sourceKey).at(-1)), [tea.id, secondTea.id]);
  await capture('both', messages, quantities);
  await capture('recited', messages, quantities);
  assert.deepEqual(rows(), stored);
  assert.match(await digest(), /\$12\.00 in 2 purchases/);
});

test('multiple amounts can be stored on the same receipt across writes', async t => {
  const meal = message('meal', 'Coffee cost 6 USD and cake cost 4 USD', 9);
  const coffee = amount('coffee', 6), cake = amount('cake', 4);
  const { capture, digest, rows } = fixture(t, meal.content);
  await capture('coffee-only', [meal], [coffee]);
  await capture('both', [meal], [coffee, cake]);
  const stored = rows();
  assert.deepEqual(stored.map(row => [row.category, row.value]), [['coffee', 6], ['cake', 4]]);
  assert.equal(new Set(stored.map(row => row.receiptId)).size, 1);
  assert.match(await digest(), /\$10\.00 in 2 purchases/);
});

test('extra equal amounts on the last matching receipt keep distinct ordinals', async t => {
  const { capture, rows } = fixture(t, tea.content);
  await capture('first', [tea], [teaAmount]);
  await capture('three', [tea, secondTea], [teaAmount, teaAmount, teaAmount]);
  const stored = rows();
  assert.deepEqual(stored.map(row => [JSON.parse(row.sourceKey).at(-1), row.ordinal]),
    [[tea.id, 0], [secondTea.id, 0], [secondTea.id, 1]]);
  await capture('recited', [tea, secondTea], [teaAmount, teaAmount, teaAmount]);
  assert.deepEqual(rows(), stored);
});

function message(id, content, hour) {
  return { id, role: 'user', content, occurredAt: '2026-03-18T' + String(hour).padStart(2, '0') + ':00:00.000Z' };
}

function amount(category, value) {
  return { item: 0, kind: 'record', measure: 'spend', category, value, unit: 'USD',
    group: 'food', period: 'none', comparator: 'none' };
}

function fixture(t, content) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  const workspace = createTestWorkspace(t), trusted = host(), ledgerPort = createInMemoryLedgerPort();
  let quantities;
  const model = { contextWindow: 8192, countTokens: () => 1, extract: ({ input }) => ({
    items: [{ content, kind: 'fact', confidence: 0.9, sourceIndices: input.messages.map((_, index) => index) }],
    quantities,
  }) };
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter };
  const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', model, contextRead, ledgerPort });
  workspace.defer(() => core.close());
  return {
    capture: async (eventId, messages, extracted) => {
      quantities = extracted;
      return ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId, messages }));
    },
    rows: () => ledgerPort.list(ns),
    async digest() {
      const value = ok(await trusted.call(core, 'contextRead', { readSet: [ns], query: 'Total food spending today',
        intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000 }));
      return value.metered.items.find(item => item.channel === 'ledger-v1')?.body ?? '';
    },
  };
}
