import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { batch } from '../testing/episode-helpers.mjs';
import { request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { registerContentWriteGuard } from '../content-write-context.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const timestamp = '2026-06-01T00:00:00.000Z';
function storage(f) { return createEngineCardStorage({ db: f.db, identity: f.identity, ready() {} }); }
function admit(f, suffix) {
  return ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic purge evidence ' + suffix, kind: 'fact' },
    receipts: [receipt(suffix)] })).memory;
}
function publish(f, memories, key = 'moc:synthetic-purge-topic') {
  const s = storage(f), ids = new Set(memories.map(m => m.id));
  const sources = s.snapshot(ns, 512, () => {}).memories.filter(m => ids.has(m.id));
  assert.equal(sources.length, ids.size);
  return s.commit(ns, { key, memories: sources }, { body: 'Synthetic retained engine body.' }, timestamp, () => {});
}
async function setup(t, authored = false) {
  const f = await lineageFixture(t, { options: { model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: [{ content: 'Synthetic unrelated captured evidence.', kind: 'fact', confidence: .8, sourceIndices: [0] }] }),
  } } }), memory = admit(f, 'bound'), other = admit(f, 'unrelated');
  const card = authored ? f.confirm(ok(f.call('createCardDraft', { actionId: 'authored-purge-target', drafting: 'authored',
    input: { title: 'Synthetic authored title', body: 'Synthetic authored body',
      memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }],
      sourcePolicy: 'retained-receipts-v1' } }))) : publish(f, [memory]);
  return { ...f, memory, other, card };
}
// Immutable facts cannot be removed and deleted rows cannot retain text in a
// real SQLite row. Alter only the verifier's SELECT observation for those two
// faults, so its own predicate is exercised without disabling schema guards.
function observe(db, transform, work) {
  const prepare = db.prepare;
  db.prepare = function(sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, method) {
      const value = Reflect.get(target, method, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        return ['get', 'all'].includes(method) ? transform(sql, method, args, result) : result;
      };
    } });
  };
  try { return work(); } finally { db.prepare = prepare; }
}
function transition(f, fault) {
  return transaction(f.db, () => {
    const guard = beginContentWriteSafety(f.db, { method: 'deleteConversation', scopes: [ns] });
    assert.ok(guard);
    try {
      const actionId = 'synthetic-terminal-source', row = f.row(f.card.id);
      const bindings = f.db.prepare('SELECT * FROM card_memory_bindings WHERE card_id=?').all(row.id);
      createPrivateCardStorage({ db: f.db, identity: f.identity, ready() {} }).engineCardWriters().purge(ns, row, actionId);
      if (fault !== 'operation does not forget the bound Memory') {
        const memory = fault === 'Memory not among removed bindings' ? f.other : f.memory;
        writeContentSuppressionInside(f.db, { namespace: ns, kind: 'memory', key: memory.id, reason: 'purge', actionId });
        if (fault !== 'Memory fact without tombstone')
          f.db.prepare('UPDATE memories SET deleted=1,content=NULL,revision=revision+1,updated_at=? WHERE id=?').run(timestamp, memory.id);
      }
      if (fault === 'wrong namespace' || fault === 'wrong owner') f.db.prepare(
        `UPDATE card_effects SET ${fault === 'wrong owner' ? 'owner_id' : 'project_id'}=? WHERE entity_id=? AND kind='card_deleted'`)
        .run('synthetic-foreign', row.id);
      if (fault === 'multi-step revision') f.db.prepare('UPDATE private_cards SET revision=revision+1 WHERE id=?').run(row.id);
      if (fault === 'surviving binding') {
        const b = bindings[0];
        f.db.prepare('INSERT INTO card_memory_bindings VALUES(?,?,?,?,?,?)')
          .run(b.card_id, b.memory_id, b.memory_revision, b.receipt_id, b.source_ref, b.position);
      }
      if (fault === 'seal change') f.db.prepare(`INSERT INTO card_body_provenance SELECT owner_id,scope,project_id,card_kind,card_id,
        body_revision,provenance_revision+1,body_digest,provenance_digest,completeness,origin,source_count,authorization_action
        FROM card_body_provenance WHERE card_id=? ORDER BY provenance_revision DESC LIMIT 1`).run(row.id);
      if (fault === 'two deletion effects' || fault === 'effect for another entity') f.db.prepare(`INSERT INTO card_effects
        SELECT 'synthetic-extra-deletion',owner_id,scope,project_id,kind,entity_type,?,revision,action_id,
        (SELECT max(ordinal)+1 FROM card_effects) FROM card_effects WHERE entity_id=? AND kind='card_deleted'`)
        .run(fault === 'effect for another entity' ? 'engine-card.synthetic-unmodified' : row.id, row.id);
      if (fault === 'no engine receipt') f.db.prepare("DELETE FROM card_operations WHERE target_id=? AND method='consolidate'").run(row.id);
      if (fault === 'other column edited') f.db.prepare('UPDATE private_cards SET body_revision=body_revision+1 WHERE id=?').run(row.id);
      let observations = 0;
      observe(f.db, (sql, method, args, value) => {
        if (['missing purge fact', 'mismatched purge fact'].includes(fault) && method === 'all' &&
            sql.startsWith('SELECT * FROM content_suppressions INDEXED BY content_suppression_window')) {
          observations++;
          return fault === 'missing purge fact' ? value.filter(fact => fact.kind !== 'card') :
            value.map(fact => fact.kind === 'card' ? { ...fact, action_id: 'synthetic-unrelated-action' } : fact);
        }
        if (fault === 'non-null text' && method === 'get' && sql.startsWith('SELECT * FROM "private_cards" WHERE') && args[0] === row.id) {
          observations++; return { ...value, title: 'Synthetic forbidden retained title' };
        }
        return value;
      }, () => {
        try { guard.validate({}); }
        finally {
          if (['missing purge fact', 'mismatched purge fact', 'non-null text'].includes(fault)) assert.ok(observations > 0);
        }
      });
    } finally { guard.close(); }
  });
}

