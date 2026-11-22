import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { workspace, until } from './local-daemon-support.mjs';
import { runtimeDirectory, endpointPaths } from '../local-daemon-state.mjs';
import { canonical } from '../local-daemon-identity.mjs';
import { authenticateClient } from '../local-daemon-wire.mjs';
import { verifiedOwner } from '../local-daemon-liveness.mjs';

test('SIGCONT with a prequeued connection after TERM never authenticates or serves it', { timeout: 15000 }, async t => {
  const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), observeConnections: true });
  candidate.release(); const descriptor = await until(w.descriptor, 'candidate publishes');
  assert.ok(verifiedOwner(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGSTOP');
  const directory = await runtimeDirectory({ root: w.root + '/run' });
  const paths = endpointPaths(directory, createHash('sha256').update(canonical(descriptor.identity)).digest('hex'));
  const socket = createConnection(paths.socket); socket.on('error', () => {}); t.after(() => socket.destroy());
  await once(socket, 'connect'); // Kernel connect completes while listener is stopped.
  const pending = authenticateClient(socket, descriptor, descriptor.identity, performance.now() + 3000);
  const refused = assert.rejects(pending); // Own rejection before delivering TERM.
  assert.ok(verifiedOwner(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGTERM');
  assert.ok(verifiedOwner(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGCONT');
  await refused; await until(() => candidate.exit, 'resumed daemon drains');
  assert.deepEqual(candidate.exit, { pid: candidate.process.pid, code: 0, signal: null });
  assert.equal(await w.descriptor(), undefined);
  const next = w.forward(); next.release(); assert.notEqual((await w.connect(next)).incarnation, descriptor.incarnation);
});

test('held multiprocess assertion detects actual stored sentinel, unlike identity-only admission', () => {
  const admitted = { id: 'synthetic-id', revision: 1 };
  const stored = { ...admitted, content: 'SYNTHETIC_WRONG_SENTINEL' };
  const incorrectlyVisible = { ok: true, value: { text: stored.content } };
  const text = JSON.stringify(incorrectlyVisible);
  assert.ok(!text.includes(admitted.id) && !text.includes(admitted.content), 'old assertion passes although actual stored content is present');
  assert.throws(() => assert.ok(!text.includes(stored.id) && !text.includes(stored.content)), assert.AssertionError, 'stored-content assertion must fail on the same wrong read');
});
