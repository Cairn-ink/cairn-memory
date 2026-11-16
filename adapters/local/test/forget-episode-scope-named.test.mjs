import test from 'node:test';
import assert from 'node:assert/strict';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { setup, sql, ok, range, stepText } from './fixtures/forget-episode.mjs';
import { layouts, label, snapshot } from './fixtures/forget-episode-assertions.mjs';
import { namedSource, independent, committedReads } from './fixtures/forget-episode-scope.mjs';

for (const options of layouts) for (const operation of ['forget', 'correct']) {
  test('named source preserves window and unknown-time Episodes ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, neighbour: true, unknownTime: true });
    const before = snapshot(f), source = namedSource(before);
    assert.equal(before.episodes.length, 4);
    assert.ok(JSON.stringify(ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }))).includes(stepText));
    const pin = recorded('forget-episode-scope', t.name);
    assertRecorded(await f.act(operation), pin.actions[0]);
    // Unnamed neighbours are untouched in this change; read-time withholding is separate work.
    await committedReads(f, before, { named: [source.id], pin: pin.p1 });
    sql(f.path, db => {
      for (const row of before.episodes.filter(row => row.id !== independent(before).id))
        assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(row.client, row.session_key), 'window and unknown-time fences still commit');
    });
  });
  test('two named sessions invalidate both source Episodes ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, twoNamed: true, neighbour: true, unknownTime: true, noCards: true });
    const before = snapshot(f), named = [namedSource(before).id, independent(before).id];
    assert.equal(sql(f.path, db => db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.target.id).n), 2);
    const pin = recorded('forget-episode-scope', t.name);
    assertRecorded(await f.act(operation), pin.actions[0]);
    await committedReads(f, before, { named, pin: pin.p1 });
    sql(f.path, db => {
      for (const id of named) {
        const episode = before.episodes.find(row => row.id === id);
        const conversation = before.headers.find(row => row.client === episode.client && row.session_key === episode.session_key);
        assert.ok(db.prepare('SELECT 1 FROM raw_session_fences WHERE client=? AND session_key=?').get(episode.client, episode.session_key));
        assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(conversation.id), 'both named source exclusions commit');
      }
    });
  });
}
