import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as ledger from '@cairn-ink/core/ledger';
import { buildModelRequest } from '../src/capture/wire.mjs';
import { plainExtractionSpec, validatePlainExtraction } from '../src/extraction/extraction.mjs';

const day = 86_400_000;
const today = Date.UTC(2026, 0, 2);
const yesterday = today - day;
const memoryId = 'memory';
const textHash = 'purchase-hash';
const quantity = (category = 'tea', value = 6, fields = {}) => ({
  item: 0, kind: 'record', measure: 'spend', value, unit: 'USD',
  group: 'food', category, period: 'none', comparator: 'none', ...fields,
});
const receipt = (receiptId, content, occurredAtMs = yesterday, fields = {}) =>
  ({ receiptId, messageId: receiptId, role: 'user', content, occurredAtMs, ...fields });
const reconcile = (quantities, citedReceipts, existingRows = []) =>
  ledger.reconcileLedgerQuantities({ memoryId, textHash, captureTimeMs: today, quantities, citedReceipts, existingRows });
const total = rows => rows.reduce((sum, row) => sum + row.value, 0);
const bindings = rows => rows.map(row => [row.category, row.receiptId, row.ordinal, row.date]);
const row = (fields = {}) => ({
  ...quantity(), memoryId, textHash, receiptId: 'A', date: today, ordinal: 0, ...fields,
});
const window = { fromMs: today, toMs: today + day, label: 'today' };

test('a corrected memory with its original receipt cannot deliver rows from the old content', () => {
  const saved = row();
  const retainedReceipts = new Map([[memoryId, new Set(['A'])]]);
  const memoryStates = new Map([[memoryId, 'current_visible']]);
  const state = memoryTextHashes => ({ memoryStates, retainedReceipts, memoryTextHashes });
  assert.equal(ledger.ledgerRowDeliverable(saved, state(new Map([[memoryId, textHash]]))), true);
  assert.equal(ledger.ledgerRowDeliverable(saved, state(new Map([[memoryId, 'water-hash']]))), false);
  assert.equal(ledger.ledgerRowDeliverable(saved, state(new Map())), false);
  assert.equal(ledger.ledgerRowDeliverable(row({ textHash: undefined }), state(new Map())), false);
});

test('re-citing two teas with price-only or named corroboration leaves the total at 12', () => {
  const a = receipt('A', 'I bought two teas for 6 USD each.');
  const amounts = [quantity(), quantity()];
  const first = reconcile(amounts, [a]);
  assert.deepEqual(bindings(first), [['tea', 'A', 0, yesterday], ['tea', 'A', 1, yesterday]]);
  assert.deepEqual(first.map(row => row.textHash), [textHash, textHash]);
  for (const content of ['Yes, they were 6 USD each.', 'Yes, both teas were 6 USD each.', 'The price was 6 USD.']) {
    const inserted = reconcile(amounts, [receipt('B', content, today), a], first);
    assert.deepEqual(inserted, []);
    assert.equal(total([...first, ...inserted]), 12);
  }
});

test('superset and subset extractions preserve the original coffee and date the cake on its own receipt', () => {
  const a = receipt('A', 'Coffee cost 6 USD. I skipped cake.');
  const b = receipt('B', 'Cake cost 6 USD.', today);
  const coffee = quantity('coffee');
  const cake = quantity('cake');
  assert.deepEqual(bindings(reconcile([coffee, cake], [a, b])),
    [['coffee', 'A', 0, yesterday], ['cake', 'B', 0, today]]);
  const first = reconcile([coffee], [a, b]);
  assert.deepEqual(bindings(first), [['coffee', 'A', 0, yesterday]]);
  const inserted = reconcile([cake, coffee], [b, a], first);
  assert.deepEqual(bindings(inserted), [['cake', 'B', 0, today]]);
  assert.equal(total([...first, ...inserted]), 12);
  assert.match(ledger.digest([...first, ...inserted], [], window).body, /Cake: total \$6\.00/);
  assert.deepEqual(reconcile([coffee], [a, b], [...first, ...inserted]), []);
});

