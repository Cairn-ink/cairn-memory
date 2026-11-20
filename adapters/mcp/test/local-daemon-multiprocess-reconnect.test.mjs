import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once as eventOnce } from 'node:events';
import { workspace, until, ok, query } from './local-daemon-support.mjs';

function cpuLoad(t) {
  const probe = spawnSync('taskset', ['-pc', String(process.pid)], { encoding: 'utf8' });
  assert.equal(probe.status, 0);
  const mask = probe.stdout.trim().split(':').at(-1).trim(), core = mask.split(/[,-]/)[0];
  assert.equal(spawnSync('taskset', ['-pc', core, String(process.pid)]).status, 0);
  const hog = spawn(process.execPath, [new URL('./fixtures/local-daemon-cpu-load.mjs', import.meta.url).pathname], { env: {}, stdio: 'ignore' });
  const done = eventOnce(hog, 'exit');
  t.after(async () => {
    hog.kill('SIGTERM'); const [code, signal] = await done;
    t.diagnostic('same-core CPU load child exit ' + JSON.stringify({ code, signal }));
    assert.equal(spawnSync('taskset', ['-pc', mask, String(process.pid)]).status, 0);
  });
}

for (const loaded of [true]) test('live SIGSTOP owner refuses within bound without another runtime; dead owner is reaped; CPU load=' + loaded, { timeout: 30000 }, async t => {
  if (loaded) cpuLoad(t);
  const w = await workspace(t), a = w.forward(); a.release(); const first = await w.connect(a);
  process.kill(first.owner.pid, 'SIGSTOP');
  const start = performance.now();
  await assert.rejects(w.probeConnection({ connectMs: 750 }), /daemon_connect_timeout/, 'stopped live owner must refuse within connect bound');
  assert.ok(performance.now() - start < 1750, 'live owner refusal must stay bounded');
  assert.equal((await w.descriptor()).incarnation, first.incarnation, 'stopped live owner incarnation must never be stolen');
  process.kill(first.owner.pid, 'SIGCONT');
  process.kill(first.owner.pid, 'SIGKILL');
  const replacement = await until(() => a.messages.filter(m => m.kind === 'connected').at(1), 'idle reconnect must respawn dead owner');
  assert.notEqual(replacement.incarnation, first.incarnation, 'dead incarnation must be reaped');
  assert.notEqual(replacement.owner.pid, first.owner.pid);
  ok(await a.tool('remember_memory', { content: 'synthetic after stale reap', kind: 'fact' }));
});
for (const loaded of [false, true]) test('dead-owner reconnect retries a candidate that exits without publishing; CPU load=' + loaded, { timeout: 30000 }, async t => {
  if (loaded) cpuLoad(t);
  const w = await workspace(t), a = w.forward([], { failRespawnOnce: true, retainExitedCandidateRecords: true });
  a.release(); const first = await w.connect(a);
  process.kill(first.owner.pid, 'SIGKILL');
  const replacement = await until(() => a.messages.filter(m => m.kind === 'connected').at(1), 'idle reconnect must respawn dead owner after candidate exit');
  assert.notEqual(replacement.incarnation, first.incarnation);
  const exits = a.messages.filter(m => m.kind === 'candidate-exit');
  assert.ok(exits.some(m => m.code === 17 && m.stderr.includes('synthetic_candidate_lost_lock')));
  ok(await a.tool('remember_memory', { content: 'synthetic after failed respawn', kind: 'fact' }));
  assert.ok(a.messages.filter(m => m.kind === 'candidate').every(m => m.active_candidates === 1), 'one forwarder never overlaps candidate processes: ' + JSON.stringify(a.messages.filter(m => m.kind === 'candidate')));
  assert.ok(a.messages.filter(m => m.kind === 'candidate').length <= 4, 'initial owner plus at most three reconnect candidates');
});
test('three failed candidates exhaust one connect budget without reading stdin', { timeout: 18000 }, async t => {
  const w = await workspace(t), a = w.forward([], { failEveryCandidate: true });
  a.release(); a.process.stdin.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n');
  const begin = performance.now(), done = await until(() => a.messages.find(m => m.kind === 'forwarder-done'), 'bounded candidates refuse within one connect budget');
  assert.deepEqual(done.code, { refused: 'daemon_connect_timeout', cause: { name: 'Error', code: 'daemon_connect_timeout' } }); assert.equal(done.bytesRead, 0);
  assert.ok(performance.now() - begin < 11500);
  assert.equal(a.messages.filter(m => m.kind === 'candidate').length, 3);
  assert.ok(a.messages.filter(m => m.kind === 'candidate').every(m => m.active_candidates === 1));
});
test('connection cursors do not cross processes; forget through B hides sentinel from A after inspecting stored content', { timeout: 30000 }, async t => {
  const w = await workspace(t), a = w.forward(), b = w.forward(); a.release(); b.release(); await Promise.all([w.connect(a), w.connect(b)]);
  const memories = [];
  for (let i = 0; i < 4; i++) memories.push(ok(await b.tool('remember_memory', { content: 'synthetic cobalt telescope SYNTHETIC_R3_SENTINEL_' + i, kind: 'fact' })).memory);
  const first = ok(await a.tool('find_memory_candidates', { ...query, limit: 1 }));
  assert.ok(first.nextCursor, 'synthetic ranking must produce cursor');
  assert.equal((await b.tool('find_memory_candidates', { ...query, limit: 1, cursor: first.nextCursor })).error.code, 'cursor_stale', 'copied cross-process cursor must fail closed');
  const victim = ok(await b.tool('inspect_memory', { memoryId: memories[0].id })).memory;
  assert.equal(victim.content, 'synthetic cobalt telescope SYNTHETIC_R3_SENTINEL_0');
  ok(await b.tool('forget_memory', { memoryId: victim.id, expectedRevision: victim.revision }));
  const read = await a.tool('read_memory_context', query);
  assert.equal(read.ok, true);
  assert.ok(!JSON.stringify(read).includes(victim.id) && !JSON.stringify(read).includes(victim.content), 'forgotten sentinel must disappear from next cross-process read');
  for (const name of (await readdir(join(w.root, 'run', 'cairn-memory'))).filter(n => /\.(?:json|log)$/.test(n))) {
    assert.ok(!(await readFile(join(w.root, 'run', 'cairn-memory', name), 'utf8')).includes('SYNTHETIC_R3_SENTINEL'), 'daemon metadata and logs must not retain request text');
  }
});
