import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest } from '@cairn-ink/core/ledger';
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

for (const [name, text, grounded, rejected] of [
  ['range', '$3k-$5k', [3000, 5000, -5000], [5]],
  ['refund', '-$20 refund', [-20, 20], [2]],
  ['scale with adjacent units', '3kUSD and $4.2mUSD', [3, 3000, 4.2, 4_200_000], [30, 420]],
  ['dotted date', '2026.11.25', [2026, 11, 25], [2026.11, 11.25]],
  ['number-word hyphen', 'twenty‑five', [25], [20, 5]],
  ['Chinese sections', '一萬零十二 and 一萬億', [10_012, 1_000_000_000_000], [12, 10_000]],
  ['Chinese decimal', '三點五萬', [35_000], [3, 50_000]],
  ['exact decimal tie', '1.000065k', [1000.07], [1000.06]],
]) {
  test(`review probe: capture keeps the cited ${name} and drops unsupported rows`, async () => {
    const { rows, diagnostics, resolved } = await capture([
      message('earliest', 'This receipt has no amount.'),
      message('grounded', text, 'user', 100),
    ], [item([0, 1])], [
      ...grounded.map(value => record(value)),
      ...rejected.map(value => record(value, { category: 'excluded probe' })),
    ]);
    assert.deepEqual(rows.map(({ value, receiptId, date }) => [value, receiptId, date]),
      grounded.map(value => [value, 'canonical-grounded', 100]));
    assert.deepEqual(resolved, [[['earliest', 'user'], ['grounded', 'user']]]);
    assert.deepEqual(diagnostics, rejected.map(() => ungrounded));
    const summary = digest(rows, [], { fromMs: 0, toMs: 200, label: 'capture' });
    assert.match(summary.body, /Coffee: total/);
    assert.doesNotMatch(summary.body, /excluded probe/i);
  });
}

for (const [text, readings, extras] of [
  ['4.2km', [4.2, 4200], { measure: 'distance', unit: 'km', category: 'walk', group: 'fitness' }],
  ['70kg', [70, 70_000], { measure: 'weight', unit: 'kg', category: 'body', group: 'health' }],
  ['$20monthly', [20, 20_000_000]], ['$4.2mm', [4.2, 4_200_000]],
  ['3kUSD', [3, 3000]], ['$4.2mUSD', [4.2, 4_200_000]],
  ['3k元', [3, 3000], { unit: 'TWD' }], ['3k5', [3000, 5]],
]) {
  test(`fix2 regression: capture keeps both readings for ${text}`, async () => {
    const { rows, diagnostics } = await capture([message('user', text)], [item([0], text)],
      readings.map(value => record(value, extras)));
    assert.deepEqual(rows.map(({ value, receiptId }) => [value, receiptId]),
      readings.map(value => [value, 'canonical-user']));
    assert.deepEqual(diagnostics, []);
  });
}

test('capture keeps only scaled readings for standalone scale letters', async () => {
  for (const [text, grounded, rejected] of [
    ['3k', [3000], [3]], ['3K.', [3000], [3]], ['$4.2m ', [4_200_000], [4.2]],
    ['3k-5k', [3000, 5000], [3, 5]],
  ]) {
    const { rows, diagnostics } = await capture([message('user', text)], [item([0], text)],
      [...grounded, ...rejected].map(value => record(value)));
    assert.deepEqual(rows.map(({ value, receiptId }) => [value, receiptId]),
      grounded.map(value => [value, 'canonical-user']), text);
    assert.deepEqual(diagnostics, rejected.map(() => ungrounded), text);
  }
});

test('fix3 regression: capture grounds both 19,999-unit receipts after normalization', async () => {
  for (const ending of ['.', '…']) {
    const text = '$42 ' + 'x '.repeat(9_997) + ending;
    assert.equal(text.length, 19_999);
    const { rows, diagnostics } = await capture([message('user', text)], [item([0])], [record(42)]);
    assert.deepEqual(rows.map(({ value, receiptId }) => [value, receiptId]), [[42, 'canonical-user']], ending);
    assert.deepEqual(diagnostics, [], ending);
  }
});