test('reconciliation favors receipts with no saved row even when an occupied receipt matches the term', () => {
  const a = receipt('A', 'Coffee cost 6 USD. Cake cost 6 USD.');
  const b = receipt('B', 'It cost 6 USD.', today);
  const first = reconcile([quantity('coffee')], [a]);
  const inserted = reconcile([quantity('cake')], [a, b], first);
  assert.deepEqual(bindings(inserted), [['cake', 'B', 0, today]]);
});

test('a second equal purchase citing only a new receipt adds $6 and replay inserts nothing', () => {
  const a = receipt('A', 'Tea cost 6 USD.');
  const b = receipt('B', 'Another tea cost 6 USD.', today);
  const first = reconcile([quantity()], [a]);
  const second = reconcile([quantity()], [b], first);
  assert.deepEqual(bindings(second), [['tea', 'B', 0, today]]);
  const saved = [...first, ...second];
  assert.equal(total(saved), 12);
  assert.deepEqual(reconcile([quantity()], [b, b], saved), []);
  assert.deepEqual(reconcile([quantity(), quantity()], [a, b], saved), []);
});

test('additional amounts continue past the highest ordinal without filling gaps', () => {
  const a = receipt('A', 'Tea cost 6 USD.');
  const saved = row({ date: yesterday, ordinal: 4 });
  const unrelated = row({ receiptId: 'A', memoryId: 'other', ordinal: 10 });
  const inserted = reconcile([quantity(), quantity(), quantity()], [a, a], [saved, unrelated]);
  assert.deepEqual(bindings(inserted), [['tea', 'A', 5, yesterday], ['tea', 'A', 6, yesterday]]);
});

test('fresh attribution retains shared receipts, canonical ordering, aliases and date fallback', () => {
  const a = receipt('canonical-a', 'Coffee cost 6 USD and cake cost 4 USD.', yesterday, { messageId: 'a' });
  const b = receipt('canonical-b', 'I went for a walk.', yesterday, { messageId: 'b' });
  const undated = receipt('canonical-undated', '咖啡 １，２００．５０ 元。', null);
  const assistant = receipt('assistant', 'Coffee cost 1200.50 USD.', yesterday, { role: 'assistant' });
  const price = receipt('price', 'It cost 1,200.50 USD.', today);
  assert.deepEqual(bindings(reconcile([quantity('coffee'), quantity('cake', 4)], [a])),
    [['coffee', 'canonical-a', 0, yesterday], ['cake', 'canonical-a', 0, yesterday]]);
  assert.deepEqual(bindings(reconcile([quantity('coffee', 1200.5), quantity('tea', 1200.5), quantity('cake', 3)],
    [b, undated, assistant, a, price])),
  [['coffee', 'canonical-undated', 0, today], ['tea', 'price', 0, today], ['cake', 'canonical-a', 0, yesterday]]);
  assert.deepEqual(reconcile([quantity()], [assistant]), []);
});

test('capture finish reads and writes the scoped ledger through the same live transaction', async () => {
  const a = receipt('A', 'Tea cost 6 USD.');
  const tx = {};
  const scope = {};
  const existing = row({ date: yesterday });
  let read = false;
  const store = {
    async listForMemory(actualTx, actualScope, id) {
      assert.equal(actualTx, tx);
      assert.equal(actualScope, scope);
      assert.equal(id, memoryId);
      read = true;
      return [existing];
    },
    async put(actualTx, actualScope, rows) {
      assert.equal(actualTx, tx);
      assert.equal(actualScope, scope);
      assert.equal(read, true);
      assert.deepEqual(bindings(rows), [['tea', 'A', 1, yesterday]]);
      return { inserted: 1 };
    },
  };
  const capture = { memoryId, textHash, captureTimeMs: today, citedReceipts: [a] };
  assert.deepEqual(await ledger.writeLedgerQuantities(tx, scope, store, { ...capture, quantities: [quantity()] }),
    { inserted: 0 });
  assert.deepEqual(await ledger.writeLedgerQuantities(tx, scope, store, { ...capture, quantities: [quantity(), quantity()] }),
    { inserted: 1 });
});

