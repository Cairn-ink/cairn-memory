import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('default MCP server and CLI imports consume no entropy or product state', () => {
  // Install observers in a fresh process before any adapter or core import.
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
    for (const entry of ${JSON.stringify(['../server.mjs', '../cli.mjs'].map(path => new URL(path, import.meta.url).href))}) {
      await import(entry);
      assert.deepEqual(calls, { uuid: 0, bytes: [] });
      assert.equal(Object.hasOwn(globalThis, domainKey), false);
      assert.equal(Object.hasOwn(globalThis, supervisionKey), false);
    }
  `], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});
