import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'historical-synthetic', scope: 'personal', projectId: null };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const receipt = (eventId, excerpt = eventId) => ({ client: 'synthetic', sessionId: 'history', eventId, role: 'user', excerpt });
const ref = (memory) => ({ memoryId: memory.id, revision: memory.revision });
const detail = (core, memory) => ok(core.get({ namespace, memoryId: memory.id }));
const admit = (core, content, ns = namespace, event = content, excerpt = content) => ok(core.admit({ namespace: ns,
  memory: { content, kind: 'fact' }, receipts: [receipt(event, excerpt)] })).memory;
const replace = (core, memory, content) => ok(core.supersede({ namespace, memoryId: memory.id,
  expectedRevision: memory.revision, replacement: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
function fixture(t, model = { countTokens: (text) => Math.ceil(text.length / 4) }) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-history-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db, model, path };
}
function chain(core) {
  const a = admit(core, 'The review is Friday.');
  const b = replace(core, a, 'The review is Monday.');
  const c = replace(core, b, 'The review is Tuesday.');
  return [detail(core, a).memory, detail(core, b).memory, detail(core, c).memory];
}
function history(core, memory, patch = {}) {
  return ok(core.fetch({ namespace, view: 'historical', refs: [ref(memory)], ...patch }));
}

test('H1 states filter precedes pagination; absent and both orders preserve the all-state cursor', (t) => {
  const { core } = fixture(t); const memories = chain(core);
  admit(core, 'Foreign history must stay foreign.', { ...namespace, ownerId: 'foreign' });
  const base = ok(core.list({ namespace, limit: 1 }));
  for (const states of [['active', 'historical'], ['historical', 'active']]) {
    assert.deepEqual(ok(core.list({ namespace, limit: 1, states })), base);
    assert.deepEqual(ok(core.list({ namespace, limit: 1, states, cursor: base.nextCursor })),
      ok(core.list({ namespace, limit: 1, cursor: base.nextCursor })));
  }
  for (const state of ['active', 'historical']) {
    let cursor; const found = [];
    do {
      const page = ok(core.list({ namespace, states: [state], limit: 1, ...(cursor ? { cursor } : {}) }));
      assert.equal(page.memories.length, 1);
      assert.equal(page.memories[0].state, state);
      assert.equal(Object.hasOwn(page.memories[0], 'content'), false);
      found.push(page.memories[0].id); cursor = page.nextCursor;
      assert.ok(found.length <= memories.length);
    } while (cursor);
    assert.deepEqual(found.sort(), memories.filter((m) => m.state === state).map((m) => m.id).sort());
  }
});

test('H1 invalid state filters and historical view inputs reject explicitly', (t) => {
  const { core } = fixture(t); const [old] = chain(core);
  for (const states of [null, [], 'historical', ['deleted'], ['active', 'active'], ['historical', 'ACTIVE'],
    Array(1), [null], Object.assign(['active'], { extra: true })]) error(core.list({ namespace, states }), 'invalid_input');
  for (const view of [null, '', 'all', 'asOf', {}, 1]) error(core.fetch({ namespace, refs: [ref(old)], view }), 'invalid_input');
  error(core.fetch({ namespace, refs: [ref(old)], view: 'historical', asOf: '2026-01-01' }), 'invalid_input');
});

test('H1 list cursors bind filters, namespace and operation and invalidate after mutations', (t) => {
  const { core } = fixture(t); const [old] = chain(core);
  const cursor = ok(core.list({ namespace, states: ['historical'], limit: 1 })).nextCursor;
  assert.ok(cursor);
  for (const patch of [{ states: ['active'] }, { states: ['active', 'historical'] },
    { namespace: { ...namespace, ownerId: 'foreign' } }]) {
    error(core.list({ namespace, states: ['historical'], limit: 1, cursor, ...patch }), 'invalid_cursor');
  }
  error(core.list({ namespace, limit: 1, cursor }), 'invalid_cursor');
  error(core.fetch({ namespace, view: 'historical', refs: [ref(old)], cursor }), 'invalid_cursor');
  admit(core, 'New observation');
  error(core.list({ namespace, states: ['historical'], limit: 1, cursor }), 'cursor_stale');
});

test('H2 historical fetch exposes exact retained A-to-B-to-C links; defaults stay current-only', (t) => {
  const { core } = fixture(t); const [a, b, c] = chain(core);
  for (const memory of [a, b]) {
    const inspected = detail(core, memory);
    assert.deepEqual(history(core, memory).items, [{ memory: inspected.memory, receipts: inspected.receipts,
      receiptCount: inspected.memory.receiptCount, supersession: inspected.supersession }]);
    for (const patch of [{}, { view: 'current' }]) {
      const result = ok(core.fetch({ namespace, refs: [ref(memory)], ...patch }));
      assert.deepEqual(result.items, []); assert.equal(result.invalidRefs[0].reason, 'not_found');
    }
  }
  assert.equal(history(core, a).items[0].supersession.replacement.memoryId, b.id);
  assert.equal(history(core, a).items[0].supersession.replacement.state, 'historical');
  assert.equal(history(core, b).items[0].supersession.replacement.memoryId, c.id);
  const current = ok(core.fetch({ namespace, refs: [ref(c)] }));
  assert.deepEqual(ok(core.fetch({ namespace, refs: [ref(c)], view: 'current' })), current);
  assert.equal(Object.hasOwn(current.items[0], 'supersession'), false);
  assert.deepEqual(history(core, c).items, []);
  assert.equal(history(core, c).invalidRefs[0].reason, 'not_found');
  assert.ok(!JSON.stringify(ok(core.map({ namespace }))).includes(a.id));
});

test('H2 historical receipt pagination is bounded, counts link metadata and preserves every receipt', (t) => {
  const { core, model } = fixture(t); let a;
  for (let index = 0; index < 105; index++) a = admit(core, 'Many retained sources', namespace,
    `source-${index}`, `Source ${index}: ${'x'.repeat(250)}`);
  replace(core, a, 'Current observation'); a = detail(core, a).memory;
  const expectedLink = detail(core, a).supersession;
  let cursor; let pages = 0; const seen = new Set();
  do {
    const response = core.fetch({ namespace, view: 'historical', refs: [ref(a)], tokenBudget: 1500,
      ...(cursor ? { cursor } : {}) });
    const page = ok(response);
    assert.ok(model.countTokens(JSON.stringify(response)) <= 1500);
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0].supersession, expectedLink);
    assert.equal(page.items[0].receiptCount, 105);
    for (const source of page.items[0].receipts) { assert.ok(!seen.has(source.id)); seen.add(source.id); }
    cursor = page.nextCursor; assert.ok(++pages < 100);
  } while (cursor);
  assert.equal(seen.size, 105); assert.ok(pages > 2);
  model.countTokens = (text) => text.includes('"supersession"') ? 4001 : 1;
  error(core.fetch({ namespace, view: 'historical', refs: [ref(a)] }), 'context_item_too_large');
});

