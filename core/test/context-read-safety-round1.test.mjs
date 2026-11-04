import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sourceFixture, savedSource, anchor, resolve, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { roleEvidence } from '../role-context-evidence.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { readTransaction } from '../database.mjs';
import { fixture as lineageFixture, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';

const excerpt = 'Synthetic shared excluded ancestry excerpt';
async function shared(t) {
  const f = sourceFixture(t, { deletion: true, model: { countTokens: () => 1, extract: () => ({ items: [
    { content: 'Synthetic ancestor interpretation A', kind: 'fact', confidence: .8, sourceIndices: [0] },
    { content: 'Synthetic surviving interpretation B', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const raw = await savedSource(f, excerpt), memories = f.db.prepare('SELECT * FROM memories ORDER BY content').all();
  assert.equal(memories.length, 2);
  const [a, b] = memories;
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'shared-draft', drafting: 'authored', input: {
    title: 'Synthetic shared Card title', body: 'Synthetic shared Card body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: b.id, revision: b.revision }] } }));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'shared-confirm', applicability: 'current' }));
  const card = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card;
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(b.id).deleted, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 1);
  return { f, raw, b, card, ref: { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: confirmed.bodyRevision } };
}
for (const surface of ['receipt-source', 'card', 'card-current', 'card-history', 'memory-current', 'memory-history', 'fetch', 'source-fetch', 'snapshot', 'get', 'legacy-get', 'legacy-list', 'legacy-search', 'assembly-current', 'assembly-history', 'product-current', 'product-history', 'role-current', 'role-history', 'recall', 'index-current', 'index-history', 'assembly-card-current', 'assembly-card-history', 'product-card-current', 'product-card-history']) {
  test(`S1 round1 shared Raw exclusion with surviving receipt: ${surface}`, async t => {
    const { f, b, card, ref } = await shared(t);
    let result;
    if (surface === 'receipt-source') result = await f.call('getSource', { namespace: ns, source: card.bindings[0].source });
    if (surface === 'card') result = f.call('getCard', { namespace: ns, cardId: ref.cardId });
    if (surface.startsWith('card-')) result = f.call('fetchEvidence', { namespace: ns, refs: [ref], intent: surface.slice(5) });
    if (surface.startsWith('memory-')) result = f.call('fetchEvidence', { namespace: ns,
      refs: [{ type: 'memory', namespace: ns, memoryId: b.id, revision: b.revision }], intent: surface.slice(7) });
    if (surface === 'fetch' || surface === 'source-fetch') result = f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }], ...(surface === 'source-fetch' ? { contextMode: 'source-evidence' } : {}) });
    if (surface === 'snapshot') result = f.core.sourceSnapshot({ readSet: [ns], limit: 12, tokenBudget: 4000 });
    if (surface === 'get') result = f.core.get({ namespace: ns, memoryId: b.id });
    if (surface.startsWith('legacy-')) {
      const store = openMemoryStore({ path: f.path }), scoped = store.scope({ ownerId: ns.ownerId, ...(ns.projectId ? { projectId: ns.projectId } : {}) });
      try { result = surface === 'legacy-get' ? scoped.get(b.id) : surface === 'legacy-list' ? scoped.list() : scoped.search('surviving'); }
      finally { store.close(); }
    }
    const memoryRef = { type: 'memory', namespace: ns, memoryId: b.id, revision: b.revision };
    if (surface.startsWith('assembly-') || surface.startsWith('index-')) {
      const h = host(); h.state.allowed = [ns];
      const reader = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: h.authority,
        counter: { id: 'synthetic', countTokens: () => 1 } } });
      const cardMode = surface.includes('-card-') || surface.startsWith('index-'), intent = surface.split('-').at(-1);
      try {
        result = await h.call(reader, surface.startsWith('index-') ? 'findCandidates' : 'contextRead', { readSet: [ns],
          types: [cardMode ? 'card' : 'memory'], intent, query: cardMode ? 'Synthetic' : 'surviving', deadlineMs: 5000,
          ...(surface.startsWith('index-') ? { limit: 20 } : { budget: { maxTokens: 4000, maxItems: 12 } }) });
        assert.equal(result.ok, true, JSON.stringify(result));
        if (surface.startsWith('index-')) assert.equal(result.value.items.some(item => item.ref.cardId === ref.cardId), false);
      }
      finally { reader.close(); }
    }
    if (surface.startsWith('product-')) {
      const intent = surface.split('-').at(-1), cardMode = surface.includes('-card-'), types = [cardMode ? 'card' : 'memory'], facade = openContextProductFacade(f.path, {});
      const product = openProductIndex({ path: f.path, facade, maintenance: true, authorize: () => ({ accessGenerations:
        accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }), check() {}, envelope: work => work() }),
        counter: { id: 'synthetic', countTokens: () => 1 }, ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
          requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } });
      try {
        for (let i = 0; i < 100; i++) if (ok(product.run('refreshContextIndex', { readSet: [ns], types, intent,
          mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } })).status === 'complete') break;
        result = product.run('contextRead', { readSet: [ns], types, intent, query: cardMode ? 'Synthetic' : 'surviving', deadlineMs: 5000,
          budget: { maxTokens: 4000, maxItems: 12 } }); assert.equal(result.ok, true, JSON.stringify(result));
      } finally { product.close(); facade.close(); }
    }
    if (surface.startsWith('role-')) {
      const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
      const role = roleEvidence({ db: f.db, identity, ready() {} }, { path: f.path });
      result = readTransaction(f.db, () => role.item(memoryRef, [ns], 1, surface.slice(5)));
    }
    if (surface === 'recall') {
      const runtime = createMemoryRuntime({ path: f.path });
      try { result = runtime.recallSnapshot([{ namespace: { ...ns, projectId: ns.projectId ?? '' }, memoryId: b.id, revision: b.revision, receiptLimit: 16 }], [0]); }
      finally { runtime.close(); }
    }
    assert.equal(JSON.stringify(result).includes(excerpt), false, JSON.stringify(result));
    if (surface === 'card' || surface.startsWith('card-') || surface.includes('-card-')) {
      for (const value of [card.title, card.body]) assert.equal(JSON.stringify(result).includes(value), false);
    }
    if (surface.startsWith('memory-')) {
      const item = ok(result).items[0]; assert.deepEqual(item.provenance.sources, []);
      assert.equal(item.provenance.coverage.included, 0); assert.equal(item.provenance.coverage.omitted, 1);
    }
    if (surface === 'snapshot') { assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes('complete-current-admitted'), false); }
    if (surface === 'source-fetch') assert.equal(result.error?.code, 'source_unavailable');
    if (['fetch', 'get', 'memory-current', 'memory-history'].includes(surface)) assert.equal(JSON.stringify(result).includes(b.content), true, JSON.stringify(result));
  });
}
function countRead(work) {
  const original = DatabaseSync.prototype.prepare;
  const counts = { preparations: 0, rawReads: 0 };
  DatabaseSync.prototype.prepare = function(sql) {
    counts.preparations++;
    const statement = original.call(this, sql);
    if (/SELECT sealed FROM raw_parts/.test(sql)) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => { counts.rawReads++; return get(...args); };
    }
    return statement;
  };
  try { work(); return counts; } finally { DatabaseSync.prototype.prepare = original; }
}
test('S1 round1 Card reads resolve each Raw binding once and never reuse across transactions', async t => {
  const f = sourceFixture(t), saved = await savedSource(f), sources = await resolve(f, [anchor(saved)]);
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'raw-draft', drafting: 'authored', input: { title: 'Raw title', body: 'Raw body', sources } }));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'raw-confirm' }));
  const observations = [];
  for (const method of ['getCard', 'listCards', 'fetchEvidence']) {
    const row = f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(draft.id);
    const input = method === 'getCard' ? { namespace: ns, cardId: draft.id } : method === 'listCards' ? { namespace: ns, states: ['confirmed'], limit: 50 } :
      { namespace: ns, intent: 'history', refs: [{ type: 'card', namespace: ns, cardId: draft.id, revision: row.revision, bodyRevision: row.body_revision }] };
    const first = countRead(() => ok(f.call(method, input))), second = countRead(() => ok(f.call(method, input)));
    t.diagnostic(JSON.stringify({ method, ...first }));
    observations.push(first, second);
  }
  for (const observation of observations) assert.equal(observation.rawReads, 1);
});
test('S1 round1 fifty Cards with sixteen receipt bindings avoid repeated validation probes', t => {
  const f = fixture(t, { cards: true }), namespace = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' };
  for (let i = 0; i < 50; i++) {
    let memory;
    for (let j = 0; j < 16; j++) memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic bound content '+i, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'count', eventId: 'event-'+i+'-'+j, role: 'user', excerpt: 'Synthetic bound excerpt '+j }] })).memory;
    const memoryRefs = [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }];
    const draft = ok(f.call('createCardDraft', { namespace, actionId: 'count-'+i, drafting: 'authored', input: {
      title: 'Synthetic count title', body: 'Synthetic count body', sourcePolicy: 'retained-receipts-v1', memoryRefs } }));
    ok(f.call('confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: 1, actionId: 'confirm-'+i }));
  }
  const counts = countRead(() => assert.equal(ok(f.call('listCards', { namespace, states: ['confirmed'], limit: 50 })).cards.length, 50));
  t.diagnostic(JSON.stringify({ cards: 50, bindings: 800, ...counts }));
  assert.ok(counts.preparations <= 2000, JSON.stringify(counts)); assert.equal(counts.rawReads, 0);
});
for (const mutation of ['correct', 'forget']) test(`S1 round1 canonical ${mutation} keeps only recoverable suppression causes`, async t => {
  const { sourceReadSafety, contentReadSafety } = await import('../content-safety.mjs');
  const { readTransaction } = await import('../database.mjs');
  const f = sourceFixture(t, { model: { extract: () => ({ items: [
    { content: 'Synthetic causal interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const saved = await savedSource(f), sources = await resolve(f, [anchor(saved)]);
  const memory = f.db.prepare('SELECT * FROM memories').get();
  const rawDraft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'cause-raw', drafting: 'authored', input: { title: 'Cause', body: 'Cause body', sources } }));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: rawDraft.id, expectedRevision: 1, actionId: 'cause-confirm' }));
  const receiptDraft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'cause-receipt', drafting: 'authored', input: {
    title: 'Receipt', body: 'Receipt body', sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } }));
  const ref = ok(f.call('getCard', { namespace: ns, cardId: receiptDraft.id })).card.bindings[0].source;
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  if (mutation === 'forget') ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  else ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision, content: 'Synthetic correction', kind: 'fact',
    receipt: { client: 'synthetic', sessionId: 'causal', eventId: 'correct', role: 'user', excerpt: 'Synthetic replacement source' } }));
  const reason = mutation === 'correct' ? 'correction_supersession' : 'purge';
  readTransaction(f.db, () => {
    assert.deepEqual(sourceReadSafety(f.db, { identity, namespace: ns, ref }), { allowed: false, reason });
    assert.deepEqual(contentReadSafety(f.db, { identity, namespace: ns, intent: 'history', ref: { type: 'memory', namespace: ns,
      memoryId: memory.id, revision: memory.revision } }), { allowed: false, reason });
  });
});
test('S1 round1 excluded receipt pages advance to independent surviving receipts without exposing an excluded cursor id', async t => {
  const { f, b } = await shared(t);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: b.content, kind: 'fact' }, receipts: [
    { client: 'synthetic', sessionId: 'independent', eventId: 'independent', role: 'user', excerpt: 'Synthetic independent surviving receipt' } ] })).memory;
  f.db.prepare("UPDATE receipts SET created_at='2000-01-01T00:00:00.000Z' WHERE excerpt=?").run(excerpt);
  const excluded = f.db.prepare('SELECT id FROM receipts WHERE excerpt=?').get(excerpt).id;
  const first = ok(f.core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 1 }));
  assert.deepEqual(first.receipts, []); assert.equal(first.exhausted, false); assert.ok(first.nextReceiptCursor);
  assert.equal(Buffer.from(first.nextReceiptCursor.split('.')[0], 'base64url').toString().includes(excluded), false);
  const second = ok(f.core.get({ namespace: ns, memoryId: memory.id, receiptLimit: 1, receiptCursor: first.nextReceiptCursor }));
  assert.equal(second.receipts[0].excerpt, 'Synthetic independent surviving receipt'); assert.equal(second.exhausted, true);
  const fetched = ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }] }));
  assert.equal(fetched.exhausted, true); assert.equal(fetched.items[0].receipts.length, 1);
  assert.equal(JSON.stringify([first, second, fetched]).includes(excerpt), false);
});
test('S1 round1 excluded Raw receipt anchors cannot reappear in qualification metadata', async t => {
  const f = sourceFixture(t, { model: { countTokens: () => 1 } }), raw = await savedSource(f, excerpt);
  const conversation = f.db.prepare('SELECT client,session_key FROM raw_conversations WHERE id=?').get(raw.conversationId);
  const receipt = { client: conversation.client, sessionId: conversation.session_key, eventId: raw.messageId, role: 'user', excerpt };
  const a = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic qualified ancestor', kind: 'fact' }, receipts: [receipt] })).memory;
  const b = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic qualified survivor', kind: 'fact' }, receipts: [receipt], qualification: {
    version: 1, slot: { subject: 'Synthetic', property: 'choice', scope: null, applies: null }, value: 'survivor', attribution: 'direct', commitment: 'adopted',
    anchors: [{ receiptIndex: 0, start: 0, end: excerpt.length, text: excerpt, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] } })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true })).qualification.anchors[0].text, excerpt);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const responses = [f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true }),
    f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }], includeQualification: true }),
    f.call('fetchEvidence', { namespace: ns, intent: 'history', refs: [{ type: 'memory', namespace: ns, memoryId: b.id, revision: b.revision }] })];
  for (const response of responses) { assert.equal(response.ok, true, JSON.stringify(response)); assert.equal(JSON.stringify(response).includes(excerpt), false); }
  assert.equal(responses[0].value.qualification, null); assert.equal(responses[1].value.items[0].qualification, null);
});
test('S1 round1 caller-chosen operation ids cannot fabricate Memory suppression causes', async t => {
  for (const cause of ['correct', 'forget']) {
    const f = fixture(t, { cards: true }), namespace = { ownerId: 'synthetic-u5a', scope: 'project', projectId: 'test' }, memory = f.admit('Synthetic unproven cause');
    const db = new DatabaseSync(f.path); db.exec('PRAGMA busy_timeout=5000'); t.after(() => db.close());
    const noteDraft = ok(f.call('createCardDraft', { namespace, actionId: 'spoof-note', drafting: 'authored', input: {
      title: 'Synthetic note', body: 'Synthetic note body', authoredInput: { text: 'Synthetic unrelated note', occurredAt: null } } }));
    const note = ok(f.call('getCard', { namespace, cardId: noteDraft.id })).card.bindings[0].source;
    const receiptDraft = ok(f.call('createCardDraft', { namespace, actionId: 'spoof-receipt', drafting: 'authored', input: {
      title: 'Synthetic receipt', body: 'Synthetic receipt body', sourcePolicy: 'retained-receipts-v1',
      memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] } }));
    const ref = ok(f.call('getCard', { namespace, cardId: receiptDraft.id })).card.bindings[0].source;
    ok(f.call('deleteSourceNote', { namespace, sourceId: note.sourceId, expectedRevision: note.revision,
      actionId: 'memory-'+cause+'-'+memory.id+(cause === 'correct' ? '-1' : '') }));
    if (cause === 'correct') { db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id); db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id); }
    else db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(memory.id);
    const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
    const { sourceReadSafety } = await import('../content-safety.mjs');
    readTransaction(db, () => assert.deepEqual(sourceReadSafety(db, { identity, namespace, ref }),
      { allowed: false, reason: cause === 'correct' ? 'missing' : 'purge' }));
  }
});
test('S1 round1 ordinary receipt compatibility never bypasses retained unresolved ancestry', t => {
  const f = sourceFixture(t, { model: { countTokens: () => 1 } }), text = 'Synthetic unresolved ancestry excerpt';
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unresolved ancestry interpretation', kind: 'fact' }, receipts: [
    { client: 'synthetic', sessionId: 'unresolved', eventId: 'source', role: 'user', excerpt: text } ] })).memory;
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'unresolved-draft', drafting: 'authored', input: {
    title: 'Synthetic unresolved title', body: 'Synthetic unresolved body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } }));
  const ref = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card.bindings[0].source;
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare("UPDATE raw_receipt_origins SET kind='unknown' WHERE receipt_id=?").run(ref.receiptId);
  f.db.prepare('INSERT INTO episode_memory_links(id,episode_id,memory_id,event_id,admission_revision,receipt_ids) VALUES(?,?,?,?,?,?)')
    .run('synthetic-link', 'synthetic-missing-episode', memory.id, 'synthetic-event', 1, JSON.stringify([ref.receiptId]));
  const source = f.call('getSource', { namespace: ns, source: ref }), card = f.call('getCard', { namespace: ns, cardId: draft.id }),
    snapshot = f.core.sourceSnapshot({ readSet: [ns], limit: 12, tokenBudget: 4000 });
  assert.equal(source.error?.code, 'source_unavailable'); assert.deepEqual(ok(card), { card: null }); assert.equal(snapshot.ok, false);
  assert.equal(JSON.stringify([source, card, snapshot]).includes(text), false);
});
test('S1 round1 existing lineage without deletion capability still withholds shared excluded receipts', async t => {
  const f = lineageFixture(t, { lineage: true, model: { countTokens: () => 1, extract: () => ({ items: [
    { content: 'Synthetic legacy ancestor', kind: 'fact', confidence: .8, sourceIndices: [0] },
    { content: 'Synthetic legacy survivor', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  ok(await f.core.captureRaw(request(splitRaw(excerpt)[0])));
  const [a, b] = f.db.prepare('SELECT * FROM memories ORDER BY content').all();
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].excerpt, excerpt);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const response = f.core.get({ namespace: ns, memoryId: b.id });
  assert.equal(ok(response).memory.content, b.content); assert.deepEqual(ok(response).receipts, []);
  assert.equal(JSON.stringify(response).includes(excerpt), false);
});
