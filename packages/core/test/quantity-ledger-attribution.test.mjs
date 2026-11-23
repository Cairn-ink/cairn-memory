import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributeLedgerQuantities, ledgerRowKey } from '@cairn-ink/core/ledger';

const jan1 = Date.UTC(2026, 0, 1);
const jan2 = Date.UTC(2026, 0, 2);
const jan3 = Date.UTC(2026, 0, 3);
const quantity = (category, value = 6, fields = {}) => ({
  item: 0, kind: 'record', measure: 'spend', value, unit: 'USD',
  group: 'food', category, period: 'none', comparator: 'none', ...fields,
});
const receipt = (receiptId, content, occurredAtMs = jan1, fields = {}) =>
  ({ receiptId, messageId: receiptId, role: 'user', content, occurredAtMs, ...fields });
const attribute = (quantities, receipts) => attributeLedgerQuantities('memory', quantities, receipts, jan3);
const bindings = rows => rows.map(row => [row.category, row.receiptId, row.ordinal, row.date]);
function deduplicate(...batches) {
  const rows = new Map();
  for (const row of batches.flat()) {
    const key = ledgerRowKey(row);
    if (!rows.has(key)) rows.set(key, row);
  }
  return [...rows.values()];
}

test('re-citing a purchase and later replies keeps the original receipt and total', () => {
  const unrelated = receipt('C', 'I stopped at the café.', jan1);
  const a = receipt('A', 'Tea cost 6 USD.', jan2);
  const replies = [receipt('B', 'It was oolong.', jan3), receipt('B', 'The price was 6 USD.', jan3)];
  const first = attribute([quantity('tea')], [unrelated, a]);
  for (const reply of replies) {
    const repeated = attribute([quantity('tea')], [reply, a, unrelated]);
    assert.deepEqual(bindings(repeated), [['tea', 'A', 0, jan2]]);
    assert.equal(deduplicate(first, repeated).reduce((sum, row) => sum + row.value, 0), 6);
  }
});

test('re-extracting a superset in a different order keeps both purchases once', () => {
  const a = receipt('A', 'Coffee cost 6 USD.');
  const b = receipt('B', 'Cake cost 6 USD.', jan2);
  const first = attribute([quantity('coffee')], [a, b]);
  const superset = attribute([quantity('cake'), quantity('coffee')], [b, a]);
  assert.deepEqual(bindings(superset), [['cake', 'B', 0, jan2], ['coffee', 'A', 0, jan1]]);
  assert.equal(deduplicate(first, superset).reduce((sum, row) => sum + row.value, 0), 12);
  assert.deepEqual(deduplicate(first, superset, first), deduplicate(first, superset));
});

test('a price-only corroboration preserves both ordinals for two teas', () => {
  const a = receipt('A', 'I bought two teas for 6 USD each.');
  const b = receipt('B', 'Yes, they were 6 USD each.', jan2);
  const teas = [quantity('tea'), quantity('tea')];
  const first = attribute(teas, [a]);
  const repeated = attribute(teas, [a, b]);
  assert.deepEqual(bindings(repeated), [['tea', 'A', 0, jan1], ['tea', 'A', 1, jan1]]);
  assert.equal(deduplicate(first, repeated).reduce((sum, row) => sum + row.value, 0), 12);
});

test('a second equal purchase gets its own receipt and exact replay adds no row', () => {
  const a = receipt('A', 'Tea cost 6 USD.');
  const b = receipt('B', 'Another tea, 6 USD.', jan2);
  const first = attribute([quantity('tea')], [a]);
  const second = attribute([quantity('tea')], [b]);
  const both = attribute([quantity('tea'), quantity('tea')], [b, a]);
  const replay = attribute([quantity('tea'), quantity('tea')], [a, b, a]);
  assert.deepEqual(bindings(both), [['tea', 'A', 0, jan1], ['tea', 'B', 0, jan2]]);
  assert.equal(deduplicate(first, second, both, replay).reduce((sum, row) => sum + row.value, 0), 12);
});

test('coffee and cake in one item keep distinct identities on a shared receipt', () => {
  const a = receipt('A', 'Coffee cost 6 USD and cake cost 4 USD.');
  const rows = attribute([quantity('coffee'), quantity('cake', 4)], [a]);
  assert.deepEqual(bindings(rows), [['coffee', 'A', 0, jan1], ['cake', 'A', 0, jan1]]);
  assert.equal(deduplicate(rows).reduce((sum, row) => sum + row.value, 0), 10);
});

test('an item with receipts from different days uses each purchase time', () => {
  const a = receipt('A', 'Tea cost 6 USD.', jan1 + 709);
  const b = receipt('B', 'Cake cost 4 USD.', jan2 + 123);
  assert.deepEqual(bindings(attribute([quantity('tea'), quantity('cake', 4)], [b, a])),
    [['tea', 'A', 0, jan1 + 709], ['cake', 'B', 0, jan2 + 123]]);
});

test('CJK aliases, normalized values, user role and value-only fallback', () => {
  const assistant = receipt('assistant', 'Coffee cost 1200.5 USD.', jan1, { role: 'assistant' });
  const valueOnly = receipt('value', 'The price was 1,200.50 USD.', jan2);
  const coffee = receipt('coffee', '咖啡 １，２００．５０ 元。', jan3);
  const amounts = [quantity('coffee', 1200.5), quantity('tea', 1200.5)];
  assert.deepEqual(bindings(attribute(amounts, [assistant, valueOnly, coffee])),
    [['coffee', 'coffee', 0, jan3], ['tea', 'value', 0, jan2]]);
  assert.deepEqual(attribute(amounts, [assistant]), []);
});

test('fallback uses canonical IDs, orders tied receipts by message ID and validates dates', () => {
  const b = receipt('canonical-b', 'I prepared tea.', jan1, { messageId: 'z' });
  const a = receipt('canonical-a', 'I bought tea.', jan1, { messageId: 'a' });
  const unknown = receipt('canonical-unknown', 'Tea cost 6 USD.', NaN);
  assert.deepEqual(bindings(attribute([quantity('tea', 4)], [b, unknown, a])), [['tea', 'canonical-a', 0, jan1]]);
  assert.deepEqual(bindings(attribute([quantity('tea')], [unknown, a])), [['tea', 'canonical-unknown', 0, jan3]]);
});

test('the final candidate receives extra ordinals and replay retains its original date', () => {
  const a = receipt('A', 'Tea cost 6 USD.');
  const b = receipt('B', 'Another tea cost 6 USD.', jan2);
  const rows = attribute(Array.from({ length: 4 }, () => quantity('tea')), [a, b]);
  assert.deepEqual(bindings(rows), [['tea', 'A', 0, jan1], ['tea', 'B', 0, jan2], ['tea', 'B', 1, jan2], ['tea', 'B', 2, jan2]]);
  const replay = attribute([quantity('tea')], [{ ...a, occurredAtMs: jan3 }]);
  assert.deepEqual(deduplicate(rows, replay), rows);
});
