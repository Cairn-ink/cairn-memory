import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

function instrumentOpening() {
  const { fault, clock, census } = workerData.journalFallback;
  const cutoff = BigInt(workerData.operation.operationCutoffMonoNs);
  const counts = new Int32Array(census);
  const logical = new BigInt64Array(clock);
  if (fault === 'short-budget' || fault === 'reserved-budget') {
    const remaining = fault === 'short-budget' ? 30n : 250n;
    const realNow = process.hrtime.bigint;
    process.hrtime.bigint = () => Atomics.load(logical, 0) || realNow();
    globalThis.journalFallbackPreflight = () => Atomics.store(logical, 0, cutoff - remaining * 1_000_000n);
    const sidecar = new URL('../context-read-sidecar.mjs', import.meta.url).href;
    registerHooks({ load(url, context, next) {
      const loaded = next(url, context);
      if (url !== sidecar) return loaded;
      const source = String(loaded.source);
      const anchor = 'export function assertContextReadCanonicalDelete(path, observer) {';
      assert.equal(source.split(anchor).length, 2, 'one canonical preflight');
      return { ...loaded, source: source.replace(anchor, anchor + ' globalThis.journalFallbackPreflight();') };
    } });
  }
  if (fault === 'native-open') {
    globalThis.journalFallbackNative = () => {
      Atomics.add(counts, 3, 1);
      throw Object.assign(Error('index_unavailable'), { code: 'index_unavailable' });
    };
    const database = new URL('../read-database.mjs', import.meta.url).href;
    registerHooks({ load(url, context, next) {
      const loaded = next(url, context);
      if (url !== database) return loaded;
      const source = String(loaded.source), anchor = "() => new DatabaseSync(path, nativeOptions)";
      assert.equal(source.split(anchor).length, 2, 'one observed native open');
      return { ...loaded, source: source.replace(anchor, 'globalThis.journalFallbackNative') };
    } });
  }
  const spawn = childProcess.spawnSync;
  childProcess.spawnSync = function(command, args, options) {
    const program = args?.[2], target = args?.[3];
    if (typeof program === 'string' && target === workerData.path && program.includes('header[18]')) {
      Atomics.add(counts, 0, 1);
      assert.ok(!program.includes('node:sqlite'), 'header child stays SQLite-free');
      if (fault === 'short-budget' || fault === 'reserved-budget') {
        // Simulate a header child using its entire remaining timeout.
        Atomics.store(counts, 4, options.timeout);
        Atomics.add(logical, 0, BigInt(options.timeout) * 1_000_000n);
        return { status: null, signal: 'SIGTERM', stdout: '', error: Object.assign(Error(), { code: 'ETIMEDOUT' }) };
      }
      if (fault === 'ambiguous-header') {
        const child = Reflect.apply(spawn, this, [command, args, options]);
        return { ...child, stdout: JSON.stringify({ ...JSON.parse(child.stdout), mode: 'other' }) };
      }
    }
    if (typeof program === 'string' && target?.startsWith('file:') &&
        new URL(target).pathname === workerData.path && program.includes('PRAGMA journal_mode') &&
        Atomics.add(counts, 1, 1) === 0) {
      if (fault === 'spawn-failure')
        return { status: null, signal: null, stdout: '', error: Object.assign(Error(), { code: 'EAGAIN' }) };
      if (fault === 'incomplete-transcript')
        return { status: 0, signal: null, stdout: '{"begin":{"stage":"open","statement":"connection"}}\n' };
      if (fault === 'probe-timeout') {
        const parked = 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);\n' + program;
        const timedOut = spawn(command, [...args.slice(0, 2), parked, target],
          { ...options, timeout: 100 });
        if (timedOut.error?.code === 'ETIMEDOUT') Atomics.store(counts, 2, 1);
        return timedOut;
      }
    }
    return Reflect.apply(spawn, this, [command, args, options]);
  };
  syncBuiltinESMExports();
}

