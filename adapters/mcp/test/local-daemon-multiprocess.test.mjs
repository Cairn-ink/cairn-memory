import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir, chmod, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { workspace, until, ok, query } from './local-daemon-support.mjs';
import { connectOrStart } from '../local-forwarder.mjs';

test('missing store creation is serialized before physical identity election', { timeout: 30000 }, async t => {
  const w = await workspace(t); await rm(w.path);
  const clients = Array.from({ length: 4 }, () => w.forward()); for (const client of clients) client.release();
  const records = await Promise.all(clients.map(w.connect));
  assert.equal(new Set(records.map(m => m.owner.pid)).size, 1, 'new store must elect one physical owner after creation');
  assert.equal(records[0].metadata.counters.runtime.cores, 1);
});

for (const count of [1, 4, 8]) test(`N=${count} barrier-started OS forwarders elect exactly one daemon and heavy runtime`, { timeout: 45000 }, async t => {
  const w = await workspace(t), clients = Array.from({ length: count }, () => w.forward());
  // Every child is forked before any receives its one-use IPC bootstrap.
  for (const client of clients) client.release();
  const metadata = await Promise.all(clients.map(w.connect));
  assert.equal(new Set(metadata.map(m => m.owner.pid)).size, 1, 'election must produce exactly one daemon PID');
  assert.equal(new Set(metadata.map(m => m.incarnation)).size, 1, 'election must produce exactly one incarnation');
  for (const m of metadata) {
    assert.equal(m.metadata.counters.runtime.cores, 1, 'authenticated inspect must prove one heavy core');
    assert.equal(m.metadata.counters.runtime.rawManagers, 1, 'authenticated inspect must prove one Raw manager');
  }
  for (const client of clients) ok(await client.tool('remember_memory', { content: 'synthetic cobalt telescope N' + count, kind: 'fact' }));
  const descriptor = await w.descriptor();
  const files = (await readdir(join(w.root, 'run'))).filter(name => name.endsWith('.sock'));
  assert.equal(files.length, 1, 'one elected identity must bind one socket');
  assert.equal((await lstat(join(w.root, 'run', files[0]))).mode & 0o777, 0o600, 'socket mode must be private');
  assert.equal(descriptor.owner.pid, metadata[0].owner.pid);
});
test('real socket mode and owner checks refuse before connection', { timeout: 20000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); await w.connect(a);
  const name = (await readdir(join(w.root, 'run'))).find(name => name.endsWith('.sock')), socket = join(w.root, 'run', name);
  await chmod(socket, 0o666);
  await assert.rejects(connectOrStart(w.args, { root: join(w.root, 'run'), environment: {}, connectMs: 1000 }), /daemon_entry_mode/, 'unsafe socket mode must refuse before MCP');
  await chmod(socket, 0o600);
  // Owner mismatch uses the same narrow entry checker without requiring root chown.
  const { checkedEntry, runtimeDirectory } = await import('../local-daemon-state.mjs');
  const directory = await runtimeDirectory({ root: join(w.root, 'run') });
  await assert.rejects(checkedEntry({ ...directory, uid: directory.uid + 1 }, socket, { socket: true }), /daemon_entry_owner/, 'wrong socket owner must refuse');
  ok(await a.tool('remember_memory', { content: 'synthetic surviving mode refusal', kind: 'fact' }));
});
test('live SIGSTOP owner refuses within bound without another runtime; dead owner is reaped', { timeout: 30000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); const first = await w.connect(a);
  process.kill(first.owner.pid, 'SIGSTOP');
  const start = performance.now();
  await assert.rejects(connectOrStart(w.args, { root: join(w.root, 'run'), environment: {}, connectMs: 750 }), /daemon_connect_timeout/, 'stopped live owner must refuse within connect bound');
  assert.ok(performance.now() - start < 1750, 'live owner refusal must stay bounded');
  assert.equal((await w.descriptor()).incarnation, first.incarnation, 'stopped live owner incarnation must never be stolen');
  process.kill(first.owner.pid, 'SIGCONT');
  process.kill(first.owner.pid, 'SIGKILL');
  const replacement = await until(() => a.messages.filter(m => m.kind === 'connected').at(1), 'idle reconnect must respawn dead owner');
  assert.notEqual(replacement.incarnation, first.incarnation, 'dead incarnation must be reaped');
  assert.notEqual(replacement.owner.pid, first.owner.pid);
  ok(await a.tool('remember_memory', { content: 'synthetic after stale reap', kind: 'fact' }));
});
test('connection cursors do not cross processes; forget through B hides sentinel from A', { timeout: 30000 }, async t => {
  const w = await workspace(t), a = w.forward(), b = w.forward(); a.release(); b.release(); await Promise.all([w.connect(a), w.connect(b)]);
  const memories = [];
  for (let i = 0; i < 4; i++) memories.push(ok(await b.tool('remember_memory', { content: 'synthetic cobalt telescope SYNTHETIC_R3_SENTINEL_' + i, kind: 'fact' })).memory);
  const first = ok(await a.tool('find_memory_candidates', { ...query, limit: 1 }));
  assert.ok(first.nextCursor, 'synthetic ranking must produce cursor');
  assert.equal((await b.tool('find_memory_candidates', { ...query, limit: 1, cursor: first.nextCursor })).error.code, 'cursor_stale', 'copied cross-process cursor must fail closed');
  const victim = memories[0]; ok(await b.tool('forget_memory', { memoryId: victim.id, expectedRevision: victim.revision }));
  const read = await a.tool('read_memory_context', query);
  assert.equal(read.ok, true);
  assert.ok(!JSON.stringify(read).includes(victim.id) && !JSON.stringify(read).includes(victim.content), 'forgotten sentinel must disappear from next cross-process read');
  for (const name of (await readdir(join(w.root, 'run'))).filter(n => /\.(?:json|log)$/.test(n))) {
    assert.ok(!(await readFile(join(w.root, 'run', name), 'utf8')).includes('SYNTHETIC_R3_SENTINEL'), 'daemon metadata and logs must not retain request text');
  }
});
test('killing a forwarder process group leaves detached daemon serving other sessions', { timeout: 30000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const candidate = w.child({ role: 'candidate', bootstrap }); candidate.release(); await until(w.descriptor, 'group-test daemon must be supervised by test parent');
  const a = w.forward(), b = w.forward(); a.release(); b.release();
  const [first, second] = await Promise.all([w.connect(a), w.connect(b)]);
  process.kill(-a.process.pid, 'SIGKILL'); await until(() => a.exit, 'killed forwarder group must exit');
  assert.equal(a.exit.signal, 'SIGKILL', 'forwarder signal must be recorded');
  ok(await b.tool('remember_memory', { content: 'synthetic process group survivor', kind: 'fact' }));
  assert.equal((await w.descriptor()).owner.pid, second.owner.pid, 'daemon must survive forwarder group death');
  assert.equal(first.owner.pid, second.owner.pid);
});
test('30 second idle exit counts handshake activity; reconnect at boundary never overlaps runtimes', { timeout: 80000 }, async t => {
  const w = await workspace(t), a = w.forward(); a.release(); const first = await w.connect(a);
  a.process.stdin.end(); await until(() => a.messages.some(m => m.kind === 'forwarder-done'), 'last forwarder must finish');
  await delay(29000);
  assert.ok(await w.descriptor(), 'idle daemon must retain ownership for full thirty second grace');
  const names = await readdir(join(w.root, 'run')), socketPath = join(w.root, 'run', names.find(n => n.endsWith('.sock')));
  const handshake = createConnection(socketPath); handshake.on('error', () => {}); await once(handshake, 'connect');
  await delay(1200);
  assert.equal((await w.descriptor()).owner.pid, first.owner.pid, 'pending handshake must count as idle activity');
  handshake.destroy();
  const b = w.forward(); b.release(); const next = await w.connect(b);
  assert.equal(next.metadata.counters.runtime.cores, 1, 'drain boundary must never overlap heavy runtimes');
  b.process.stdin.end(); await until(() => b.messages.some(m => m.kind === 'forwarder-done'), 'reconnected forwarder must finish');
  await until(async () => !(await readdir(join(w.root, 'run'))).some(n => n.endsWith('.sock')), 'daemon must exit after last connection grace', 35000);
});
test('SIGTERM closes admissions revokes clients and removes endpoint before lock release', { timeout: 20000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const candidate = w.child({ role: 'candidate', bootstrap }); candidate.release();
  await until(w.descriptor, 'candidate must publish ready descriptor');
  const a = w.forward(); a.release(); const first = await w.connect(a);
  process.kill(first.owner.pid, 'SIGTERM');
  await until(() => candidate.exit, 'SIGTERM drain must finish within outer grace', 6000);
  assert.equal(candidate.exit.code, 0, 'normal SIGTERM drain must exit cleanly');
  const log = (await readdir(join(w.root, 'run'))).find(n => n.endsWith('.log'));
  const codes = (await readFile(join(w.root, 'run', log), 'utf8')).trim().split('\n');
  assert.ok(codes.indexOf('daemon_draining') < codes.indexOf('daemon_exit'), 'drain must precede exit');
});
test('SIGTERM revokes a provider-backed call and drains admitted work before clean exit', { timeout: 20000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap();
  const candidate = w.child({ role: 'candidate', bootstrap, providerBarrier: true }); candidate.release();
  await until(w.descriptor, 'provider drain candidate must publish');
  const a = w.forward(); a.release(); const first = await w.connect(a);
  ok(await a.tool('remember_memory', { content: 'synthetic cobalt telescope provider drain', kind: 'fact' }));
  const pending = a.tool('recall_memory', { query: 'synthetic cobalt telescope' });
  await until(() => candidate.messages.some(m => m.kind === 'provider-entered'), 'provider call must be admitted before SIGTERM');
  process.kill(first.owner.pid, 'SIGTERM'); await pending;
  await until(() => candidate.exit, 'provider drain must finish within outer grace', 6000);
  assert.ok(candidate.messages.some(m => m.kind === 'provider-settled'), 'SIGTERM must settle admitted provider work before releasing ownership');
  assert.equal(candidate.exit.code, 0, 'bounded provider drain must exit cleanly');
});
