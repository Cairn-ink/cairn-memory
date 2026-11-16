import test from 'node:test';
import assert from 'node:assert/strict';
import { recorded, assertRecorded } from './fixtures/forget-episode-recording.mjs';
import { setup, sql, ok, forgottenText, stepText } from './fixtures/forget-episode.mjs';
import { layouts, label, snapshot, copySummary } from './fixtures/forget-episode-assertions.mjs';
import { namedSource, committedReads } from './fixtures/forget-episode-scope.mjs';

for (const options of layouts) for (const operation of ['forget', 'correct']) {
  test('cross-conversation consumer loses named passages and step ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await setup(t, { ...options, noCards: true });
    const source = namedSource(snapshot(f));
    const passage = sql(f.path, db => db.prepare('SELECT id FROM episode_sources WHERE episode_id=? ORDER BY id LIMIT 1').get(source.id));
    const consumer = copySummary(f, [passage.id]);
    const before = snapshot(f), needles = [forgottenText, stepText, 'consumerneedle', 'consumerstep'];
    assert.notEqual(before.episodes.find(row => row.id === consumer).session_key, source.session_key);
    assert.ok(JSON.stringify(ok(await f.core.getEpisode({ namespace: f.namespace, episodeId: consumer }))).includes('consumerstep'));
    const pin = recorded('forget-episode-scope', t.name);
    assertRecorded(await f.act(operation), pin.actions[0]);
    await committedReads(f, before, { named: [source.id], consumers: [consumer], needles, pin: pin.p1 });
  });
}
