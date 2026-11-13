import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { scriptedConsolidator } from '../testing/engine-card-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openMemoryCore } from '../index.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { createPrivateEvidenceStorage } from '../private-evidence-storage.mjs';
import { createPrivateOrganizationStorage } from '../private-organization-storage.mjs';
import { contentReadSafety, createContentReadMemo, engineCardRevisionsInside } from '../content-safety.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { inContentSuppressionRequestInside } from '../content-suppression-storage.mjs';
import { readTransaction } from '../database.mjs';
import { performance } from 'node:perf_hooks';

const surviving = 'Synthetic surviving signal';
const siblingText = 'Synthetic sibling secret';
const cardBody = 'Synthetic derived card signal';
const row = (f, id) => f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(id);

async function rawFixture(t, mode, operation) {
  const trusted = contextHost();
  const model = { ...scriptedConsolidator(), extract: () => ({ items: [
    { content: surviving, kind: 'fact', confidence: .8, sourceIndices: [0] },
    { content: siblingText, kind: operation === 'reject' ? 'decision' : 'fact', confidence: .8, sourceIndices: [0] },
  ] }) };
  const options = { model, decisionReview: 'required-v1' };
  if (mode === 'sealed Raw') return { ...await lineageFixture(t, { base: 33, raw: true, options }), model, trusted };
  const f = safetyFixture(t, 33);
  await f.migrate();
  const host = lineageHost();
  const core = openRawCaptureCore({ path: f.path, privateCards: host.options, ...options }, {
    mode: 'raw-v1', sources: true, deletion: true, port: localPlainPort(),
    readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const db = f.connect(); attestContentSafety(db);
  t.after(() => { core.close(); db.close(); });
  return { ...f, core, db, model, trusted, host, call: (method, input) => host.call(core, method, input),
    identity: db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() };
}
async function fixture(t, mode, operation) {
  const f = await rawFixture(t, mode, operation);
  const context = openMemoryCore({ path: f.path, privateCards: f.host.options, contextRead: {
    version: 'context-read-v1', authority: f.trusted.authority, counter: { id: 'synthetic', countTokens: () => 1 } } });
  t.after(() => context.close());
  return { ...f, context };
}

for (const mode of ['sealed Raw', 'suppression Raw without sealed lineage'])
for (const operation of ['forget', 'correct', 'reject'])
test(`current engine Card denied after sibling ${operation}, ${mode}`, async t => {
  const f = await fixture(t, mode, operation);
  const captured = ok(await f.core.captureRaw(request(splitRaw(surviving + '. ' + siblingText + '.')[0], { namespace: ns })));
  const [memory, sibling] = ok(captured.interpretation).admission.memories;
  const independent = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic independent surviving evidence', kind: 'fact' },
    receipts: [receipt('synthetic-independent')] })).memory;
  const spans = id => f.db.prepare(`SELECT l.conversation_id,l.message_id,l.start,l.end FROM raw_receipt_lineage l
    JOIN receipts r ON r.id=l.receipt_id WHERE r.memory_id=? ORDER BY l.start,l.end`).all(id);
  assert.ok(spans(memory.id).length);
  assert.deepEqual(spans(memory.id), spans(sibling.id), 'both Memories share the same Raw span');
  const storage = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const card = storage.commit(ns, { key: 'moc:synthetic-sibling',
    memories: storage.snapshot(ns, 512, () => {}).memories.filter(m => m.id === memory.id) },
  { body: cardBody }, '2026-06-01T00:00:00.000Z', () => {});
  const before = row(f, card.id);
  assert.deepEqual(f.db.prepare('SELECT DISTINCT memory_id FROM card_memory_bindings WHERE card_id=?').all(card.id)
    .map(r => r.memory_id), [memory.id]);
  assert.equal(ok(f.call('getCard', { cardId: card.id })).card.body, cardBody);
  const input = { namespace: ns, memoryId: sibling.id, expectedRevision: sibling.revision };
  if (operation === 'correct') ok(f.core.correct({ ...input, content: 'Synthetic corrected sibling', kind: 'fact',
    receipt: receipt('synthetic-sibling-correction') }));
  else ok(f.core[operation]({ ...input, ...(operation === 'reject' ? { actionId: 'synthetic-sibling-reject' } : {}) }));
  assert.deepEqual(row(f, card.id), before, 'unbound sibling suppression never writes the Card');
  const retained = f.db.prepare('SELECT revision,deleted,content FROM memories WHERE id=?').get(memory.id);
  assert.equal(retained.revision, memory.revision); assert.equal(retained.deleted, 0); assert.equal(retained.content, surviving);
  const boundRead = f.core.get({ namespace: ns, memoryId: memory.id });
  assert.equal(boundRead.ok, false); assert.equal(boundRead.error.code, 'memory_not_found');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: independent.id })).memory.content, 'Synthetic independent surviving evidence');
  const ref = { type: 'card', namespace: ns, cardId: card.id, revision: before.revision, bodyRevision: before.body_revision };
  const proof = readTransaction(f.db, () => inContentSuppressionRequestInside(f.db, () => ({
    revisions: engineCardRevisionsInside(f.db, ns, before),
    safety: contentReadSafety(f.db, { identity: f.identity, namespace: ns, method: 'getCard', ref,
      memo: createContentReadMemo(f.db) }),
    memorySafety: contentReadSafety(f.db, { namespace: ns, ref: { type: 'memory', namespace: ns,
      memoryId: memory.id, revision: memory.revision }, memo: createContentReadMemo(f.db) }),
  }), [ns]));
  assert.equal(proof.revisions, true);
  assert.equal(proof.safety.allowed, false);
  assert.equal(proof.memorySafety.allowed, false);
  const refresh = await f.trusted.call(f.context, 'refreshContextIndex', { readSet: [ns], types: ['memory', 'card'],
    intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } });
  assert.deepEqual(row(f, card.id), before, 'context indexing does not retire or revise the denied Card');
  const reads = {
    selection: f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['card'], limit: 24 }),
    historySelection: f.call('selectEvidence', { intent: 'history', query: 'Synthetic', types: ['card'], limit: 24 }),
    mixedSelection: f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory', 'card'], limit: 24 }),
    memorySelection: f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }),
    memoryFetch: f.call('fetchEvidence', { intent: 'current', refs: [{ type: 'memory', namespace: ns,
      memoryId: memory.id, revision: memory.revision }] }),
    map: f.call('mapEvidence', { type: 'card' }),
    list: f.call('listCards', { states: ['confirmed'] }),
    card: f.call('getCard', { cardId: card.id }),
    fetch: f.call('fetchEvidence', { intent: 'current', refs: [ref] }),
    context: await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory', 'card'], intent: 'current',
      query: 'Synthetic', semantic: false,
      deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }),
  };
  t.diagnostic(JSON.stringify({ mode, operation, proof, boundRead, refresh, reads }));
  for (const result of Object.values(reads)) assert.equal(JSON.stringify(result).includes(siblingText), false);
  for (const method of ['selection', 'historySelection', 'map', 'list', 'card', 'context']) {
    const value = ok(reads[method]);
    assert.equal(JSON.stringify(value).includes(card.id), false, method + ' omits denied identity');
    assert.equal(JSON.stringify(value).includes(cardBody), false, method + ' omits denied text');
  }
  for (const method of ['mixedSelection', 'memorySelection', 'memoryFetch']) {
    assert.equal(reads[method].ok, false); assert.equal(reads[method].error.code, 'evidence_unavailable');
  }
  assert.ok(reads.context.value.metered.items.some(item => item.ref.type === 'memory' && item.ref.id === independent.id));
  assert.ok(reads.context.value.metered.items.every(item => item.ref.id !== memory.id));
  assert.equal(reads.fetch.ok, false); assert.equal(reads.fetch.error.code, 'evidence_unavailable');
  assert.equal(reads.card.value.card, null);
  assert.deepEqual(reads.list.value.cards, []);
  assert.deepEqual(reads.selection.value.items, []);
  assert.deepEqual(reads.historySelection.value.items, []);
  assert.equal(reads.selection.value.nextCursor, null);
  assert.equal(reads.selection.value.coverage.scannedRows, 0);
  assert.equal(reads.selection.value.coverage.scannedBodyUnits, 0);
  assert.deepEqual(reads.selection.value.coverage.byType.card, { scanned: 0, included: 0, partial: false });
  assert.equal(reads.map.value.coverage.scanned, 0); assert.equal(reads.map.value.coverage.included, 0);
  assert.equal(reads.map.value.nextCursor, null);
  const maintenance = await createEngineCardMaintenance({ storage, model: f.model,
    now: () => Date.parse(before.updated_at) + 600001 }).maintain({ namespace: ns, budget: { maxMs: 5000 } });
  assert.ok(maintenance.deleted > 0 || maintenance.built.length > 0);
  assert.equal(row(f, card.id).state, 'deleted'); assert.equal(row(f, card.id).body, null);
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: independent.id })).memory.content, 'Synthetic independent surviving evidence');
});

