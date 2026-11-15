import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../../../core/testing/raw-search-clock.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
const createLocalSharedRuntime = options => createSharedRuntime(options, { strict: true });
import { createCairnServer } from '../server.mjs';
import { ns, counter, query, ok, connect, context, deferred, streams } from './local-shared-support.mjs';

test('A3 eight parallel connections preserve single-connection Raw coverage and semantic ready rates', { timeout: 90000 }, async t => {
  installRawSearchTestClock(t);
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-capacity.sqlite');
  const singlePath = join(w.path, 'synthetic-capacity-single.sqlite');
  const ordinaryPath = join(w.path, 'synthetic-capacity-unbound.sqlite');
  for (const fixturePath of [path, singlePath, ordinaryPath]) {
    const seed = openMemoryCore({ path: fixturePath, raw: true, model: rationaleModel() });
    try {
      // Core capture requires message IDs; Raw retention accepts codex/claude-code.
      // Keep each extraction within the core's five-item output limit.
      for (let i = 0; i < 12; i++) ok(await seed.capture({ namespace: ns, client: 'codex',
        sessionId: 'synthetic-capacity', eventId: 'synthetic-batch-' + i,
        messages: [{ id: 'synthetic-message-' + i, role: 'user', content: 'Synthetic cobalt telescope part ' + i,
          occurredAt: '2026-01-01T08:00:00.000Z' }] }));
      let published;
      for (let i = 0; i < 80; i++) {
        await rawSearchTestWait(1010); ok(await seed.maintainRawSearch({ namespace: ns }));
        published = ok(await seed.searchRaw({ namespace: ns, query: query.query }));
        if (published.coverage.status === 'complete' && published.candidates.length === 12) break;
      }
      assert.equal(published.coverage.status, 'complete'); assert.equal(published.candidates.length, 12);
    } finally { await seed.close(); }
  }
  const base = createFakeEmbedder();
  let blocking = false, entered = 0;
  const gate = deferred(), allEntered = deferred(); t.after(() => gate.resolve());
  const embedder = { ...base, id: 'synthetic-capacity-' + randomUUID(), async embed(texts, controls) {
    if (blocking && texts.length === 1 && texts[0] === query.query) {
      if (++entered === 8) allEntered.resolve();
      await gate.promise;
    }
    return base.embed(texts, controls);
  } };
  const configuration = { namespace: ns, contextCounter: counter,
    contextEmbedding: { embedder, policy: { family: 'hosted', maxRequests: 10000, maxUsd: 1,
      maxConcurrentQueries: 8, estimateUsd: () => 0 } } };
  // Independent identical fixtures prevent either runtime's sidecar from
  // warming the other. Decision (A): strict parity uses host mode on both
  // fixtures; the unbound server has one query slot on shared daily totals.
  const singleHost = createLocalSharedRuntime({ ...configuration, path: singlePath });
  w.defer(() => singleHost.close());
  const referenceClient = (await connect(t, singleHost)).client;
  const server = createCairnServer({ ...configuration, path: ordinaryPath });
  const [serverSide, clientSide] = streams(), direct = new Client({ name: 'synthetic-capacity-oracle', version: '1' });
  w.defer(async () => { await direct.close(); await server.close(); serverSide.destroy(); clientSide.destroy(); });
  await server.connect(new StdioServerTransport(serverSide, serverSide));
  await direct.connect(new StdioServerTransport(clientSide, clientSide), { prior: { kind: 'legacy' } });
  const host = createLocalSharedRuntime({ ...configuration, path });
  w.defer(() => host.close());
  const clients = [];
  for (let i = 0; i < 8; i++) clients.push((await connect(t, host)).client);
  const input = { ...query, semantic: true, deadlineMs: 5000, maxItems: 24, maxTokens: 6000 };
  let warm;
  for (let i = 0; i < 30; i++) {
    await rawSearchTestWait(1010); await delay(1100);
    const ordinary = await context(direct, input);
    const reference = await context(referenceClient, input);
    warm = await context(clients[0], input);
    // Main's unbound upkeep may leave this exact semantic view unready.
    // Wait for Raw there, and semantic readiness on both host fixtures.
    if (ordinary.diagnostics.coverage.raw === 'included' &&
        reference.diagnostics.coverage.raw === 'included' && reference.diagnostics.candidates.channels.semantic.state === 'ready' &&
        warm.diagnostics.coverage.raw === 'included' && warm.diagnostics.candidates.channels.semantic.state === 'ready') break;
  }
  const ordinaryBaseline = [], referenceBaseline = [];
  for (let i = 0; i < 8; i++) {
    ordinaryBaseline.push(await context(direct, input));
    referenceBaseline.push(await context(referenceClient, input));
  }
  assert.equal(warm.diagnostics.coverage.raw, 'included');
  assert.equal(warm.diagnostics.candidates.channels.semantic.state, 'ready');
  const baseline = [];
  for (let i = 0; i < 8; i++) baseline.push(await context(clients[0], input));
  blocking = true;
  const operations = clients.map(client => context(client, input));
  await Promise.race([allEntered.promise, Promise.all(operations).then(() => { throw Error('not_all_connection_query_slots_entered'); })]);
  gate.resolve();
  const concurrent = await Promise.all(operations);
  const rates = results => ({ reads: results.length,
    rawIncluded: results.filter(r => r.diagnostics.coverage.raw === 'included').length,
    semanticReady: results.filter(r => r.diagnostics.candidates.channels.semantic.state === 'ready').length,
    rawItems: results.map(r => r.value.items.filter(item => item.ref.type === 'raw' || item.evidence?.some(e => e.ref.type === 'raw')).length) });
  const single = rates(baseline), eight = rates(concurrent);
  const ordinary = rates(ordinaryBaseline), reference = rates(referenceBaseline);
  t.diagnostic('A3 ' + JSON.stringify({ ordinary, reference, single, eight }));
  assert.equal(single.rawIncluded, 8); assert.equal(single.semanticReady, 8);
  assert.ok(single.rawItems.every(count => count > 0), 'single-connection baseline must contain published synthetic Raw');
  const rawCoverage = ({ rawIncluded, rawItems, reads }) => ({ rawIncluded, rawItems, reads });
  assert.deepEqual(rawCoverage(eight), rawCoverage(ordinary), 'A3_UNBOUND_RAW_EQUAL');
  assert.ok(eight.semanticReady >= ordinary.semanticReady, 'A3_READY_AT_LEAST_UNBOUND');
  assert.deepEqual(eight, reference, 'A3_HOST_REFERENCE_EQUAL');
  assert.deepEqual(eight, single);
});
