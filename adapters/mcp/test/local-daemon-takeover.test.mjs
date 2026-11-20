import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
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
  // Exempt from crash-temp exclusion: every call is awaited with the holder
  // SIGSTOPped, before releasing any contender that could acquire its lock.
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

for (const stage of ['lock', 'term']) test('takeover ENOENT releases its lock and re-verifies after ' + stage, { timeout: 20000 }, async t => {
  const w = await workspace(t), { descriptor: old, candidate } = await stopped(w), e = await stale(w);
  const b = w.child({ args: w.args, observeTakeover: true, takeoverFault: stage,
    options: { root: join(w.root, 'run'), environment: {} } });
  b.release();
  await until(() => b.messages.some(m => m.kind === 'takeover-read-pending'), 'fault is inside the held takeover lock');
  assert.equal(JSON.parse(await readFile(e.paths.takeover, 'utf8')).pid, b.process.pid);
  const before = b.messages.filter(m => m.kind === 'takeover-signal');
  assert.deepEqual(before.map(m => [m.pid, m.signal]), stage === 'term' ? [[old.owner.pid, 'SIGTERM']] : []);
  process.kill(old.owner.pid, 'SIGKILL'); await until(() => candidate.exit, 'old owner actually dies');
  const replacement = w.child({ role: 'candidate', bootstrap: await w.bootstrap() }); replacement.release();
  const fresh = await until(async () => { const d = await w.descriptor(); return d?.incarnation !== old.incarnation && d; }, 'fresh election publishes before the injected error unwinds');
  b.process.send({ kind: 'release-takeover-read' });
  const connected = await w.connect(b);
  assert.equal(connected.incarnation, fresh.incarnation); assert.deepEqual(connected.owner, fresh.owner);
  await until(async () => {
    try { await lstat(e.paths.takeover); return false; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }, 'the failed takeover releases its lock');
  assert.deepEqual(b.messages.filter(m => m.kind === 'takeover-signal'), before, 'retry repeats the full fresh-stamp verification and never signals the new owner');
  assert.ok(startAwareAlive(fresh.owner));
  assert.equal(b.messages.filter(m => m.kind === 'candidate').length, 0);
  ok(await b.tool('remember_memory', { content: 'synthetic fresh owner after takeover read failure', kind: 'fact' }));
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

for (const entry of ['.stamp', '.json']) for (const takeover of [false, true]) test('losing candidate attaches to an already-published winner after private-open race; entry=' + entry + '; takeover=' + takeover, { timeout: 25000 }, async t => {
  const w = await workspace(t), { descriptor: old, candidate: predecessor } = await stopped(w);
  if (takeover) await stale(w);
  else { assert.ok(startAwareAlive(old.owner)); process.kill(old.owner.pid, 'SIGKILL'); await until(() => predecessor.exit, 'ordinary dead owner exits'); }
  const gate = join(w.root, 'release-losing-candidate');
  const b = w.child({ args: w.args, losingElectionRace: gate, losingElectionEntry: entry, observeTakeover: true,
    options: { root: join(w.root, 'run'), environment: {}, takeoverOptions: { graceMs: 0 } } });
  b.release();
  await until(() => b.messages.some(m => m.kind === 'private-open-pending'), 'B checks the old private inode after launching its candidate');
  assert.equal(b.messages.filter(m => m.kind === 'candidate').length, 1);
  const winner = w.child({ role: 'candidate', bootstrap: await w.bootstrap(), holdAfterLock: true }); winner.release();
  await until(() => winner.messages.some(m => m.kind === 'candidate-after-lock'), 'winner reaps the old endpoint while holding the lifetime lock');
  b.process.send({ kind: 'try-private-open' });
  const error = await until(() => b.messages.find(m => m.kind === 'private-open-failed'), 'B observes the real unlinked private-file open');
  assert.deepEqual(error, { kind: 'private-open-failed', name: 'Error', code: 'ENOENT' });
  winner.process.send({ kind: 'release-candidate-lock' });
  const fresh = await until(async () => { const d = await w.descriptor(); return d?.incarnation !== old.incarnation && d; }, 'winner publishes before B resumes');
  const a = w.forward(); a.release(); assert.equal((await w.connect(a)).incarnation, fresh.incarnation);
  await writeFile(gate, '', { mode: 0o600 });
  const loser = await until(() => b.messages.find(m => m.kind === 'candidate-exit'), 'B candidate loses the real lifetime-lock election');
  assert.equal(loser.code, 0); assert.equal(loser.signal, null);
  assert.equal(loser.stderr, 'synthetic_candidate_lost_lock\n');
  b.process.send({ kind: 'release-private-error' });
  // Check the outcome immediately: red/control evidence includes original name/code.
  const outcome = await until(() => b.messages.find(m => m.kind === 'connected' || m.kind === 'forwarder-done'), 'B attaches within its original budget');
  assert.equal(outcome.kind, 'connected', JSON.stringify(outcome));
  const attached = await w.connect(b);
  assert.equal(attached.incarnation, fresh.incarnation); assert.deepEqual(attached.owner, fresh.owner);
  assert.ok(performance.now() - b.startedAt < 10500, 'the original ten-second budget is never restarted');
  assert.equal(b.messages.filter(m => m.kind === 'candidate').length, 1, 'the loser attaches without launching a second candidate');
  const signals = b.messages.filter(m => m.kind === 'takeover-signal');
  assert.ok(signals.every(m => m.pid === old.owner.pid));
  assert.equal(signals.filter(m => m.signal === 'SIGTERM').length, takeover ? 1 : 0);
  assert.equal(signals.filter(m => m.signal === 'SIGKILL').length, takeover ? 1 : 0);
  ok(await b.tool('remember_memory', { content: 'synthetic authenticated losing forwarder', kind: 'fact' }));
});
