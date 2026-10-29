import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, ns, ok, query, refresh } from '../testing/context-read-core-fixture.mjs';
import { createPrivateEvidenceStorage } from '../private-evidence-storage.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { createCardReceiptSources } from '../card-receipt-sources.mjs';
import { keyed } from '../private-card-input.mjs';
import { roleEvidence } from '../role-context-evidence.mjs';
import { readTransaction } from '../database.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';

const hidden = (response, strings) => {
  const serialized = JSON.stringify(response);
  for (const text of strings) assert.equal(serialized.includes(text), false, serialized);
  for (const reason of ['user_forget', 'correction_supersession', 'privacy_erase', 'account_erasure', 'identity_mismatch'])
    assert.equal(serialized.includes(reason), false, serialized);
};
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'safety', eventId, role: 'user', excerpt });
function setup(t, kind) {
  const f = coreFixture(t, { cards: true, coreOptions: { model: { countTokens: () => 1 } } });
  f.reopen({ counter: { id: 'synthetic', countTokens: () => 1 } });
  const db = new DatabaseSync(f.path); db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON'); t.after(() => db.close());
  const call = (method, input) => f.host.call(f.context, method, input);
  const text = ['Safety SensitiveCardTitle', 'Safety SensitiveCardBody', 'Safety SensitiveContributorExcerpt'];
  const memory = ok(f.context.admit({ namespace: ns, memory: { content: 'SensitiveMemoryBody', kind: 'fact' },
    receipts: [receipt('source', text[2])] })).memory;
  const source = kind === 'note' ? { sources: [ok(call('submitSourceNote', { namespace: ns, actionId: 'note', text: text[2], occurredAt: null })).source] }
    : { memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], sourcePolicy: 'retained-receipts-v1' };
  const make = actionId => ok(call('createCardDraft', { namespace: ns, actionId, drafting: 'authored',
    input: { ...source, title: text[0], body: text[1] } }));
  const draft = make('confirmed-draft'), confirmed = ok(call('confirmCardDraft', { namespace: ns, cardId: draft.id,
    expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' })), pending = make('pending');
  const ref = { type: 'card', namespace: ns, cardId: confirmed.id, revision: confirmed.revision, bodyRevision: confirmed.bodyRevision };
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const cards = createPrivateCardStorage({ db, identity, ready() {} });
  const receipts = createCardReceiptSources(db, (purpose, value) => keyed(identity.cursorSecret, purpose, [identity.storeId, value]));
  const evidence = createPrivateEvidenceStorage({ db, identity, cardDetailInside: cards.cardDetailInside, receiptRefInside: receipts.refInside });
  const role = roleEvidence({ db, identity, ready() {} }, { path: f.path });
  const facade = openContextProductFacade(f.path, {}); t.after(() => facade.close());
  const access = { accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }),
    check() {}, envelope: work => work() };
  const product = openProductIndex({ path: f.path, facade, authorize: () => access, maintenance: true,
    ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 },
    counter: { id: 'synthetic', countTokens: () => 1 } }); t.after(() => product.close());
  return { ...f, db, call, text, memory, source, pending, ref, evidence, role, product };
}
const history = () => query({ query: 'Safety', types: ['card'], intent: 'history', limit: 1, deadlineMs: 5000 });
const assembly = () => ({ readSet: [ns], types: ['card'], intent: 'history', query: 'Safety', deadlineMs: 5000, budget: { maxTokens: 4000, maxItems: 12 } });
async function build(f) {
  for (let i = 0; i < 100; i++) if (ok(await f.callContext('refreshContextIndex', refresh({ types: ['card'], intent: 'history' }))).status === 'complete') break;
  for (let i = 0; i < 100; i++) if (ok(f.product.run('refreshContextIndex', { ...refresh({ types: ['card'], intent: 'history' }), mode: 'lexical' })).status === 'complete') return;
  assert.fail('history build incomplete');
}

