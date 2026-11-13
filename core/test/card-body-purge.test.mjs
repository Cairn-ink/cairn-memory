import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { createEngineCardMaintenance } from '../engine-card-maintenance.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { createPrivateEvidenceStorage } from '../private-evidence-storage.mjs';
import { contentReadSafety } from '../content-safety.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside, suppressOwnerInside } from '../content-suppression-storage.mjs';
import { openMemoryCore } from '../index.mjs';

const marker = 'SyntheticForgottenCardMarkerQzv';
const boundary = namespace => [namespace.ownerId, namespace.scope, namespace.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const forget = (f, memory) => f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision });
const rows = (f, namespace = ns) => f.db.prepare(`SELECT * FROM private_cards WHERE ${where} ORDER BY id`).all(...boundary(namespace));
// Scan every column, including retained JSON, rather than relying on a list of
// fields presumed not to hold text. Include immutable seals and suppression facts.
function assertNoMarker(f, namespace = ns) {
  const tables = ['private_cards', 'card_body_authorizations', 'card_body_provenance', 'card_body_sources',
    'card_effects', 'card_operations', 'content_suppressions', 'content_identity_reservations', 'suppressed'];
  for (const table of tables) {
    if (!f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    for (const row of f.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...boundary(namespace))) {
      for (const [column, value] of Object.entries(row)) if (typeof value === 'string' || value instanceof Uint8Array)
        assert.equal(Buffer.from(value).includes(Buffer.from(marker)), false, `forgotten marker survives in ${table}.${column}`);
    }
  }
}
const seals = f => ['card_body_authorizations', 'card_body_provenance', 'card_body_sources'].map(table =>
  f.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    ? f.db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all(...boundary(ns)) : []);
function seed(f, namespace = ns, count = 9, unique = true) {
  return Array.from({ length: count }, (_, i) => {
    const content = `Orion evidence milestone ${i}${unique && i === 0 ? ' ' + marker : ''}`;
    const memory = ok(f.core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-conversation-' + i % 3,
        eventId: 'synthetic-source-' + i, role: 'user', excerpt: content }] })).memory;
    f.db.prepare('UPDATE memories SET created_at=? WHERE id=?').run(new Date(Date.UTC(2026, 0, 1 + i * 3)).toISOString(), memory.id);
    return memory;
  });
}
function worker(f, model) {
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const storage = createEngineCardStorage({ db: f.db, identity, ready() {}, upgrade: true });
  let clock = Date.parse('2026-06-01T00:00:00.000Z');
  return { identity, storage, advance() {
    clock = Math.max(clock, ...rows(f).map(row => Date.parse(row.updated_at))) + 600001;
  },
    pass: (namespace = ns) => createEngineCardMaintenance({ storage, model, now: () => clock })
      .maintain({ namespace, budget: { maxMs: 5000 } }) };
}
// Extra triggers violate sealed schema attestation and permanently refuse the
// handle. Fail the intended statement without changing the fixture's layout.
function withStatementFailure(pattern, work, beforeFailure) {
  const prepare = DatabaseSync.prototype.prepare;
  let injected = false, inspected = false;
  DatabaseSync.prototype.prepare = function(sql) {
    const connection = this, statement = prepare.call(connection, sql);
    if (!pattern.test(sql)) return statement;
    return { run() {
      injected = true; beforeFailure(connection); inspected = true; throw Error('synthetic_abort');
    } };
  };
  try { return work(); }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    assert.equal(injected, true, 'the transaction reaches the intended failure statement');
    assert.equal(inspected, true, 'the purge completes before the injected failure');
  }
}
// Copy a source verbatim into the body, including the unique marker. Remaining
// sources are still bound even though this intentionally small output cites one.
const copyingModel = () => scriptedConsolidator(({ input }) => {
  const memory = input.memories.find(value => value.content.includes(marker)) ?? input.memories[0];
  return { currentState: [{ text: memory.content, memoryIds: [memory.id] }], timeline: [], contradictions: [] };
});
function assertHidden(f, w, cards) {
  const privateStorage = createPrivateCardStorage({ db: f.db, identity: w.identity, ready() {} });
  const evidence = createPrivateEvidenceStorage({ db: f.db, identity: w.identity,
    cardDetailInside: (...args) => privateStorage.cardDetailInside(...args) });
  for (const card of cards) {
    const row = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id);
    const ref = { type: 'card', namespace: ns, cardId: card.id, revision: row.revision, bodyRevision: row.body_revision };
    for (const intent of ['current', 'history']) {
      assert.equal(contentReadSafety(f.db, { identity: w.identity, namespace: ns, ref, intent, method: 'getCard' }).allowed, false);
      assert.equal(privateStorage.cardDetailInside(ns, row.id, [ns], { intent }), null);
      assert.throws(() => evidence.itemsInside(ns, [ref], intent, [ns]), error => error.code === 'evidence_unavailable');
    }
    assert.equal(privateStorage.cardMetadataInside(ns, row), null);
  }
}

