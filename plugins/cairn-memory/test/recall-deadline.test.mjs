import assert from 'node:assert/strict';
import test from 'node:test';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { withFileLock } from '../lib/file-lock.mjs';
import { setPaused, startIfActive, runIfActive } from '../lib/control-state.mjs';
import { projectKey, clientProjectId, resolveClient } from '../lib/pairing.mjs';
import { recordCredentialConfiguration } from '../lib/credential-state.mjs';

import { invocation as invoke, assertProcessOutcome, assertScenario, scenarios }
  from './fixtures/recall-deadline-harness.mjs';

async function invocation(t, options) {
  const result = await invoke(t, options);
  console.log(JSON.stringify({ node: process.versions.node, code: result.code, signal: result.signal,
    elapsedMs: result.elapsedMs, hostKilled: result.hostKilled,
    stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), events: result.events }));
  assertProcessOutcome(result);
  return result;
}

test('RH-01 immediate recall returns validated context and exits before the host window', async t => {
  const result = await invocation(t);
  assertScenario('success-slow-telemetry', result);
});
test('RH-02 actual recall with quota contention and slow telemetry completes inside the unchanged host window', async t => {
  // The ordinary suite keeps a wide margin before the 2,500 ms budget on slow CI
  // runners (trap 12); the opt-in measurement keeps the 1,800 ms recall.
  const result = await invocation(t, { ...scenarios['success-slow-telemetry'], recallMs: 1000 });
  assertScenario('success-slow-telemetry', result);
  assert.equal(result.events.filter(event => event.kind === 'telemetry-fetch').length, 0);
});
test('RH-03 pre-dispatch waits and HTTP share the invocation budget, with no late context', async t => {
  const result = await invocation(t, { lockMs: 1600, recallMs: 1800 });
  assert.ok(result.stdout === '', 'silent_stdout');
});
test('RH-03 stalled stdin is cancelled without a host kill or context', async t => {
  const result = await invocation(t, { stalledInput: true });
  assert.ok(result.stdout === '', 'silent_stdout'); assert.equal(result.events.filter(event => event.kind === 'recall-fetch').length, 0);
});
test('RH-03 slow HTTP cancels within the narrower existing HTTP budget', async t => {
  const result = await invocation(t, scenarios['slow-recall']);
  assertScenario('slow-recall', result);
});
test('RH-03 unavailable quota lock exits silently without host intervention', async t => {
  const result = await invocation(t, scenarios['unavailable-quota-lock']);
  assertScenario('unavailable-quota-lock', result);
});
test('RH-04 schema fallback shares remaining invocation and HTTP deadlines', async t => {
  const result = await invocation(t, scenarios['schema-fallback']);
  assertScenario('schema-fallback', result);
});
test('RH-05 pause and resume during recall still suppress stale injection', async t => {
  const result = await invocation(t, { onFetch: async root => {
    await setPaused(root, true); await setPaused(root, false);
  } });
  assert.ok(result.stdout === '', 'silent_stdout');
  const kinds = result.events.map(event => event.kind);
  assert.ok(kinds.indexOf('recall-control-complete') < kinds.indexOf('recall-fetch-acknowledged'));
  assert.ok(kinds.indexOf('recall-fetch-acknowledged') < kinds.indexOf('recall-response'));
});
for (const reply of ['empty', 'invalid', 'unauthorized', 'quota', 'other-400']) {
  test(`RH-01/04 ${reply} remains silent without retries or telemetry`, async t => {
    const result = await invocation(t, { reply, telemetry: true });
    assert.ok(result.stdout === '', 'silent_stdout');
    assert.equal(result.events.filter(event => event.kind === 'recall-fetch').length, 1);
    assert.equal(result.events.filter(event => event.kind === 'telemetry-fetch').length, 0);
  });
}
test('RH-01 missing token makes no request and remains silent', async t => {
  const result = await invocation(t, { missingToken: true });
  assert.ok(result.stdout === '', 'silent_stdout'); assert.equal(result.events.filter(event => event.kind === 'recall-fetch').length, 0);
});
test('RH-05 already-aborted lock/control/identity/observation calls start no work', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'recall-aborted-' }), root = join(workspace.path, 'absent');
  const signal = AbortSignal.abort(new Error('synthetic_cancelled'));
  let entered = 0;
  await assert.rejects(withFileLock(join(root, 'lock'), () => entered++, { signal }));
  await assert.rejects(startIfActive(root, 'initial', () => entered++, { signal }));
  await assert.rejects(runIfActive(root, 'initial', () => entered++, { signal }));
  await assert.rejects(projectKey(root, { signal }));
  await assert.rejects(resolveClient({ client: 'claude', home: root, signal }));
  await assert.rejects(clientProjectId({ client: 'claude', home: root, signal }, '/synthetic'));
  await assert.rejects(recordCredentialConfiguration(root, { configured: true, endpoint: 'https://synthetic.invalid',
    observedAt: '2026-10-01T00:00:00.000Z' }, { signal }));
  assert.equal(entered, 0); await assert.rejects(access(root), error => error.code === 'ENOENT');
});
test('RH-05 cancellation while contending preserves foreign live owner and removes only own lock file', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'recall-live-lock-' }), lock = join(workspace.path, 'held.lock');
  let ready, unlock;
  const acquired = new Promise(resolve => ready = resolve), release = new Promise(resolve => unlock = resolve);
  const holder = withFileLock(lock, async () => { ready(); await release; }); await acquired;
  workspace.defer(async () => { unlock(); await holder; });
  const before = await readFile(lock, 'utf8'), controller = new AbortController();
  let entered = false;
  await assert.rejects(withFileLock(lock, () => { entered = true; }, { signal: controller.signal,
    validateOwner: () => controller.abort(new Error('synthetic_cancelled')) }));
  assert.equal(entered, false); assert.equal(await readFile(lock, 'utf8'), before);
  assert.equal((await readdir(workspace.path)).filter(name => name.includes('.owner-')).length, 1);
  unlock(); await holder; assert.deepEqual(await readdir(workspace.path), []);
});
test('RH-05 cancellation after reaper election finishes token-checked recovery without stranding the dead lock', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'recall-reaper-' }), lock = join(workspace.path, 'dead.lock');
  const owner = { pid: 123456, token: '12345678-1234-4234-8234-123456789abc' };
  await writeFile(lock, JSON.stringify(owner));
  await writeFile(`${lock}.owner-${owner.pid}-${owner.token}`, JSON.stringify(owner));
  const controller = new AbortController(); let reads = 0, entered = 0;
  await assert.rejects(withFileLock(lock, () => entered++, { signal: controller.signal, isAlive: () => false,
    read: async (...args) => { const value = await readFile(...args); if (++reads === 2)
      controller.abort(new Error('synthetic_cancelled')); return value; } }));
  assert.equal(reads, 2); assert.equal(entered, 0);
  assert.equal(await withFileLock(lock, () => entered++, { timeoutMs: 150, pollMs: 1, isAlive: () => false }), true);
  assert.equal(entered, 1);
});
test('RH-05 an elected cancelled reaper never unlinks a replacement owner', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'recall-reaper-successor-' }), lock = join(workspace.path, 'dead.lock');
  const owner = { pid: 123456, token: '12345678-1234-4234-8234-123456789abc' };
  const successor = { pid: process.pid, token: '12345678-1234-4234-8234-123456789abd' };
  await writeFile(lock, JSON.stringify(owner));
  const controller = new AbortController(); let reads = 0;
  await assert.rejects(withFileLock(lock, () => assert.fail('cancelled callback'), {
    signal: controller.signal, isAlive: () => false,
    read: async (...args) => { if (++reads === 2) {
      await writeFile(lock, JSON.stringify(successor)); controller.abort(new Error('synthetic_cancelled'));
    } return readFile(...args); },
  }));
  assert.deepEqual(JSON.parse(await readFile(lock, 'utf8')), successor);
});
for (const kind of ['control-dispatch', 'control-output', 'credential', 'identity']) {
  test(`RH-05 ${kind} contention cancels underlying wait without mutating a live owner`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'recall-wait-' }), root = join(workspace.path, 'data');
    const leaf = kind.startsWith('control') ? 'control.lock' : kind === 'credential'
      ? 'credential-state.json.lock' : '.project-key.lock';
    const lock = join(root, leaf); let ready, unlock, called = 0;
    const acquired = new Promise(resolve => ready = resolve), release = new Promise(resolve => unlock = resolve);
    const holder = withFileLock(lock, async () => { ready(); await release; }); await acquired;
    workspace.defer(async () => { unlock(); await holder; });
    const before = await readFile(lock, 'utf8'), names = (await readdir(root)).sort(), signal = AbortSignal.timeout(20);
    const operation = kind === 'control-dispatch' ? () => startIfActive(root, 'initial', () => called++, { signal })
      : kind === 'control-output' ? () => runIfActive(root, 'initial', () => called++, { signal })
      : kind === 'credential' ? () => recordCredentialConfiguration(root, { configured: true,
        endpoint: 'https://synthetic.invalid', observedAt: '2026-10-01T00:00:00.000Z' }, { signal })
      : () => projectKey(root, { signal, home: workspace.path });
    await assert.rejects(operation()); assert.equal(called, 0);
    assert.equal(await readFile(lock, 'utf8'), before);
    assert.deepEqual((await readdir(root)).sort(), names);
    assert.equal((await readdir(root)).filter(name => name.includes('.owner-')).length, 1);
    unlock(); await holder; assert.deepEqual(await readdir(root), []);
  });
}
for (const mode of ['immediate', 'slow-default', 'slow-cancelled']) {
  test(`RH-05 owner publication preserves the default acquisition window (${mode})`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'recall-owner-publication-' }), lock = join(workspace.path, 'guard.lock');
    const original = fsPromises.writeFile, controller = new AbortController();
    let hits = 0, entered = 0, timer;
    fsPromises.writeFile = async function (path, ...args) {
      const result = await original.call(this, path, ...args);
      if (String(path).startsWith(lock + '.owner-')) {
        hits++;
        if (mode === 'slow-cancelled') timer = setTimeout(() => controller.abort(new Error('synthetic_cancelled')), 10);
        if (mode !== 'immediate') await delay(300);
      }
      return result;
    };
    syncBuiltinESMExports();
    try {
      const operation = withFileLock(lock, () => entered++, { timeoutMs: 250, pollMs: 1,
        ...(mode === 'slow-cancelled' ? { signal: controller.signal } : {}) });
      if (mode === 'slow-cancelled') await assert.rejects(operation, /synthetic_cancelled/);
      else assert.equal(await operation, true);
    } finally { clearTimeout(timer); fsPromises.writeFile = original; syncBuiltinESMExports(); }
    assert.equal(hits, 1); assert.equal(entered, mode === 'slow-cancelled' ? 0 : 1);
    assert.deepEqual(await readdir(workspace.path), []);
  });
}