test('sealed purge verifier accepts a terminal bound Memory without a forget method ancestor', async t => {
  const f = await setup(t); transition(f);
  assert.equal(f.row(f.card.id).state, 'deleted');
  assert.equal(f.row(f.card.id).title, null); assert.equal(f.row(f.card.id).body, null);
});
for (const fault of ['wrong namespace', 'wrong owner', 'multi-step revision', 'surviving binding', 'seal change',
  'two deletion effects', 'effect for another entity', 'missing purge fact', 'mismatched purge fact',
  'operation does not forget the bound Memory', 'an authored Card', 'non-null text', 'other column edited',
  'no engine receipt', 'Memory not among removed bindings', 'Memory fact without tombstone', 'already deleted Memory']) test(`sealed purge verifier rejects ${fault}`, async t => {
  const f = await setup(t, fault === 'an authored Card');
  if (fault === 'already deleted Memory') f.db.prepare('UPDATE memories SET deleted=1,content=NULL,revision=revision+1 WHERE id=?').run(f.memory.id);
  const before = contentSafetyInventory(f.db);
  assert.throws(() => transition(f, fault), error => error.code === 'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db), before, 'the entire write rolls back');
});

for (const method of ['capture', 'correct', 'editKnowledgeCard']) test(`ordinary ${method} cannot delete an engine Card through the purge branch`, async t => {
  const f = await setup(t), authored = f.confirm(f.draft([f.note('synthetic-edit-source')])), before = contentSafetyInventory(f.db);
  const invoke = () => method === 'capture' ? f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-capture',
    eventId: 'synthetic-capture-event', messages: [{ id: 'synthetic-message', role: 'user', content: 'Synthetic unrelated capture.' }] }) : method === 'correct' ?
    f.core.correct({ namespace: ns, memoryId: f.other.id, expectedRevision: f.other.revision,
      content: 'Synthetic corrected unrelated evidence.', kind: 'fact', receipt: receipt('correction') }) :
    f.call('editKnowledgeCard', { actionId: 'synthetic-authored-edit', cardId: authored.id, expectedRevision: authored.revision,
      title: 'Synthetic edited title', body: 'Synthetic edited body', applicability: 'current',
      bindings: ok(f.call('getCard', { cardId: authored.id })).card.bindings.map(b => b.source) });
  let injected = 0;
  registerContentWriteGuard((db, operation) => {
    const guard = beginContentWriteSafety(db, operation); if (!guard) return guard;
    return { ...guard, validate(result) {
      injected++;
      const row = db.prepare('SELECT * FROM private_cards WHERE id=?').get(f.card.id);
      createPrivateCardStorage({ db, identity: f.identity, ready() {} }).engineCardWriters()
        .purge(ns, row, 'synthetic-unrelated-source');
      guard.validate(result);
    } };
  });
  let result;
  try { result = await invoke(); } finally { registerContentWriteGuard(beginContentWriteSafety); }
  assert.equal(injected, 1, 'the real write reaches native validation');
  assert.equal(result.ok, false); assert.equal(result.error.code, 'evidence_unavailable');
  assert.equal(contentSafetyInventory(f.db), before);
  ok(await invoke()); assert.equal(f.row(f.card.id).state, 'confirmed', 'the ordinary write succeeds without the injected deletion');
});

