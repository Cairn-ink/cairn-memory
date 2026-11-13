import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../server.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { ns, streams, call, ok, holdWriteLock } from './local-shared-support.mjs';

for (const holdMs of [3000, 7000]) test(`ordinary createCairnServer retains its synchronous 5000ms busy behavior under a ${holdMs}ms lock`,
  { timeout: 20000 }, async t => {
    const w = createTestWorkspace(t), path = join(w.path, 'synthetic-single-busy.sqlite');
    // No context/Raw scheduling: only the ordinary canonical writer is timed.
    const server = createCairnServer({ path, namespace: ns, raw: false, contextRead: false });
    w.defer(() => server.close());
    const [a, b] = streams(), client = new Client({ name: 'synthetic-single-busy', version: '1' });
    t.after(async () => { await client.close(); a.destroy(); b.destroy(); });
    await server.connect(new StdioServerTransport(a, a));
    await client.connect(new StdioServerTransport(b, b), { prior: { kind: 'legacy' } });
    ok(await call(client, 'remember_memory', { content: 'Synthetic single-connection seed', kind: 'fact' }));
    const { exited } = await holdWriteLock(t, path, holdMs);
    const start = performance.now();
    let heartbeatTimer;
    t.after(() => clearTimeout(heartbeatTimer));
    const heartbeat = new Promise(resolve => { heartbeatTimer = setTimeout(() => resolve(performance.now() - start), 100); });
    const result = await call(client, 'remember_memory', { content: 'Synthetic single-connection locked write', kind: 'fact' });
    const elapsedMs = performance.now() - start, heartbeatMs = await heartbeat;
    const [code, signal] = await exited;
    assert.equal(code, 0, 'parity lock child exits successfully');
    assert.equal(signal, null, 'parity lock child is not terminated on the positive path');
    if (holdMs < 5000) {
      assert.equal(result.ok, true, 'ordinary server still waits and succeeds when a 3s lock clears before 5s');
      assert.ok(elapsedMs >= 2500 && elapsedMs <= 5256, 'ordinary successful busy wait retains the original timing envelope');
      assert.ok(heartbeatMs >= 2500, 'shared-only async retry must not leak into ordinary server event-loop behavior');
    } else {
      assert.equal(result.ok, false, 'ordinary server refuses a lock held beyond its native 5s timeout');
      assert.equal(result.error.code, 'storage_busy', 'ordinary server preserves the named busy mapping');
      assert.equal(result.error.retryable, true, 'ordinary busy remains retryable');
      assert.ok(elapsedMs >= 4744 && elapsedMs <= 5500, 'ordinary server retains its native 5000ms busy timeout');
      assert.ok(heartbeatMs >= 4500, 'ordinary server retains synchronous native waiting without adapter back-off');
    }
    ok(await call(client, 'remember_memory', { content: 'Synthetic single-connection recovered write', kind: 'fact' }));
    assert.equal((await call(client, 'inspect_memory', {})).ok, true, 'ordinary connection remains usable after busy cleanup');
  });
