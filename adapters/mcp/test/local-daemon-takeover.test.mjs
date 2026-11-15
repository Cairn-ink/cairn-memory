import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { workspace, until, ok } from './local-daemon-support.mjs';
import { runtimeDirectory, endpointPaths, writePrivate } from '../local-daemon-state.mjs';
import { startAwareAlive, takeOver, daemonMonotonicMs } from '../local-daemon-liveness.mjs';
import { createHash } from 'node:crypto';
import { canonical } from '../local-daemon-identity.mjs';

async function endpoint(w) {
  const descriptor = await w.descriptor(), directory = await runtimeDirectory({ root: join(w.root, 'run') });
  const digest = createHash('sha256').update(canonical(descriptor.identity)).digest('hex');
  return { descriptor, directory, paths: endpointPaths(directory, digest) };
}
async function stale(w) {
  const e = await endpoint(w), stamp = JSON.parse(await readFile(e.paths.stamp, 'utf8'));
  stamp.monotonicMs = daemonMonotonicMs() - 31000;
  await writePrivate(e.directory, e.paths.stamp, canonical(stamp));
  return e;
}
async function stopped(w) {
  const candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), observeConnections: true }); candidate.release();
  const descriptor = await until(w.descriptor, 'supervised owner publishes');
  assert.ok(startAwareAlive(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGSTOP');
  return { candidate, descriptor };
}

test('stamp has only exact code-only fields, refreshes, and is removed with endpoint', { timeout: 15000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
  const { paths, descriptor } = await endpoint(w);
  const stamp = await until(async () => {
    const value = JSON.parse(await readFile(paths.stamp, 'utf8')); return value.attachedSessions === 1 && value;
  }, 'stamp reflects authenticated sessions');
  assert.deepEqual(Object.keys(stamp).sort(), ['attachedSessions', 'build', 'codes', 'incarnation', 'monotonicMs', 'owner', 'version']);
  assert.deepEqual(stamp.owner, descriptor.owner); assert.equal(stamp.build, descriptor.identity.build);
  assert.ok(stamp.codes.length <= 8); assert.ok(stamp.codes.every(code => /^daemon_[a-z_]+$/.test(code)));
  assert.ok(!JSON.stringify(stamp).includes(w.root));
  await until(async () => JSON.parse(await readFile(paths.stamp, 'utf8')).monotonicMs > stamp.monotonicMs, 'stamp refreshes within five seconds plus scheduling margin', 6500);
  a.process.stdin.end(); await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'forwarder closes');
  assert.ok(startAwareAlive(descriptor.owner)); process.kill(descriptor.owner.pid, 'SIGTERM');
  await until(async () => !(await readdir(join(w.root, 'run', 'cairn-memory'))).some(n => /\.(stamp|json|sock)$/.test(n)), 'stamp and endpoint clean together');
});

test('fresh stopped stamp refuses before stdin within connect budget and never signals', { timeout: 15000 }, async t => {
  const w = await workspace(t), { descriptor } = await stopped(w);
  const b = w.child({ args: w.args, observeTakeover: true, options: { root: join(w.root, 'run'), environment: {}, connectMs: 750 } });
  b.release(); b.process.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  const begin = performance.now();
  const done = await until(() => b.messages.find(m => m.kind === 'forwarder-done'), 'fresh stopped owner refuses');
  assert.equal(done.code.refused, 'daemon_connect_timeout'); assert.equal(done.bytesRead, 0);
  assert.ok(performance.now() - begin < 1750); assert.ok(startAwareAlive(descriptor.owner));
  assert.equal(b.messages.filter(m => m.kind === 'takeover-signal').length, 0);
});

for (const resume of [false, true]) test('two stale-owner takeovers elect one fresh owner; resume after TERM=' + resume, { timeout: 25000 }, async t => {
  const w = await workspace(t), { descriptor: old, candidate } = await stopped(w); await stale(w);
  const clients = Array.from({ length: 2 }, () => w.child({ args: w.args, observeTakeover: true, options: { root: join(w.root, 'run'), environment: {} } }));
  for (const b of clients) b.release();
  await until(() => clients.flatMap(c => c.messages).some(m => m.kind === 'takeover-signal' && m.signal === 'SIGTERM'), 'takeover sends TERM before election');
  assert.equal((await w.descriptor()).incarnation, old.incarnation, 'lifetime lock excludes election while stopped owner lives');
  if (resume) { assert.ok(startAwareAlive(old.owner)); process.kill(old.owner.pid, 'SIGCONT'); }
  const connected = await Promise.all(clients.map(w.connect));
  assert.equal(new Set(connected.map(m => m.incarnation)).size, 1);
  assert.notEqual(connected[0].incarnation, old.incarnation); assert.equal(startAwareAlive(old.owner), false);
  const signals = clients.flatMap(c => c.messages).filter(m => m.kind === 'takeover-signal');
  assert.equal(signals.filter(m => m.signal === 'SIGTERM').length, 1);
  assert.equal(signals.filter(m => m.signal === 'SIGKILL').length, resume ? 0 : 1);
  assert.ok(signals.every(m => m.pid === old.owner.pid), 'no signal targets a fresh owner');
  await until(() => candidate.exit, 'old candidate exits');
  assert.equal(candidate.exit.signal, resume ? null : 'SIGKILL');
  if (resume) {
    assert.equal(candidate.exit.code, 0, 'resumed owner drains without admitting another connection');
    assert.equal(candidate.messages.filter(m => m.kind === 'connection-accepted').length, 0, 'resumed old incarnation accepts no connection');
  }
  ok(await clients[0].tool('remember_memory', { content: 'synthetic after takeover', kind: 'fact' }));
});