test('sealed Raw conversation deletion purges bound engine text and preserves other conversations Cards', async t => {
  let batch = 0;
  const f = await lineageFixture(t, { base: 33, raw: true, options: { model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: Array.from({ length: 2 }, (_, i) => ({ content: `Synthetic conversation evidence ${batch} item ${i}`,
      kind: 'fact', confidence: .8, sourceIndices: [0] })) }),
  } } });
  const conversations = [];
  for (; batch < 2; batch++) {
    const part = splitRaw('Synthetic retained conversation ' + batch)[0];
    const captured = ok(await f.core.captureRaw(request(part, { namespace: ns, sessionId: 'synthetic-conversation-' + batch,
      eventId: 'synthetic-capture-' + batch })));
    const memories = ok(captured.interpretation).admission.memories;
    const card = publish(f, memories, 'moc:synthetic-conversation-' + batch);
    const conversation = f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(captured.raw.conversationId);
    conversations.push({ conversation, memories, card });
  }
  const [removed, retained] = conversations, survivor = f.row(retained.card.id), previous = f.row(removed.card.id);
  const result = ok(f.core.deleteConversation({ namespace: ns, conversationId: removed.conversation.id,
    expectedRevision: removed.conversation.revision, actionId: 'synthetic-delete-conversation' }));
  assert.equal(result.forgottenMemories, removed.memories.length);
  assert.equal(f.db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(removed.conversation.id), undefined);
  const row = f.row(removed.card.id);
  assert.equal(row.revision, previous.revision + 1); assert.equal(row.state, 'deleted');
  assert.equal(row.title, null); assert.equal(row.body, null);
  assert.deepEqual(f.row(retained.card.id), survivor);
  for (const memory of removed.memories) assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  for (const intent of ['current', 'history']) {
    const selected = ok(f.call('selectEvidence', { namespace: ns, intent, query: 'Synthetic', types: ['memory', 'card'] }));
    assert.ok(selected.items.length, 'other conversation evidence remains available');
    const forbidden = new Set([removed.card.id, ...removed.memories.map(m => m.id)]);
    assert.ok(selected.items.every(item => !forbidden.has(item.ref.cardId ?? item.ref.memoryId)));
    const fetched = ok(f.call('fetchEvidence', { refs: selected.items.map(item => item.ref), intent }));
    assert.equal(fetched.items.length, selected.items.length);
    assert.equal(f.call('fetchEvidence', { intent, refs: [{ type: 'card', namespace: ns, cardId: row.id,
      revision: row.revision, bodyRevision: row.body_revision }] }).ok, false);
  }
  assert.equal(ok(f.call('getCard', { cardId: row.id })).card, null);
});

for (const order of ['stale first', 'current first']) test(`publication preserves one current Card per topic with ${order}`, async t => {
  const f = await setup(t), current = publish(f, [f.memory], 'moc:synthetic-second-route');
  f.db.prepare("UPDATE card_operations SET result=json_set(result,'$.clusterKey',?) WHERE action_id=?")
    .run('moc:synthetic-purge-topic', current.id);
  f.db.prepare('UPDATE card_memory_bindings SET memory_revision=memory_revision+1 WHERE card_id=?').run(f.card.id);
  const stale = f.row(f.card.id), retained = f.row(current.id), s = storage(f);
  const memories = s.snapshot(ns, 512, () => {}).memories.filter(m => m.id === f.memory.id);
  let selected = 0;
  const result = observe(f.db, (sql, method, _args, value) => {
    if (sql.startsWith('SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id') &&
        sql.includes("c.revision=1") && sql.includes("$.clusterKey")) {
      selected++;
      const rows = order === 'stale first' ? [stale, retained] : [retained, stale];
      // Exercise both the old LIMIT/get implementation and the complete lookup.
      return method === 'get' ? rows[0] : rows;
    }
    return value;
  }, () => s.commit(ns, { key: 'moc:synthetic-purge-topic', memories }, { body: 'Synthetic replacement body.' }, timestamp, () => {}));
  assert.equal(selected, 1); assert.equal(result, null);
  assert.deepEqual(f.row(stale.id), stale); assert.deepEqual(f.row(current.id), retained);
  const rows = f.db.prepare(`SELECT c.id FROM private_cards c JOIN card_operations o ON o.target_id=c.id
    WHERE c.state='confirmed' AND c.revision=1 AND o.method='consolidate' AND json_extract(o.result,'$.clusterKey')=?
      AND NOT EXISTS(SELECT 1 FROM card_memory_bindings b JOIN memories m ON m.id=b.memory_id
        WHERE b.card_id=c.id AND b.memory_revision!=m.revision)`).all('moc:synthetic-purge-topic');
  assert.deepEqual(rows.map(row => row.id), [current.id], 'exactly one current Card remains');
});

