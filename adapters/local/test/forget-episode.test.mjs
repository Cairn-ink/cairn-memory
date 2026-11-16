import test from 'node:test';
import assert from 'node:assert/strict';
import { registerContentWriteGuard } from '../../../core/content-write-context.mjs';
import { beginContentWriteSafety } from '../../../core/content-write-safety.mjs';
import { assertReads, snapshot } from './fixtures/forget-episode-assertions.mjs';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { setup, sql, ok, range, forgottenText, stepText } from './fixtures/forget-episode.mjs';

// Preserve the eleven recording-probe scenarios, and pair each forget with correct.
const cases = [
  ['X_29_episodes', { layout: 29 }], ['X_33_episodes', { layout: 33 }],
  ['X_48_episodes', { layout: 48 }], ['X_48_no_episodes', { layout: 48, noEpisodes: true }],
  ['X_48_episodes_other_session_only', { layout: 48, episodeOtherOnly: true }],
  ['X_53time_episodes', { layout: 53 }], ['X_53time_no_episodes', { layout: 53, noEpisodes: true }],
  ['X_53time_episodes_other_session_only', { layout: 53, episodeOtherOnly: true }],
  ['X_53lineage_episodes', { layout: 53, cardLineage: true }],
  ['X_53lineage_no_episodes', { layout: 53, cardLineage: true, noEpisodes: true }],
  ['X_53time_different_messages_episodes', { layout: 53, differentMessages: true }],
];
const text = value => JSON.stringify(value);
function noNeedles(value) {
  for (const needle of [forgottenText, stepText]) assert.equal(text(value).includes(needle), false, 'whole result must withhold ' + needle);
}
function committed(f, operation, connection) {
  const check = db => {
    const row = db.prepare('SELECT * FROM memories WHERE id=?').get(f.target.id);
    assert.equal(row.deleted, operation === 'forget' ? 1 : 0);
    assert.equal(row.content, operation === 'forget' ? null : 'synthetic corrected replacement');
    assert.equal(db.prepare('SELECT count(*) n FROM raw_session_fences WHERE client=? AND session_key=?')
      .get(f.conversation.client, f.conversation.session_key).n, 1, 'source session fence commits');
    assert.ok(db.prepare('SELECT 1 FROM raw_source_exclusions WHERE conversation_id=?').get(f.conversation.id), 'source exclusion commits');
    for (const episode of f.episodes) {
      const named = episode.client === f.conversation.client && episode.session_key === f.conversation.session_key;
      const current = db.prepare('SELECT * FROM session_episodes WHERE id=?').get(episode.id);
      if (named) {
        assert.equal(current.deleted, 1, 'every named Episode is withheld in the transaction');
        assert.equal(JSON.parse(current.record).processing.state, 'invalidated');
        assert.equal(JSON.parse(current.record).nextStep, null);
        assert.equal(db.prepare('SELECT count(*) n FROM episode_sources WHERE episode_id=?').get(episode.id).n, 0);
      } else {
        assert.deepEqual(current, episode, 'unnamed Episode stays byte-for-byte unchanged');
        assert.deepEqual(db.prepare('SELECT * FROM episode_sources WHERE episode_id=? ORDER BY id').all(episode.id),
          f.episodeSources.filter(source => source.episode_id === episode.id), 'all unnamed source rows stay unchanged');
      }
    }
  };
  if (connection) check(connection); else sql(f.path, check);
}
for (const [name, options] of cases) for (const operation of ['forget', 'correct']) {
  const caseName = name === 'X_53time_episodes' && operation === 'correct' ? 'X_53time_correct_episodes' : name + ' ' + operation;
  test(caseName, { concurrency: false, timeout: 120000 }, async t => {
    const f = await setup(t, options);
    const before = { ...snapshot(f), episodes: f.episodes }, pin = recorded('forget-episode', caseName);
    if (!options.noEpisodes && !options.episodeOtherOnly) {
      const before = ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }));
      assert.ok(text(before).includes(stepText), 'a deliverable target step exists before mutation');
    }
    let commits = 0;
    registerContentWriteGuard((db, context) => {
      const state = beginContentWriteSafety(db, context);
      if (!state) return state;
      return { ...state, validate(result) {
        state.validate(result);
        if (context.method === operation) {
          commits++;
          assert.equal(db.isTransaction, true);
          committed(f, operation, db);
        }
      } };
    });
    try { assertRecorded(await f.act(operation), pin.actions[0]); } finally { registerContentWriteGuard(beginContentWriteSafety); }
    if (options.layout >= 48) assert.equal(commits, 1, 'post-state is checked before COMMIT');
    committed(f, operation);
    await assertReads(f, before, { pin: pin.p1, named: f.episodes.filter(episode =>
      episode.client === f.conversation.client && episode.session_key === f.conversation.session_key).map(episode => episode.id) });
    await f.reopen();
    await assertReads(f, before, { pin: pin.p1, named: f.episodes.filter(episode =>
      episode.client === f.conversation.client && episode.session_key === f.conversation.session_key).map(episode => episode.id) });
  });
}
// Window and unknown-time preservation now run on every layout in forget-episode-scope.test.mjs.
test('pending direct Raw readers whole-result needle scan', {
  skip: 'Pending the direct-reader fix on its separate branch; this branch only withholds Episodes.'
}, async t => {
  for (const operation of ['forget', 'correct']) {
    const f = await setup(t, { layout: 53 });
    ok(await f.act(operation));
    noNeedles(await f.core.listRawConversations({ namespace: f.namespace, limit: 50 }));
    noNeedles(await f.core.getConversation({ namespace: f.namespace, conversationId: f.conversation.id, limit: 50 }));
  }
});
