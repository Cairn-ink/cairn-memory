import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../contract.mjs';
import { meteredText } from '../context-read-assembly.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { counter, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { policy, host } from '../testing/context-read-core-fixture.mjs';

const makeQuantity = value => ({ item: 0, kind: 'record', measure: 'spend', value, unit: 'USD',
  group: 'food', category: 'tea', period: 'none', comparator: 'none' });
const receipt = excerpt => ({ client: 'test', sessionId: 'session', eventId: 'replacement', role: 'user', excerpt });

test('the source channel meters one digest and follows correction, forgetting and supersession', async t => {
  const { createInMemoryLedgerPort } = await import('../quantity-ledger.mjs');
  const workspace = createTestWorkspace(t), ledgerPort = createInMemoryLedgerPort();
  const trusted = host();
  const now = new Date().toISOString();
  let value = 6, content = 'I spent 6 on tea.';
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
    items: [{ content, kind: 'fact', confidence: 0.9, sourceIndices: [0] }], quantities: [makeQuantity(value)],
  }), classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
    newL1: { title: 'Purchases', parentL2Ids: [] } })) }) };
  const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', ledgerPort, model,
    contextRead: { version: 'context-read-v1', authority: trusted.authority, policy: policy(), counter } });
  workspace.defer(() => core.close());
  const capture = async id => ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId: id,
    messages: [{ id, role: 'user', occurredAt: now, content }] })).admission.memories[0];
  const read = async budget => ok(await trusted.call(core, 'contextRead', { readSet: [ns], query: 'Total tea spending today',
    intent: 'current', types: ['memory'], representation: 'memory-compact-v1', raw: false, deadlineMs: 5000,
    ...(budget ? { budget } : {}) }));
  const ledgerItem = result => result.metered.items.find(item => item.channel === 'ledger-v1');
  const a = await capture('first');
  value = 9; content = 'I spent 9 on tea.';
  const b = await capture('second');
  const current = id => ok(core.get({ namespace: ns, memoryId: id })).memory.revision;
  assert.ok(current(a.id) > a.revision);
  let pack = await read();
  assert.match(ledgerItem(pack).body, /\$15\.00/);
  assert.deepEqual([...ledgerItem(pack).sources].sort(), [a.id, b.id].sort());
  assert.equal(pack.diagnostics.budget.used, counter.countTokens(meteredText(pack.metered)));
  pack = await read({ maxItems: 1, maxTokens: 300 });
  assert.equal(ledgerItem(pack), undefined);
  assert.ok(pack.diagnostics.budget.used <= 300);

  ok(core.correct({ namespace: ns, memoryId: a.id, expectedRevision: current(a.id), content: 'I spent 7 on tea.',
    kind: 'fact', receipt: receipt('I spent 7 on tea.'), quantities: [makeQuantity(7)] }));
  assert.match(ledgerItem(await read()).body, /\$16\.00/);
  ok(core.forget({ namespace: ns, memoryId: b.id, expectedRevision: current(b.id) }));
  assert.match(ledgerItem(await read()).body, /\$7\.00/);
  const revised = ok(core.get({ namespace: ns, memoryId: a.id })).memory;
  ok(core.supersede({ namespace: ns, memoryId: a.id, expectedRevision: revised.revision,
    replacement: { content: 'I switched to water.', kind: 'fact' }, receipts: [receipt('I switched to water.')] }));
  assert.deepEqual(ledgerPort.list(ns, {}), []);
  assert.equal(ledgerItem(await read()), undefined);
});

test('rejecting an awaiting decision removes its quantity rows', async t => {
  const { createInMemoryLedgerPort } = await import('../quantity-ledger.mjs');
  const workspace = createTestWorkspace(t), ledgerPort = createInMemoryLedgerPort();
  const content = 'I decided to keep tea purchases below 9 per week.';
  const quantity = { ...makeQuantity(9), kind: 'goal', period: 'week', comparator: 'at_most' };
  const model = { contextWindow: 8192, countTokens: () => 1, extract: () => ({
    items: [{ content, kind: 'decision', confidence: 0.9, sourceIndices: [0] }], quantities: [quantity],
  }) };
  const core = openMemoryCore({ path: workspace.path + '/memory.sqlite', model, ledgerPort, decisionReview: 'required-v1' });
  workspace.defer(() => core.close());
  const { memories: [memory] } = ok(await core.capture({ namespace: ns, client: 'test', sessionId: 'session', eventId: 'capture',
    messages: [{ id: 'message', role: 'user', content }] })).admission;
  assert.deepEqual(ledgerPort.list(ns, {}).map(row => row.memoryId), [memory.id]);

  const reject = expectedRevision => core.reject({ namespace: ns, memoryId: memory.id, expectedRevision, actionId: 'reject' });
  assert.equal(reject(memory.revision + 1).error.code, 'revision_conflict');
  assert.equal(ledgerPort.list(ns, {}).length, 1);
  ok(reject(memory.revision));
  assert.deepEqual(ledgerPort.list(ns, {}), []);
});
