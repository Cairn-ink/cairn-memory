import { copySqliteFixture, readSqliteFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { openDatabase as openLegacyDatabase } from '../testing/raw-v26-database.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../database.mjs';
import { openMemoryCore } from '../index.mjs';
import { migrateContentSafety } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { safetyFixture, ns, ok, receipt, quiescence } from '../testing/content-safety-s2h-fixture.mjs';

for (const base of [18, 23, 33]) test(`S2h migration ${base}: independent tombstone inventory, exact cell and no Card installation`, async t => {
  const f = safetyFixture(t, base), core = openMemoryCore({ path: f.path });
  const a = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic forgotten content', kind: 'fact' }, receipts: [receipt('seed')] })).memory;
  ok(core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision })); core.close();
  let db = f.connect();
  const expected = db.prepare('SELECT id FROM memories WHERE deleted=1').all().map(row => ['memory', row.id]);
  if (base >= 20) {
    const note = randomUUID(), card = randomUUID();
    db.prepare("INSERT INTO card_notes VALUES(?,?,?,?,2,'deleted',NULL,0,NULL,?)").run(note, ns.ownerId, ns.scope, ns.projectId, 'synthetic-time');
    db.prepare("INSERT INTO private_cards VALUES(?,?,?,?,2,'cancelled',NULL,NULL,NULL,?,?,NULL)").run(card, ns.ownerId, ns.scope, ns.projectId, 'synthetic-time', 'synthetic-time');
    expected.push(['submitted-note', note], ['card', card]);
  }
  const beforeCards = db.prepare("SELECT name,sql FROM sqlite_schema WHERE name GLOB 'card_*' OR name='private_cards' ORDER BY name").all();
  db.close();
  const result = await f.migrate(); assert.equal(result.physical, { 18: 34, 23: 38, 33: 48 }[base]);
  db = f.connect();
  assert.deepEqual(db.prepare('SELECT kind,stable_key FROM content_suppressions').all().map(row => [row.kind, row.stable_key]).sort(), expected.sort());
  assert.ok(db.prepare('SELECT reason FROM content_suppressions').all().every(row => row.reason === 'purge'));
  assert.equal(db.prepare('SELECT count(*) n FROM content_identity_reservations').get().n, expected.length);
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_schema WHERE name GLOB 'card_*' OR name='private_cards' ORDER BY name").all(), beforeCards);
  if (base === 18) assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='private_cards'").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name GLOB 'card_body_*'").get().n, 0);
  const domain = db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;
  assert.equal(attestContentSafety(db).base, base); db.close();
  // Explicit re-run is refused, never reset to zero or a fresh domain.
  await assert.rejects(() => f.migrate(), { code: 'unsupported_database' });
  db = f.connect(); assert.equal(db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain, domain); db.close();
});

for (const stage of ['CREATE TABLE content_safety_control', 'INSERT INTO content_suppressions', 'PRAGMA user_version=']) test(`S2h migration rollback at ${stage} is byte-identical and legacy-openable`, async t => {
  const f = safetyFixture(t), core = openMemoryCore({ path: f.path });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic rollback tombstone', kind: 'fact' }, receipts: [receipt('rollback')] })).memory;
  ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })); core.close();
  copySqliteFixture(f.path, f.backupPath); const before = readSqliteFixture(f.path);
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this, sql);
    if (stage !== 'INSERT INTO content_suppressions' && sql.includes(stage)) throw Error('synthetic-migration-failure');
    return result;
  };
  DatabaseSync.prototype.prepare = function(sql) {
    if (stage === 'INSERT INTO content_suppressions' && sql.includes(stage)) throw Error('synthetic-migration-failure');
    return prepare.call(this, sql);
  };
  try { await assert.rejects(() => migrateContentSafety({ ...f, expected: { storeId: f.storeId, base: 18 }, quiescence }), /synthetic-migration-failure/); }
  finally { DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare; }
  assert.deepEqual(readSqliteFixture(f.path), before);
  const db = openLegacyDatabase(f.path); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18); db.close();
});

test('S2h maintenance refuses missing quiescence, changed backup, wrong store and non-source cells', async t => {
  const f = safetyFixture(t); copySqliteFixture(f.path, f.backupPath);
  const input = { ...f, expected: { storeId: f.storeId, base: 18 }, quiescence };
  await assert.rejects(() => migrateContentSafety({ ...input, quiescence: {} }), { code: 'invalid_input' });
  await assert.rejects(() => migrateContentSafety({ ...input, expected: { storeId: 'wrong', base: 18 } }), { code: 'unsupported_database' });
  const db = f.connect(); db.exec("INSERT INTO suppressed VALUES('synthetic','personal','','synthetic-fingerprint')"); db.close();
  const before = readSqliteFixture(f.path);
  await assert.rejects(() => migrateContentSafety(input), { code: 'unsupported_database' });
  assert.deepEqual(readSqliteFixture(f.path), before);
});

test('S2h raw seeding reconciles independent retained exclusions and deletion effects, without inventing removed children', async t => {
  const [{ openRawCaptureCore }, { request, splitRaw, localPlainPort }, { rationaleModel }] = await Promise.all([
    import('../raw-capture.mjs'), import('../testing/raw-capture-fixtures.mjs'), import('../testing/rationale-model.mjs'),
  ]);
  const f = safetyFixture(t, 33);
  const core = openRawCaptureCore({ path: f.path, model: { ...rationaleModel(), extract: () => ({ items: [{ content: 'Synthetic recovered Raw interpretation', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } },
    { mode: 'raw-v1', deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const rawA = ok(await core.captureRaw(request(splitRaw('Synthetic retained Raw A')[0], { namespace: ns, sessionId: 'a', eventId: 'a' })));
  const memory = ok(rawA.interpretation).admission.memories[0];
  ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  const rawB = ok(await core.captureRaw(request(splitRaw('Synthetic retained Raw B')[0], { namespace: ns, sessionId: 'b', eventId: 'b' })));
  const conversationId = rawB.raw.conversationId;
  let db = f.connect(); const revision = db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision; db.close();
  ok(await core.deleteConversation({ namespace: ns, conversationId, expectedRevision: revision, actionId: 'delete-b' })); core.close();
  db = f.connect();
  const expected = [
    ...db.prepare('SELECT id FROM memories WHERE deleted=1').all().map(row => ['memory',row.id,'incarnation','',0,0]),
    ...db.prepare('SELECT conversation_id,message_id,start,end FROM raw_source_exclusions').all().map(row => ['raw',row.conversation_id,'span',row.message_id,row.start,row.end]),
    ...db.prepare("SELECT DISTINCT entity_id FROM raw_deletion_effects WHERE entity_type='conversation'").all().map(row => ['raw',row.entity_id,'incarnation','',0,0]),
  ]; db.close(); await f.migrate(); db = f.connect();
  try {
    const actual = db.prepare('SELECT kind,stable_key,match_mode,message_key,span_start,span_end,reason FROM content_suppressions').all();
    assert.deepEqual(actual.map(row => [row.kind,row.stable_key,row.match_mode,row.message_key,row.span_start,row.span_end]).sort(),expected.sort());
    assert.ok(actual.every(row => row.reason === 'purge'));
    assert.equal(db.prepare("SELECT count(*) n FROM content_identity_reservations WHERE kind='raw-message'").get().n,
      db.prepare('SELECT count(DISTINCT conversation_id||char(0)||message_id) n FROM raw_source_exclusions').get().n);
  } finally { db.close(); }
});
