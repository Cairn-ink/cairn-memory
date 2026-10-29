import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture, savedSource, anchor, resolve, ns, ok } from '../testing/raw-source-fixtures.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openMemoryCore } from '../index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { roleEvidence } from '../role-context-evidence.mjs';
import { readTransaction } from '../database.mjs';

const secrets = ['Safety RawSecretTitle', 'Safety RawSecretBody', 'RawSecretContributorExcerpt'];
const hidden = response => { for (const value of secrets) assert.equal(JSON.stringify(response).includes(value), false, JSON.stringify(response)); };
const query = { readSet: [ns], types: ['card'], intent: 'history', query: 'Safety', limit: 1, deadlineMs: 5000 };
const assembly = { readSet: [ns], types: ['card'], intent: 'history', query: 'Safety', deadlineMs: 5000, budget: { maxTokens: 4000, maxItems: 12 } };
const refresh = { readSet: [ns], types: ['card'], intent: 'history', budget: { maxItems: 1024, maxMs: 5000 } };
for (const mutation of ['excluded', 'deleted', 'removeReceipts']) test(`S1 ${mutation} Raw/receipt contributor hides the whole Card on every history surface`, async t => {
  const h = host(); h.state.allowed = [ns];
  const f = sourceFixture(t, { deletion: true, model: { extract: () => ({ items: [{ content: 'Derived raw interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const context = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: h.authority, counter: { id: 'synthetic', countTokens: () => 1 } } });
  f.workspace.defer(() => context.close());
  f.db.exec('PRAGMA busy_timeout=5000');
  const source = await savedSource(f, secrets[2]), rawRefs = await resolve(f, [anchor(source)]);
  let memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get(); assert.ok(memory);
  let sources = rawRefs;
  if (mutation === 'removeReceipts') {
    memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Derived raw interpretation', kind: 'fact' }, receipts: [
      { client: 'synthetic', sessionId: 'independent', eventId: 'independent', role: 'user', excerpt: 'Independent surviving source' } ] })).memory;
    const temporary = ok(f.call('createCardDraft', { namespace: ns, actionId: 'receipt-resolve', drafting: 'authored', input: {
      title: 'Temporary', body: 'Temporary', memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], sourcePolicy: 'retained-receipts-v1' } }));
    const bindings = ok(f.call('getCard', { namespace: ns, cardId: temporary.id })).card.bindings;
    sources = bindings.filter(binding => f.db.prepare('SELECT client FROM receipts WHERE id=?').get(binding.receiptId).client !== 'synthetic').map(binding => binding.source);
    assert.equal(sources.length, 1);
  }
  const make = actionId => {
    const input = mutation === 'removeReceipts' ? { memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], sourcePolicy: 'retained-receipts-v1' } : { sources };
    const value = ok(f.call('createCardDraft', { namespace: ns, actionId, drafting: 'authored', input: { ...input, title: secrets[0], body: secrets[1] } }));
    return mutation === 'removeReceipts' ? ok(f.call('editCardDraft', { namespace: ns, cardId: value.id, expectedRevision: value.revision,
      actionId: actionId+'-select', title: secrets[0], body: secrets[1], bindings: sources })) : value;
  };
  const draft = make('draft'), pending = make('pending'), confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id,
    expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' }));
  const ref = { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: confirmed.bodyRevision };
  const safe = ok(f.call('createCardDraft', { namespace: ns, actionId: 'safe', drafting: 'authored', input: {
    title: 'Safety', body: 'Safety Safety Safety', authoredInput: { text: 'Safe source', occurredAt: null } } }));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: safe.id, expectedRevision: 1, actionId: 'safe-confirm', applicability: 'current' }));
  const facade = openContextProductFacade(f.path, {}); f.workspace.defer(() => facade.close());
  const product = openProductIndex({ path: f.path, facade, maintenance: true, authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }), check() {}, envelope: work => work() }),
    counter: { id: 'synthetic', countTokens: () => 1 }, ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } });
  f.workspace.defer(() => product.close());
  async function build() {
    for (let i = 0; i < 100; i++) if (ok(await h.call(context, 'refreshContextIndex', refresh)).status === 'complete') break;
    for (let i = 0; i < 100; i++) if (ok(product.run('refreshContextIndex', { ...refresh, mode: 'lexical' })).status === 'complete') return;
    assert.fail('history build incomplete');
  }
  await build();
  const first = ok(await h.call(context, 'findCandidates', query)), productFirst = ok(product.run('findCandidates', query));
  assert.ok(first.nextCursor); assert.ok(productFirst.nextCursor);
  assert.equal(first.items[0].ref.cardId, safe.id); assert.equal(productFirst.items[0].ref.cardId, safe.id);
  const selected = ok(f.call('fetchEvidence', { namespace: ns, intent: 'history', refs: [ref] }));
  if (mutation === 'excluded') ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  else {
    const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
    const removed = ok(f.core.deleteConversation({ namespace: ns, conversationId: source.conversationId, expectedRevision: revision, actionId: 'delete-raw' }));
    if (mutation === 'removeReceipts') {
      assert.equal(removed.retainedMemories, 1); assert.equal(removed.removedReceipts, 1);
      assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
      assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 1);
    }
  }
  const current = f.db.prepare('SELECT revision,body_revision FROM private_cards WHERE id=?').get(ref.cardId);
  const latest = { ...ref, revision: current.revision, bodyRevision: current.body_revision };
  const responses = [
    f.call('getCard', { namespace: ns, cardId: ref.cardId }), f.call('getCard', { namespace: ns, cardId: pending.id }),
    f.call('listCards', { namespace: ns, states: ['draft', 'confirmed'], limit: 50 }),
    f.call('selectEvidence', { namespace: ns, intent: 'history', types: ['card'], query: 'Safety' }),
    f.call('fetchEvidence', { namespace: ns, intent: 'history', refs: [latest] }),
    f.call('revalidateEvidence', { namespace: ns, snapshot: selected.snapshot }),
    f.call('mapEvidence', { namespace: ns, type: 'card' }),
    await f.call('getSource', { namespace: ns, source: sources[0] }),
    await h.call(context, 'findCandidates', query), await h.call(context, 'findCandidates', { ...query, cursor: first.nextCursor }),
    await h.call(context, 'contextRead', assembly),
    await h.call(context, 'fetchCandidateEvidence', { readSet: [ns], refs: [latest], intent: 'history' }),
    product.run('findCandidates', query), product.run('findCandidates', { ...query, cursor: productFirst.nextCursor }),
    product.run('contextRead', assembly),
  ];
  for (const response of responses) hidden(response);
  assert.deepEqual(ok(responses[0]), { card: null }); assert.deepEqual(ok(responses[1]), { card: null });
  assert.equal(ok(responses[2]).cards.some(card => card.id === ref.cardId || card.id === pending.id), false);
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const role = roleEvidence({ db: f.db, identity, ready() {} }, { path: f.path });
  for (const intent of ['current', 'history']) assert.throws(() => readTransaction(f.db, () => role.item(latest, [ns], 1, intent)), { code: 'evidence_unavailable' });
  const { sourceReadSafety } = await import('../content-safety.mjs');
  const denial = readTransaction(f.db, () => sourceReadSafety(f.db, { identity, namespace: ns, ref: sources[0] }));
  assert.equal(denial.allowed, false);
  assert.equal(denial.reason, mutation === 'excluded' ? 'ineligible' : 'missing');
  await build();
  assert.equal(ok(await h.call(context, 'findCandidates', query)).items.some(item => item.ref.cardId === ref.cardId), false);
  assert.equal(ok(product.run('findCandidates', query)).items.some(item => item.ref.cardId === ref.cardId), false);
});
