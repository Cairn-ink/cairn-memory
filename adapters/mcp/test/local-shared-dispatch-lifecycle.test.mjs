import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { createLocalSharedRuntime as createSharedRuntime } from '../local-shared-runtime.mjs';
const createLocalSharedRuntime = options => createSharedRuntime(options, { strict: true });
import { createLocalCairnRuntime } from '../server.mjs';
import { call, connect, deferred, holdWriteLock, ns, ok, streams } from './local-shared-support.mjs';

async function drained(host) {
  const end = performance.now() + 1000;
  while (host.inspect().inFlight && performance.now() < end) await delay(5);
  assert.equal(host.inspect().inFlight, 0, 'R2G_CANCEL_BACKOFF_IMMEDIATE');
}
for (const reason of ['disconnect', 'host-close']) test(`shared SDK ${reason} stops commit backoff`, { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'lifecycle.sqlite');
  const host = createLocalSharedRuntime({ path, namespace: ns, raw: false, contextRead: false });
  w.defer(() => host.close());
  const { client, handle } = await connect(t, host);
  const observer = await connect(t, host);
  const lock = await holdWriteLock(t, path, 1500);
  const pending = call(client, 'remember_memory', { content: `Synthetic cancelled ${reason}`, kind: 'fact' })
    .then(value => ({ value }), error => ({ error }));
  // A native blocking attempt would prevent this heartbeat until lock release.
  await delay(60);
  assert.equal(host.inspect().inFlight, 1, 'request must be backing off before cancellation');
  const start = performance.now();
  const closed = reason === 'disconnect' ? handle.close() : host.close();
  await drained(host);
  assert.ok(performance.now() - start < 1000, 'R2G_CANCEL_BACKOFF_IMMEDIATE');
  await closed; await pending;
  assert.deepEqual(await lock.exited, [0, null]);
  if (reason === 'disconnect') {
    assert.equal(ok(await call(observer.client, 'inspect_memory', {})).memories.length, 0, 'R2G_NOTHING_AFTER_REVOCATION');
  } else {
    const reopened = createLocalSharedRuntime({ path, namespace: ns, raw: false, contextRead: false });
    w.defer(() => reopened.close());
    const connection = await connect(t, reopened);
    assert.equal(ok(await call(connection.client, 'inspect_memory', {})).memories.length, 0, 'R2G_NOTHING_AFTER_REVOCATION');
  }
});

test('SDK server revocation wakes backoff before disconnect and retains the existing refusal', { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'revocation.sqlite');
  const backoff = deferred(), settled = deferred(); let response;
  const dispatcher = createCommitDispatcher({ strict: true, onBackoff: () => backoff.resolve() });
  const runtime = dispatcher.open(() => createLocalCairnRuntime({ path, namespace: ns, raw: false, contextRead: false }, { dispatcher }));
  w.defer(() => runtime.close());
  const server = runtime.server({ lifecycle: { async run(work) {
    try { response = await work(); return response; } finally { settled.resolve(); }
  } } });
  w.defer(() => server.close());
  const [a, b] = streams(), client = new Client({ name: 'synthetic-revocation', version: '1' });
  t.after(async () => { await client.close(); a.destroy(); b.destroy(); });
  await server.connect(new StdioServerTransport(a, a));
  await client.connect(new StdioServerTransport(b, b), { prior: { kind: 'legacy' } });
  const lock = await holdWriteLock(t, path, 1500);
  const pending = call(client, 'remember_memory', { content: 'Synthetic revoked action', kind: 'fact' }).catch(() => null);
  await backoff.promise;
  const start = performance.now(), closed = server.close();
  await settled.promise;
  assert.ok(performance.now() - start < 500, 'R2G_CANCEL_BACKOFF_IMMEDIATE');
  assert.equal(JSON.parse(response.content[0].text).error.code, 'authority_required', 'R2G_REVOCATION_REFUSAL');
  await closed;
  // SDK server transport close stops sends but does not end this synthetic
  // peer's streams. The engine refusal above is already observed; retire the
  // client so its pending RPC cannot wait for the SDK's default timeout.
  await client.close(); await pending; assert.deepEqual(await lock.exited, [0, null]);
  const observer = runtime.server(); w.defer(() => observer.close());
  const [c, d] = streams(), reader = new Client({ name: 'synthetic-observer', version: '1' });
  t.after(async () => { await reader.close(); c.destroy(); d.destroy(); });
  await observer.connect(new StdioServerTransport(c, c));
  await reader.connect(new StdioServerTransport(d, d), { prior: { kind: 'legacy' } });
  assert.equal(ok(await call(reader, 'inspect_memory', {})).memories.length, 0, 'R2G_NOTHING_AFTER_REVOCATION');
});
