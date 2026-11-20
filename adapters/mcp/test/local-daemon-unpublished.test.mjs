import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { workspace, until, ok } from './local-daemon-support.mjs';
import { runDaemonCommand, verifiedOwner } from '../local-daemon-liveness.mjs';

for (const mode of ['exit', 'SIGKILL', 'pre-chmod SIGKILL']) test('unpublished bound socket recovers after ' + mode, { timeout: 18000 }, async t => {
  const w = await workspace(t), root = join(w.root, 'run');
  const candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), unpublishedSocket: mode === 'exit' ? 'exit' : mode === 'SIGKILL' ? 'pause' : 'before-chmod' });
  candidate.release(); await until(() => candidate.messages.some(m => m.kind === 'socket-bound-unpublished'), 'candidate binds before descriptor publication');
  assert.equal(await w.descriptor(), undefined);
  if (mode !== 'exit') {
    let output = ''; await runDaemonCommand(['status'], { root, write: text => { output += text; } });
    assert.deepEqual(JSON.parse(output).daemons, [{ code: 'endpoint_uncertain', auto_removable: false }]);
    const name = (await readdir(join(root, 'cairn-memory'))).find(n => /^d-.*\.lock$/.test(n));
    const owner = JSON.parse(await readFile(join(root, 'cairn-memory', name), 'utf8'));
    assert.equal(owner.pid, candidate.process.pid); assert.ok(verifiedOwner(owner));
    process.kill(owner.pid, 'SIGKILL');
  }
  await until(() => candidate.exit, 'unpublished candidate actual exit');
  assert.equal(candidate.exit.code, mode === 'exit' ? 17 : null);
  assert.equal(candidate.exit.signal, mode === 'exit' ? null : 'SIGKILL');
  const socketName = (await readdir(join(root, 'cairn-memory'))).find(n => n.endsWith('.sock'));
  assert.equal((await lstat(join(root, 'cairn-memory', socketName))).mode & 0o777, 0o600, 'bind establishes safe socket mode before chmod/publication');
  const lockName = (await readdir(join(root, 'cairn-memory'))).find(n => /^d-.*\.lock$/.test(n));
  const recorded = JSON.parse(await readFile(join(root, 'cairn-memory', lockName), 'utf8'));
  const physical = (await w.bootstrap()).identity.store;
  assert.deepEqual(recorded.store, { dev: physical.dev, ino: physical.ino }, 'filtered orphan discovery matches the full physical identity');
  for (const args of [['status'], ['status', '--db', w.path]]) {
    let output = ''; await runDaemonCommand(args, { root, write: text => { output += text; } });
    assert.deepEqual(JSON.parse(output).daemons, [{ code: 'endpoint_uncertain', auto_removable: true }]);
    assert.ok(!output.includes(w.root));
  }
  const a = w.forward([], { connectMs: 1500 }); a.release();
  const next = await w.connect(a); assert.notEqual(next.owner.pid, candidate.process.pid);
  ok(await a.tool('remember_memory', { content: 'synthetic after unpublished socket', kind: 'fact' }));
});
