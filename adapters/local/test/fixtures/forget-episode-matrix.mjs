import assert from 'node:assert/strict';
import { registerContentWriteGuard } from '../../../../core/content-write-context.mjs';
import { beginContentWriteSafety } from '../../../../core/content-write-safety.mjs';
import { assertReads, snapshot } from './forget-episode-assertions.mjs';
import { recorded, assertRecorded } from './forget-episode-recording.mjs';
import { setup, sql, ok, range, stepText } from './forget-episode.mjs';

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
export async function runMatrixCase(t, options, operation) {
  const caseName = t.name;
  const f = await setup(t, options);
  const before = { ...snapshot(f), episodes: f.episodes }, pin = recorded('forget-episode', caseName);
  if (!options.noEpisodes && !options.episodeOtherOnly) {
    const before = ok(await f.core.listEpisodes({ namespace: f.namespace, ...range, timeBasis: 'receipt' }));
    assert.ok(JSON.stringify(before).includes(stepText), 'a deliverable target step exists before mutation');
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
  const expected = { pin: pin.p1, named: f.episodes.filter(episode =>
    episode.client === f.conversation.client && episode.session_key === f.conversation.session_key).map(episode => episode.id) };
  await assertReads(f, before, expected);
  await f.reopen();
  await assertReads(f, before, expected);
}
