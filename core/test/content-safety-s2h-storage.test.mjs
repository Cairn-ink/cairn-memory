import test from 'node:test';
import assert from 'node:assert/strict';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { writeContentSuppressionInside, suppressOwnerInside, reserveContentIdentityInside, suppressionEpoch } from '../content-suppression-storage.mjs';

const fact = (patch = {}) => ({ namespace: ns, kind: 'memory', key: 'synthetic-memory', reason: 'purge', actionId: 'synthetic-action', ...patch });
for (const base of [18, 23, 33]) test(`S2h ${base}: immutable facts, reservations, retries and exact owner epochs`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const db = f.connect(); t.after(() => db.close());
  assert.equal(attestContentSafety(db).base, base);
  assert.throws(() => writeContentSuppressionInside(db, fact()), { code: 'storage_error' });
  const first = transaction(db, () => writeContentSuppressionInside(db, fact()));
  assert.equal(first.epoch, 1n);
  assert.deepEqual(transaction(db, () => writeContentSuppressionInside(db, fact({ recordedAt: 'later' }))), first);
  const other = transaction(db, () => writeContentSuppressionInside(db, fact({ reason: 'privacy_erase' })));
  assert.equal(other.epoch, 2n);
  assert.equal(transaction(db, () => suppressOwnerInside(db, { ownerId: 'another-owner', reason: 'account_erasure', actionId: 'owner-erasure' })).epoch, 1n);
  assert.throws(() => transaction(db, () => { writeContentSuppressionInside(db, fact({ actionId: 'rolled-back' })); throw Error('crash'); }), /crash/);
  assert.equal(transaction(db, () => writeContentSuppressionInside(db, fact({ actionId: 'after-crash' }))).epoch, 3n);
  assert.equal(suppressionEpoch(db.prepare('SELECT * FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId)), 3n);
  for (const sql of ['DELETE FROM content_suppressions', "UPDATE content_suppressions SET reason='user_forget'", 'DELETE FROM content_identity_reservations',
    "UPDATE content_identity_reservations SET incarnation='other'", 'DELETE FROM owner_suppression_epochs', 'UPDATE owner_suppression_epochs SET epoch_lo=0']) assert.throws(() => db.exec(sql));
  db.exec('PRAGMA recursive_triggers=OFF');
  for (const table of ['content_identity_reservations','owner_suppression_epochs','content_safety_control']) assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`));
  const columns = db.prepare('PRAGMA table_info(content_suppressions)').all().map(row => row.name).join(',');
  assert.throws(() => db.exec(`INSERT OR REPLACE INTO content_suppressions(${columns}) SELECT ${columns} FROM content_suppressions`));
  assert.throws(() => db.exec('SELECT rowid FROM content_suppressions'));
  assert.throws(() => transaction(db, () => reserveContentIdentityInside(db, ns, 'memory', 'synthetic-memory', 'different')));
  const target = db.prepare('SELECT fact_id FROM content_suppressions WHERE owner_id=? ORDER BY epoch_lo LIMIT 1').get(ns.ownerId).fact_id;
  db.prepare("UPDATE content_suppressions SET cleanup_status='failed',cleanup_attempt=cleanup_attempt+1 WHERE fact_id=?").run(target);
  assert.equal(db.prepare('SELECT reason FROM content_suppressions WHERE fact_id=?').get(target).reason, 'purge');
  db.prepare("UPDATE content_suppressions SET cleanup_status='complete',cleanup_attempt=cleanup_attempt+1 WHERE fact_id=?").run(target);
  assert.equal(db.prepare('SELECT reason FROM content_suppressions WHERE fact_id=?').get(target).reason, 'purge');
  assert.equal(suppressionEpoch(db.prepare('SELECT * FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId)), 3n);
  assert.throws(() => db.prepare("UPDATE content_suppressions SET cleanup_status='pending',cleanup_attempt=cleanup_attempt+1 WHERE fact_id=?").run(target));
});

test('S2h uint64 carry and exhaustion refuse without wrapping; another owner is independent', async t => {
  const f = safetyFixture(t); await f.migrate(); const db = f.connect(); t.after(() => db.close());
  transaction(db, () => writeContentSuppressionInside(db, fact()));
  // Seed boundary state with guards deliberately removed, then restore exactly.
  const trigger = db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_epoch_update'").get().sql;
  db.exec('DROP TRIGGER safety_epoch_update');
  db.prepare('UPDATE owner_suppression_epochs SET epoch_lo=4294967295 WHERE owner_id=?').run(ns.ownerId); db.exec(trigger);
  assert.equal(transaction(db, () => writeContentSuppressionInside(db, fact({ actionId: 'carry' }))).epoch, 4294967296n);
  db.exec('DROP TRIGGER safety_epoch_update');
  db.prepare('UPDATE owner_suppression_epochs SET epoch_hi=4294967295,epoch_lo=4294967295 WHERE owner_id=?').run(ns.ownerId); db.exec(trigger);
  const before = db.prepare('SELECT count(*) n FROM content_suppressions').get().n;
  assert.throws(() => transaction(db, () => writeContentSuppressionInside(db, fact({ actionId: 'exhausted' }))), { code: 'storage_error' });
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n, before);
  assert.equal(transaction(db, () => suppressOwnerInside(db, { ownerId: 'other', reason: 'account_erasure', actionId: 'erase' })).epoch, 1n);
});

test('S2h every canonical PK/UNIQUE/rowid REPLACE route and reserved-key reuse refuses with recursive triggers off', async t => {
  const f = safetyFixture(t, 33); await f.migrate(); const db = f.connect(); t.after(() => db.close());
  const nsValues = [ns.ownerId, ns.scope, ns.projectId];
  db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at)
    VALUES('guard-memory',?,?,?,'guard-fingerprint','Synthetic guard content','fact','explicit',1,1,0,'time','time')`).run(...nsValues);
  db.prepare("INSERT INTO receipts VALUES('guard-receipt','guard-memory','guard-key','synthetic','session','event','user','Synthetic excerpt','time')").run();
  db.prepare("INSERT INTO card_notes VALUES('guard-note',?,?,?,1,'available','Synthetic note',14,NULL,'time')").run(...nsValues);
  db.prepare("INSERT INTO private_cards VALUES('guard-card',?,?,?,1,'draft','Synthetic title','Synthetic body',NULL,'time','time',NULL)").run(...nsValues);
  db.prepare("INSERT INTO raw_conversations VALUES('guard-raw',?,?,?,'codex','synthetic-session',1,'time','time')").run(...nsValues);
  db.prepare(`INSERT INTO raw_messages(conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id)
    VALUES('guard-raw','guard-message',1,'user',4,4,'pending','event')`).run();
  db.prepare(`INSERT INTO raw_parts(conversation_id,message_id,part_index,start,end,byte_count,digest,event_id,saved,reason)
    VALUES('guard-raw','guard-message',0,0,4,4,?,'event',0,'raw_disabled')`).run('a'.repeat(64));
  db.exec('PRAGMA recursive_triggers=OFF');
  for (const [table, kind, key, incarnation] of [
    ['memories','memory','guard-memory'], ['receipts','receipt','guard-receipt'], ['card_notes','submitted-note','guard-note'],
    ['private_cards','card','guard-card'], ['raw_conversations','raw','guard-raw'],
    ['raw_messages','raw-message',JSON.stringify(['guard-raw','guard-message']),'guard-raw'],
    ['raw_parts','raw-part',JSON.stringify(['guard-raw','guard-message',0]),'guard-raw'],
  ]) {
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /safety_identity_reuse/, table);
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    const expressions = columns.map(name => name === 'id' ? "'fresh-id'" : name === 'message_id' ? "'fresh-message'" : name);
    if (['memories','receipts','raw_conversations','raw_messages'].includes(table))
      assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table}(${columns.join(',')}) SELECT ${expressions.join(',')} FROM ${table}`), /safety_identity_reuse/, table+' UNIQUE');
    const row = db.prepare(`SELECT rowid,* FROM ${table} LIMIT 1`).get();
    assert.throws(() => transaction(db, () => {
      reserveContentIdentityInside(db, ns, kind, key, incarnation ?? key);
      // Canonical deletion is allowed; permanent reservation outlives it.
      if (table === 'raw_conversations') { db.exec('DELETE FROM raw_parts; DELETE FROM raw_messages'); }
      if (table === 'raw_messages') db.exec('DELETE FROM raw_parts');
      db.exec(`DELETE FROM ${table}`);
      db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...columns.map(name => row[name]));
    }), /safety_identity_reuse/, table+' reserved reuse');
    const identityColumns = columns.filter(name => ['id','owner_id','scope','project_id','memory_id','receipt_key','conversation_id','message_id','ordinal','part_index','start','end','digest','role','first_event_id'].includes(name));
    for (const column of identityColumns) assert.throws(() => db.exec(`UPDATE ${table} SET ${column}=${['ordinal','part_index','start','end'].includes(column) ? column+'+1' : "'changed'"}`), undefined, table+'.'+column);
    // Explicit rowid replacement cannot bypass the identity guard either.
    assert.throws(() => db.exec(`INSERT OR REPLACE INTO ${table}(rowid,${columns.join(',')}) SELECT rowid,${expressions.join(',')} FROM ${table}`), /safety_identity_reuse/, table+' rowid');
    assert.throws(() => db.exec(`UPDATE ${table} SET rowid=rowid+100`), /safety_identity_change/, table+' rowid UPDATE');
  }
});
