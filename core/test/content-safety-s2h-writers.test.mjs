import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { transaction } from '../database.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { memorySuppressionObservationInside } from '../content-suppression-storage.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

function inspect(db) { return db.prepare('SELECT kind,stable_key,match_mode,source_version,reason,epoch_hi,epoch_lo FROM content_suppressions ORDER BY epoch_hi,epoch_lo').all(); }
// Independent post-commit oracle for the split: every fact written by a
// public terminal operation has the canonical state S1 already consumes.
function assertCanonicalFacts(db) {
  for (const fact of db.prepare('SELECT * FROM content_suppressions').all()) {
    assert.equal(['owner','namespace'].includes(fact.kind),false);
    if (fact.kind === 'memory') {
      const row=db.prepare('SELECT deleted,revision FROM memories WHERE id=?').get(fact.stable_key);
      assert.ok(row);
      if(fact.match_mode === 'revision-through')assert.ok(row.revision>JSON.parse(fact.source_version)[1]);
      else assert.equal(row.deleted,1);
    } else if(fact.kind === 'receipt')assert.equal(db.prepare('SELECT 1 FROM receipts WHERE id=?').get(fact.stable_key),undefined);
    else if(fact.kind === 'card')assert.ok(['deleted','cancelled'].includes(db.prepare('SELECT state FROM private_cards WHERE id=?').get(fact.stable_key)?.state));
    else if(fact.kind === 'submitted-note')assert.equal(db.prepare('SELECT state FROM card_notes WHERE id=?').get(fact.stable_key)?.state,'deleted');
    else if(fact.kind === 'raw') {
      const parent=db.prepare('SELECT 1 FROM raw_conversations WHERE id=?').get(fact.stable_key);
      if(!parent)assert.ok(db.prepare("SELECT 1 FROM raw_deletion_effects WHERE entity_type='conversation' AND entity_id=?").get(fact.stable_key));
      else {assert.equal(fact.match_mode,'span');assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start=? AND end=?')
        .get(fact.stable_key,fact.message_key,fact.span_start,fact.span_end));}
    } else assert.fail('unclassified public fact: '+fact.kind);
  }
}
function inject(db, on) { db.exec(on ? "CREATE TRIGGER injected_fact_failure BEFORE INSERT ON content_suppressions BEGIN SELECT RAISE(ABORT,'synthetic-fact-failure'); END" : 'DROP TRIGGER injected_fact_failure'); }
function admit(core, text) { return ok(core.admit({ namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [receipt(text)] })).memory; }
for (const base of [18, 23, 33]) for (const mutation of ['forget', 'correct', 'reject']) test(`S2h ${base} ${mutation}: atomic causal facts; failure has no tombstone or acknowledgement`, async t => {
  const f = safetyFixture(t, base); await f.migrate();
  const core = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = admit(core, 'Synthetic '+mutation+' content');
  if (mutation === 'reject') db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
  const oldReceipts = db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memory.id).map(row => row.id);
  const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  const invoke = () => mutation === 'correct' ? core.correct({ ...input, content: 'Synthetic corrected content', kind: 'fact', receipt: receipt('corrected') })
    : mutation === 'reject' ? core.reject({ ...input, actionId: 'reject' }) : core.forget(input);
  inject(db, true); const before = contentSafetyInventory(db);
  assert.equal(invoke().ok, false); assert.equal(contentSafetyInventory(db), before); inject(db, false);
  ok(invoke()); assertCanonicalFacts(db); const rows = inspect(db);
  assert.deepEqual(rows.map(row => [row.kind,row.stable_key]).sort(), [['memory',memory.id], ...oldReceipts.map(id => ['receipt',id])].sort());
  const reason = mutation === 'forget' ? 'user_forget' : mutation === 'correct' ? 'correction_supersession' : 'purge';
  assert.ok(rows.every((row, i) => row.reason === reason && row.epoch_hi === 0 && row.epoch_lo === i + 1));
  if (mutation === 'correct') {
    assert.equal(rows[0].match_mode, 'revision-through');
    assert.deepEqual(JSON.parse(rows[0].source_version), ['memory-revision-through-v1', memory.revision]);
    const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
    assert.equal(transaction(db, () => memorySuppressionObservationInside(db, ns, { memoryId: memory.id, revision: memory.revision })).reason, reason);
    assert.equal(contentReadSafety(db, { identity, namespace: ns, ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision + 1 } }).allowed, true);
  }
});