for (const sealed of [false, true]) for (const state of ['current', 'stale', 'rebuilt'])
  test(`forget erases copied Card text at rest and permits regeneration: sealed=${sealed}, ${state}`, async t => {
    const model = copyingModel(), f = sealed ? await lineageFixture(t, { options: { model } }) : engineCardFixture(t, { model });
    const memories = seed(f), w = worker(f, model), first = (await w.pass()).built[0];
    assert.ok(first, 'scripted model builds the initial Card');
    assert.ok(rows(f).every(row => row.body.includes(marker)));
    if (state !== 'current') {
      // Revision invalidation preserves the original body's bytes until forget.
      f.db.prepare("UPDATE memories SET revision=revision+1,updated_at='2026-06-01T00:00:00.000Z' WHERE id=?").run(memories[1].id);
      w.advance();
      if (state === 'rebuilt') {
        const next = await w.pass(); assert.equal(next.built.length, 1, JSON.stringify(next));
        assert.equal(rows(f).length, 2);
        assert.equal(rows(f).find(row => row.id === first.id).body, null, 'rebuild purges the superseded body');
        assert.ok(rows(f).find(row => row.id === next.built[0].id).body.includes(marker));
      }
    }
    const old = rows(f), retainedSeals = seals(f), schema = f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    const calls = model.calls.length;
    // The mutation is confined to this test's writer wrapper. The assertion is
    // unchanged, so the same at-rest scan must fail when the purge is skipped.
    const original = DatabaseSync.prototype.prepare;
    if (process.env.CAIRN_TEST_SKIP_ENGINE_CARD_PURGE === '1' && !sealed && state === 'current')
      DatabaseSync.prototype.prepare = function(sql) {
        const statement = original.call(this, sql);
        if (/UPDATE private_cards SET state=\?,revision=revision\+1,title=NULL,body=NULL/.test(sql))
          return { run() { return { changes: 0 }; } };
        return statement;
      };
    try { ok(forget(f, memories[0])); }
    finally { DatabaseSync.prototype.prepare = original; }
    assertNoMarker(f);
    assert.ok(rows(f).every(row => row.state === 'deleted' && row.title === null && row.body === null));
    for (const row of old) assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(row.id).n, 0);
    assert.deepEqual(seals(f), retainedSeals, 'immutable text-free seals remain byte-identical');
    assert.deepEqual(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), schema);
    assert.equal(model.calls.length, calls, 'forget makes no model request');
    assertHidden(f, w, old);
    w.advance();
    const next = await w.pass(); assert.equal(next.built.length, 1, JSON.stringify(next));
    assert.ok(old.every(row => row.id !== next.built[0].id));
    assert.ok(next.built[0].sourceRevisions.every(ref => ref.memoryId !== memories[0].id));
    assertNoMarker(f); assertHidden(f, w, old);
  });

