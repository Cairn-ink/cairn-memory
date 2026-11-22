import test from 'node:test';
import assert from 'node:assert/strict';
import { workspace, until, ok } from './local-daemon-support.mjs';
import { startAwareAlive } from '../local-daemon-liveness.mjs';
import { join } from 'node:path';

test('dead-owner election replaces socket between attached A descriptor and inode reads', { timeout: 20000 }, async t => {
  const w = await workspace(t);
  const a = w.child({ args: w.args, endpointReadRace: true, options: { root: join(w.root, 'run'), environment: {} } });
  a.release(); const old = await w.connect(a);
  const content = 'synthetic cobalt telescope replacement sentinel';
  const memory = ok(await a.tool('remember_memory', { content, kind: 'fact' })).memory;
  assert.ok(startAwareAlive(old.owner)); process.kill(old.owner.pid, 'SIGKILL');
  await until(() => a.messages.some(m => m.kind === 'endpoint-between-reads'), 'A reads old descriptor before socket check');
  const b = w.forward(); b.release(); const replacement = await w.connect(b);
  assert.notEqual(replacement.incarnation, old.incarnation);
  a.process.send({ kind: 'release-endpoint-read' });
  const reconnected = await until(() => a.messages.filter(m => m.kind === 'connected')[1], 'A authenticates ordinary replacement within original budget');
  assert.equal(reconnected.incarnation, replacement.incarnation);
  const stored = ok(await a.tool('inspect_memory', { memoryId: memory.id })).memory;
  assert.equal(stored.content, content);
  assert.equal(a.messages.filter(m => m.kind === 'forwarder-done').length, 0);
});

test('dead owner with a tool in flight still closes with daemon_outcome_unknown', { timeout: 15000 }, async t => {
  const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), providerBarrier: true });
  candidate.release(); await until(w.descriptor, 'candidate publishes');
  const a = w.forward(); a.release(); const old = await w.connect(a);
  ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope unknown outcome', kind: 'fact' }));
  const pending = a.tool('recall_memory', { query: 'synthetic cobalt telescope' });
  await until(() => candidate.messages.some(m => m.kind === 'provider-entered'), 'tool is in flight');
  assert.ok(startAwareAlive(old.owner)); process.kill(old.owner.pid, 'SIGKILL');
  assert.equal((await pending).error.message, 'daemon_transport');
  const done = await until(() => a.messages.find(m => m.kind === 'forwarder-done'), 'in-flight session closes');
  assert.equal(done.code, 'daemon_outcome_unknown');
  assert.equal(a.messages.filter(m => m.kind === 'connected').length, 1);
  const b = w.forward(); b.release(); assert.notEqual((await w.connect(b)).incarnation, old.incarnation);
  ok(await b.tool('remember_memory', { content: 'synthetic new daemon usable', kind: 'fact' }));
});
