import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until } from './local-daemon-support.mjs';

test('activation import failure drains the daemon, removes its endpoint, and permits a fresh session', { timeout: 30000 }, async t => {
  const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), activationImportFailure: true });
  candidate.release();
  const failed = await until(w.descriptor, 'failing daemon publishes before activation');
  // Probe only that exact endpoint: do not let the probe elect a replacement.
  const { createConnection } = await import('node:net');
  const { once } = await import('node:events');
  const { endpointPaths, runtimeDirectory } = await import('../local-daemon-state.mjs');
  const { createHash } = await import('node:crypto');
  const { canonical } = await import('../local-daemon-identity.mjs');
  const { authenticateClient } = await import('../local-daemon-wire.mjs');
  const directory = await runtimeDirectory({ root: w.root + '/run' });
  const digest = createHash('sha256').update(canonical(failed.identity)).digest('hex');
  const socket = createConnection(endpointPaths(directory, digest).socket); socket.on('error', () => {});
  try {
    await once(socket, 'connect');
    await assert.rejects(authenticateClient(socket, failed, failed.identity, performance.now() + 3000));
  } finally { socket.destroy(); }
  await until(() => candidate.exit, 'failed import must exit rather than retain a poisoned endpoint', 4000);
  assert.deepEqual(candidate.exit, { pid: candidate.process.pid, code: 0, signal: null });
  assert.equal(await w.descriptor(), undefined, 'failed incarnation endpoint removed');
  const next = w.forward(); next.release(); const fresh = await w.connect(next);
  assert.notEqual(fresh.incarnation, failed.incarnation);
  assert.notEqual(fresh.owner.pid, failed.owner.pid);
  assert.ok((await next.request('tools/list')).result.tools.length > 0);
});
