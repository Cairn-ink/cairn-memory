import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sourceFixture, ns, ok, cardHost, localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { fixture, ns as ordinaryNs } from '../testing/context-read-fixture.mjs';
import { readTransaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { expandRelations } from '../context-read-relations.mjs';
import { rankMoc } from '../context-read-moc.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';

function bound(t, raw, namespace = raw ? ns : ordinaryNs) {
  const f = raw ? sourceFixture(t) : fixture(t, { cards: true });
  const memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic needle support', kind: 'fact' }, receipts: [
    { client: 'synthetic', sessionId: 'round2', eventId: 'one', role: 'user', excerpt: 'Synthetic intact contributor' }] })).memory;
  const draft = ok(f.call('createCardDraft', { namespace, actionId: 'draft', drafting: 'authored', input: {
    title: 'Synthetic Card', body: 'Synthetic authored body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] } }));
  const card = ok(f.call('confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: 1, actionId: 'confirm', applicability: 'current' }));
  return { ...f, memory, card, namespace };
}
for (const source of ['relations-one-hop-v1', 'moc-v1']) test(`S1 round2 Raw-enabled intact receipt Card participates in ${source}`, t => {
  const f = bound(t, true), namespace = ns;
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  if (source === 'moc-v1') {
    const index = ok(f.call('mapEvidence', { namespace, type: 'card' })).indexRevision;
    ok(f.call('applyCardPlacement', { namespace, actionId: 'place', expectedIndexRevision: index,
      refs: [{ type: 'card', namespace, cardId: f.card.id, revision: f.card.revision, bodyRevision: f.card.bodyRevision }],
      proposal: { items: [{ cardId: f.card.id, parentIds: [], newL1: { title: 'needle title', parentL2Ids: [] } }] } }));
  }
  const input = { readSet: [namespace], types: source === 'moc-v1' ? ['card'] : ['memory', 'card'], intent: 'current', query: 'needle' };
  const value = readTransaction(f.db, () => source === 'moc-v1' ? rankMoc(f.db, identity,
    { cards: true, receipts: true, reviews: true, organization: true }, input, Infinity) : expandRelations(f.db, identity,
    { cards: true, receipts: true, reviews: true, organization: true }, input,
    [{ ref: { type: 'memory', namespace, memoryId: f.memory.id, revision: f.memory.revision } }], Infinity));
  assert.ok(JSON.stringify(value).includes(f.card.id), JSON.stringify(value));
});
function measured(work) {
  const original = DatabaseSync.prototype.prepare, counts = { preparations: 0, executions: 0 };
  DatabaseSync.prototype.prepare = function(sql) {
    counts.preparations++;
    const statement = original.call(this, sql);
    for (const method of ['get', 'all', 'run']) {
      const execute = statement[method].bind(statement);
      statement[method] = (...args) => { counts.executions++; return execute(...args); };
    }
    return statement;
  };
  try { work(); return counts; } finally { DatabaseSync.prototype.prepare = original; }
}
for (const raw of [false, true]) test(`S1 round2 fifty Cards with sixteen independent receipts: ${raw ? 'Raw' : 'ordinary'} schema`, t => {
  const host = cardHost(), options = { path: ':memory:', privateCards: host.options };
  const core = raw ? openRawCaptureCore(options, { mode: 'off', sources: true, port: localPlainPort(),
    readPolicy: () => ({ generation: 'synthetic', reason: null }) }) : openMemoryCore(options);
  t.after(() => core.close());
  const f = { core, call: (method, input) => host.call(core, method, input) }, namespace = raw ? ns : ordinaryNs;
  for (let i = 0; i < 50; i++) {
    let memory;
    for (let j = 0; j < 16; j++) memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic count body '+i, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'count', eventId: 'event-'+i+'-'+j, role: 'user', excerpt: 'Synthetic excerpt '+j }] })).memory;
    const draft = ok(f.call('createCardDraft', { namespace, actionId: 'draft-'+i, drafting: 'authored', input: {
      title: 'Synthetic count title', body: 'Synthetic count Card', sourcePolicy: 'retained-receipts-v1',
      memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] } }));
    ok(f.call('confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: 1, actionId: 'confirm-'+i }));
  }
  const counts = measured(() => assert.equal(ok(f.call('listCards', { namespace, states: ['confirmed'], limit: 50 })).cards.length, 50));
  t.diagnostic(JSON.stringify({ schema: raw ? 'Raw' : 'ordinary', cards: 50, bindings: 800, ...counts }));
  if (!process.env.CAIRN_SAFETY_COUNT_BASELINE) { assert.ok(counts.preparations <= 160, JSON.stringify(counts)); assert.ok(counts.executions <= (raw ? 3000 : 1200), JSON.stringify(counts)); }
});
test('S1 round2 root memo keeps session fences authoritative in fresh reads', async t => {
  const { createContentReadMemo, receiptReadSafety } = await import('../content-safety.mjs');
  const f = bound(t, true), row = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(f.memory.id);
  const check = () => readTransaction(f.db, () => receiptReadSafety(f.db, { namespace: ns, receipt: row, memo: createContentReadMemo(f.db) }));
  assert.equal(check().allowed, true);
  f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId ?? '', row.client, row.session_id);
  assert.equal(check().allowed, false);
});
for (const state of ['current', 'historical']) test(`S1 round2 awaiting ${state} Memory preserves every legacy gate and context history`, async t => {
  const f = fixture(t, { cards: true, coreOptions: { decisionReview: 'required-v1', model: { countTokens: () => 1 } } }), namespace = ordinaryNs;
  const memory = f.admit('Synthetic awaiting safety body'), db = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => db.close());
  db.prepare("UPDATE memories SET review_state='awaiting',currentness=?,kind='instruction' WHERE id=?").run(state, memory.id);
  const ref = { type: 'memory', namespace, memoryId: memory.id, revision: memory.revision };
  for (const intent of ['current', 'history']) {
    const result = f.call('fetchEvidence', { namespace, refs: [ref], intent });
    assert.equal(result.ok, intent === 'history', JSON.stringify(result));
  }
  for (const view of ['current', 'historical']) for (const contextMode of [undefined, 'source-evidence', 'rationale-evidence']) {
    const response = f.core.fetch({ namespace, refs: [{ memoryId: memory.id, revision: memory.revision }], view, ...(contextMode ? { contextMode } : {}) });
    if (view === 'historical' && contextMode === 'rationale-evidence') { assert.equal(response.error?.code, 'invalid_input'); continue; }
    const value = ok(response);
    assert.deepEqual(value.items, []); assert.deepEqual(value.invalidRefs, [{ memoryId: memory.id, reason: 'not_found' }]);
  }
  assert.equal(f.core.get({ namespace, memoryId: memory.id }).error.code, 'memory_not_found');
  assert.equal(ok(f.core.get({ namespace, memoryId: memory.id, includeAwaiting: true })).memory.id, memory.id);
  for (const states of [['active'], ['historical'], ['active', 'historical']]) assert.deepEqual(ok(f.core.list({ namespace, states })).memories, []);
  assert.equal(ok(f.core.list({ namespace, reviewState: 'awaiting', states: ['active', 'historical'] })).memories[0].id, memory.id);
  for (const purpose of ['recall', 'classification']) assert.deepEqual(ok(f.core.map({ namespace, purpose })).items, []);
  const startup = ok(f.core.sessionStartContext({ namespace }));
  assert.deepEqual(startup.groups.procedural.items, []); assert.equal(JSON.stringify(startup).includes(memory.id), false);
  const now = Date.now();
  for (const timeBasis of ['receipt', 'revision']) for (const states of [['active'], ['historical'], ['active', 'historical']]) assert.deepEqual(ok(f.core.listMemoriesByTime({ namespace, timeBasis,
    states, since: new Date(now-86400000).toISOString(), until: new Date(now+86400000).toISOString() })).items, []);
  const legacy = openMemoryStore({ path: f.path });
  try { const scope = legacy.scope({ ownerId: namespace.ownerId, projectId: namespace.projectId });
    assert.equal(scope.get(memory.id), null); assert.deepEqual(scope.list(), []); assert.deepEqual(scope.search('awaiting'), []);
  } finally { legacy.close(); }
});
test('S1 round2 trusted legacy method policy cannot opt into awaiting history', async t => {
  const { contentReadSafety } = await import('../content-safety.mjs');
  const f = fixture(t), namespace = ordinaryNs, memory = f.admit('Synthetic trusted method policy');
  const db = new DatabaseSync(f.path, { timeout: STORAGE_BUSY_TIMEOUT_MS }); t.after(() => db.close());
  db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const ref = { type: 'memory', namespace, memoryId: memory.id, revision: memory.revision };
  readTransaction(db, () => {
    for (const intent of ['current', 'history']) for (const method of ['fetch', 'get', 'list', 'search', 'map', 'sessionStartContext', 'listMemoriesByTime'])
      assert.equal(contentReadSafety(db, { identity, namespace, ref, intent, method }).allowed, false);
    assert.equal(contentReadSafety(db, { identity, namespace, ref, intent: 'history' }).allowed, true);
  });
});
