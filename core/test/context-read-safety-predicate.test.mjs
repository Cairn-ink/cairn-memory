import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
const safety = await import('../content-safety.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return null;
  throw error;
});
const { contentReadSafety, sourceReadSafety, contentReadPurpose, CONTENT_SUPPRESSION_REASONS } = safety ?? {};

function setup(t) {
  assert.ok(safety, 'shared content-safety API is required');
  const f = fixture(t, { cards: true }), db = new DatabaseSync(f.path); db.exec('PRAGMA busy_timeout=5000'); t.after(() => db.close());
  const memory = f.admit('Synthetic predicate content');
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
    title: 'Synthetic predicate title', body: 'Synthetic predicate body', authoredInput: { text: 'Synthetic predicate note', occurredAt: null } } }));
  const card = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card;
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const ref = { type: 'card', namespace: ns, cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision };
  const check = (ref, patch = {}) => contentReadSafety(db, { identity, namespace: ns, ref, ...patch });
  return { ...f, db, memory, card, ref, identity, check };
}
test('S1 trusted method dispatch has exactly three purposes, with retrieval as the default', t => {
  const f = setup(t);
  assert.deepEqual(CONTENT_SUPPRESSION_REASONS, ['user_forget', 'correction_supersession', 'purge', 'privacy_erase', 'account_erasure']);
  for (const method of ['getCard', 'listCards', 'confirmCardDraft']) assert.equal(contentReadPurpose(method, { state: 'draft' }), 'draft-inspection');
  assert.equal(contentReadPurpose('getCard', { state: 'confirmed' }), 'confirmed-review');
  for (const method of ['fetchEvidence', 'selectEvidence', 'contextRead', 'findCandidates', 'fetch', 'sourceSnapshot', 'recall', 'roleEvidence', 'mapEvidence', 'lineage-recovery'])
    assert.equal(contentReadPurpose(method, { state: 'draft' }), 'retrieval');
  assert.deepEqual(f.check(f.ref, { intent: 'history' }), { allowed: false, reason: 'ineligible' });
  assert.deepEqual(f.check(f.ref, { method: 'getCard' }), { allowed: true });
  assert.deepEqual(f.check({ ...f.ref, bodyRevision: 99 }, { method: 'getCard' }), { allowed: false, reason: 'identity_mismatch' });
  assert.equal(f.call('getCard', { namespace: ns, cardId: f.ref.cardId, purpose: 'retrieval' }).error.code, 'invalid_input');
});
test('S1 canonical tombstones, missing rows and exact identities produce internal typed denials', t => {
  const f = setup(t), ref = { type: 'memory', namespace: ns, memoryId: f.memory.id, revision: f.memory.revision };
  assert.deepEqual(f.check(ref), { allowed: true });
  assert.deepEqual(f.check({ ...ref, memoryId: 'absent' }), { allowed: false, reason: 'missing' });
  assert.deepEqual(f.check({ ...ref, revision: 99 }), { allowed: false, reason: 'identity_mismatch' });
  assert.deepEqual(f.check({ ...ref, namespace: { ...ns, ownerId: 'another-owner' } }), { allowed: false, reason: 'ineligible' });
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(f.memory.id);
  assert.deepEqual(f.check(ref), { allowed: false, reason: 'ineligible' });
  assert.deepEqual(f.check(ref, { intent: 'history' }), { allowed: true });
  f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(f.memory.id);
  assert.deepEqual(f.check(ref, { intent: 'history' }), { allowed: false, reason: 'user_forget' });
  const source = f.card.bindings[0].source;
  assert.deepEqual(sourceReadSafety(f.db, { identity: f.identity, namespace: ns, ref: { ...source, sourceId: 'absent' } }), { allowed: false, reason: 'missing' });
  f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(f.memory.id);
  f.db.prepare('DELETE FROM memories WHERE id=?').run(f.memory.id);
  assert.deepEqual(f.check(ref, { intent: 'history' }), { allowed: false, reason: 'missing' });
  f.db.prepare('UPDATE card_notes SET revision=revision+1 WHERE id=?').run(source.sourceId);
  assert.deepEqual(sourceReadSafety(f.db, { identity: f.identity, namespace: ns, ref: source }), { allowed: false, reason: 'identity_mismatch' });
  f.db.prepare("UPDATE card_notes SET state='deleted',text=NULL,byte_count=0 WHERE id=?").run(source.sourceId);
  assert.deepEqual(f.check(f.ref, { method: 'getCard' }), { allowed: false, reason: 'user_forget' });
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: f.ref.cardId })), { card: null });
  const storage = createPrivateCardStorage({ db: f.db, identity: f.identity, ready() {} });
  assert.equal(storage.cardMetadataInside(ns, f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(f.ref.cardId)), null);
  f.db.prepare('DELETE FROM card_bindings WHERE card_id=?').run(f.ref.cardId);
  assert.deepEqual(f.check(f.ref, { method: 'getCard' }), { allowed: false, reason: 'ineligible' });
  ok(f.call('cancelCardDraft', { namespace: ns, cardId: f.ref.cardId, expectedRevision: f.ref.revision, actionId: 'cancel' }));
  assert.deepEqual(f.check({ ...f.ref, revision: f.ref.revision + 1 }, { method: 'getCard' }), { allowed: false, reason: 'ineligible' });
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'delete-draft', drafting: 'authored', input: {
    title: 'Delete title', body: 'Delete body', authoredInput: { text: 'Delete source', occurredAt: null } } }));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'confirm-delete' }));
  const deleted = ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: draft.id, expectedRevision: confirmed.revision, actionId: 'delete' }));
  assert.deepEqual(f.check({ ...f.ref, cardId: draft.id, revision: deleted.revision, bodyRevision: confirmed.bodyRevision }, { method: 'getCard' }), { allowed: false, reason: 'user_forget' });
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: draft.id })), { card: null });
});
test('S1 receipt identities bind the original Memory revision and live bytes, rather than the latest revision', t => {
  const f = setup(t), memory = f.memory;
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'receipt-draft', drafting: 'authored', input: {
    title: 'Receipt card', body: 'Receipt body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } }));
  const source = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card.bindings[0].source;
  const check = patch => sourceReadSafety(f.db, { identity: f.identity, namespace: ns, ref: source, ...patch });
  f.db.prepare("UPDATE memories SET currentness='historical',revision=revision+1 WHERE id=?").run(memory.id);
  assert.deepEqual(check(), { allowed: true }); assert.deepEqual(check({ strict: true }), { allowed: false, reason: 'ineligible' });
  f.db.prepare("UPDATE receipts SET excerpt='Changed source bytes' WHERE id=?").run(source.receiptId);
  assert.deepEqual(check(), { allowed: false, reason: 'identity_mismatch' });
  f.db.prepare('DELETE FROM receipts WHERE id=?').run(source.receiptId);
  assert.deepEqual(check(), { allowed: false, reason: 'missing' });
  f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(memory.id);
  assert.deepEqual(check(), { allowed: false, reason: 'user_forget' });
});
