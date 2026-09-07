import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';

const ns = { ownerId: 'fetch-test', scope: 'personal', projectId: null };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false); assert.equal(r.error.code, code); assert.deepEqual(Object.keys(r), ['ok', 'error']); };
function fixture(t, model = createMockRecallModel()) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-fetch-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model });
  t.after(() => core.close());
  return { core, model, path };
}
function admit(core, content, eventId = content, namespace = ns, excerpt = content) {
  return ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [
    { client: 'test', sessionId: 's', eventId, role: 'user', excerpt },
  ] })).memory;
}
const ref = (m) => ({ memoryId: m.id, revision: m.revision });

test('fetch returns exact current content and real receipts, not navigation labels', (t) => {
  const { core, model } = fixture(t);
  const m = admit(core, 'Use SQLite for the synthetic prototype.');
  const before = ok(core.get({ namespace: ns, memoryId: m.id }));
  const result = ok(core.fetch({ namespace: ns, refs: [ref(m)] }));
  assert.deepEqual(result.items, [{ memory: before.memory, receipts: before.receipts, receiptCount: 1 }]);
  assert.equal(result.exhausted, true);
  assert.equal(result.nextCursor, null);
  assert.equal(model.calls.length, 0);
});

test('foreign, missing, forgotten and stale refs never emit memory or receipt payload', (t) => {
  const { core } = fixture(t);
  const own = admit(core, 'Old revision');
  const other = admit(core, 'Foreign secret prose', 'foreign', { ...ns, ownerId: 'other' });
  const gone = admit(core, 'Forgotten prose');
  ok(core.forget({ namespace: ns, memoryId: gone.id, expectedRevision: gone.revision }));
  const refs = [ref(other), { memoryId: 'missing', revision: 1 }, ref(gone), { memoryId: own.id, revision: 99 }];
  let cursor;
  const invalid = [];
  do {
    const page = ok(core.fetch({ namespace: ns, refs, ...(cursor ? { cursor } : {}) }));
    assert.deepEqual(page.items, []);
    invalid.push(...page.invalidRefs);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(invalid.map((i) => i.reason), ['not_found', 'not_found', 'not_found', 'stale']);
});

test('receipt pages continue the same memory, then next ref, without skips or duplicates', (t) => {
  const { core, model } = fixture(t);
  let first;
  for (let i = 0; i < 105; i++) first = admit(core, 'Many sources', `source-${i}`, ns, `Source ${i} ${'x'.repeat(300)}`);
  const second = admit(core, 'Next memory');
  const refs = [ref(first), ref(second)];
  let cursor;
  const receipts = new Set();
  let pages = 0;
  let sawSecond = false;
  do {
    const response = core.fetch({ namespace: ns, refs, tokenBudget: 1500, ...(cursor ? { cursor } : {}) });
    const page = ok(response);
    assert.ok(model.countTokens(JSON.stringify(response)) <= 1500);
    assert.equal(page.items.length, 1);
    const item = page.items[0];
    if (item.memory.id === first.id) {
      assert.equal(sawSecond, false);
      assert.equal(item.receiptCount, 105);
      for (const source of item.receipts) { assert.equal(receipts.has(source.id), false); receipts.add(source.id); }
    } else sawSecond = true;
    cursor = page.nextCursor;
    assert.ok(++pages < 100);
  } while (cursor);
  assert.equal(receipts.size, 105);
  assert.equal(sawSecond, true);
  assert.ok(pages > 2);
});

test('fetch cursors bind ordered refs, budget, operation, namespace, store and survive reopen', (t) => {
  const { core, model, path } = fixture(t);
  const refs = [ref(admit(core, 'First')), ref(admit(core, 'Second'))];
  const cursor = ok(core.fetch({ namespace: ns, refs })).nextCursor;
  for (const input of [
    { namespace: ns, refs: refs.toReversed(), cursor },
    { namespace: ns, refs, tokenBudget: 3900, cursor },
    { namespace: { ...ns, ownerId: 'other' }, refs, cursor },
    { namespace: ns, refs, cursor: cursor.slice(0, -3) + 'ABC' },
  ]) error(core.fetch(input), 'invalid_cursor');
  error(core.map({ namespace: ns, cursor }), 'invalid_cursor');
  const other = fixture(t);
  error(other.core.fetch({ namespace: ns, refs, cursor }), 'invalid_cursor');
  core.close();
  const reopened = openMemoryCore({ path, model });
  t.after(() => reopened.close());
  assert.equal(ok(reopened.fetch({ namespace: ns, refs, cursor })).items[0].memory.id, refs[1].memoryId);
  admit(reopened, 'Mutation');
  error(reopened.fetch({ namespace: ns, refs, cursor }), 'cursor_stale');
});

test('bad inputs, absent counting and too-small budget fail explicitly', (t) => {
  const { core } = fixture(t);
  const m = ref(admit(core, 'Budget example'));
  for (const refs of [[], [m, m], [{ ...m, junk: true }], [{ ...m, revision: 0 }],
    Array(1), Object.assign(Array(1), { extra: m })]) {
    error(core.fetch({ namespace: ns, refs }), 'invalid_input');
  }
  for (const tokenBudget of [0, 4001, 1.5]) error(core.fetch({ namespace: ns, refs: [m], tokenBudget }), 'invalid_input');
  error(core.fetch({ namespace: ns, refs: [m], tokenBudget: 1 }), 'context_item_too_large');
  const bare = fixture(t, undefined);
  // Explicitly remove the counter from the otherwise valid mock adapter.
  delete bare.model.countTokens;
  error(bare.core.fetch({ namespace: ns, refs: [m] }), 'token_count_unavailable');
});

test('counter-triggered deletion after fetch snapshot cannot return stale content', (t) => {
  const model = createMockRecallModel();
  const { core } = fixture(t, model);
  const m = admit(core, 'Must not escape');
  const count = model.countTokens;
  model.countTokens = (text) => {
    if (text.includes('Must not escape')) ok(core.forget({ namespace: ns, memoryId: m.id, expectedRevision: m.revision }));
    return count(text);
  };
  error(core.fetch({ namespace: ns, refs: [ref(m)] }), 'index_revision_conflict');
});
