import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/core/internal';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { createCairnServer } from '../server.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { ns, counter, query, ok, streams, connect, call, context, deferred } from './local-shared-support.mjs';

test('first attach builds exactly one core, Raw timer and refresher for eight connections', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic.sqlite'), namespace: ns,
    contextCounter: counter, model: { consolidate() {} } });
  w.defer(() => host.close());
  assert.equal(host.inspect().runtime.state, 'dormant');
  const signals = ['SIGTERM', 'SIGINT'].map(name => process.listenerCount(name));
  let rawTimers = 0, refreshers = 0;
  const native = globalThis.setTimeout;
  const mock = t.mock.method(globalThis, 'setTimeout', function(...args) {
    const stack = new Error().stack;
    if (stack.includes('/core/local-raw-search.mjs:')) rawTimers++;
    if (/at arm \([^\n]*\/adapters\/mcp\/server\.mjs:/.test(stack)) refreshers++;
    return Reflect.apply(native, this, args);
  });
  const handles = [];
  for (let i = 0; i < 8; i++) {
    const [a, b] = streams(); t.after(() => { a.destroy(); b.destroy(); });
    handles.push(host.attach(a, a));
  }
  assert.deepEqual(host.inspect(), { connections: 8, inFlight: 0, sdkServers: 0,
    runtime: { state: 'active', cores: 1, rawManagers: 1, rawMaintenanceTimers: 1, refreshers: 1 } });
  assert.equal(rawTimers, 1, 'one Raw scheduler across all attachments'); assert.equal(refreshers, 1); mock.mock.restore();
  assert.deepEqual(['SIGTERM', 'SIGINT'].map(name => process.listenerCount(name)), signals);
  await handles[0].close();
  assert.equal(host.inspect().connections, 7); assert.equal(host.inspect().runtime.cores, 1);
  await host.close(); await host.close();
  assert.equal(host.inspect().runtime.state, 'closed'); assert.equal(host.inspect().connections, 0);
  assert.throws(() => host.attach(...streams()), /local_host_closed/);
});

test('shared and createCairnServer connections have identical catalogues, schemas and canonical results', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), options = { path: join(w.path, 'synthetic-parity.sqlite'), namespace: ns, raw: false, contextCounter: counter };
  const host = createLocalSharedRuntime(options); w.defer(() => host.close());
  const shared = await connect(t, host), server = createCairnServer(options);
  w.defer(() => server.close());
  const [a, b] = streams(), direct = new Client({ name: 'synthetic-direct-client', version: '1' });
  t.after(async () => { await direct.close(); a.destroy(); b.destroy(); });
  await server.connect(new StdioServerTransport(a, a));
  await direct.connect(new StdioServerTransport(b, b), { prior: { kind: 'legacy' } });
  assert.deepEqual((await shared.client.listTools()).tools, (await direct.listTools()).tools);
  const memory = ok(await call(shared.client, 'remember_memory', { content: 'Synthetic cobalt telescope parity', kind: 'fact' })).memory;
  for (const [name, args] of [['inspect_memory', { memoryId: memory.id }],
    ['recall_memory', { query: 'synthetic' }], ['inspect_memory', {}]]) {
    assert.deepEqual(await call(shared.client, name, args), await call(direct, name, args));
  }
  const sharedRead = await context(shared.client), directRead = await context(direct);
  assert.deepEqual(sharedRead.value, directRead.value);
  assert.notEqual(sharedRead.snapshot, directRead.snapshot, 'only the shared connection wraps continuations');
});

test('the first context call waits for the shared tokenizer without a caller readiness wait', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-counter-startup.sqlite');
  const seed = openMemoryCore({ path });
  try {
    ok(seed.admit({ namespace: ns, memory: { content: 'Synthetic cobalt telescope startup', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'startup', eventId: 'startup', role: 'user', excerpt: 'Synthetic cobalt telescope startup' }] }));
  } finally { await seed.close(); }
  const host = createLocalSharedRuntime({ path, namespace: ns, raw: false }); w.defer(() => host.close());
  const a = await connect(t, host);
  assert.equal((await context(a.client)).value.items.length, 1);
});

