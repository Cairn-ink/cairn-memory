import test from 'node:test';
import assert from 'node:assert/strict';
import { lineageFixture, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
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
  'no engine receipt', 'Memory not among removed bindings']) test(`sealed purge verifier rejects ${fault}`, async t => {
  const f = await setup(t, fault === 'an authored Card'), before = contentSafetyInventory(f.db);
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

test('supersession excludes a current row even when the first rev-one match is stale', async t => {
  const f = await setup(t), current = publish(f, [f.memory], 'moc:synthetic-second-route');
  f.db.prepare("UPDATE card_operations SET result=json_set(result,'$.clusterKey',?) WHERE action_id=?")
    .run('moc:synthetic-purge-topic', current.id);
  // Represent two rev-one rows sharing a route, with the first now invalid.
  // Force that unordered LIMIT 1 result so this cannot pass by row order luck.
  f.db.prepare('UPDATE card_memory_bindings SET memory_revision=memory_revision+1 WHERE card_id=?').run(f.card.id);
  const stale = f.row(f.card.id), retained = f.row(current.id), s = storage(f);
  const memories = s.snapshot(ns, 512, () => {}).memories.filter(m => m.id === f.memory.id);
  let selected = 0;
  const result = observe(f.db, (sql, method, _args, value) => {
    if (method === 'get' && sql.startsWith('SELECT c.* FROM private_cards c JOIN card_operations o ON o.target_id=c.id') && sql.includes('LIMIT 1')) {
      selected++; return stale;
    }
    return value;
  }, () => s.commit(ns, { key: 'moc:synthetic-purge-topic', memories }, { body: 'Synthetic replacement body.' }, timestamp, () => {}));
  assert.equal(selected, 1); assert.equal(result.supersededCount, 1);
  assert.equal(f.row(stale.id).body, null);
  assert.deepEqual(f.row(current.id), retained, 'the current row is excluded from the purge set');
});
