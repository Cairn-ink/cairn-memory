import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../contract.mjs';
import { legacyFixture, episodeInput } from '../testing/raw-deletion-review-fixtures.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { contentSafetyObservations } from '../content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';
import { openDatabase, readTransaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { sourceFixture, savedSource, request, splitRaw, resolve, anchor, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { fixture, ns, ok, receipt } from './content-safety-preflight-fixture.mjs';

const limits = { scanRows: 250000, scanBytes: 128 * 1024 * 1024 };
function classify(f, id) {
  const snapshot = readTransaction(f.db, () => contentSafetyObservations(f.db, limits, () => {}));
  return classifyCardBodySafetyV1(snapshot.observations.find(row => row.body.identity.key === id));
}
function rawFixture(t, options = {}) {
  const f = sourceFixture(t, options), upgrade = openDatabase(f.path, { currentDependencies: true }); upgrade.close();
  f.db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
  let serial = 0;
  f.card = memory => {
    const draft = ok(f.call('createCardDraft', { namespace: rawNs, actionId: 'draft-' + (++serial), drafting: 'authored', input: {
      title: 'Synthetic round three title', body: 'Synthetic round three body', sourcePolicy: 'retained-receipts-v1',
      memoryRefs: [{ type: 'memory', namespace: rawNs, memoryId: memory.id, revision: memory.revision }] } }));
    return ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm-' + (++serial) }));
  };
  f.remove = (source, actionId = 'remove-' + (++serial)) => ok(f.core.deleteConversation({ namespace: rawNs,
    conversationId: source.conversationId, actionId,
    expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision }));
  return f;
}

for (const variant of ['exact', 'revision', 'receipt', 'live-episode', 'effect-action', 'no-fence', 'namespace']) {
  test(`R3.1 retained episode proof: ${variant}`, async t => {
    const content = 'Synthetic episode-backed interpretation.';
    const f = rawFixture(t, { kind: 'episode', model: { extract: () => ({ items: [{ content, kind: 'context', confidence: .8, sourceIndices: [0] }] }) } });
    const captured = ok(await f.core.captureRaw(request(splitRaw('Synthetic episode Raw A.')[0],
      { client: 'codex', sessionId: 'episode-A', eventId: 'episode-capture' }, 'episode')));
    const source = { conversationId: captured.raw.conversationId }, episodeId = ok(captured.interpretation).episode.id;
    const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get(), card = f.card(memory);
    const link = f.db.prepare('SELECT * FROM episode_memory_links WHERE memory_id=? AND episode_id=?').get(memory.id, episodeId);
    assert.ok(link); assert.equal(link.admission_revision, memory.revision);
    const bound = f.db.prepare('SELECT receipt_id FROM card_memory_bindings WHERE card_id=? AND receipt_id IN (SELECT value FROM json_each(?))').get(card.id, link.receipt_ids);
    assert.ok(bound);
    ok(f.core.admit({ namespace: rawNs, memory: { content, kind: 'context' }, receipts: [receipt('independent-after')] }));
    f.remove(source);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
    assert.equal(f.db.prepare('SELECT 1 FROM receipts WHERE id=?').get(bound.receipt_id), undefined);
    assert.equal(f.db.prepare('SELECT deleted FROM session_episodes WHERE id=?').get(link.episode_id).deleted, 1);
    if (variant === 'revision') f.db.prepare('UPDATE episode_memory_links SET admission_revision=admission_revision+1 WHERE id=?').run(link.id);
    if (variant === 'receipt') f.db.prepare('UPDATE episode_memory_links SET receipt_ids=? WHERE id=?').run('["synthetic-other-receipt"]', link.id);
    if (variant === 'live-episode') f.db.prepare('UPDATE session_episodes SET deleted=0 WHERE id=?').run(link.episode_id);
    if (variant === 'effect-action') f.db.prepare("UPDATE raw_deletion_effects SET action_id='unrelated-action' WHERE entity_type='episode'").run();
    if (variant === 'no-fence') f.db.exec('DELETE FROM raw_session_fences');
    if (variant === 'namespace') f.db.prepare("UPDATE session_episodes SET owner_id='synthetic-other-owner' WHERE id=?").run(link.episode_id);
    // e9 option A: missing episode-derived receipts are outside single-producer-v1.
    assert.deepEqual(classify(f, card.id), { status: 'unknown', reasons: ['source_missing'] });
  });
}

for (const action of ['ordinary', 'memory-revision', 'memory-revision-no-ledger', 'memory-revision-effect-only', 'memory-forget', 'memory-correct', 'source-exclusion', 'episode-delete']) {
  test(`R3.2 deferred Raw writer never decodes caller action as a Memory contributor: ${action}`, async t => {
    const f = rawFixture(t), a = await savedSource(f, 'Synthetic Raw A.', { sessionId: 'raw-A' });
    const b = await savedSource(f, 'Synthetic Raw B.', { sessionId: 'raw-B' });
    const memory = ok(f.core.admit({ namespace: rawNs, memory: { content: 'Synthetic mixed support.', kind: 'context' }, receipts: [
      { client: 'codex', sessionId: 'raw-A', eventId: a.messageId, role: 'user', excerpt: a.text }, receipt('independent') ] })).memory;
    const unrelated = ok(f.core.admit({ namespace: rawNs, memory: { content: 'Synthetic unrelated forgotten source.', kind: 'context' }, receipts: [receipt('unrelated')] })).memory;
    ok(f.core.forget({ namespace: rawNs, memoryId: unrelated.id, expectedRevision: unrelated.revision }));
    const card = f.card(memory), detail = ok(f.call('getCard', { namespace: rawNs, cardId: card.id })).card;
    const [raw] = await resolve(f, [anchor(b)]);
    ok(f.call('editKnowledgeCard', { namespace: rawNs, cardId: card.id, expectedRevision: detail.revision,
      title: detail.title, body: detail.body, applicability: 'unknown', actionId: 'add-live-Raw-B',
      bindings: [...detail.bindings.map(item => item.source), raw] }));
    const prefix = action.startsWith('memory-revision') ? 'memory-revision' : action;
    const actionId = action === 'ordinary' ? 'ordinary-delete' : `${prefix}-${unrelated.id}-2`;
    f.remove(a, actionId);
    if (['memory-revision-no-ledger', 'memory-revision-effect-only'].includes(action)) {
      f.db.prepare('DELETE FROM raw_deletion_actions WHERE action_id=?').run(actionId);
    }
    if (action === 'memory-revision-effect-only') f.db.prepare("DELETE FROM raw_deletion_effects WHERE entity_type=source_type AND entity_id=source_id").run();
    assert.equal(classify(f, card.id).status, 'unknown');
  });
}

test('R3.2 API UUID effect cannot impersonate a SQL trigger even after its operation is lost', t => {
  const f = fixture(t), forgotten = f.admit(), card = f.draft(ns, undefined, true);
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  const detail = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card, actionId = `memory-revision-${forgotten.id}-2`;
  ok(f.call('editKnowledgeCard', { namespace: ns, cardId: card.id, expectedRevision: detail.revision, actionId,
    title: detail.title, body: detail.body, applicability: 'unknown', bindings: detail.bindings.map(item => item.source) }));
  f.db.prepare('DELETE FROM card_operations WHERE action_id=?').run(actionId);
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R3.2 ambiguous legacy keep roots cannot authenticate a fenced contributor', async t => {
  const f = await legacyFixture(t, 'codex');
  const other = ok(await f.core.capture(episodeInput('codex', 'C'))).episode.id;
  const extra = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(other);
  const action = f.db.prepare('SELECT admission_key,keep_source_ids FROM episode_keep_actions WHERE episode_id=?').get(f.consumer);
  const ids = [...JSON.parse(action.keep_source_ids), extra.id];
  const upgrade = openDatabase(f.path, { currentDependencies: true }); upgrade.close();
  const host = cardHost(), core = openMemoryCore({ path: f.path, privateCards: host.options });
  f.workspace.defer(() => core.close());
  const namespace = rawNs, memory = ok(core.get({ namespace, memoryId: f.memoryId })).memory;
  const draft = ok(host.call(core, 'createCardDraft', { namespace, actionId: 'ambiguous-draft', drafting: 'authored', input: {
    title: 'Synthetic ambiguous title', body: 'Synthetic ambiguous body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision }] } }));
  const card = ok(host.call(core, 'confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision, actionId: 'ambiguous-confirm' }));
  f.db.prepare('UPDATE episode_keep_actions SET keep_source_ids=? WHERE admission_key=?').run(JSON.stringify(ids), action.admission_key);
  const origin = f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(f.origin);
  f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(origin.owner_id, origin.scope, origin.project_id, origin.client, origin.session_key);
  assert.equal(classify(f, card.id).status, 'unknown');
});

function historyReads(t, count) {
  const f = fixture(t), card = f.draft(ns, undefined, true);
  let current = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card;
  for (let index = 0; index < count; index++) {
    ok(f.call('editKnowledgeCard', { namespace: ns, cardId: card.id, expectedRevision: current.revision, actionId: 'edit-' + index,
      title: current.title, body: current.body, applicability: 'unknown', bindings: current.bindings.map(item => item.source) }));
    current = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card;
  }
  const parse = JSON.parse; let reads = 0;
  JSON.parse = function(...args) {
    const value = parse(...args);
    return value && value.id === card.id && Object.hasOwn(value, 'bodyRevision') ? new Proxy(value, {
      get(target, key, receiver) { if (key === 'revision') reads++; return Reflect.get(target, key, receiver); },
    }) : value;
  };
  try { assert.equal(classify(f, card.id).status, 'unknown'); }
  finally { JSON.parse = parse; }
  return reads;
}
test('R3.3 operation history revision reads grow linearly for 200 and 400 edits', t => {
  const small = historyReads(t, 200), large = historyReads(t, 400);
  t.diagnostic(JSON.stringify({ historyRevisionReads: { edits200: small, edits400: large } }));
  assert.ok(small > 0); assert.ok(large <= small * 2.25, `${small} -> ${large}`);
});