test('H2 fetch cursors bind view, refs, namespace and budget and survive cold reopen', (t) => {
  const { core, model, path } = fixture(t); const [a, b] = chain(core); const refs = [ref(a), ref(b)];
  const cursor = ok(core.fetch({ namespace, refs, view: 'historical' })).nextCursor;
  assert.ok(cursor);
  for (const patch of [{ view: 'current' }, { refs: refs.toReversed() }, { tokenBudget: 3900 },
    { namespace: { ...namespace, ownerId: 'foreign' } }]) {
    error(core.fetch({ namespace, refs, view: 'historical', cursor, ...patch }), 'invalid_cursor');
  }
  error(core.fetch({ namespace, refs, cursor }), 'invalid_cursor');
  const currentCursor = ok(core.fetch({ namespace, refs })).nextCursor;
  error(core.fetch({ namespace, refs, view: 'historical', cursor: currentCursor }), 'invalid_cursor');
  assert.deepEqual(ok(core.fetch({ namespace, refs, cursor: currentCursor })),
    ok(core.fetch({ namespace, refs, view: 'current', cursor: currentCursor })));
  const first = history(core, a); core.close();
  const cold = openMemoryCore({ path, model }); t.after(() => cold.close());
  assert.deepEqual(history(cold, a), first);
  assert.equal(ok(cold.fetch({ namespace, refs, view: 'historical', cursor })).items[0].memory.id, b.id);
});