for (const mode of ['sealed Raw', 'suppression Raw without sealed lineage'])
for (const operation of ['forget', 'correct', 'reject'])
test(`shared Raw span denial without any engine Card after sibling ${operation}, ${mode}`, async t => {
  const f = await fixture(t, mode, operation);
  const captured = ok(await f.core.captureRaw(request(splitRaw(surviving + '. ' + siblingText + '.')[0], { namespace: ns })));
  const [memory, sibling] = ok(captured.interpretation).admission.memories;
  const independent = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic independent surviving evidence', kind: 'fact' },
    receipts: [receipt('synthetic-independent')] })).memory;
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 0);
  const input = { namespace: ns, memoryId: sibling.id, expectedRevision: sibling.revision };
  if (operation === 'correct') ok(f.core.correct({ ...input, content: 'Synthetic corrected sibling', kind: 'fact',
    receipt: receipt('synthetic-sibling-correction') }));
  else ok(f.core[operation]({ ...input, ...(operation === 'reject' ? { actionId: 'synthetic-sibling-reject' } : {}) }));
  const reads = {
    memory: f.core.get({ namespace: ns, memoryId: memory.id }),
    memorySelection: f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }),
    mixedSelection: f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory', 'card'], limit: 24 }),
    memoryFetch: f.call('fetchEvidence', { intent: 'current', refs: [{ type: 'memory', namespace: ns,
      memoryId: memory.id, revision: memory.revision }] }),
  };
  assert.equal(reads.memory.ok, false); assert.equal(reads.memory.error.code, 'memory_not_found');
  for (const method of ['memorySelection', 'mixedSelection', 'memoryFetch']) {
    assert.equal(reads[method].ok, false); assert.equal(reads[method].error.code, 'evidence_unavailable');
  }
  await f.trusted.call(f.context, 'refreshContextIndex', { readSet: [ns], types: ['memory', 'card'],
    intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } });
  const context = ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory', 'card'], intent: 'current',
    query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  assert.ok(context.metered.items.some(item => item.ref.type === 'memory' && item.ref.id === independent.id));
  assert.ok(context.metered.items.every(item => item.ref.id !== memory.id));
  for (const value of [...Object.values(reads), context]) assert.equal(JSON.stringify(value).includes(siblingText), false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 0);
});

