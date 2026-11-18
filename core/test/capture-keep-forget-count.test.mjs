import assert from 'node:assert/strict';
import test from 'node:test';
import { input, interpretation, ns, ok, setup } from '../testing/episode-capture-helpers.mjs';

test('explicit keep records a suppressed empty admission and reports the same count on replay', async t => {
  const fact = 'Synthetic forgotten finding';
  const f = setup(t, {
    interpretEpisode: request => interpretation(request, 'quick-one-off-question'),
    extract: () => ({ items: [{ content: fact, kind: 'fact', confidence: .9, sourceIndices: [0] }] }),
  });
  const batch = input();
  const { id: episodeId } = ok(await f.core.capture(batch)).episode;
  const sessionId = f.db.prepare('SELECT session_key FROM session_episodes WHERE id=?').get(episodeId).session_key;
  const [{ id: eventId, role, content: excerpt }] = batch.messages;
  const old = ok(f.core.admit({ namespace: ns, memory: { content: fact, kind: 'fact' },
    receipts: [{ client: batch.client, sessionId, eventId, role, excerpt }] })).memory;
  ok(f.core.forget({ namespace: ns, memoryId: old.id, expectedRevision: old.revision }));
  f.model.calls.length = 0;

  const { episode } = ok(f.core.getEpisode({ namespace: ns, episodeId }));
  const action = { namespace: ns, episodeId, expectedRevision: episode.revision, actionId: 'synthetic-keep-forgotten' };
  const kept = ok(await f.core.keepEpisode(action));
  const { indexRevision } = ok(f.core.map({ namespace: ns }));
  assert.equal(kept.duplicate, false);
  assert.deepEqual(kept.admission, { status: 'completed', memories: [], suppressedCount: 1, indexRevision });
  assert.deepEqual(kept.classification, { status: 'skipped', reason: 'empty' });
  const saved = f.db.prepare('SELECT state,keep_state,memory_ids,suppressed_count FROM episode_keep_actions WHERE action_id=?')
    .get(action.actionId);
  assert.deepEqual({ ...saved }, { state: 'completed', keep_state: 'completed', memory_ids: '[]', suppressed_count: 1 });
  const replay = ok(await f.core.keepEpisode(action));
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.admission, { status: 'completed', memoryIds: [] });
  assert.equal(replay.suppressedCount, 1);
  assert.deepEqual(f.model.calls, [], 'neither keep operation dispatches a model request');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
});
