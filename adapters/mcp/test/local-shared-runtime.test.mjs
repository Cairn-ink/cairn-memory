import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { PassThrough } from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/core/internal';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
const createLocalSharedRuntime = options => createSharedRuntime(options, { strict: true });
import { createCairnServer } from '../server.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { defaultRawOptions } from '../../../core/local-defaults.mjs';
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
  assert.throws(() => host.attach(), /local_host_closed/);
});

test('eight connections contain stream errors during attach, abort, ended peer, double close and host close', { timeout: 15000 }, async t => {
  const asynchronousErrors = [], record = error => asynchronousErrors.push(error);
  process.on('uncaughtExceptionMonitor', record);
  process.on('unhandledRejection', record);
  t.after(() => {
    process.off('uncaughtExceptionMonitor', record);
    process.off('unhandledRejection', record);
  });
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'synthetic-teardown.sqlite'),
    namespace: ns, raw: false, contextCounter: counter });
  w.defer(() => host.close());
  const attached = [];
  for (let i = 0; i < 8; i++) attached.push(await connect(t, host));
  assert.equal(host.inspect().connections, 8);
  const abort = () => Object.assign(Error('synthetic peer abort'), { name: 'AbortError', code: 'ABORT_ERR' });
  attached[0].stream.destroy(abort());
  attached[1].stream.end();
  await Promise.all([attached[2].handle.close(), attached[2].handle.close()]);
  await nextTurn(); await nextTurn();
  assert.equal(attached[0].handle.inspect().closed, true);
  assert.equal(attached[1].handle.inspect().closed, true);
  assert.equal(host.inspect().connections, 5);
  ok(await call(attached[7].client, 'remember_memory', { content: 'Synthetic surviving teardown write', kind: 'fact' }));
  await Promise.all([host.close(), host.close(), attached[3].handle.close()]);
  for (const connection of attached) {
    await connection.client.close();
    await connection.handle.close();
    connection.stream.destroy(abort());
  }
  await nextTurn(); await nextTurn();
  assert.equal(host.inspect().connections, 0);
  assert.equal(host.inspect().runtime.state, 'closed');
  // No handshake yet, and separate input/output endpoints: the SDK's retained
  // stdout error handler cannot accidentally protect the input under test.
  const openingHost = createLocalSharedRuntime({ path: join(w.path, 'synthetic-opening-teardown.sqlite'),
    namespace: ns, raw: false, contextCounter: counter });
  w.defer(() => openingHost.close());
  const opening = [];
  for (let i = 0; i < 8; i++) {
    const endpoint = () => new PassThrough({ destroy(error, done) { setImmediate(() => done(error ?? abort())); } });
    const input = endpoint(), output = endpoint();
    opening.push(openingHost.attach(input, output));
  }
  assert.equal(openingHost.inspect().connections, 8);
  await Promise.all(opening.map(connection => connection.close()));
  await openingHost.close();
  await nextTurn(); await nextTurn();
  assert.equal(openingHost.inspect().connections, 0);
  assert.deepEqual(asynchronousErrors, [], 'no connection may emit an uncaught exception or unhandled rejection');
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
  // B's write must not invalidate B's own in-progress sidecar generation.
  // Both operations still complete while A is awaiting its provider.
  const read = await context(b.client);
  const bWrite = call(b.client, 'remember_memory', { content: 'synthetic in-flight B write', kind: 'fact' });
  await a.handle.close();
  ok(await bWrite);
  assert.ok(!JSON.stringify(read.value).includes('SYNTHETIC_PENDING_SENTINEL'));
  ok(await call(b.client, 'remember_memory', { content: 'synthetic concurrent B write', kind: 'fact' }));
  release.resolve(); await pending;
  await returned.promise; await nextTurn();
  assert.equal(host.inspect().inFlight, 0);
  assert.equal(host.inspect().runtime.cores, 1);
});

