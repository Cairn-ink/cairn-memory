import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRawSourceRoots } from '../../../core/raw-source-roots.mjs';
import { layouts, label, snapshot, assertStored, assertReads } from './fixtures/forget-episode-assertions.mjs';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { setup, sql, forgottenText, stepText, otherStep } from './fixtures/forget-episode.mjs';

// Older keeps stamp the consumer's receipt identity while recording exact
// source IDs. Reuse that persisted shape; never infer authority from text.
for (const options of layouts)
  for (const operation of ['forget', 'correct']) test('legacy keeper invalidates proven origin and stamped consumer ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, noCards: true, neighbour: true, unknownTime: true, seedBeforeMigration(db, { namespace }) {
      const episodes = db.prepare('SELECT * FROM session_episodes WHERE deleted=0').all();
      const target = db.prepare('SELECT * FROM memories WHERE content=?').get('forgetneedle synthetic victim');
      const origin = episodes.find(row => JSON.parse(row.record).gist.includes('forgetneedle'));
      const consumer = episodes.find(row => JSON.parse(row.record).gist.includes('independent'));
      const receipt = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(target.id);
      const sourceId = 'synthetic-kept-source', eventId = 'synthetic-keep';
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO episode_sources VALUES(?,?,?,?,?,?,?,?,0,1)').run(sourceId, consumer.id, origin.id,
          eventId, receipt.event_id, 'a'.repeat(64), receipt.role, receipt.excerpt);
        db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id=?').run(receipt.id);
        const value = { client: consumer.client, sessionId: 'independent', eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt };
        db.prepare('UPDATE receipts SET client=?,session_id=?,receipt_key=? WHERE id=?').run(value.client, value.sessionId,
          createHash('sha256').update(JSON.stringify(value)).digest('hex'), receipt.id);
        db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,1,?)').run('synthetic-keep-link', consumer.id,
          target.id, eventId, JSON.stringify([receipt.id]));
        db.prepare(`INSERT INTO episode_keep_actions VALUES(?,?,?,?,?,?,?,?,?,'completed',NULL,NULL,?,0,'completed',NULL,?,?,?,1,?)`)
          .run('b'.repeat(64), 'synthetic-keep', consumer.id, namespace.ownerId, namespace.scope, '', consumer.client, eventId,
            'c'.repeat(64), JSON.stringify([target.id]), JSON.stringify([sourceId]), consumer.revision, consumer.source_fence,
            '2020-01-01T00:00:00.000Z');
        const stored = db.prepare('SELECT * FROM receipts WHERE id=?').get(receipt.id);
        const proof = createRawSourceRoots(db).receipt({ ...namespace, projectId: '' }, stored);
        assert.equal(proof.legacyKeep, true);
        assert.equal(proof.unknown, false);
        assert.equal(proof.roots[0].sessionKey, origin.session_key);
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    } });
    const pin = recorded('forget-episode-keeper', t.name);
    const before = snapshot(f), named = before.episodes.filter(row =>
      /forgetneedle|independent/.test(JSON.parse(row.record).gist)).map(row => row.id);
    const needles = [forgottenText, stepText, 'independent episode evidence', otherStep];
    assert.equal(named.length, 2);
    assertRecorded(await f.act(operation), pin.actions[0], needles);
    sql(f.path, db => {
      const origin = before.episodes.find(row => JSON.parse(row.record).gist.includes('forgetneedle'));
      const conversation = db.prepare('SELECT id FROM raw_conversations WHERE client=? AND session_key=?').get(origin.client, origin.session_key);
      assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(conversation.id),
        'exclusion resolved the original source before invalidation removed keep IDs');
    });
    assertStored(f, before, { named });
    await assertReads(f, before, { named, needles, pin: pin.p1 });
    await f.reopen();
    await assertReads(f, before, { named, needles, pin: pin.p1 });
  });