for (const extra of [false, true]) test(`sealed user Card deletion ${extra ? 'refuses a second undeclared engine Card' : 'erases its declared engine Card'}`, async t => {
  const f = await setup(t), second = extra ? publish(f, [f.other], 'moc:synthetic-other-target') : null;
  const before = contentSafetyInventory(f.db);
  let injected = 0;
  if (extra) registerContentWriteGuard((db, operation) => {
    const guard = beginContentWriteSafety(db, operation); if (!guard) return guard;
    return { ...guard, validate(result) {
      injected++;
      createPrivateCardStorage({ db, identity: f.identity, ready() {} }).engineCardWriters()
        .purge(ns, db.prepare('SELECT * FROM private_cards WHERE id=?').get(second.id), 'synthetic-undeclared-deletion');
      guard.validate(result);
    } };
  });
  let result;
  try { result = f.call('deleteKnowledgeCard', { actionId: 'synthetic-user-deletion', cardId: f.card.id, expectedRevision: f.card.revision }); }
  finally { registerContentWriteGuard(beginContentWriteSafety); }
  if (extra) {
    assert.equal(injected, 1); assert.equal(result.ok, false); assert.equal(result.error.code, 'evidence_unavailable');
    assert.equal(contentSafetyInventory(f.db), before);
    assert.equal(f.row(second.id).state, 'confirmed');
  } else {
    assert.equal(ok(result).id, f.card.id);
    const row = f.row(f.card.id); assert.equal(row.state, 'deleted'); assert.equal(row.title, null); assert.equal(row.body, null);
  }
});

function linkedEpisode(f, memories, sessionId = 'synthetic-shared-root') {
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  try {
    // Reserve through the storage seam; the Memories already exist and need
    // links, so model extraction would add an unrelated setup dependency.
    const input = { ...batch('synthetic-episode-event', 'Synthetic episode evidence.', sessionId), client: 'claude-code' };
    const { episodeId: id } = runtime.reserveEpisodeBatch(ns, input);
    const claim = runtime.claimAdmission(ns, { ...input, leaseMs: 125000 });
    runtime.finishAdmission(ns, { ...input, token: claim.token, items: [] });
    for (const memory of memories) {
      const ids = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(row => row.id);
      f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)')
        .run('synthetic-link-' + memory.id, id, memory.id, input.eventId, memory.revision, JSON.stringify(ids));
    }
    return f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(id);
  } finally { runtime.close(); }
}
for (const route of ['deleteConversation', 'forgetEpisode']) test(`sealed mixed ${route} purges shared engine Cards before retaining sibling receipts`, async t => {
  let items = ['Synthetic shared evidence first', 'Synthetic shared evidence second'];
  const f = await lineageFixture(t, { base: 33, raw: true, options: { model: { contextWindow: 8192, countTokens: () => 1,
    extract: () => ({ items: items.map(content => ({ content, kind: 'fact', confidence: .8, sourceIndices: [0] })) }),
  } } });
  const capture = async (sessionId, eventId) => ok(await f.core.captureRaw(request(splitRaw('Synthetic retained root ' + eventId, { id: eventId })[0],
    { namespace: ns, client: 'claude-code', sessionId, eventId })));
  const shared = await capture('synthetic-shared-root', 'synthetic-shared-event');
  const memories = ok(shared.interpretation).admission.memories.toSorted((a, b) => a.id < b.id ? -1 : 1);
  assert.equal(memories.length, 2);
  const [first, second] = memories;
  items = [f.db.prepare('SELECT content FROM memories WHERE id=?').get(first.id).content];
  const independent = await capture('synthetic-independent-root', 'synthetic-independent-event');
  assert.equal(ok(independent.interpretation).admission.memories[0].id, first.id);
  // Keep the Card's chosen receipt on the shared root even if both captures
  // received the same millisecond timestamp and UUID ordering differs.
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=? AND event_id=?')
    .run('2026-01-01T00:00:00.000Z', first.id, 'synthetic-shared-event');
  const ma = ok(f.core.get({ namespace: ns, memoryId: first.id })).memory, mb = second;
  assert.ok(ma.id < mb.id, 'the retained Memory sorts before the terminal Memory');
  const card = publish(f, [ma, mb]), survivor = publish(f, [ma], 'moc:synthetic-surviving-sibling');
  const before = f.row(survivor.id), previous = f.row(card.id);
  assert.equal(f.db.prepare('SELECT r.event_id FROM card_memory_bindings b JOIN receipts r ON r.id=b.receipt_id WHERE b.card_id=? AND b.memory_id=?')
    .get(survivor.id, ma.id).event_id, 'synthetic-shared-event');
  const raw = f.db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(shared.raw.conversationId);
  let result;
  if (route === 'deleteConversation') result = ok(f.core.deleteConversation({ namespace: ns, conversationId: raw.id,
    expectedRevision: raw.revision, actionId: 'synthetic-mixed-delete' }));
  else {
    const episode = linkedEpisode(f, [ma, mb]);
    result = ok(f.core.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision }));
  }
  assert.equal(route === 'deleteConversation' ? result.forgottenMemories : result.forgotten, route === 'deleteConversation' ? 1 : true);
  if (route === 'deleteConversation') { assert.equal(result.retainedMemories, 1); assert.equal(result.removedReceipts, 2); }
  const row = f.row(card.id); assert.equal(row.state, 'deleted'); assert.equal(row.revision, previous.revision + 1);
  assert.equal(row.title, null); assert.equal(row.body, null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(card.id).n, 0);
  const retained = ok(f.core.get({ namespace: ns, memoryId: ma.id }));
  assert.equal(retained.memory.revision, ma.revision + 1); assert.equal(retained.receipts.length, 1);
  assert.equal(retained.receipts[0].eventId, 'synthetic-independent-event');
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(mb.id).deleted, 1);
  const stale = f.row(survivor.id); assert.equal(stale.state, 'confirmed'); assert.equal(stale.revision, before.revision + 1);
  assert.equal(stale.title, before.title); assert.equal(stale.body, before.body);
  const effects = f.db.prepare('SELECT kind,entity_id FROM card_effects WHERE entity_id IN (?,?) ORDER BY ordinal').all(card.id, survivor.id);
  assert.deepEqual(effects.map(row => [row.kind, row.entity_id]), [['card_deleted', card.id], ['evidence_invalidated', survivor.id]]);
});

