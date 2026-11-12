import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { engineCardFixture, scriptedConsolidator, ns, ok } from '../testing/engine-card-fixture.mjs';
import { lineageFixture } from '../testing/card-lineage-fixture.mjs';
import { createEngineCardStorage } from '../engine-card-storage.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside, suppressOwnerInside } from '../content-suppression-storage.mjs';
import { openMemoryCore } from '../index.mjs';

const methods = "method IN ('consolidateAttempt','consolidateOutcome')";
const rows = (db, namespace = ns) => db.prepare(`SELECT * FROM card_operations WHERE owner_id=? AND scope=? AND project_id=? AND ${methods} ORDER BY action_id`)
  .all(namespace.ownerId, namespace.scope, namespace.projectId ?? '');
const storage = f => createEngineCardStorage({ db: f.db, ready() {}, upgrade: true,
  identity: f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get() });
const cluster = (s, namespace = ns) => ({ key: 'moc:synthetic-topic', memories: s.snapshot(namespace, 512, () => {}).memories });
const timestamp = '2026-06-01T00:00:00.000Z';
function reserve(s, value, namespace = ns) { return s.claim(namespace, value, timestamp, () => {}); }
function settle(s, attempt, namespace = ns) { s.finish(namespace, attempt, 'terminal', timestamp); }
const forget = (f, memory, namespace = ns) => ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));

for (const position of [0, 1, 2]) test(`forget source ${position} of three purges the entire fingerprint, preserves main Card invalidation and rolls back atomically`, async t => {
  const f = engineCardFixture(t), memories = f.seed(3), s = storage(f), value = cluster(s);
  const attempt = reserve(s, value), card = s.commit(ns, value, { body: 'Synthetic consolidated topic.' }, timestamp, () => {});
  settle(s, attempt);
  assert.equal(rows(f.db).length, 2);
  const victim = memories[position];
  f.db.exec("CREATE TRIGGER synthetic_forget_failure BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'synthetic_abort'); END");
  assert.equal(f.core.forget({ namespace: ns, memoryId: victim.id, expectedRevision: victim.revision }).ok, false);
  assert.equal(rows(f.db).length, 2, 'late failure restores bookkeeping with the Memory');
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(victim.id).deleted, 0);
  f.db.exec('DROP TRIGGER synthetic_forget_failure');
  forget(f, victim);
  assert.deepEqual(rows(f.db), []);
  assert.equal(f.db.prepare(`SELECT count(*) n FROM card_operations WHERE ${methods} AND (target_id=? OR payload_binding=? OR instr(action_id,?)>0 OR instr(result,?)>0)`)
    .get(victim.id, attempt.fingerprint, attempt.fingerprint, victim.id).n, 0);
  const retained = f.db.prepare('SELECT state,revision,body FROM private_cards WHERE id=?').get(card.id);
  assert.equal(retained.state, 'deleted'); assert.equal(retained.revision, 2); assert.equal(retained.body, null);
  assert.throws(() => reserve(s, value), error => error.code === 'source_unavailable');
  settle(s, attempt); assert.deepEqual(rows(f.db), []);
  await f.pass(); assert.deepEqual(rows(f.db), []); assert.equal(f.model.calls.length, 0);
});

for (const failure of [false, true]) test(`forget while model is awaiting cannot settle a purged claim, model failure=${failure}`, async t => {
  let entered, release;
  const entry = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const normal = scriptedConsolidator();
  const model = scriptedConsolidator(async request => { entered(); await gate; if (failure) throw Error('Synthetic failure'); return normal.consolidate(request); });
  const f = engineCardFixture(t, { model }), memories = f.seed(9);
  const pass = f.pass(); await entry;
  const before = rows(f.db); assert.equal(before.length, 1);
  const refs = JSON.parse(before[0].result).sourceRevisions;
  const victim = memories.find(memory => memory.id === refs.at(-1).memoryId);
  forget(f, victim); assert.deepEqual(rows(f.db), []);
  release(); const result = ok(await pass); assert.deepEqual(result.built, []); assert.equal(result.state, 'refused');
  assert.equal(f.db.prepare(`SELECT count(*) n FROM card_operations WHERE ${methods} AND payload_binding=?`).get(before[0].payload_binding).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 0);
  await f.pass();
  assert.ok(rows(f.db).every(row => row.payload_binding !== before[0].payload_binding && !row.result.includes(victim.id)));
});