for (const mutation of ['forget', 'correct', 'remove-receipt', 'note']) test(`S1 history denies every receipt/note Card surface after ${mutation}`, async t => {
  const f = setup(t, mutation === 'note' ? 'note' : 'receipt');
  f.callContext = (method, input) => f.trusted.call(f.context, method, input);
  // A second matching Card makes both cached cursor paths observable.
  const safe = ok(f.call('createCardDraft', { namespace: ns, actionId: 'safe', drafting: 'authored', input: {
    title: 'Safety', body: 'Safety Safety Safety', authoredInput: { text: 'Safe source', occurredAt: null } } }));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: safe.id, expectedRevision: 1, actionId: 'safe-confirm', applicability: 'current' }));
  await build(f);
  const selected = ok(f.call('fetchEvidence', { namespace: ns, intent: 'history', refs: [f.ref] }));
  const candidates = ok(await f.callContext('findCandidates', history()));
  const productCandidates = ok(f.product.run('findCandidates', history()));
  assert.ok(candidates.nextCursor); assert.ok(productCandidates.nextCursor);
  assert.equal(candidates.items[0].ref.cardId, safe.id); assert.equal(productCandidates.items[0].ref.cardId, safe.id);
  const assembled = ok(await f.callContext('contextRead', assembly()));
  assert.ok(JSON.stringify(assembled).includes(f.text[0]));
  const detail = ok(f.call('getCard', { namespace: ns, cardId: f.ref.cardId })).card;
  if (mutation === 'note') ok(f.call('deleteSourceNote', { namespace: ns, actionId: 'delete-note', sourceId: f.source.sources[0].sourceId, expectedRevision: 1 }));
  if (mutation === 'forget') ok(f.context.forget({ namespace: ns, memoryId: f.memory.id, expectedRevision: f.memory.revision }));
  if (mutation === 'correct') ok(f.context.correct({ namespace: ns, memoryId: f.memory.id, expectedRevision: f.memory.revision,
    content: 'NewMemoryContent', kind: 'fact', receipt: receipt('corrected', 'NewSourceExcerpt') }));
  if (mutation === 'remove-receipt') {
    const id = detail.bindings[0].receiptId;
    // Same-revision loss proves epoch checks alone cannot protect cached reads.
    f.db.prepare('DELETE FROM receipts WHERE id=?').run(id);
  }
  const latest = f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(f.ref.cardId);
  const ref = { ...f.ref, revision: latest.revision, bodyRevision: latest.body_revision };
  const responses = [
    f.call('getCard', { namespace: ns, cardId: ref.cardId }),
    f.call('getCard', { namespace: ns, cardId: f.pending.id }),
    f.call('listCards', { namespace: ns, states: ['draft', 'confirmed'], limit: 50 }),
    f.call('selectEvidence', { namespace: ns, types: ['card'], query: 'Safety', intent: 'history' }),
    f.call('fetchEvidence', { namespace: ns, refs: [ref], intent: 'history' }),
    f.call('revalidateEvidence', { namespace: ns, snapshot: selected.snapshot }),
    f.call('mapEvidence', { namespace: ns, type: 'card' }),
    await f.callContext('findCandidates', { ...history(), cursor: candidates.nextCursor }),
    await f.callContext('findCandidates', history()),
    await f.callContext('contextRead', assembly()),
    await f.callContext('fetchCandidateEvidence', { readSet: [ns], refs: [ref], intent: 'history' }),
    await f.callContext('fetchCandidateEvidence', { readSet: [ns], snapshot: assembled.snapshot }),
    f.product.run('findCandidates', history()),
    f.product.run('findCandidates', { ...history(), cursor: productCandidates.nextCursor }),
    f.product.run('contextRead', assembly()),
  ];
  for (const response of responses) hidden(response, f.text);
  assert.deepEqual(responses[0], { ok: true, value: { card: null } });
  assert.deepEqual(responses[1], { ok: true, value: { card: null } });
  assert.equal(responses[2].value.cards.some(card => card.id === ref.cardId || card.id === f.pending.id), false);
  assert.throws(() => readTransaction(f.db, () => f.evidence.itemsInside(ns, [ref], 'history')), { code: 'evidence_unavailable' });
  assert.throws(() => readTransaction(f.db, () => f.role.item(ref, [ns], 1, 'history')), { code: 'evidence_unavailable' });
  hidden(f.call('getSource', { namespace: ns, source: detail.bindings[0].source }), f.text);
  await build(f);
  const rebuilt = ok(await f.callContext('findCandidates', history()));
  assert.equal(rebuilt.items.some(item => item.ref.cardId === ref.cardId), false);
  assert.equal(ok(f.product.run('findCandidates', history())).items.some(item => item.ref.cardId === ref.cardId), false);
});