test('sealed direct episode forgetting purges shared engine text once across linked Memories', async t => {
  const f = await lineageFixture(t), second = admit(f, 'direct-episode-second');
  // Direct episode forgetting terminally forgets every linked Memory, even one
  // with an additional receipt. It does not perform the Raw-root receipt plan.
  const ma = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic purge evidence bound', kind: 'fact' },
    receipts: [receipt('bound'), receipt('direct-independent')] })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: ma.id })).receipts.length, 2);
  const shared = publish(f, [ma, second], 'moc:synthetic-direct-episode');
  const episode = linkedEpisode(f, [ma, second]);
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_deletion_actions'").get(), undefined);
  assert.equal(ok(f.core.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision })).forgotten, true);
  for (const memory of [ma, second]) assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  const row = f.row(shared.id); assert.equal(row.state, 'deleted'); assert.equal(row.revision, 2);
  assert.equal(row.title, null); assert.equal(row.body, null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM card_effects WHERE entity_id=? AND kind='card_deleted'").get(shared.id).n, 1);
});

test('sealed rejection drops held review work and purges the rejected Memory engine Card', async t => {
  const f = await lineageFixture(t, { options: { decisionReview: 'required-v1' } });
  const memory = admit(f, 'reviewed-bound'), other = admit(f, 'reviewed-other'), card = publish(f, [memory, other]);
  const otherCard = publish(f, [other], 'moc:synthetic-review-sibling'), before = f.row(otherCard.id);
  // Seed a previously bound source that now awaits review; the terminal path
  // must handle existing bindings even though new publication excludes it.
  f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
  f.db.prepare(`INSERT INTO confirmation_conflicts(memory_id,memory_revision,target_id,target_revision,source)
    VALUES(?,?,?,?,?)`).run(memory.id, memory.revision, other.id, other.revision, 'synthetic-review');
  const result = ok(f.core.reject({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision, actionId: 'synthetic-reject' }));
  assert.equal(result.forgotten, true); assert.equal(result.reviewEffects.conflicts.length, 1);
  assert.equal(result.reviewEffects.conflicts[0].status, 'dropped');
  const row = f.row(card.id); assert.equal(row.state, 'deleted'); assert.equal(row.title, null); assert.equal(row.body, null);
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 1);
  assert.deepEqual(f.row(otherCard.id), before, 'review effects do not revise the other Memory or its Card');
});
