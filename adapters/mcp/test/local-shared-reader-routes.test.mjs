import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../../../core/testing/raw-search-clock.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { ns, counter, query, ok, connect, context, deferred } from './local-shared-support.mjs';

test('N=12 overlapping connections preserve sequential Raw coverage and semantic ready rates', { timeout: 90000 }, async t => {
  installRawSearchTestClock(t);
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-reader-routes.sqlite');
  const seed = openMemoryCore({ path, raw: true, model: rationaleModel() });
  try {
    ok(await seed.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-reader-routes', eventId: 'synthetic-batch',
      messages: Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: 'Synthetic cobalt telescope part ' + i,
        occurredAt: '2026-01-01T08:00:00.000Z' })) }));
    let published;
    for (let i = 0; i < 80; i++) {
      await rawSearchTestWait(1010); ok(await seed.maintainRawSearch({ namespace: ns }));
      published = ok(await seed.searchRaw({ namespace: ns, query: query.query }));
      if (published.coverage.status === 'complete' && published.candidates.length === 12) break;
    }
    assert.equal(published.coverage.status, 'complete'); assert.equal(published.candidates.length, 12);
  } finally { await seed.close(); }
  const base = createFakeEmbedder();
  let blocking = false, entered = 0;
  const gate = deferred(), allEntered = deferred(); t.after(() => gate.resolve());
  const embedder = { ...base, id: 'synthetic-reader-routes-' + randomUUID(), async embed(texts, controls) {
    if (blocking && texts.length === 1 && texts[0] === query.query) {
      if (++entered === 12) allEntered.resolve();
      await gate.promise;
    }
    return base.embed(texts, controls);
  } };
  const host = createLocalSharedRuntime({ path, namespace: ns, contextCounter: counter,
    contextEmbedding: { embedder, policy: { family: 'hosted', maxRequests: 10000, maxUsd: 1,
      maxConcurrent: 1, estimateUsd: () => 0 } } });
  w.defer(() => host.close());
  const clients = [];
  for (let i = 0; i < 12; i++) clients.push((await connect(t, host)).client);
  const input = { ...query, semantic: true, deadlineMs: 5000, maxItems: 24, maxTokens: 6000 };
  let warm;
  for (let i = 0; i < 30; i++) {
    await rawSearchTestWait(1010); await delay(1100);
    warm = await context(clients[0], input);
    if (warm.diagnostics.coverage.raw === 'included' && warm.diagnostics.candidates.channels.semantic.state === 'ready') break;
  }
  assert.equal(warm.diagnostics.coverage.raw, 'included');
  assert.equal(warm.diagnostics.candidates.channels.semantic.state, 'ready');
  const baseline = [];
  for (let i = 0; i < 12; i++) baseline.push(await context(clients[0], input));
  blocking = true;
  const operations = clients.map(client => context(client, input));
  await Promise.race([allEntered.promise, Promise.all(operations).then(() => { throw Error('not_all_connection_query_slots_entered'); })]);
  gate.resolve();
  const concurrent = await Promise.all(operations);
  const rates = results => ({ reads: results.length,
    rawIncluded: results.filter(r => r.diagnostics.coverage.raw === 'included').length,
    semanticReady: results.filter(r => r.diagnostics.candidates.channels.semantic.state === 'ready').length,
    rawItems: results.map(r => r.value.items.filter(item => item.ref.type === 'raw' || item.evidence?.some(e => e.ref.type === 'raw')).length) });
  const single = rates(baseline), twelve = rates(concurrent);
  t.diagnostic('R2b-N12 ' + JSON.stringify({ single, twelve }));
  assert.equal(single.rawIncluded, 12); assert.equal(single.semanticReady, 12);
  assert.ok(single.rawItems.every(count => count > 0), 'N=12 sequential baseline must contain published synthetic Raw');
  assert.deepEqual(twelve, single, 'N=12 shared Raw-included rate must equal twelve sequential reads');
});