test('late failure rolls back engine text, bindings, seals, effects and bookkeeping with forget', async t => {
  const model = copyingModel(), f = await lineageFixture(t, { options: { model } }), memories = seed(f), w = worker(f, model);
  assert.equal((await w.pass()).built.length, 1);
  const dump = () => ['private_cards', 'card_memory_bindings', 'card_body_authorizations', 'card_body_provenance', 'card_body_sources',
    'card_operations', 'card_effects', 'card_epochs', 'content_suppressions', 'content_identity_reservations', 'owner_suppression_epochs',
    'memories', 'receipts', 'suppressed', 'namespace_epochs']
    .map(table => f.db.prepare(`SELECT * FROM ${table}`).all());
  const before = dump();
  const failed = withStatementFailure(/^DELETE FROM receipts WHERE memory_id = \?$/, () => forget(f, memories[0]), db => {
    assert.ok(rows({ db }).every(row => row.state === 'deleted' && row.body === null));
    assert.equal(db.prepare('SELECT count(*) n FROM card_memory_bindings').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM card_operations WHERE method IN ('consolidateAttempt','consolidateOutcome')").get().n, 0);
  });
  assert.equal(failed.ok, false); assert.deepEqual(dump(), before);
  ok(forget(f, memories[0])); assertNoMarker(f);
});

for (const sealed of [false, true]) test(`supersession erases the old Card bytes atomically: sealed=${sealed}`, async t => {
  let generation = 0;
  const model = scriptedConsolidator(({ input }) => {
    const memory = generation++ === 0 ? input.memories.find(value => value.content.includes(marker))
      : input.memories.find(value => !value.content.includes(marker));
    return { currentState: [{ text: memory.content, memoryIds: [memory.id] }], timeline: [], contradictions: [] };
  });
  const f = sealed ? await lineageFixture(t, { options: { model } }) : engineCardFixture(t, { model });
  const memories = seed(f), w = worker(f, model), first = (await w.pass()).built[0]; assert.ok(first);
  const retainedSeals = seals(f);
  // Add a source while preserving the marker in its original Memory; only
  // the superseded Card's copy must disappear.
  const content = 'Orion synthetic added source milestone.';
  const added = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [{ client: 'synthetic',
    sessionId: 'synthetic-added-conversation', eventId: 'synthetic-added-source', role: 'user', excerpt: content }] })).memory;
  f.db.prepare("UPDATE memories SET created_at='2026-04-01T00:00:00.000Z' WHERE id=?").run(added.id);
  assert.equal((await w.pass()).modelCalls, 0, 'the source change first stales the old Card');
  w.advance();
  const cluster = { key: first.clusterKey, memories: w.storage.snapshot(ns, 512, () => {}).memories };
  const before = rows(f);
  // A failure after purge must roll back the old payload and its bindings.
  assert.throws(() => withStatementFailure(/^INSERT INTO private_cards VALUES\(/, () =>
    w.storage.commit(ns, cluster, { body: 'Synthetic replacement.' }, '2026-07-01T00:00:00.000Z', () => {}), db => {
      assert.equal(rows({ db }).find(row => row.id === first.id).body, null);
      assert.equal(db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(first.id).n, 0);
    }), /synthetic_abort/);
  assert.deepEqual(rows(f), before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(first.id).n, memories.length);
  const next = await w.pass(); assert.equal(next.built.length, 1, JSON.stringify(next));
  assert.equal(next.built[0].clusterKey, first.clusterKey);
  assert.equal(next.deleted, 1, 'the rebuild counts the body it purged in this pass');
  assertNoMarker(f);
  const old = rows(f).find(row => row.id === first.id);
  assert.equal(old.state, 'deleted'); assert.equal(old.title, null); assert.equal(old.body, null);
  for (const table of ['card_bindings', 'card_memory_bindings', 'card_raw_bindings']) {
    if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))
      assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE card_id=?`).get(first.id).n, 0);
  }
  assert.deepEqual(seals(f).map((set, index) => set.filter(row => retainedSeals[index].some(prior => prior.card_id === row.card_id))), retainedSeals);
  assert.equal(w.storage.cards(ns).find(card => card.id === next.built[0].id).status, 'current');
  assertHidden(f, w, [old]);
  assert.equal((await w.pass()).modelCalls, 0, 'unchanged sources do not rebuild');
});

test('publication purges only its own engine routing key and namespace', async t => {
  const model = copyingModel(), f = await lineageFixture(t, { options: { model } }), w = worker(f, model);
  seed(f);
  const first = (await w.pass()).built[0], snapshot = w.storage.snapshot(ns, 512, () => {});
  const other = w.storage.commit(ns, { key: 'moc:synthetic-independent-part', memories: snapshot.memories },
    { body: 'Synthetic independent part.' }, '2026-06-01T00:00:00.000Z', () => {});
  const namespace = { ...ns, projectId: 'synthetic-independent-project' }; seed(f, namespace, 9, false);
  assert.equal((await w.pass(namespace)).built.length, 1);
  const authored = f.confirm(f.draft([f.note('synthetic-independent-author')]));
  const independent = f.row(other.id), authoredBefore = f.row(authored.id), otherBefore = rows(f, namespace);
  w.storage.retire(ns, first.id, '2026-06-01T00:00:00.000Z');
  const next = w.storage.commit(ns, { key: first.clusterKey, memories: snapshot.memories },
    { body: 'Synthetic fresh supported state.' }, '2026-07-01T00:00:00.000Z', () => {});
  assert.ok(next); assertNoMarker(f);
  assert.equal(f.row(first.id).body, null);
  assert.deepEqual(f.row(other.id), independent);
  assert.deepEqual(f.row(authored.id), authoredBefore);
  assert.deepEqual(rows(f, namespace), otherBefore);
});

for (const mode of ['forget', 'namespace', 'owner']) test(`${mode} purges engine text across retained rows and isolates other Cards`, async t => {
  const model = copyingModel(), f = await lineageFixture(t, { options: { model } }), w = worker(f, model);
  const namespaces = [ns, { ...ns, projectId: 'synthetic-other-project' }, { ...ns, ownerId: 'synthetic-other-owner' }];
  const sets = [];
  for (const namespace of namespaces) {
    const memories = seed(f, namespace); assert.equal((await w.pass(namespace)).built.length, 1);
    f.db.prepare("UPDATE memories SET revision=revision+1,updated_at='2026-06-01T00:00:00.000Z' WHERE id=?").run(memories[1].id); w.advance();
    assert.equal((await w.pass(namespace)).built.length, 1);
    sets.push({ namespace, memories, before: rows(f, namespace) });
  }
  const authored = f.confirm(f.draft([f.note('synthetic-authored-source')]));
  const authoredBefore = f.row(authored.id);
  const purge = () => mode === 'owner'
    ? suppressOwnerInside(f.db, { ownerId: ns.ownerId, reason: 'account_erasure', actionId: 'synthetic-erase' })
    : writeContentSuppressionInside(f.db, { namespace: ns, kind: 'namespace', matchMode: 'namespace', reason: 'purge', actionId: 'synthetic-purge' });
  if (mode === 'forget') ok(forget(f, sets[0].memories[0]));
  else {
    assert.throws(() => transaction(f.db, () => { purge(); throw Error('synthetic rollback'); }), /synthetic rollback/);
    for (const set of sets) assert.deepEqual(rows(f, set.namespace).filter(row => row.id !== authored.id), set.before);
    transaction(f.db, purge);
  }
  assert.deepEqual(f.row(authored.id), authoredBefore, 'authored row and body are untouched');
  for (const [index, set] of sets.entries()) {
    const removed = index === 0 || mode === 'owner' && index === 1;
    const engine = rows(f, set.namespace).filter(row => row.id !== authored.id);
    if (removed) {
      assertNoMarker(f, set.namespace);
      assert.ok(engine.every(row => row.body === null && row.title === null && row.state === 'deleted'));
      for (const row of engine) assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(row.id).n, 0);
    } else assert.deepEqual(engine, set.before, 'other namespace/owner rows, including text bytes, are identical');
  }
});

test('a handle without a consolidation model still purges engine text without installing a layout', async t => {
  const model = copyingModel(), f = engineCardFixture(t, { model }), memories = seed(f), w = worker(f, model);
  assert.equal((await w.pass()).built.length, 1);
  const plain = openMemoryCore({ path: f.path }); f.workspace.defer(() => plain.close());
  const schema = f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
  const calls = model.calls.length;
  ok(plain.forget({ namespace: ns, memoryId: memories[0].id, expectedRevision: memories[0].revision }));
  assertNoMarker(f); assert.equal(model.calls.length, calls);
  assert.deepEqual(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), schema);
});