test('H3 stale historical refs, foreign namespaces and deleted records expose no bodies or receipts', (t) => {
  const { core } = fixture(t); const [a] = chain(core);
  assert.equal(history(core, a, { refs: [{ ...ref(a), revision: a.revision - 1 }] }).invalidRefs[0].reason, 'stale');
  for (const foreign of [{ ...namespace, ownerId: 'foreign' }, { ...namespace, scope: 'project', projectId: 'foreign' }]) {
    const page = history(core, a, { namespace: foreign });
    assert.deepEqual(page.items, []); assert.equal(page.invalidRefs[0].reason, 'not_found');
    assert.ok(!JSON.stringify(page).includes(a.content));
  }
  ok(core.forget({ namespace, memoryId: a.id, expectedRevision: a.revision }));
  assert.deepEqual(history(core, a).items, []);
  assert.equal(history(core, a).invalidRefs[0].reason, 'not_found');
  assert.ok(!ok(core.list({ namespace, states: ['historical'] })).memories.some((memory) => memory.id === a.id));
});

for (const action of ['correct', 'forget', 'corrupt']) {
  test(`H3 ${action} successor cannot substitute new or foreign evidence for retained history`, (t) => {
    const { core, db } = fixture(t); const a = admit(core, 'Original position'); const b = replace(core, a, 'Updated position');
    const old = detail(core, a).memory;
    let foreign;
    if (action === 'correct') ok(core.correct({ namespace, memoryId: b.id, expectedRevision: b.revision,
      content: 'Unrelated corrected body', kind: 'fact', receipt: receipt('corrected', 'Unrelated corrected evidence') }));
    if (action === 'forget') ok(core.forget({ namespace, memoryId: b.id, expectedRevision: b.revision }));
    if (action === 'corrupt') {
      foreign = admit(core, 'Foreign private body', { ...namespace, ownerId: 'foreign' });
      db.prepare('UPDATE memory_supersessions SET replacement_memory_id=?').run(foreign.id);
    }
    const fetched = history(core, old).items[0];
    assert.deepEqual(fetched.supersession, detail(core, old).supersession);
    assert.equal(fetched.supersession.evidenceAvailable, false);
    assert.deepEqual(fetched.supersession.receiptIds, []);
    if (action !== 'correct') assert.equal(fetched.supersession.replacement, null);
    for (const hidden of ['Unrelated corrected body', 'Unrelated corrected evidence', 'Foreign private body', ...(foreign ? [foreign.id] : [])])
      assert.ok(!JSON.stringify(fetched).includes(hidden));
    assert.equal(fetched.memory.content, 'Original position');
    assert.equal(fetched.receipts[0].excerpt, 'Original position');
  });
}

test('H3 deletion during token counting invalidates the historical snapshot before returning evidence', (t) => {
  const { core, model } = fixture(t); const [a] = chain(core); let deleted = false;
  model.countTokens = (text) => {
    if (!deleted && text.includes(a.content)) {
      deleted = true; ok(core.forget({ namespace, memoryId: a.id, expectedRevision: a.revision }));
    }
    return 1;
  };
  error(core.fetch({ namespace, view: 'historical', refs: [ref(a)] }), 'index_revision_conflict');
  assert.equal(deleted, true);
});