test('engine scan canonical database and programming errors remain errors', async t => {
  const f = await lineageFixture(t);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: surviving, kind: 'fact' },
    receipts: [receipt('synthetic-error-source')] })).memory;
  const storage = createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} });
  storage.commit(ns, { key: 'moc:synthetic-error',
    memories: storage.snapshot(ns, 512, () => {}).memories.filter(m => m.id === memory.id) },
  { body: cardBody }, '2026-06-01T00:00:00.000Z', () => {});
  const cards = createPrivateCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const options = { db: f.db, identity: f.identity, cardDetailInside: cards.cardDetailInside };
  for (const [method, factory, input] of [
    ['selectEvidence', createPrivateEvidenceStorage, { intent: 'current', query: 'Synthetic', types: ['card'] }],
    ['mapEvidence', createPrivateOrganizationStorage, { type: 'card' }],
  ]) for (const error of [Object.assign(new Error('synthetic database failure'), { code: 'ERR_SQLITE_ERROR' }),
    new TypeError('synthetic programming failure')]) {
    const prepare = f.db.prepare; let reached = false;
    f.db.prepare = function(sql) {
      if (sql.startsWith('SELECT id,revision,state,body_revision FROM private_cards')) { reached = true; throw error; }
      return prepare.call(this, sql);
    };
    try {
      assert.throws(() => readTransaction(f.db, () => inContentSuppressionRequestInside(f.db,
        () => factory(options).call(method, ns, input, 1), [ns])), caught => caught === error);
      assert.equal(reached, true, method + ' reaches the canonical safety check');
    } finally { f.db.prepare = prepare; }
  }
});

