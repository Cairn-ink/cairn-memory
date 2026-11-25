import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryService } from '@cairn-ink/core/service';
import { hostedScope as scope, serviceFake } from './helpers/service-fake.mjs';

const event = { client: 'client', sessionId: 'session', eventId: 'event' };
const message = (id, content, role = 'user', occurredAtMs = 0) => ({ id, content, role, occurredAtMs });
const item = (sourceIndices, content = 'Coffee purchase.') => ({ kind: 'fact', confidence: 1, content, sourceIndices });
const record = (value, extras = {}) => ({
  item: 0, kind: 'record', measure: 'spend', value, unit: 'USD', category: 'coffee',
  group: 'food', period: 'none', comparator: 'none', ...extras,
});
const ungrounded = { version: 1, stage: 'extract', layer: 'core_validation', reason: 'ungrounded_extraction_quantity' };

async function capture(messages, items, quantities) {
  const { deps, hooks, storage } = serviceFake({ writes: true, capture: true, hasKey: false });
  const rows = [], diagnostics = [], resolved = [];
  deps.config = { quantityLedger: { enabled: true } };
  deps.diagnostics = event => diagnostics.push(event);
  storage.capabilities.quantityLedger = true;
  storage.quantityLedger = {
    async listForMemory(_tx, _scope, id) { return rows.filter(row => row.memoryId === id); },
    async put(_tx, _scope, batch) { rows.push(...batch); return { inserted: batch.length }; },
  };
  storage.hydrate.hydrate = async (tx, _scope, refs) => refs.map(ref => ({
    ref, memory: tx.rows.find(memory => memory.id === ref.id),
  }));
  storage.capture.retainedReceiptIds = async (_tx, _scope, _id, receipts) => {
    resolved.push(receipts.map(({ messageId, role }) => [messageId, role]));
    return receipts.map(({ messageId }) => `canonical-${messageId}`);
  };
  hooks.model = () => ({ items, quantities });
  const service = createMemoryService(deps);
  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: 'accepted' });
  assert.equal((await service.runCapture(scope, event)).status, 'done');
  return { rows, diagnostics, resolved };
}

test('capture stores a grounded record with the cited receipt that contains the number', async () => {
  const { rows, diagnostics } = await capture([
    message('earliest', 'I bought a coffee.'),
    message('grounded', 'I paid twelve thousand USD.', 'user', 100),
  ], [item([0, 1])], [record(12_000.004)]);
  assert.deepEqual(rows.map(({ value, receiptId, date }) => [value, receiptId, date]),
    [[12_000.004, 'canonical-grounded', 100]]);
  assert.deepEqual(diagnostics, []);
});

test('capture drops one computed total, keeps grounded siblings and leaves goals unchanged', async () => {
  const { rows, diagnostics } = await capture([message('user', 'Two coffees at $4.')], [item([0])], [
    record(4), record(8), record(2, { measure: 'count', unit: 'cups' }),
    record(20, { kind: 'goal', period: 'week', comparator: 'at_most' }),
  ]);
  assert.deepEqual(rows.map(({ kind, value }) => [kind, value]), [['record', 4], ['record', 2], ['goal', 20]]);
  assert.deepEqual(diagnostics, [ungrounded]);
});

test('only cited user messages can ground a record', async () => {
  const { rows, diagnostics, resolved } = await capture([
    message('user', 'No, just the coffee.'),
    message('assistant', 'The coffee is $8.', 'assistant'),
    message('uncited', 'A different purchase was $8.'),
  ], [item([0, 1], 'Coffee was $8.')], [record(8), record(10, { kind: 'goal', period: 'day', comparator: 'at_most' })]);
  assert.deepEqual(resolved, [[['user', 'user']]]);
  assert.deepEqual(rows.map(({ kind, value, receiptId }) => [kind, value, receiptId]), [['goal', 10, 'canonical-user']]);
  assert.deepEqual(diagnostics, [ungrounded]);
});
