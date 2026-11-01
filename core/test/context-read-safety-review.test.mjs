import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ns, ok } from './card-current-fixture.mjs';

for (const source of ['note', 'receipt']) test(`S1 confirmed needs-review ${source} Card stays inspectable until a contributor is removed`, async t => {
  const f = fixture(t);
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic safety interpretation', kind: 'fact' }, receipts: [
    { client: 'synthetic', sessionId: 'safety', eventId: 'source', role: 'user', excerpt: 'Synthetic safety source' } ] })).memory;
  const ref = f.card({ ...(source === 'receipt' ? { memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } : {}) });
  f.change();
  const card = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  assert.equal(card.support.currentDependency.status, 'needs-review'); assert.equal(card.state, 'confirmed');
  assert.equal(f.call('fetchEvidence', { namespace: ns, intent: 'current', refs: [ref] }).error.code, 'evidence_unavailable');
  assert.equal(ok(f.call('fetchEvidence', { namespace: ns, intent: 'history', refs: [ref] })).items[0].body, card.body);
  if (source === 'receipt') ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  else ok(f.call('deleteSourceNote', { namespace: ns, sourceId: card.bindings[0].source.sourceId, expectedRevision: 1, actionId: 'delete-note' }));
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })), { card: null });
  const revision = f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(ref.cardId).revision;
  for (const intent of ['current', 'history']) {
    const result = f.call('fetchEvidence', { namespace: ns, intent, refs: [{ ...ref, revision }] });
    assert.equal(result.error.code, 'evidence_unavailable');
    for (const secret of [card.title, card.body, 'Synthetic safety source', 'user_forget', 'identity_mismatch']) assert.equal(JSON.stringify(result).includes(secret), false);
  }
  assert.equal(ok(f.call('listCards', { namespace: ns, states: ['confirmed'] })).cards.length, 0);
});