test('an oversized incoming frame revokes only its connection and leaves B usable', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic-frame.sqlite'), namespace: ns, raw: false, contextCounter: counter });
  w.defer(() => host.close());
  const a = await connect(t, host), b = await connect(t, host);
  a.stream.write('x'.repeat(262145));
  await nextTurn(); await nextTurn();
  assert.equal(host.inspect().connections, 1, 'failed connection must be removed without closing B');
  assert.equal(a.handle.inspect().closed, true);
  ok(await call(b.client, 'remember_memory', { content: 'Synthetic surviving transport-error write', kind: 'fact' }));
  assert.equal(host.inspect().runtime.cores, 1);
});

test('real SDK connections own cursors/snapshots and forget is visible on the next read and retained page', { timeout: 30000 }, async t => {
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic.sqlite'), namespace: ns, raw: false, contextCounter: counter });
  w.defer(() => host.close());
  const a = await connect(t, host), b = await connect(t, host);
  const memories = [];
  for (let i = 0; i < 4; i++) memories.push(ok(await call(b.client, 'remember_memory', {
    content: 'cobalt telescope SYNTHETIC_FORGET_SENTINEL_' + i, kind: 'fact' })).memory);
  const first = ok(await call(a.client, 'find_memory_candidates', { ...query, limit: 1 }));
  assert.ok(first.nextCursor);
  assert.equal((await call(b.client, 'find_memory_candidates', { ...query, limit: 1, cursor: first.nextCursor })).error.code, 'cursor_stale');
  const assembled = await context(a.client);
  assert.ok(assembled.snapshot);
  assert.equal((await call(b.client, 'fetch_memory_candidate_evidence', { snapshot: assembled.snapshot })).error.code, 'snapshot_stale');
  assert.equal((await call(a.client, 'find_memory_candidates', { ...query, limit: 1, cursor: assembled.snapshot })).error.code, 'cursor_stale');
  ok(await call(a.client, 'fetch_memory_candidate_evidence', { snapshot: assembled.snapshot }));
  // Alternating connections retain the same policy generation and projection.
  for (let i = 0; i < 4; i++) await context(i % 2 ? a.client : b.client);
  ok(await call(a.client, 'fetch_memory_candidate_evidence', { snapshot: assembled.snapshot }));
  for (let i = 0; i < 130; i++) ok(await call(b.client, 'find_memory_candidates', { ...query, limit: 1 }));
  const retained = await call(a.client, 'find_memory_candidates', { ...query, limit: 1, cursor: first.nextCursor });
  assert.equal(retained.ok, true, 'A ranking partition must survive B churn');
  const delivered = first.items[0].ref.memoryId;
  const victim = memories.find(memory => memory.id !== delivered);
  ok(await call(b.client, 'forget_memory', { memoryId: victim.id, expectedRevision: victim.revision }));
  const next = await call(a.client, 'find_memory_candidates', { ...query, limit: 1, cursor: first.nextCursor });
  // The canonical generation may invalidate the entire retained ranking.
  const read = await context(a.client);
  assert.ok(!JSON.stringify(read.value).includes(victim.content), 'SYNTHETIC_FORGET_SENTINEL must not be deliverable after forget');
  assert.ok(!JSON.stringify(read.value).includes(victim.id));
  assert.ok(!next.ok && next.error.code === 'cursor_stale' || next.ok && !JSON.stringify(next).includes(victim.id));
  assert.equal((await call(a.client, 'fetch_memory_candidate_evidence', { snapshot: assembled.snapshot })).error.code, 'snapshot_stale');
  await a.handle.close();
  ok(await call(b.client, 'remember_memory', { content: 'synthetic surviving B write', kind: 'fact' }));
  assert.equal(host.inspect().connections, 1); assert.equal(host.inspect().runtime.cores, 1);
});

