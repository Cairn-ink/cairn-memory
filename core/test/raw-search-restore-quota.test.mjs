import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { createRawSearchMaintenance } from '../raw-search-maintenance.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../testing/raw-search-clock.mjs';
import { broker, rawSearchHost } from '../testing/raw-search-fixtures.mjs';
import { ns, savedSource, sourceFixture } from '../testing/raw-source-fixtures.mjs';

test('a full sidecar during cancellation recovery preserves the attempt and keeps denial cleanup running', { timeout: 20000 }, async t => {
  installRawSearchTestClock(t);
  const f = sourceFixture(t);
  await savedSource(f, 'Synthetic copper telescope.');
  await savedSource(f, 'Synthetic cedar cabinet.', { sessionId: 'other' });
  const directory = join(f.workspace.path, 'raw-index');
  mkdirSync(directory, { mode: 0o700 });
  const reader = openReadDatabase(f.path, { contextRead: true });
  f.workspace.defer(() => reader.db.close());
  const host = rawSearchHost();
  const authority = createRawSearchAuthority(reader, { ownerId: ns.ownerId, readSet: [ns], crypto: f.port, authority: host.authority });
  const storage = { ...await openRawSearchStorage({ directory, identity: authority.identity, bind: authority.bind, quotaBytes: 512 * 1024 * 1024 }) };
  f.workspace.defer(() => storage.close());

  const provider = Promise.withResolvers();
  let dispatched = false;
  const embedder = { id: 'synthetic-restore-quota', revision: '1', dimensions: 2, normalization: 'l2',
    async embed(texts) {
      dispatched = true;
      await provider.promise;
      return texts.map(() => [1, 0]);
    } };
  const maintenance = createRawSearchMaintenance(storage, authority, { embedder, maintenanceTurn: broker(),
    policy: { family: 'local', maxBatchDocuments: 1, maxRequests: 30, maxConcurrent: 1, maxUsd: 0 } });
  f.workspace.defer(async () => { provider.resolve(); await maintenance.close(); });
  const tick = async input => {
    await rawSearchTestWait(1010);
    const access = authority.authorize('rawSearchMaintenance', {}, host.token);
    return maintenance.maintain({ maxMs: 5000, ...input }, access);
  };

  for (let turn = 0; turn < 8; turn++) await tick();
  assert.equal((await storage.snapshot()).rows.length, 2);
  const generation = new AbortController();
  for (let turn = 0; turn < 8 && !dispatched; turn++) {
    await tick({ embeddings: true, upkeepSignal: generation.signal });
  }
  assert.ok(dispatched, 'provider entered after reserving an attempt');
  const { rows } = await storage.snapshot();
  const reserved = rows.find(row => row.retry.attempts === 1);
  assert.ok(reserved);
  const other = rows.find(row => row.key !== reserved.key);
  generation.abort();
  provider.resolve();
  await rawSearchTestWait(0);

  let restoreCommits = 0, cleanupFences = 0;
  const { commitBatch } = storage, { fence } = authority;
  storage.commitBatch = input => {
    if (input.staged?.some(row => row.key === reserved.key && row.expected === reserved.segment)) {
      restoreCommits++;
      throw Object.assign(new Error('synthetic SQLite quota failure'), { code: 'ERR_SQLITE_ERROR', errcode: 13 });
    }
    return commitBatch(input);
  };
  authority.fence = (...args) => {
    cleanupFences++;
    return fence(...args);
  };
  const resumed = { upkeepSignal: new AbortController().signal };
  const progress = await tick(resumed);
  assert.notEqual(progress.phase, 'failed');
  assert.equal(progress.error, 'quota_exhausted');
  assert.equal(restoreCommits, 1);
  assert.ok(cleanupFences > 0, 'the quota-full turn continues into reconciliation');
  assert.deepEqual((await storage.lookup([reserved.key]))[0].retry, reserved.retry);

  const { conversationId, messageId, span } = other.source.ref;
  f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(conversationId, messageId, span.start, span.end);
  for (let turn = 0; turn < 8 && (await storage.lookup([other.key])).length; turn++) {
    await tick(resumed);
  }
  assert.deepEqual(await storage.lookup([other.key]), [], 'later upkeep removes the denied source');
  await tick(resumed);
  assert.equal(restoreCommits, 1, 'later turns discard the failed restore record');
  assert.deepEqual((await storage.lookup([reserved.key]))[0].retry, reserved.retry);
});