for (const phase of ['selection', 'metadata lookahead']) test(`denied engine ${phase} stops at the shared deadline`, async t => {
  const f = await lineageFixture(t);
  ok(f.core.admit({ namespace: ns, memory: { content: surviving, kind: 'fact' },
    receipts: [receipt('synthetic-deadline-source')] }));
  const cards = createPrivateCardStorage({ db: f.db, identity: f.identity, ready() {} });
  const evidence = createPrivateEvidenceStorage({ db: f.db, identity: f.identity, cardDetailInside: cards.cardDetailInside });
  const prepare = f.db.prepare, clock = Object.getOwnPropertyDescriptor(performance, 'now');
  let candidates = 0;
  // Model an arbitrarily long increasing denied prefix. A hard probe ceiling
  // makes a missing deadline check fail promptly instead of hanging the test.
  f.db.prepare = function(sql) {
    if (/^SELECT .* FROM private_cards WHERE/.test(sql) && sql.includes("state='confirmed' AND id>?")) return { get() {
      assert.ok(++candidates <= 3, 'no candidate scan after the shared deadline');
      return { id: 'engine-card.synthetic-denied-' + candidates, revision: 1, body_revision: 1, state: 'confirmed' };
    } };
    return prepare.call(this, sql);
  };
  Object.defineProperty(performance, 'now', { configurable: true, value: () => candidates >= 3 ? 100 : 0 });
  let result;
  try {
    result = readTransaction(f.db, () => inContentSuppressionRequestInside(f.db, () => evidence.call('selectEvidence', ns,
      { query: 'Synthetic', types: phase === 'selection' ? ['card'] : ['memory', 'card'],
        intent: 'current', limit: 1, deadlineMs: 100 }, 1), [ns]));
  } finally {
    f.db.prepare = prepare;
    if (clock) Object.defineProperty(performance, 'now', clock); else delete performance.now;
  }
  assert.equal(candidates, 3);
  assert.equal(result.coverage.status, 'budget_exhausted');
  assert.equal(result.coverage.byType.card.partial, true, 'deadline does not imply exhaustion');
  assert.equal(result.coverage.byType.card.scanned, 0);
  assert.equal(result.coverage.byType.card.included, 0);
  assert.equal(result.items.length, phase === 'selection' ? 0 : 1);
  assert.equal(result.coverage.reason, phase === 'selection' ? 'deadline' : 'item_limit');
  assert.ok(result.nextCursor);
  assert.equal(JSON.stringify(result).includes('engine-card.synthetic-denied'), false);
});