test('B forgets and reads/writes while A awaits a provider; A disconnect does not close B', { timeout: 15000 }, async t => {
  const entered = deferred(), release = deferred(), returned = deferred();
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic.sqlite'), namespace: ns,
    raw: false, contextCounter: counter, model: { contextWindow: 8192, countTokens: () => 1,
      async select() { entered.resolve(); await release.promise; returned.resolve(); return { refs: [] }; }, rank() { return { refs: [] }; } } });
  t.after(() => release.resolve()); w.defer(() => host.close());
  const a = await connect(t, host), b = await connect(t, host);
  const memory = ok(await call(b.client, 'remember_memory', { content: 'cobalt telescope SYNTHETIC_PENDING_SENTINEL', kind: 'fact' })).memory;
  const pending = call(a.client, 'recall_memory', { query: 'cobalt telescope' }).catch(() => null);
  await Promise.race([entered.promise, pending.then(() => { throw Error('provider_not_entered'); })]);
  assert.equal(host.inspect().inFlight, 1);
  ok(await call(b.client, 'forget_memory', { memoryId: memory.id, expectedRevision: memory.revision }));
  const bRead = context(b.client);
  const bWrite = call(b.client, 'remember_memory', { content: 'synthetic in-flight B write', kind: 'fact' });
  await a.handle.close();
  const read = await bRead;
  ok(await bWrite);
  assert.ok(!JSON.stringify(read.value).includes('SYNTHETIC_PENDING_SENTINEL'));
  ok(await call(b.client, 'remember_memory', { content: 'synthetic concurrent B write', kind: 'fact' }));
  release.resolve(); await pending;
  await returned.promise; await nextTurn();
  assert.equal(host.inspect().inFlight, 0);
  assert.equal(host.inspect().runtime.cores, 1);
});

test('canonical pause gates capture on every connected SDK server; pause has no public MCP tool', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'synthetic-pause.sqlite');
  const host = createLocalSharedRuntime({ path, namespace: ns, contextCounter: counter,
    model: rationaleModel(), captureQualification: 'source-bound-v2' });
  w.defer(() => host.close());
  const a = await connect(t, host), b = await connect(t, host);
  const control = openMemoryCore({ path, raw: true }); w.defer(() => control.close());
  const generation = ok(control.getCaptureControl({ namespace: ns })).generation;
  const paused = ok(control.setCapturePaused({ namespace: ns, expectedGeneration: generation, paused: true }));
  for (const [index, connection] of [a, b].entries()) {
    const result = await call(connection.client, 'capture_memory', { batchId: 'synthetic-paused-' + index,
      messages: [{ role: 'user', content: 'Synthetic paused cobalt telescope' }] });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'capture_disabled');
  }
  ok(control.setCapturePaused({ namespace: ns, expectedGeneration: paused.generation, paused: false }));
  ok(await call(b.client, 'capture_memory', { batchId: 'synthetic-resumed',
    messages: [{ role: 'user', content: 'Synthetic resumed cobalt telescope' }] }));
});

test('SDK discover probe then legacy initialize builds two servers without disposing the connection runtime', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic-probe.sqlite'), namespace: ns, raw: false, contextCounter: counter });
  w.defer(() => host.close());
  const [a, b] = streams(), handle = host.attach(a, a);
  const transport = new StdioServerTransport(b, b), discovered = deferred();
  t.after(async () => { await handle.close(); a.destroy(); b.destroy(); });
  transport.onmessage = message => discovered.resolve(message);
  await transport.start();
  await transport.send({ jsonrpc: '2.0', id: 'synthetic-probe', method: 'server/discover', params: { _meta: {
    [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {},
  } } });
  assert.ok((await discovered.promise).result);
  assert.equal(host.inspect().sdkServers, 1);
  transport.start = async () => {};
  const client = new Client({ name: 'synthetic-probe-client', version: '1' });
  t.after(() => client.close());
  await assert.doesNotReject(async () => {
    await client.connect(transport, { prior: { kind: 'legacy' } });
    assert.equal(host.inspect().sdkServers, 1, 'discarded probe server is gone');
    assert.equal(host.inspect().connections, 1); assert.equal(host.inspect().runtime.cores, 1);
    ok(await call(client, 'remember_memory', { content: 'synthetic post-probe write', kind: 'fact' }));
  }, 'discarding an SDK probe must preserve the shared runtime for the replacement server');
  await handle.close(); await handle.close();
  assert.equal(host.inspect().sdkServers, 0); assert.equal(host.inspect().runtime.cores, 1);
});
