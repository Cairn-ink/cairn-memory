import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
const createLocalSharedRuntime = (options, diagnostics) => createSharedRuntime(options, { strict: true, ...diagnostics });
import { seed, namespace } from './fixtures/episode-server.mjs';
import { call, connect, deferred, ok } from './local-shared-support.mjs';

test('shared explicit episode keeper binds to the host dispatcher and retries only its commit', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'keeper.sqlite');
  const data = await seed(path, { count: 1, quick: true }), base = rationaleModel(), locked = deferred();
  const holder = new DatabaseSync(path);
  let armed = false, backoffs = 0, extract = 0;
  const model = { ...base, async extract(request) {
    extract++; return base.extract(request);
  } };
  const host = createLocalSharedRuntime({ path, namespace, raw: false, contextRead: false, model, sessionEpisodesAccess: 'episode-v1' },
    { onBackoff() { backoffs++; locked.resolve(); } });
  w.defer(() => host.close());
  w.defer(() => { if (holder.isTransaction) holder.exec('ROLLBACK'); holder.close(); });
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (armed && this !== holder && sql === 'BEGIN IMMEDIATE' && new Error().stack.includes('finishAdmission')) {
      armed = false; holder.exec('BEGIN IMMEDIATE');
    }
    return Reflect.apply(exec, this, [sql]);
  });
  const a = await connect(t, host), b = await connect(t, host);
  const episode = ok(await call(a.client, 'inspect_session_episode', { episodeId: data.ids[0] })).episode;
  const before = host.inspectTransactions().length;
  armed = true;
  const pending = call(a.client, 'keep_session_episode', { episodeId: episode.id, expectedRevision: episode.revision, actionId: 'synthetic-keep' });
  void pending.catch(() => {});
  try { await locked.promise;
  assert.ok(backoffs >= 1, 'keeper admission must actually encounter BUSY');
  assert.ok(host.inspectTransactions().length > before, 'R2G_KEEPER_SAME_DISPATCHER');
  const start = performance.now();
  ok(await call(b.client, 'inspect_memory', {}));
  assert.ok(performance.now() - start < 400, 'R2G_KEEPER_ASYNC_COMMIT');
  } finally { if (holder.isTransaction) holder.exec('ROLLBACK'); }
  assert.equal(ok(await pending).admission.memories.length, 1);
  assert.equal(extract, 1, 'keeper provider must execute exactly once');
  assert.ok(host.inspectTransactions().every(state => !state.isTransaction));
});