test('canonical pause fences Raw on all eight connections and preserves main explicit-capture semantics', { timeout: 30000 }, async t => {
  const w = createTestWorkspace(t), rawPath = join(w.path, 'synthetic-pause-raw.sqlite');
  const options = { namespace: ns, contextCounter: counter, rawSearch: false,
    model: rationaleModel(), captureQualification: 'source-bound-v2', sessionEpisodesAccess: 'episode-v1' };
  let extractions = 0;
  const rawHost = createLocalSharedRuntime({ ...options, path: rawPath, client: 'codex',
    model: rationaleModel(method => { if (method === 'extract') extractions++; }) });
  w.defer(() => rawHost.close());
  const rawConnections = [];
  for (let i = 0; i < 8; i++) rawConnections.push(await connect(t, rawHost));
  const control = openMemoryCore({ path: rawPath, raw: true, rawSearch: false }); w.defer(() => control.close());
  const capture = (batchId, content) => ({ batchId, messages: [{ role: 'user', content }] });
  const setPaused = (core, paused) => ok(core.setCapturePaused({ namespace: ns,
    expectedGeneration: ok(core.getCaptureControl({ namespace: ns })).generation, paused }));
  // Populate any accidental per-connection cache before changing durable state.
  for (const [index, connection] of rawConnections.entries()) {
    const catalogue = (await connection.client.listTools()).tools.map(tool => tool.name);
    assert.equal(catalogue.some(name => /pause|resume/.test(name)), false, `pause has no public MCP control on connection ${index}`);
    assert.equal(catalogue.some(name => /capture.*episode|end.*episode/.test(name)), false,
      `connection ${index} exposes episode access but no automatic episode producer`);
    assert.equal((await call(connection.client, 'capture_memory', capture('synthetic-warm-' + index,
      'Synthetic warm cobalt telescope ' + index))).ok, true, `Raw warm-up succeeds on connection ${index}`);
  }
  setPaused(control, true);
  const beforePaused = extractions;
  for (const [index, connection] of rawConnections.entries()) {
    const result = await call(connection.client, 'capture_memory', capture('synthetic-paused-' + index,
      'SYNTHETIC_PAUSED_RAW_SENTINEL_' + index));
    assert.equal(result.ok, false, `Raw pause must refuse connection ${index} on its very next call`);
    assert.equal(result.error.code, 'capture_disabled', `Raw pause returns capture_disabled on connection ${index}`);
    assert.equal(extractions, beforePaused, `Raw pause prevents extraction on connection ${index}`);
  }
  setPaused(control, false);
  for (const [index, connection] of rawConnections.entries()) {
    const result = await call(connection.client, 'capture_memory', capture('synthetic-resumed-' + index,
      'Synthetic resumed cobalt telescope ' + index));
    assert.equal(result.ok, true, `Raw resume admits connection ${index} on its very next call`);
  }
  const conversations = ok(control.listRawConversations({ namespace: ns, client: 'codex', limit: 50 }));
  assert.equal(conversations.conversations.length, 1, 'all Raw connections share one configured capture session');
  // raw:true intentionally hides text readers. Select the existing explicit
  // journal reader profile, using the same local plaintext port as the writer.
  const rawReader = openMemoryCore({ path: rawPath, rawSearch: false, rawConversations: defaultRawOptions() });
  w.defer(() => rawReader.close());
  const retained = ok(await rawReader.getConversation({ namespace: ns,
    conversationId: conversations.conversations[0].id, limit: 50 }));
  assert.equal(retained.messages.length, 16, 'only eight warm and eight resumed Raw messages are retained');
  assert.equal(JSON.stringify(retained).includes('SYNTHETIC_PAUSED_RAW_SENTINEL_'), false,
    'no Raw message submitted while paused may appear after resume');
  const memories = ok(control.list({ namespace: ns, limit: 50 }));
  assert.equal(memories.exhausted, true, 'paused Memory absence must inspect the entire namespace');
  const inspected = memories.memories.map(memory => ok(control.get({ namespace: ns, memoryId: memory.id })));
  assert.equal(JSON.stringify(inspected).includes('SYNTHETIC_PAUSED_RAW_SENTINEL_'), false,
    'no inferred Memory from refused paused Raw may appear after resume');

  // Client identity is runtime configuration. Use a second eight-connection
  // cohort for the default Memory-only explicit path, and an isolated ordinary
  // server with the same operations as the main-semantics oracle.
  const explicitPath = join(w.path, 'synthetic-pause-explicit.sqlite');
  const singlePath = join(w.path, 'synthetic-pause-single.sqlite');
  const explicitHost = createLocalSharedRuntime({ ...options, path: explicitPath });
  const single = createCairnServer({ ...options, path: singlePath });
  w.defer(() => explicitHost.close()); w.defer(() => single.close());
  const explicitConnections = [];
  for (let i = 0; i < 8; i++) explicitConnections.push(await connect(t, explicitHost));
  const [a, b] = streams(), direct = new Client({ name: 'synthetic-pause-oracle', version: '1' });
  t.after(async () => { await direct.close(); a.destroy(); b.destroy(); });
  await single.connect(new StdioServerTransport(a, a));
  await direct.connect(new StdioServerTransport(b, b), { prior: { kind: 'legacy' } });
  const explicitControl = openMemoryCore({ path: explicitPath, raw: true, rawSearch: false });
  const singleControl = openMemoryCore({ path: singlePath, raw: true, rawSearch: false });
  w.defer(() => explicitControl.close()); w.defer(() => singleControl.close());
  setPaused(explicitControl, true); setPaused(singleControl, true);
  // Independent stores allocate independent Memory keys. Preserve every field
  // and all cross-references, renaming only the admitted keys bijectively.
  const comparable = result => {
    const names = new Map(result.value.admission.memories.map((memory, index) => [memory.id, `admitted-${index}`]));
    const rename = value => typeof value === 'string' ? names.get(value) ?? value : Array.isArray(value)
      ? value.map(rename) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rename(item)])) : value;
    return rename(result);
  };
  for (const [index, connection] of explicitConnections.entries()) {
    const input = capture('synthetic-explicit-paused-' + index, 'Synthetic explicit capture while paused ' + index);
    const actual = await call(connection.client, 'capture_memory', input), expected = await call(direct, 'capture_memory', input);
    assert.equal(expected.ok, true, `main oracle explicit capture proceeds while paused for connection ${index}`);
    assert.equal(actual.ok, true, `shared explicit capture proceeds while paused for connection ${index}`);
    assert.equal(actual.value.admission.memories.length, 1, `explicit capture admits a nonempty Memory on connection ${index}`);
    assert.deepEqual(comparable(actual), comparable(expected), `explicit paused capture matches main field by field on connection ${index}`);
  }
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
