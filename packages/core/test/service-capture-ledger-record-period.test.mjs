import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryService } from '@cairn-ink/core/service';
import { hostedScope as scope, serviceFake } from './helpers/service-fake.mjs';

const event = { client: 'client', sessionId: 'session', eventId: 'event' };
const occurredAtMs = 100;
const messages = [{
  id: 'user', role: 'user', occurredAtMs,
  content: 'I just spent $7.98 on coffee earlier this morning, a small but regular part of my daily routine.',
}];

async function capture(comparator) {
  const { deps, hooks, storage } = serviceFake({ writes: true, capture: true, hasKey: false });
  const rows = [], diagnostics = [];
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
  storage.capture.retainedReceiptIds = async (_tx, _scope, _id, receipts) =>
    receipts.map(({ messageId }) => `canonical-${messageId}`);
  hooks.model = () => ({
    items: [{ kind: 'fact', confidence: 1, content: 'I spent $7.98 on coffee this morning.', sourceIndices: [0] }],
    quantities: [{
      item: 0, kind: 'record', measure: 'spend', value: 7.98, unit: 'USD',
      category: 'coffee', group: 'food', period: 'day', comparator,
    }],
  });
  const service = createMemoryService(deps);
  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: 'accepted' });
  assert.equal((await service.runCapture(scope, event)).status, 'done');
  return { rows, diagnostics };
}

test('capture stores a grounded record returned with a day period as a dated row', async () => {
  const { rows, diagnostics } = await capture('none');
  assert.deepEqual(rows.map(({ kind, value, period, date }) => ({ kind, value, period, date })), [
    { kind: 'record', value: 7.98, period: 'none', date: occurredAtMs },
  ]);
  assert.deepEqual(diagnostics, []);
});

test('capture drops a record with a day period and a comparator', async () => {
  const { rows, diagnostics } = await capture('at_most');
  assert.deepEqual(rows, []);
  assert.deepEqual(diagnostics, [
    { version: 1, stage: 'extract', layer: 'core_validation', reason: 'invalid_extraction_quantity' },
  ]);
});