for (const base of [18, 23, 33]) test(`S2h ${base}: supersession retains readable history and writes no suppression`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = admit(core, 'Synthetic historical content');
  ok(core.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Synthetic replacement', kind: 'fact' }, receipts: [receipt('replacement')] }));
  assert.deepEqual(inspect(db), []);
  const revision = db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision;
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  assert.equal(contentReadSafety(db, { identity, namespace: ns, intent: 'history', ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision } }).allowed, true);
});

for (const base of [23, 33]) for (const mutation of ['cancel', 'delete', 'note', 'automatic']) test(`S2h ${base} ${mutation}: Card/note purge facts and rollback`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const host = cardHost();
  const core = openMemoryCore({ path: f.path, privateCards: host.options }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const call = (method, input) => host.call(core, method, input);
  const source = ok(call('submitSourceNote', { namespace: ns, actionId: 'note', text: 'Synthetic note', occurredAt: null })).source;
  let card = ok(call('createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: { title: 'Synthetic title', body: 'Synthetic body', sources: [source] } }));
  if (mutation === 'delete') card = ok(call('confirmCardDraft', { namespace: ns, actionId: 'confirm', cardId: card.id, expectedRevision: card.revision }));
  const invoke = () => mutation === 'automatic' ? transaction(db, () => db.prepare("UPDATE private_cards SET state='cancelled',title=NULL,body=NULL,revision=revision+1,updated_at='synthetic-terminal' WHERE id=?").run(card.id))
    : mutation === 'note' ? call('deleteSourceNote', { namespace: ns, actionId: 'delete-note', sourceId: source.sourceId, expectedRevision: source.revision })
    : call(mutation === 'cancel' ? 'cancelCardDraft' : 'deleteKnowledgeCard', { namespace: ns, actionId: 'terminal', cardId: card.id, expectedRevision: card.revision });
  inject(db, true); const before = contentSafetyInventory(db);
  if (mutation === 'automatic') assert.throws(invoke, /synthetic-fact-failure/); else assert.equal(invoke().ok, false);
  assert.equal(contentSafetyInventory(db), before); inject(db, false);
  if (mutation === 'automatic') invoke(); else ok(invoke());
  assertCanonicalFacts(db); const rows = inspect(db);
  assert.deepEqual(rows.map(row => [row.kind, row.stable_key]).sort(), [['card',card.id], ...(mutation === 'note' ? [['submitted-note',source.sourceId]] : [])].sort());
  assert.ok(rows.every((row, i) => row.reason === 'purge' && row.epoch_lo === i + 1));
});

for (const mutation of ['forget', 'correct', 'delete', 'remove-receipt', 'exclude']) test(`S2h Raw ${mutation}: facts survive child cleanup; failure rolls back all nested writers`, async t => {
  const f = safetyFixture(t, 33); await f.migrate(); const host = cardHost();
  const core = openRawCaptureCore({ path: f.path, privateCards: host.options, model: { ...rationaleModel(), extract: () => ({ items: [{ content: 'Synthetic Raw interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } },
    { mode: 'raw-v1', port: localPlainPort(), sources: true, readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const db = f.connect(); t.after(() => { core.close(); db.close(); });
  const raw = ok(await core.captureRaw(request(splitRaw('Synthetic retained Raw input')[0], { namespace: ns, client: 'codex', sessionId: 'raw-session', eventId: 'raw-event' })));
  const memoryId = ok(raw.interpretation).admission.memories[0].id, conversationId = raw.raw.conversationId;
  const memory = db.prepare('SELECT * FROM memories WHERE id=?').get(memoryId);
  const receipts = db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(memoryId);
  if (mutation === 'remove-receipt') ok(core.admit({ namespace: ns, memory: { content: memory.content, kind: 'fact' }, receipts: [receipt('independent')] }));
  const revision = db.prepare('SELECT revision FROM memories WHERE id=?').get(memoryId).revision;
  const input = { namespace: ns, memoryId, expectedRevision: revision };
  const invoke = () => mutation === 'delete' || mutation === 'remove-receipt' ? core.deleteConversation({ namespace: ns, conversationId,
    expectedRevision: db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision, actionId: 'raw-delete' })
    : mutation === 'correct' ? core.correct({ ...input, content: 'Synthetic Raw correction', kind: 'fact', receipt: receipt('new-receipt') })
    : mutation === 'exclude' ? transaction(db, () => createRawLineageStorage(db).excludeMemory(ns, memoryId, { reason: 'privacy_erase', actionId: 'exclude' })) : core.forget(input);
  inject(db, true); const before = contentSafetyInventory(db);
  if (mutation === 'exclude') assert.throws(invoke, /synthetic-fact-failure/); else assert.equal((await invoke()).ok, false);
  assert.equal(contentSafetyInventory(db), before); inject(db, false);
  if (mutation === 'exclude') invoke(); else ok(await invoke());
  assertCanonicalFacts(db); const rows = inspect(db), reason = mutation === 'forget' ? 'user_forget' : mutation === 'correct' ? 'correction_supersession' : mutation === 'exclude' ? 'privacy_erase' : 'purge';
  assert.ok(rows.length); assert.ok(rows.every((row, i) => row.reason === reason && row.epoch_lo === i + 1));
  if (mutation === 'remove-receipt') {
    assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(memoryId).deleted, 0);
    assert.ok(rows.some(row => row.kind === 'receipt' && row.stable_key === receipts[0].id));
    assert.equal(rows.some(row => row.kind === 'memory'), false);
  }
  if (['forget','correct','exclude'].includes(mutation)) {
    assert.ok(rows.some(row => row.kind === 'raw' && row.match_mode === 'span'));
    // The canonical exclusion is written with the fact. Raw delivery fact checks
    // belong to S2h-2; this test only verifies the retained storage.
    assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(conversationId));
    db.prepare('DELETE FROM raw_source_exclusions WHERE conversation_id=?').run(conversationId);
    assert.ok(inspect(db).some(row => row.kind === 'raw' && row.match_mode === 'span'));
  } else assert.ok(rows.some(row => row.kind === 'raw' && row.match_mode === 'incarnation'));
});

test('S2h a later fact failure and a COMMIT failure roll back facts, reservations, counters and tombstones', async t => {
  for (const stage of ['later-fact','commit']) {
    const f = safetyFixture(t); await f.migrate(); const core = openMemoryCore({ path: f.path }), db = f.connect();
    try {
      const memory = admit(core, 'Synthetic multi-fact rollback');
      if (stage === 'later-fact') db.exec(`CREATE TRIGGER injected_later_fact BEFORE INSERT ON content_suppressions
        WHEN NEW.epoch_lo=2 BEGIN SELECT RAISE(ABORT,'synthetic-later-fact'); END`);
      const before = contentSafetyInventory(db), exec = db.constructor.prototype.exec;
      if (stage === 'commit') db.constructor.prototype.exec = function(sql) {
        if (sql.trim() === 'COMMIT') throw Error('synthetic-commit-failure');
        return exec.call(this, sql);
      };
      let result;
      try { result = core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }); }
      finally { db.constructor.prototype.exec = exec; }
      assert.equal(result.ok, false); assert.equal(contentSafetyInventory(db), before, stage);
      assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM content_identity_reservations').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM owner_suppression_epochs').get().n, 0);
    } finally { core.close(); db.close(); }
  }
});

test('S2h established handles refuse later safety metadata damage before content or ordinary mutation', async t => {
  const f = safetyFixture(t); await f.migrate(); const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = admit(core, 'Synthetic metadata fence content');
  db.exec('DROP TRIGGER safety_memories_insert');
  assert.equal(core.get({ namespace: ns, memoryId: memory.id }).ok, false);
  assert.equal(core.admit({ namespace: ns, memory: { content: 'New content', kind: 'fact' }, receipts: [receipt('new')] }).ok, false);
});

test('S2h same-byte correction retires old receipt incarnations and every earlier Memory revision', async t => {
  const f = safetyFixture(t); await f.migrate(); const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  let memory = admit(core, 'Synthetic same-byte correction');
  // A prior metadata revision must not hide an older bound input.
  db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id); memory = { ...memory, revision: memory.revision + 1 };
  const oldReceipt = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
  ok(core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision, content: 'Synthetic same-byte correction', kind: 'fact', receipt: receipt('replacement-receipt') }));
  assert.equal(db.prepare('SELECT 1 FROM receipts WHERE id=?').get(oldReceipt), undefined);
  assert.ok(inspect(db).some(row => row.kind === 'receipt' && row.stable_key === oldReceipt && row.reason === 'correction_supersession'));
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  for (const revision of [1,2]) assert.equal(transaction(db, () => memorySuppressionObservationInside(db, ns, { memoryId: memory.id, revision })).reason, 'correction_supersession');
  assert.equal(contentReadSafety(db, { identity, namespace: ns, intent: 'history',
    ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: 3 } }).allowed, true);
});