test('dead takeover lock owner is reclaimable by the next forwarder', { timeout: 25000 }, async t => {
  const w = await workspace(t), { descriptor: old } = await stopped(w); await stale(w);
  const b = w.child({ args: w.args, holdTakeoverLock: true, options: { root: join(w.root, 'run'), environment: {} } }); b.release();
  await until(() => b.messages.some(m => m.kind === 'takeover-locked'), 'forwarder owns separate takeover lock');
  b.process.kill('SIGKILL'); await until(() => b.exit, 'dead lock owner exit recorded');
  const c = w.forward(); c.release(); const next = await w.connect(c);
  assert.notEqual(next.incarnation, old.incarnation); assert.equal(startAwareAlive(old.owner), false);
});

test('takeover re-verification cannot signal an overlapping fresh election', { timeout: 20000 }, async t => {
  const w = await workspace(t), { descriptor: old, candidate } = await stopped(w); await stale(w);
  const b = w.child({ args: w.args, observeTakeover: true, holdTakeoverLock: true, options: { root: join(w.root, 'run'), environment: {} } }); b.release();
  await until(() => b.messages.some(m => m.kind === 'takeover-locked'), 'takeover records old incarnation before lock callback');
  assert.ok(startAwareAlive(old.owner)); process.kill(old.owner.pid, 'SIGKILL'); await until(() => candidate.exit, 'old lifetime owner dies');
  const replacement = w.child({ role: 'candidate', bootstrap: await w.bootstrap() }); replacement.release();
  const fresh = await until(async () => { const d = await w.descriptor(); return d?.incarnation !== old.incarnation && d; }, 'independent election publishes while takeover lock is held');
  b.process.send({ kind: 'release-takeover' });
  const connected = await w.connect(b); assert.equal(connected.incarnation, fresh.incarnation);
  assert.equal(b.messages.filter(m => m.kind === 'takeover-signal').length, 0);
  assert.ok(startAwareAlive(fresh.owner));
});

test('SIGKILL re-verifies the recorded owner and a young stamp cannot be taken over', async t => {
  const w = await workspace(t), { descriptor: old } = await stopped(w), e = await endpoint(w);
  const signals = []; let running = true;
  await takeOver(e.directory, e.paths, old, { alive: () => running, signal: (_, signal) => { signals.push(signal); if (signal === 'SIGKILL') running = false; }, graceMs: 0 });
  assert.deepEqual(signals, [], 'healthy stamp age must prevent even TERM');
  await stale(w);
  let verified = true;
  await takeOver(e.directory, e.paths, old, { alive: () => verified, signal: (_, signal) => signals.push(signal), graceMs: 0,
    afterTerm: async () => { verified = false; } });
  assert.deepEqual(signals, ['SIGTERM'], 'owner changed during grace must never receive KILL');
});

test('a busy healthy owner with a young stamp is never signalled', { timeout: 15000 }, async t => {
  const w = await workspace(t), candidate = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), providerBarrier: true }); candidate.release();
  await until(w.descriptor, 'healthy owner publishes');
  const a = w.forward(); a.release(); const first = await w.connect(a);
  ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope busy owner', kind: 'fact' }));
  const work = a.tool('recall_memory', { query: 'synthetic cobalt telescope' });
  await until(() => candidate.messages.some(m => m.kind === 'provider-entered'), 'healthy work is admitted');
  const b = w.child({ args: w.args, observeTakeover: true, options: { root: join(w.root, 'run'), environment: {} } }); b.release();
  assert.equal((await w.connect(b)).incarnation, first.incarnation); await work;
  assert.equal(b.messages.filter(m => m.kind === 'takeover-signal').length, 0); assert.ok(startAwareAlive(first.owner));
});