test('S1 same-revision forget hides a draft and refuses confirmation without exposing reasons', t => {
  const f = setup(t, 'receipt');
  f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(f.memory.id);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: f.pending.id })), { card: null });
  const refused = f.call('confirmCardDraft', { namespace: ns, cardId: f.pending.id, expectedRevision: 1, actionId: 'unsafe-confirm' });
  assert.equal(refused.error?.code, 'source_unavailable'); hidden(refused, f.text);
  const listed = ok(f.call('listCards', { namespace: ns, states: ['draft', 'confirmed'] }));
  assert.deepEqual(listed.cards, []);
  assert.equal(f.db.prepare('SELECT state FROM private_cards WHERE id=?').get(f.pending.id).state, 'draft');
});

test('S1 supersession keeps labelled Memory history and intact receipt Card history until forget', async t => {
  const f = setup(t, 'receipt');
  ok(f.context.supersede({ namespace: ns, memoryId: f.memory.id, expectedRevision: f.memory.revision,
    replacement: { content: 'Replacement interpretation', kind: 'fact' }, receipts: [receipt('successor', 'Replacement source')] }));
  const historicalMemory = { type: 'memory', namespace: ns, memoryId: f.memory.id, revision: f.memory.revision + 1 };
  const historical = ok(f.call('fetchEvidence', { namespace: ns, refs: [historicalMemory], intent: 'history' })).items[0];
  assert.equal(historical.state, 'historical'); assert.equal(historical.content, 'SensitiveMemoryBody');
  assert.equal(f.call('fetchEvidence', { namespace: ns, refs: [historicalMemory], intent: 'current' }).error.code, 'evidence_unavailable');
  const legacy = ok(f.context.fetch({ namespace: ns, refs: [{ memoryId: f.memory.id, revision: historicalMemory.revision }], view: 'historical' }));
  assert.equal(legacy.items[0].memory.state, 'historical'); assert.equal(legacy.items[0].memory.content, historical.content);
  assert.equal(legacy.items[0].supersession.evidenceAvailable, true);
  const candidateInput = query({ types: ['memory'], intent: 'history', query: 'SensitiveMemoryBody' });
  assert.ok(ok(await f.trusted.call(f.context, 'findCandidates', candidateInput)).items.some(item => item.ref.memoryId === f.memory.id));
  assert.equal(ok(await f.trusted.call(f.context, 'findCandidates', { ...candidateInput, intent: 'current' })).items.some(item => item.ref.memoryId === f.memory.id), false);
  const exact = ok(await f.trusted.call(f.context, 'fetchCandidateEvidence', { readSet: [ns], refs: [historicalMemory], intent: 'history' }));
  assert.equal(exact.items[0].state, 'historical');
  const card = ok(f.call('getCard', { namespace: ns, cardId: f.ref.cardId })).card;
  const ref = { ...f.ref, revision: card.revision };
  assert.equal(card.support.status, 'unavailable');
  assert.equal(ok(f.call('fetchEvidence', { namespace: ns, refs: [ref], intent: 'history' })).items[0].body, f.text[1]);
  assert.equal(f.call('fetchEvidence', { namespace: ns, refs: [ref], intent: 'current' }).error.code, 'evidence_unavailable');
  ok(f.context.forget({ namespace: ns, memoryId: f.memory.id, expectedRevision: historicalMemory.revision }));
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })), { card: null });
  hidden(f.call('fetchEvidence', { namespace: ns, refs: [{ ...ref, revision: ref.revision + 1 }], intent: 'history' }), f.text);
});

test('S1 list pagination crosses denied physical rows without exposing their ids or metadata', t => {
  const f = setup(t, 'note'), safeIds = [];
  for (let i = 0; i < 3; i++) {
    const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'safe-'+i, drafting: 'authored', input: {
      title: 'Safe title '+i, body: 'Safe body '+i, authoredInput: { text: 'Safe note '+i, occurredAt: null } } }));
    safeIds.push(draft.id);
  }
  // Keep the unsafe draft extant to test metadata filtering independently of cancellation.
  f.db.prepare("UPDATE card_notes SET text=NULL,byte_count=0,state='deleted' WHERE id=?").run(f.source.sources[0].sourceId);
  let cursor, ids = [];
  for (let page = 0; page < 20; page++) {
    const result = f.call('listCards', { namespace: ns, states: ['draft', 'confirmed'], limit: 1, ...(cursor ? { cursor } : {}) });
    hidden(result, [...f.text, f.ref.cardId, f.pending.id]);
    const value = ok(result); ids.push(...value.cards.map(card => card.id)); cursor = value.nextCursor;
    if (!cursor) { assert.equal(value.coverage.status, 'complete'); break; }
  }
  assert.equal(cursor, null); assert.deepEqual(ids.sort(), safeIds.sort());
});
