import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('default imports and existing-store open consume no entropy or product state', t => {
  const workspace = createTestWorkspace(t, { prefix: 'context-default-entropy-' });
  // A fresh process observes module evaluation before any core import caches it.
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import crypto from 'node:crypto';
    import workerThreads from 'node:worker_threads';
    import { syncBuiltinESMExports } from 'node:module';
    const calls = { uuid: 0, bytes: [] };
    crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++calls.uuid).padStart(12, '0');
    crypto.randomBytes = size => { calls.bytes.push(size); return Buffer.alloc(size, 7); };
    workerThreads.Worker = class { constructor() { assert.fail('default path started a Worker'); } };
    syncBuiltinESMExports();
    const domainKey = Symbol.for('context-read-product-v1.1/clock-domain');
    const supervisionKey = Symbol.for('context-read-product-v1.1/supervision');
    function untouched() {
      assert.equal(Object.hasOwn(globalThis, domainKey), false);
      assert.equal(Object.hasOwn(globalThis, supervisionKey), false);
    }
    const api = await import(${JSON.stringify(new URL('../index.mjs', import.meta.url).href)});
    await import(${JSON.stringify(new URL('../../adapters/mcp/server.mjs', import.meta.url).href)});
    await import(${JSON.stringify(new URL('../../adapters/mcp/cli.mjs', import.meta.url).href)});
    assert.deepEqual(calls, { uuid: 0, bytes: [] }); untouched();
    // New-store identity, cursor secret and episode secret are legacy entropy.
    const fresh = api.openMemoryCore({ path: process.argv[1] });
    try { assert.deepEqual(calls, { uuid: 1, bytes: [32, 32] }); untouched(); }
    finally { fresh.close(); }
    calls.uuid = 0; calls.bytes.length = 0;
    const existing = api.openMemoryCore({ path: process.argv[1] });
    try { assert.deepEqual(calls, { uuid: 0, bytes: [] }); untouched(); }
    finally { existing.close(); }
    // Product opt-in initializes one shared domain and the supervisor registry.
    const { requestRecord } = await import(${JSON.stringify(new URL('../context-product-control.mjs', import.meta.url).href)});
    const control = { requestId: 'request', handleId: 'handle', credentialBindingId: 'binding',
      credentialExpiresUtcMs: null, requestMaxMs: 1000 };
    const first = requestRecord(control, 0n, 0), second = requestRecord(control, 0n, 0);
    assert.equal(first.clockDomainId, second.clockDomainId);
    assert.deepEqual(calls, { uuid: 1, bytes: [] });
    assert.equal(Object.hasOwn(globalThis, supervisionKey), false);
    const supervisor = api.createContextReadSupervisor();
    assert.equal(Object.hasOwn(globalThis, supervisionKey), true);
    await supervisor.close();
  `, join(workspace.path, 'canonical.sqlite')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});