for (const base of [23,33]) test(`S2h ${base}: supersession suppresses only its automatically cancelled dependent draft`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const host = cardHost();
  const core = openMemoryCore({ path: f.path, privateCards: host.options }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = admit(core, 'Synthetic supersession with dependent draft');
  const draft = ok(host.call(core, 'createCardDraft', { namespace: ns, actionId: 'bound-draft', drafting: 'authored', input: {
    title: 'Synthetic bound title', body: 'Synthetic bound body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } }));
  ok(core.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Synthetic replacement for bound draft', kind: 'fact' }, receipts: [receipt('bound-replacement')] }));
  assert.equal(db.prepare('SELECT state FROM private_cards WHERE id=?').get(draft.id).state, 'cancelled');
  assert.deepEqual(inspect(db).map(row => [row.kind,row.stable_key,row.reason]), [['card',draft.id,'purge']]);
  assert.equal(inspect(db).filter(row => ['memory','receipt','raw'].includes(row.kind)).length,0);
});

for (const base of [23,33]) test(`S2h ${base}: confirmed Card keeps intact superseded contributors readable under history`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const host = cardHost();
  const core = openMemoryCore({ path: f.path, privateCards: host.options }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = admit(core, 'Synthetic confirmed historical source');
  const draft = ok(host.call(core, 'createCardDraft', { namespace: ns, actionId: 'history-draft', drafting: 'authored', input: {
    title: 'Synthetic historical Card', body: 'Synthetic intact historical body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } }));
  ok(host.call(core, 'confirmCardDraft', { namespace: ns, actionId: 'history-confirm', cardId: draft.id, expectedRevision: draft.revision, applicability: 'current' }));
  ok(core.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Synthetic fresh historical replacement', kind: 'fact' }, receipts: [receipt('history-replacement')] }));
  const row = db.prepare('SELECT revision,body_revision,state FROM private_cards WHERE id=?').get(draft.id);
  assert.equal(row.state,'confirmed'); assert.deepEqual(inspect(db), []);
  const evidence = ok(host.call(core, 'fetchEvidence', { namespace: ns, intent: 'history',
    refs: [{ type: 'card', namespace: ns, cardId: draft.id, revision: row.revision, bodyRevision: row.body_revision }] }));
  assert.equal(evidence.items[0].body,'Synthetic intact historical body');
});
