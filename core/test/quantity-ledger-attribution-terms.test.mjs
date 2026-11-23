import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort } from '../quantity-ledger.mjs';
import { counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const coffee = amount('coffee');
const cake = amount('cake');
const tea = amount('tea');

test('equal prices for different purchases stay with their own receipts as extraction changes', async t => {
  const a = message('coffee', 'Coffee cost 6 USD', 8);
  const b = message('cake', 'Cake cost 6 USD', 9);
  const { capture, purchases, sources } = fixture(t, 'Coffee and cake cost 6 USD each');
  await capture([a, b], [coffee]);
  await purchases(6, 1);
  await capture([a, b], [cake, coffee]);
  await purchases(12, 2);
  await capture([b, a], [cake]);
  await purchases(12, 2);
  assert.deepEqual(sources(), [['coffee', a.id, 0], ['cake', b.id, 0]]);
});

test('a price confirmation leaves both amounts and ordinals on the original receipt', async t => {
  const a = message('two-teas', 'I bought two teas for 6 USD each', 8);
  const b = message('confirmation', 'Yes, they were 6 USD each', 9);
  const { capture, purchases, sources } = fixture(t, a.content);
  await capture([a], [tea, tea]);
  await purchases(12, 2);
  await capture([a, b], [tea, tea]);
  await purchases(12, 2);
  assert.deepEqual(sources(), [['tea', a.id, 0], ['tea', a.id, 1]]);
});

test('a second named tea adds one purchase and replay ignores an incidental value match', async t => {
  const a = message('tea', 'Tea cost 6 USD', 8);
  const b = message('another-tea', 'Another tea, 6 USD', 10);
  const c = message('table', 'The table number was 6', 9);
  const { capture, purchases, sources } = fixture(t, a.content);
  await capture([a], [tea]);
  await purchases(6, 1);
  await capture([a, b], [tea, tea]);
  await purchases(12, 2);
  await capture([a, b], [tea, tea]);
  await purchases(12, 2);
  await capture([b, c, a], [tea, tea]);
  await purchases(12, 2);
  assert.deepEqual(sources(), [['tea', a.id, 0], ['tea', b.id, 0]]);
});

test('a fixed receipt alias can distinguish an equal value in another message', async t => {
  const a = message('cake', 'Cake cost 6 USD', 8);
  const b = message('coffee', '咖啡 ６ USD', 9);
  const { capture, purchases, sources } = fixture(t, 'Coffee and cake cost 6 USD each');
  await capture([a, b], [coffee, cake]);
  await purchases(12, 2);
  assert.deepEqual(sources(), [['coffee', b.id, 0], ['cake', a.id, 0]]);
});

function message(id, content, hour) {
  return { id, role: 'user', content, occurredAt: `2026-03-18T${String(hour).padStart(2, '0')}:00:00.000Z` };
}

function amount(category) {
  return { item: 0, kind: 'record', measure: 'spend', category, value: 6, unit: 'USD',
    group: 'food', period: 'none', comparator: 'none' };
}

function fixture(t, content) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-03-18T12:00:00.000Z') });
  const workspace = createTestWorkspace(t), trusted = host(), ledgerPort = createInMemoryLedgerPort();
  let quantities, captureCount = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, extract: ({ input }) => ({
    items: [{ content, kind: 'fact', confidence: 0.9, sourceIndices: input.messages.map((_, index) => index) }],
    quantities,
  }) };
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter };
  const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', model, contextRead, ledgerPort });
  workspace.defer(() => core.close());
  return {
    async capture(messages, extracted) {
      quantities = extracted;
      return ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session',
        eventId: 'capture-' + ++captureCount, messages }));
    },
    async purchases(total, count) {
      const value = ok(await trusted.call(core, 'contextRead', { readSet: [ns], query: 'Total food spending today',
        intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000 }));
      const digest = value.metered.items.find(item => item.channel === 'ledger-v1');
      assert.ok(digest);
      assert.ok(digest.body.includes(`Food spending: $${total.toFixed(2)} in ${count} ${count === 1 ? 'purchase,' : 'purchases,'}`),
        digest.body);
    },
    sources: () => ledgerPort.list(ns).map(row => [row.category, JSON.parse(row.sourceKey).at(-1), row.ordinal]),
  };
}
