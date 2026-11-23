import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createInMemoryLedgerPort } from '../quantity-ledger.mjs';
import { counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, policy } from '../testing/context-read-core-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const today = '2026-03-18T12:00:00.000Z';
const yesterday = '2026-03-17T12:00:00.000Z';
const tea = { id: 'tea', role: 'user', content: 'Tea cost 6 USD', occurredAt: yesterday };
const quantity = (category, value) => ({ item: 0, kind: 'record', measure: 'spend', value, unit: 'USD',
  group: 'food', category, period: 'none', comparator: 'none' });

test('adding a later supporting receipt does not add the original purchase again', async t => {
  const { capture, digest, port } = fixture(t, tea.content, [quantity('tea', 6)]);
  const first = await capture('first', [tea]);
  const second = await capture('second', [
    { id: 'oolong', role: 'user', content: 'It was oolong', occurredAt: today }, tea,
  ]);
  assert.equal(second.id, first.id);
  assert.equal(port.list(ns, {}).length, 1);
  assert.match(await digest('last 2 days'), /\$6\.00 in 1 purchase/);
});

test('amounts on one item follow their own normalized receipt text and date', async t => {
  const { capture, digest } = fixture(t, 'Tea cost 6 USD and cake cost 4 USD',
    [quantity('tea', 6), quantity('cake', 4)]);
  await capture('both', [{ ...tea, content: 'Tea cost ６ USD' },
    { id: 'cake', role: 'user', content: 'Cake cost 4 USD', occurredAt: today }]);
  assert.match(await digest('yesterday'), /\$6\.00 in 1 purchase/);
  assert.match(await digest('today'), /\$4\.00 in 1 purchase/);
});

test('ambiguous amounts use the earliest dated user receipt, then message id', async t => {
  const { capture, port } = fixture(t, 'Tea cost 6 USD and cake cost 4 USD',
    [quantity('tea', 6), quantity('cake', 4)]);
  const { id } = await capture('ambiguous', [
    { id: 'z', role: 'user', content: '6 USD', occurredAt: yesterday },
    { id: 'missing', role: 'user', content: 'An amount', occurredAt: null },
    { id: 'a', role: 'user', content: '6 USD', occurredAt: yesterday },
    { id: 'assistant', role: 'assistant', content: '4 USD', occurredAt: yesterday },
  ]);
  const rows = port.list(ns, {});
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.memoryId, id);
    assert.equal(row.occurredAt, yesterday);
    assert.equal(JSON.parse(row.sourceKey).at(-1), 'a');
  }
});

function fixture(t, content, quantities) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(today) });
  const workspace = createTestWorkspace(t), trusted = host(), port = createInMemoryLedgerPort();
  const model = { contextWindow: 8192, countTokens: () => 1, extract: ({ input }) => ({
    items: [{ content, kind: 'fact', confidence: 0.9, sourceIndices: input.messages.map((_, index) => index) }],
    quantities,
  }) };
  const contextRead = { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter };
  const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', model, contextRead, ledgerPort: port });
  workspace.defer(() => core.close());
  return {
    port,
    async capture(eventId, messages) {
      return ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId, messages }))
        .admission.memories[0];
    },
    async digest(window) {
      const value = ok(await trusted.call(core, 'contextRead', { readSet: [ns], query: 'Total food spending ' + window,
        intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000 }));
      return value.metered.items.find(item => item.channel === 'ledger-v1')?.body ?? '';
    },
  };
}