test('both opt-in request builders match the exact frozen system bytes', () => {
  const messages = [{ role: 'user', content: 'Tea cost 6 USD.' }];
  const options = { quantities: true };
  const base = plainExtractionSpec(messages);
  const { request } = buildModelRequest('extract', { ...base, maxOutputTokens: 1024 }, options);
  for (const system of [plainExtractionSpec(messages, options).system, request.system]) {
    const bytes = Buffer.from(system, 'utf8');
    assert.equal(bytes.length, 3956);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      '088a76824a2cb69635940c3a7fd9ea3d453fe79b13573689b8521cba3f1127d7');
  }
});

test('the drop selector validates one tagged key and rejects ambiguous selectors', () => {
  for (const by of ['memoryId', 'receiptId']) {
    assert.equal(ledger.ledgerDropSelector({ by, id: 'r' }), by);
  }
  for (const selector of [
    { memoryId: undefined, receiptId: 'r' },
    { by: 'receiptId', id: 'r', memoryId: undefined },
    { by: 'receiptId', id: undefined },
    { by: 'other', id: 'r' },
  ]) {
    assert.throws(() => ledger.ledgerDropSelector(selector), { code: 'invalid_input' });
  }
});

const fail = () => { throw new Error('unexpected quantity access'); };
const item = { kind: 'fact', content: 'Tea cost 6 USD.', confidence: 1, sourceIndices: [0] };
const revoked = Proxy.revocable([], {});
revoked.revoke();
const revokedEntry = Proxy.revocable(quantity(), {});
revokedEntry.revoke();
for (const [name, output] of [
  ['revoked list', { items: [item], quantities: revoked.proxy }],
  ['list length', { items: [item], quantities: new Proxy([quantity()], { get: fail }) }],
  ['entry validation after a valid quantity', { items: [item], quantities: [quantity(), revokedEntry.proxy] }],
  ['top-level quantity property', new Proxy({ items: [item], quantities: [] }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'quantities') fail();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  })],
]) {
  test(`an exception reading ${name} drops all quantities and keeps valid items`, () => {
    assert.deepEqual(validatePlainExtraction(output, { sourceCount: 1, itemLimit: 5 }, { quantities: true }), {
      items: [item], quantities: [], dropped: { invalid_extraction_quantity: 1 },
    });
  });
}

test('small non-currency totals and averages retain their non-zero values', () => {
  for (const value of [0.004, 0.000000004, Number.MIN_VALUE]) {
    const distance = row({ measure: 'distance', category: '', group: 'fitness', unit: 'km', value });
    const { body } = ledger.digest([distance], [], window);
    const displayed = body.match(/Distance: total ([\d.,]+) km.*average ([\d.,]+) km/);
    assert.ok(displayed, body);
    assert.equal(Number(displayed[1].replaceAll(',', '')), value, body);
    assert.equal(Number(displayed[2].replaceAll(',', '')), value, body);
  }
  assert.match(ledger.digest([row({ value: 0.004 })], [], window).body, /Spend: total \$0\.00/);
  const speed = row({ measure: 'speed', unit: 'MPH', value: 0.004 });
  assert.match(ledger.digest([speed], [], window).body, /Speed: total 0\.004 MPH/);
});

test('goal status compares displayed totals and limits for currency and non-currency units', () => {
  for (const [unit, values, target] of [
    ['USD', [0.1, 0.2], 0.3],
    ['km', [0.123456, 0.0000004], 0.123456],
  ]) {
    const records = values.map(value => row({ value, unit }));
    const goals = ['at_most', 'at_least'].map(comparator =>
      row({ kind: 'goal', period: 'day', value: target, unit, comparator }));
    const { body } = ledger.digest(records, goals, window);
    assert.equal([...body.matchAll(/goal met/g)].length, 2, body);
    assert.doesNotMatch(body, /over by|under by/);
  }
});