async function observeOpening(t, { fault, wal, explicit }) {
  const { DatabaseSync } = await import('node:sqlite');
  const { createProductReaderRuntime } = await import('../context-product-reader.mjs');
  const { createContextReadSupervisor, openMemoryCore } = await import('../index.mjs');
  const { credentialDigest, PRODUCT_PROFILE } = await import('../context-product-control.mjs');
  const { ns } = await import('../testing/context-read-fixture.mjs');
  const { createTestWorkspace } = await import('../../tools/testing/workspace.mjs');
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'canonical.sqlite');
  openMemoryCore({ path, raw: true }).close();
  if (wal) {
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal');
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally { db.close(); }
    for (const suffix of ['-wal', '-shm', '-journal']) assert.equal(existsSync(path + suffix), false);
  } else if (fault !== 'native-open') {
    // Only protection metadata is relevant to the stray SHM refusal.
    new DatabaseSync(path + '-shm').close();
    chmodSync(path + '-shm', 0o600);
  }

  const supervisor = createContextReadSupervisor();
  workspace.defer(() => supervisor.close());
  const requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(),
    credentialExpiresUtcMs: null, requestMaxMs: 5000 };
  const readSet = [ns];
  const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1,
    selectedNamespaces: 1, omittedNamespaces: 0 };
  const requestBinding = { kind: 'request', requestId: requestControl.requestId, handleId: requestControl.handleId,
    credentialBindingId: requestControl.credentialBindingId, credentialExpiresUtcMs: null,
    credentialDigest: credentialDigest({ nonce: randomUUID() }), ownerId: ns.ownerId,
    namespaces: { readSet, ownerCoverage }, issuedAt: 0 };
  const state = new SharedArrayBuffer(32);
  new Int32Array(state)[0] = 1;
  const clock = new BigInt64Array(new SharedArrayBuffer(8));
  const census = new Int32Array(new SharedArrayBuffer(20));
  const now = () => Atomics.load(clock, 0) || process.hrtime.bigint();
  let cutoff;
  const open = createProductReaderRuntime({ now, spawnWorker(data) {
    cutoff = BigInt(data.operation.operationCutoffMonoNs);
    return new Worker(new URL(import.meta.url), { env: {}, execArgv: [],
      workerData: { ...data, journalFallback: { fault, clock: clock.buffer, census: census.buffer } } });
  } });
  let refusal;
  const reader = await open({ supervisor, path, version: 'context-read-v1', profile: PRODUCT_PROFILE,
      readSet, ownerCoverage, requestControl, diagnostics: true, ...(explicit ? { wal: true } : {}),
      host: { moduleUrl: new URL('../testing/context-product-host.mjs', import.meta.url).href,
        configuration: { requestBinding, state, requestReservation: new SharedArrayBuffer(4) } } })
    .catch(error => { refusal = error; });
  const beforeCutoff = now() < cutoff;
  await reader?.close();
  return { refusal, beforeCutoff, header: Atomics.load(census, 0), probes: Atomics.load(census, 1),
    timedOut: Atomics.load(census, 2) === 1, native: Atomics.load(census, 3), headerTimeout: Atomics.load(census, 4) };
}

if (!isMainThread) {
  instrumentOpening();
  await import('../context-product-worker.mjs');
} else {
  for (const { fault, wal, explicit, code, header, probes, native = 0, headerTimeout = 0 } of [
    { fault: 'spawn-failure', wal: true, code: 'storage_error', header: 0, probes: 1 },
    { fault: 'probe-timeout', wal: true, code: 'storage_busy', header: 0, probes: 1 },
    { fault: 'incomplete-transcript', wal: true, code: 'index_unavailable', header: 0, probes: 1 },
    { fault: 'completed-probe', wal: true, code: undefined, header: 1, probes: 2 },
    { fault: 'explicit-wal', wal: true, explicit: true, code: undefined, header: 0, probes: 0 },
    { fault: 'ambiguous-header', wal: true, code: 'index_unavailable', header: 1, probes: 1 },
    { fault: 'native-open', wal: false, code: 'index_unavailable', header: 0, probes: 1, native: 1 },
    { fault: 'native-open', wal: true, explicit: true, code: 'index_unavailable', header: 0, probes: 0, native: 1 },
    { fault: 'short-budget', wal: false, code: 'index_unavailable', header: 0, probes: 0 },
    { fault: 'reserved-budget', wal: false, code: 'index_unavailable', header: 1, probes: 0, headerTimeout: 150 },
    { fault: 'ample-budget', wal: false, code: 'index_unavailable', header: 1, probes: 0 },
  ]) test(`canonical journal fallback: ${fault}${explicit ? ' (explicit routing)' : ''}`, async t => {
    const observed = await observeOpening(t, { fault, wal, explicit });
    assert.equal(observed.timedOut, fault === 'probe-timeout');
    assert.deepEqual({ code: observed.refusal?.code, header: observed.header, probes: observed.probes,
      beforeCutoff: observed.beforeCutoff, native: observed.native, headerTimeout: observed.headerTimeout },
    { code, header, probes, beforeCutoff: true, native, headerTimeout });
    if (code) {
      assert.equal(observed.refusal.message, code);
      assert.equal(JSON.stringify(observed.refusal), JSON.stringify({ code, cleanupId: observed.refusal.cleanupId }));
      assert.match(observed.refusal.cleanupId, /^[a-f\d-]{36}$/);
    }
  });
}
