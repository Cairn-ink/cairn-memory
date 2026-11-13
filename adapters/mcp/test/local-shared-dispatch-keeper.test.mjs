import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { seed, namespace } from './fixtures/episode-server.mjs';
import { call, connect, deferred, holdWriteLock, ok } from './local-shared-support.mjs';

test('shared explicit episode keeper binds to the host dispatcher and retries only its commit', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'keeper.sqlite');
  const data = await seed(path, { count: 1, quick: true }), base = rationaleModel(), locked = deferred();
  let lock, extract = 0;
  const model = { ...base, async extract(request) {
    extract++; lock = await holdWriteLock(t, path, 700); locked.resolve(); return base.extract(request);
  } };
  const host = createLocalSharedRuntime({ path, namespace, raw: false, contextRead: false, model, sessionEpisodesAccess: 'episode-v1' });
  w.defer(() => host.close());
  const a = await connect(t, host), b = await connect(t, host);
  const episode = ok(await call(a.client, 'inspect_session_episode', { episodeId: data.ids[0] })).episode;
  const before = host.inspectTransactions().length;
  const pending = call(a.client, 'keep_session_episode', { episodeId: episode.id, expectedRevision: episode.revision, actionId: 'synthetic-keep' });
  await locked.promise;
  assert.ok(host.inspectTransactions().length > before, 'R2G_KEEPER_SAME_DISPATCHER');
  const start = performance.now();
  ok(await call(b.client, 'inspect_memory', {}));
  assert.ok(performance.now() - start < 400, 'R2G_KEEPER_ASYNC_COMMIT');
  assert.equal(ok(await pending).admission.memories.length, 1);
  assert.equal(extract, 1, 'keeper provider must execute exactly once');
  assert.deepEqual(await lock.exited, [0, null]);
  assert.ok(host.inspectTransactions().every(state => !state.isTransaction));
});
