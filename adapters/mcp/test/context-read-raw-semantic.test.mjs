import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { openMemoryCore } from '../../../core/index.mjs';
import { openContextProductFacade } from '../../../core/context-read-facade.mjs';
import { openProductIndex } from '../../../core/context-product-index.mjs';
import { accessDigest } from '../../../core/context-product-validation.mjs';
import { createLocalRawSearch, createLocalRawSearchUpkeepControl, withLocalRawSearchUpkeep } from '../../../core/local-raw-search.mjs';
import { eventTimeFixture } from '../../../core/testing/receipt-event-time-fixture.mjs';
import { localPlainPort, ns, ok, request, splitRaw } from '../../../core/testing/raw-source-fixtures.mjs';
import { searchFixture } from '../../../core/testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock, rawSearchTestWait } from '../../../core/testing/raw-search-clock.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createContextReadAccess } from '../context-read-access.mjs';
import { buildCairnServer } from '../server.mjs';

const query = 'compass';
const text = 'The compass is in the workshop supply cupboard.';
const types = ['memory'], intent = 'current';
const counter = { id: 'synthetic-counter', countTokens: value => Math.ceil(value.length / 4) };
const policy = { family: 'local', maxBatchDocuments: 1, maxRequests: 100, maxConcurrent: 1, maxUsd: 0 };

for (const layout of [29, 53]) {
  for (const mcp of [true, false]) {
    test(`Explicit lexical context reads keep Raw evidence without embedding through ${mcp ? 'MCP' : 'the product host'}, layout ${layout}`, async t => {
      installRawSearchTestClock(t);
      const f = await seed(t, layout);
      const calls = [];
      const embedder = { id: 'synthetic-raw-embedder', revision: '1', dimensions: 2, normalization: 'l2',
        async embed(texts, controls) { controls.beforeDispatch(); calls.push([...texts]); return texts.map(() => [1, 0]); } };
      const { rawSearch, maintain } = mcp ? localHost(f, embedder) : await productHost(f, embedder);
      let probe;
      for (let i = 0; i < 24; i++) {
        await rawSearchTestWait(1010);
        await maintain();
        probe = await rawSearch.search({ query: 'readiness' });
        if (probe.semantic.state === 'ready') break;
      }
      assert.equal(probe.semantic.state, 'ready', 'Raw vectors must be ready before the read');
      const read = mcp ? await mcpReader(f, rawSearch, embedder) : await productReader(f, rawSearch);
      calls.length = 0;

      const lexical = await read(false);
      const lexicalCalls = calls.splice(0);
      assert.ok(lexical.metered.items.some(item => item.ref.type === 'raw' && item.body === text), JSON.stringify(lexical));
      assert.equal((await read(true)).metered.items.some(item => item.ref.type === 'raw'), true);
      assert.deepEqual(calls, [[query]], 'the semantic control still transmits the Raw query');
      assert.equal((await read()).metered.items.some(item => item.ref.type === 'raw'), true);
      assert.deepEqual(calls, [[query], [query]], 'the default still uses the configured Raw provider');
      assert.deepEqual(lexicalCalls, [], 'the lexical read must not transmit the Raw query');
    });
  }
}

async function seed(t, layout) {
  let path, workspace;
  if (layout === 53) ({ path, workspace } = await eventTimeFixture(t, 33));
  else { workspace = createTestWorkspace(t); path = join(workspace.path, 'store.sqlite'); }
  const core = openMemoryCore({ path, raw: true, rawSearch: false });
  workspace.defer(() => core.close());
  for (const part of splitRaw(text)) ok(await core.captureRaw(request(part)));
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  return { db, path, workspace, port: localPlainPort() };
}

function localHost(f, embedder) {
  // Drive upkeep explicitly so document embeds cannot race the query recorder.
  const upkeep = createLocalRawSearchUpkeepControl({ setTimer: () => ({ unref() {} }), clearTimer() {} });
  upkeep.resume();
  const manager = withLocalRawSearchUpkeep(upkeep, () => createLocalRawSearch(f.path, f.port, { embedder, policy }));
  f.workspace.defer(() => manager.close());
  return { rawSearch: manager.contextPort([ns]),
    maintain: async () => ok(await manager.methods.maintainRawSearch({ namespace: ns })) };
}

async function productHost(f, embedder) {
  const s = await searchFixture(f, { embedder, policy });
  return { rawSearch: { search: input => s.search(input),
    prepareMany: (candidates, settings) => s.service.prepareMany(candidates, settings, s.host.token),
    revalidate: handles => s.service.revalidate(handles) },
  maintain: () => s.maintain({ embeddings: true, maxMs: 5000 }) };
}

async function mcpReader(f, rawSearch, embedder) {
  const access = createContextReadAccess(ns, false, { maintenance: true });
  const core = openMemoryCore({ path: f.path, contextRead: { ...access.configuration, counter, rawSearch, embedder,
    policy: { family: 'local', maxRequests: 100, maxUsd: 1, estimateUsd: () => 0 } } });
  f.workspace.defer(() => core.close());
  await refresh(input => access.call(core, 'refreshContextIndex', input));
  const server = buildCairnServer({ path: f.path, binding: ns, core, context: access,
    contextSemantic: true, maintenance: false, ownsCore: false });
  const client = new Client({ name: 'context-test', version: '1' });
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  f.workspace.defer(() => server.close());
  f.workspace.defer(() => client.close());
  await server.connect(serverSide);
  await client.connect(clientSide);
  return async semantic => {
    const response = await client.callTool({ name: 'read_memory_context',
      arguments: { query, types, intent, deadlineMs: 5000, ...(semantic === undefined ? {} : { semantic }) } });
    assert.equal(response.isError, false, JSON.stringify(response));
    return { metered: ok(JSON.parse(response.content[0].text)) };
  };
}

async function productReader(f, rawSearch) {
  const facade = openContextProductFacade(f.path, {});
  f.workspace.defer(() => facade.close());
  const index = openProductIndex({ path: f.path, facade, rawSearch, counter, maintenance: true,
    authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet: [ns] } }),
      check() {}, envelope: work => work() }),
    ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } });
  f.workspace.defer(() => index.close());
  await refresh(input => index.run('refreshContextIndex', { ...input, mode: 'lexical' }));
  return async semantic => ok(await index.run('contextRead', { query, types, intent, readSet: [ns], deadlineMs: 5000,
    ...(semantic === undefined ? {} : { semantic }) }));
}

async function refresh(run) {
  for (let i = 0; i < 16; i++) {
    const result = ok(await run({ readSet: [ns], types, intent, budget: { maxItems: 64, maxMs: 5000 } }));
    if (result.status === 'complete') return;
  }
  assert.fail('the lexical Memory index must be ready before the read');
}