test('forget during an awaited relation read prevents the initial claim and model dispatch', async t => {
  let entered, release;
  const entry = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const f = engineCardFixture(t, { cardRelations: { async read() { entered(); await gate; return []; } } }), memories = f.seed(8);
  const pass = f.pass(); await entry; forget(f, memories[1]); release();
  assert.equal(ok(await pass).state, 'refused'); assert.equal(f.model.calls.length, 0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='card_operations'").get().n, 0);
});

for (const eraseOwner of [false, true]) test(`namespace purge/owner erasure is atomic, isolated and fences in-flight settlement: owner=${eraseOwner}`, async t => {
  const f = await lineageFixture(t), s = storage(f);
  const otherNamespace = { ...ns, projectId: 'synthetic-other-project' }, otherOwner = { ...ns, ownerId: 'synthetic-other-owner' };
  const sets = [ns, otherNamespace, otherOwner].map((namespace, group) => {
    for (let i = 0; i < 3; i++) ok(f.core.admit({ namespace, memory: { content: `Synthetic topic ${group} source ${i}`, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-conversation', eventId: `synthetic-${group}-${i}`, role: 'user', excerpt: `Synthetic topic ${group} source ${i}` }] }));
    const value = cluster(s, namespace), attempt = reserve(s, value, namespace); settle(s, attempt, namespace);
    return { namespace, attempt, value, before: rows(f.db, namespace) };
  });
  const purge = () => eraseOwner ? suppressOwnerInside(f.db, { ownerId: ns.ownerId, reason: 'account_erasure', actionId: 'synthetic-erasure' })
    : writeContentSuppressionInside(f.db, { namespace: ns, kind: 'namespace', matchMode: 'namespace', reason: 'purge', actionId: 'synthetic-purge' });
  assert.throws(() => transaction(f.db, () => { purge(); assert.deepEqual(rows(f.db), []); throw Error('synthetic rollback'); }), /synthetic rollback/);
  assert.deepEqual(rows(f.db), sets[0].before);
  transaction(f.db, purge);
  for (const [index, set] of sets.entries()) {
    const removed = index === 0 || eraseOwner && index === 1;
    assert.deepEqual(rows(f.db, set.namespace), removed ? [] : set.before);
    if (removed) { settle(s, set.attempt, set.namespace); assert.deepEqual(rows(f.db, set.namespace), []); }
  }
  assert.throws(() => reserve(s, sets[0].value), error => error.code === 'source_unavailable' || error.code === 'evidence_unavailable');
  cluster(s); assert.equal(f.db.prepare("SELECT count(*) n FROM card_operations WHERE owner_id=? AND scope=? AND project_id=? AND method='consolidateCleanup'")
    .get(ns.ownerId, ns.scope, ns.projectId).n, 0);
});

test('forget preserves fully identified claims from other clusters and namespace/owner boundaries', t => {
  const f = engineCardFixture(t), memories = f.seed(6), s = storage(f), all = cluster(s);
  const a = { ...all, memories: all.memories.slice(0, 3) }, b = { key: 'moc:synthetic-other-topic', memories: all.memories.slice(3) };
  const first = reserve(s, a), second = reserve(s, b); settle(s, first); settle(s, second);
  const intact = rows(f.db).filter(row => row.payload_binding === second.fingerprint);
  forget(f, memories.find(memory => memory.id === a.memories[1].id));
  assert.deepEqual(rows(f.db), intact);
});

test('forget removes legacy opaque fingerprints even when their first source is intact', t => {
  const f = engineCardFixture(t), memories = f.seed(3), s = storage(f), attempt = reserve(s, cluster(s)); settle(s, attempt);
  f.db.prepare(`UPDATE card_operations SET result=CASE method WHEN 'consolidateAttempt'
    THEN '{"claimedAt":"2026-06-01T00:00:00.000Z","attemptNumber":1}' ELSE '{"outcome":"terminal"}' END
    WHERE ${methods}`).run();
  forget(f, memories.find(memory => memory.id !== attempt.target));
  assert.deepEqual(rows(f.db), []); settle(s, attempt); assert.deepEqual(rows(f.db), []);
});

test('pre-existing legacy and forgotten-source rows are cleaned in bounded durable pages across reopen without changing layout', async t => {
  const f = engineCardFixture(t), memories = f.seed(3), s = storage(f), value = cluster(s), attempt = reserve(s, value); settle(s, attempt);
  const prototype = rows(f.db)[0];
  forget(f, memories[1]);
  const insert = f.db.prepare('INSERT INTO card_operations VALUES(?,?,?,?,?,?,?,?,?)');
  // Legacy attempts include failures for which no Card/source list ever existed.
  for (let i = 0; i < 140; i++) insert.run(prototype.owner_id, prototype.scope, prototype.project_id, 'synthetic-legacy-' + i,
    i % 2 ? 'consolidateOutcome' : 'consolidateAttempt', prototype.payload_binding, memories[0].id, '{}', timestamp);
  insert.run(prototype.owner_id, prototype.scope, prototype.project_id, 'synthetic-stale-identified', 'consolidateAttempt',
    prototype.payload_binding, memories[0].id, prototype.result, timestamp);
  const schema = f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), version = f.db.prepare('PRAGMA user_version').get();
  const before = rows(f.db).length;
  cluster(storage(f)); const remaining = rows(f.db).length;
  assert.ok(before - remaining > 0 && before - remaining <= 64); assert.ok(remaining > 0);
  // A fresh core and a fresh storage instance must resume the persisted watermark.
  const reader = openMemoryCore({ path: f.path }); f.workspace.defer(() => reader.close());
  const reopened = new DatabaseSync(f.path); f.workspace.defer(() => reopened.close());
  for (let pass = 0; pass < 8 && rows(f.db).length; pass++) cluster(storage({ db: reopened }));
  assert.deepEqual(rows(f.db), []);
  assert.deepEqual(f.db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all(), schema);
  assert.deepEqual(f.db.prepare('PRAGMA user_version').get(), version);
  assert.equal(f.model.calls.length, 0);
});

test('forget statement census on a consolidated synthetic topic', async t => {
  const f = engineCardFixture(t), memories = f.seed(8); ok(await f.pass());
  const original = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec, statements = [];
  DatabaseSync.prototype.prepare = function(sql) {
    const prepared = original.call(this, sql);
    return new Proxy(prepared, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => { if (['run', 'all', 'get', 'iterate'].includes(key)) statements.push(sql); return Reflect.apply(value, target, args); };
    } });
  };
  DatabaseSync.prototype.exec = function(sql) { statements.push(...sql.split(';').filter(part => part.trim())); return exec.call(this, sql); };
  try { forget(f, memories[1]); }
  finally { DatabaseSync.prototype.prepare = original; DatabaseSync.prototype.exec = exec; }
  t.diagnostic('FORGET_STATEMENT_CENSUS ' + JSON.stringify({ node: process.version, statements: statements.length,
    bookkeeping: statements.filter(sql => /DELETE FROM card_operations|SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_operations'/.test(sql)).length }));
});
