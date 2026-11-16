import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { runtimeDirectory } from '../../adapters/mcp/local-daemon-state.mjs';
import { localProcessIdentity, startAwareAlive } from '../../adapters/mcp/local-daemon-liveness.mjs';
import { installedDaemonRuntime, runtimeLease, sameOwner } from './fixtures/installed-daemon-runtime.mjs';

const leasePath = directory => join(dirname(directory.path), '.installed-daemon-test.lease');
const boundMs = 2000;
async function until(predicate, message, ms = boundMs) {
  const deadline = performance.now() + ms;
  do { const value = predicate(); if (value) return value; await delay(10); } while (performance.now() < deadline);
  assert.fail(message);
}

if (process.argv[2] === '--lease-holder') {
  process.send({ event: 'started' });
  const release = await runtimeLease({ path: process.argv[3] });
  process.send({ event: 'acquired', owner: localProcessIdentity() });
  await new Promise(resolve => process.once('message', resolve));
  await release(); process.disconnect();
} else {
  function childHolder(t, directory) {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--lease-holder', directory.path], {
      env: { PATH: dirname(process.execPath), NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const messages = []; let stderr = '', exit;
    child.stderr.on('data', value => { stderr += value; }); child.on('message', value => messages.push(value));
    const done = new Promise((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => { exit = { code, signal }; resolve(exit); });
    });
    // Each child is supervised and reaped before the workspace cleanup hook.
    directory.workspace.defer(async () => {
      if (!exit) child.kill('SIGKILL');
      await done;
    });
    return { child, done, messages, async acquired() {
      return until(() => {
        assert.equal(exit, undefined, stderr);
        return messages.find(value => value.event === 'acquired');
      }, 'lease acquisition exceeds the 2000 ms bound');
    }, async release() { child.send({ event: 'release' }); assert.deepEqual(await done, { code: 0, signal: null }, stderr); } };
  }
  const directoryFor = t => {
    const workspace = createTestWorkspace(t, { prefix: 'runtime-lease-' });
    return { path: join(workspace.path, 'runtime'), workspace };
  };

  test('scheduling lease publishes its PID and start-aware holder identity', { timeout: 10000 }, async t => {
    const directory = directoryFor(t), holder = childHolder(t, directory), acquired = await holder.acquired();
    const owner = JSON.parse(await readFile(leasePath(directory), 'utf8'));
    assert.equal(owner.pid, holder.child.pid); assert.ok(sameOwner(owner, acquired.owner));
    assert.equal(startAwareAlive(owner), true);
    await holder.release();
    await assert.rejects(lstat(leasePath(directory)), { code: 'ENOENT' });
  });

  test('SIGKILLed lease holder is recovered within 2000 ms and racing successors exclude each other', { timeout: 10000 }, async t => {
    const directory = directoryFor(t), original = childHolder(t, directory), { owner } = await original.acquired();
    original.child.kill('SIGKILL'); assert.deepEqual(await original.done, { code: null, signal: 'SIGKILL' });
    assert.equal(startAwareAlive(owner), false);
    const start = performance.now(), a = childHolder(t, directory), b = childHolder(t, directory);
    const first = await until(() => [a, b].find(holder => holder.messages.some(value => value.event === 'acquired')),
      'dead-holder recovery exceeds the 2000 ms bound');
    const recoveredMs = Math.round(performance.now() - start);
    assert.ok(performance.now() - start < boundMs);
    const second = first === a ? b : a;
    await delay(200);
    assert.equal(second.messages.some(value => value.event === 'acquired'), false, 'one exclusive successor');
    const published = JSON.parse(await readFile(leasePath(directory), 'utf8'));
    assert.equal(published.pid, first.child.pid);
    await first.release(); await second.acquired(); await second.release();
    t.diagnostic(`SIGKILL recovery ${recoveredMs} ms (<2000 ms); two contenders never hold simultaneously`);
  });

  test('a live scheduling lease holder is never taken over', { timeout: 10000 }, async t => {
    const directory = directoryFor(t), holder = childHolder(t, directory); await holder.acquired();
    const before = await readFile(leasePath(directory)), pin = await lstat(leasePath(directory));
    const contender = childHolder(t, directory);
    await until(() => contender.messages.some(value => value.event === 'started'), 'contender started');
    await delay(300);
    assert.equal(contender.messages.some(value => value.event === 'acquired'), false);
    assert.deepEqual(await readFile(leasePath(directory)), before);
    assert.equal((await lstat(leasePath(directory))).ino, pin.ino);
    await holder.release(); await contender.acquired(); await contender.release();
  });

  test('a live PID with a stale start identity cannot strand the scheduling lease', { timeout: 10000 }, async t => {
    const directory = directoryFor(t), owner = { ...localProcessIdentity(), start: 'synthetic-old-start', token: randomUUID() };
    assert.equal(startAwareAlive(owner), false);
    await writeFile(leasePath(directory), JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    const holder = childHolder(t, directory); await holder.acquired(); await holder.release();
  });

  test('initial snapshot failure releases the acquired lease before finish can be registered', { timeout: 10000 }, async t => {
    const directory = await runtimeDirectory(), failure = Error('synthetic_initial_snapshot_failure');
    let unexpected;
    try {
      await assert.rejects(async () => { unexpected = await installedDaemonRuntime({ snapshot: async path => {
        assert.equal(path, directory.path);
        const owner = JSON.parse(await readFile(leasePath(directory), 'utf8'));
        assert.ok(sameOwner(owner, localProcessIdentity()), 'failure is injected after acquisition');
        throw failure;
      } }); }, error => error === failure);
    } finally { if (unexpected) await unexpected.finish(); }
    await assert.rejects(lstat(leasePath(directory)), { code: 'ENOENT' });
    const start = performance.now(), release = await runtimeLease(directory, { timeoutMs: 500 });
    try {
      t.diagnostic(`next acquisition ${Math.round(performance.now() - start)} ms (<500 ms)`);
      assert.ok(performance.now() - start < 500, 'next acquisition is immediate (<500 ms)');
    }
    finally { await release(); }
    t.diagnostic('post-acquisition initialization failure released lease; next acquisition <500 ms');
  });
}
