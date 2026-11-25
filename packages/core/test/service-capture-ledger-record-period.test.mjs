import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryService } from '@cairn-ink/core/service';
import { hostedScope as scope, serviceFake } from './helpers/service-fake.mjs';

const event = { client: 'client', sessionId: 'session', eventId: 'event' };
const occurredAtMs = 100;
const occasion = 'I paid $8 for tea this morning, part of my daily routine.';
const rate = 'I usually spend about $8 a day on tea.';

async function capture(contents, { value = 8, period = 'day', comparator = 'none' } = {}) {
  const messages = contents.map((content, index) => ({
    id: `user-${index}`, role: 'user', occurredAtMs, content,
  }));
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
    items: [{ kind: 'fact', confidence: 1, content: contents[0], sourceIndices: messages.map((_, index) => index) }],
    quantities: [{
      item: 0, kind: 'record', measure: 'spend', value, unit: 'USD',
      category: 'tea', group: 'food', period, comparator,
    }],
  });
  const service = createMemoryService(deps);
  assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: 'accepted' });
  assert.equal((await service.runCapture(scope, event)).status, 'done');
  return { rows, diagnostics };
}

function assertDatedRow({ rows, diagnostics }) {
  assert.deepEqual(rows.map(({ kind, value, period, date }) => ({ kind, value, period, date })), [
    { kind: 'record', value: 8, period: 'none', date: occurredAtMs },
  ]);
  assert.deepEqual(diagnostics, []);
}

function assertDropped({ rows, diagnostics }, reason) {
  assert.deepEqual(rows, []);
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'extract', layer: 'core_validation', reason }]);
}

test('capture stores a day-tagged record as a dated row when a cited occasion states its value', async () => {
  assertDatedRow(await capture([occasion]));
  assertDatedRow(await capture([occasion, rate]));
});

test('capture drops a grounded day-tagged spending rate', async () => {
  assertDropped(await capture([rate]), 'periodic_extraction_quantity');
});

test('capture drops a grounded day-tagged budget mislabelled as a record', async () => {
  assertDropped(await capture(['My daily budget is $50.'], { value: 50 }), 'periodic_extraction_quantity');
});

test('capture requires the occasion and matching value in the same cited message', async () => {
  assertDropped(await capture([rate, 'I paid $9 for tea this morning.']), 'periodic_extraction_quantity');
});

test('capture diagnoses a day-tagged record without the cited value as ungrounded', async () => {
  assertDropped(await capture([occasion], { value: 9 }), 'ungrounded_extraction_quantity');
});

test('capture drops a record with a day period and a comparator', async () => {
  assertDropped(await capture([occasion], { comparator: 'at_most' }), 'invalid_extraction_quantity');
});

test('capture still stores a grounded untagged record in a rate message', async () => {
  assertDatedRow(await capture([rate], { period: 'none' }));
});
