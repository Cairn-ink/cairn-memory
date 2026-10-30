import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import { setTimeout as realDelay } from 'node:timers/promises';
import { readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createReaderWorkerPool, READER_POOL_BOOTSTRAP, READER_POOL_COMPATIBILITY } from '../context-product-reader-pool.mjs';
import { createSupervisorRegistry, createContextReadSupervisor, supervisorOwner, readerPoolDiagnostic } from '../context-read-supervisor.mjs';
import { createProductReaderRuntime, productOpenPhaseDiagnostic } from '../context-product-reader.mjs';
import { openContextProductReader, openContextIndexMaintainer } from '../index.mjs';
import { fixture, ok } from '../testing/context-read-fixture.mjs';
import { personal, configured } from '../testing/context-product-owner-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
const engine = new URL('../context-product-worker.mjs', import.meta.url).href;
const entry = new URL('../context-product-reader-pool-worker.mjs', import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function nativeTest(name, body) { test(name, async t => {
  const abort = new AbortController();
  try { await Promise.race([body(t), realDelay(30000, undefined, { signal: abort.signal }).then(() => assert.fail('pool_test_watchdog'))]); }
  finally { abort.abort(); }
}); }
function fakePool() {
  const workers = [], timers = new Set(); let terminated = 0, maxLive = 0;
  const pool = createReaderWorkerPool({ setTimer(fn, ms) { const timer = { fn, ms, unref() {} }; timers.add(timer); return timer; },
    clearTimer(timer) { timers.delete(timer); }, spawnWorker(data, options) {
      const worker = new EventEmitter(), gate = deferred();
      Object.assign(worker, { threadId: workers.length + 1, data, options, sent: [], ref() {}, unref() {},
        postMessage(m) { worker.sent.push(m); },
        terminate() { terminated++; return gate.promise.then(() => { worker.threadId = -1; worker.emit('exit', 1); return 1; }); },
        ready(patch = {}) { worker.emit('message', { kind: 'context-reader-pool-ready', ...data, ...patch }); },
        release() { gate.resolve(); },
      });
      workers.push(worker); maxLive = Math.max(maxLive, workers.filter(w => w.threadId !== -1).length); return worker;
    } });
  return { pool, workers, timers, get terminated() { return terminated; }, get maxLive() { return maxLive; },
    async close() { const closing = pool.close(); for (const w of workers) w.release(); await closing; },
    async retry() { const timer = [...timers].find(t => t.ms <= 1000); assert.ok(timer); timers.delete(timer); timer.fn(); await flush(); } };
}

test('pool bounds, exhaustion, compatibility, bootstrap replay and private counts', async () => {
  const h = fakePool();
  try {
    assert.equal(h.workers.length, 1); assert.equal(h.pool.take(engine), undefined, 'loading_is_immediate_cold_miss');
    assert.deepEqual(Object.keys(h.workers[0].data).sort(), ['compatibility', 'generation']);
    assert.deepEqual(h.workers[0].options, { env: {}, execArgv: [], stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 192 } });
    h.workers[0].ready(); await flush(); assert.equal(h.workers.length, 2);
    h.workers[1].ready(); await flush(); assert.equal(h.workers.length, 2);
    assert.equal(h.pool.take('other-engine'), undefined, 'incompatible_engine_is_cold_fallback');
    const first = h.pool.take(engine), second = h.pool.take(engine);
    assert.notEqual(first.worker, second.worker); assert.equal(h.pool.take(engine), undefined, 'exhaustion_has_no_waiter');
    first.bootstrap({ maintenance: false }); assert.throws(() => first.bootstrap({ maintenance: false }), /bootstrap_reused/);
    assert.equal(first.worker.sent.length, 1, 'one_bootstrap_per_assignment');
    await flush(); assert.equal(h.workers.length, 3, 'one_refill_only');
    assert.deepEqual(h.pool.diagnostic(), { hits: 2, misses: 3, startupFailures: 0 });
    const closing = h.pool.close(); await flush();
    assert.equal(h.terminated, 1, 'close_only_reaps_idle_loading_not_assigned');
    h.workers[2].release(); await closing;
    assert.equal(h.workers[0].threadId > 0, true); assert.equal(h.workers[1].threadId > 0, true);
  } finally { for (const w of h.workers) w.release(); await h.close(); }
});

test('startup timeout, bad generation, pre-assignment crash and backoff stay bounded', async () => {
  const h = fakePool();
  try {
    h.workers[0].ready({ generation: 'wrong' }); await flush();
    assert.equal(h.pool.diagnostic().startupFailures, 1); assert.equal(h.workers.length, 1);
    await h.retry(); assert.equal(h.workers.length, 1, 'loading_reap_precedes_refill');
    h.workers[0].release(); await flush(); assert.equal(h.workers.length, 2);
    const timer = [...h.timers].find(t => t.ms === 5000); assert.ok(timer); timer.fn(); await flush();
    h.workers[1].release(); await flush(); await h.retry();
    h.workers[2].ready(); await flush(); h.workers[2].emit('error', Error('synthetic idle crash')); await flush();
    assert.equal(h.pool.diagnostic().startupFailures, 3);
    assert.ok([...h.timers].filter(t => t.ms <= 1000).every(t => t.ms >= 25 && t.ms <= 1000));
    assert.ok(h.maxLive <= 3, 'idle_ledger_never_exceeds_three');
  } finally { await h.close(); }
});

test('shutdown cancels queued refill, awaits all reaping, and never restarts', async () => {
  const h = fakePool(); h.workers[0].ready();
  let stopped = false; const closing = h.pool.close().then(() => { stopped = true; }); await flush();
  assert.equal(stopped, false); assert.equal(h.workers.length, 1, 'queued_refill_does_not_spawn_after_close');
  h.workers[0].release(); await closing; await flush(); assert.equal(h.workers.length, 1);
  assert.equal(h.pool.take(engine), undefined); assert.equal(h.timers.size, 0);
});

test('constructor failures back off without a hot loop; shutdown waits for every termination', async () => {
  let timer, attempts = 0; const delays = [];
  const pool = createReaderWorkerPool({ spawnWorker() { attempts++; throw Error('synthetic startup failure'); },
    setTimer(fn, ms) { delays.push(ms); return timer = { fn, unref() {} }; }, clearTimer() { timer = undefined; } });
  assert.equal(attempts, 1);
  for (let i = 0; i < 8; i++) { const next = timer; timer = undefined; next.fn(); }
  assert.equal(attempts, 9); assert.ok(delays.every(ms => ms >= 25 && ms <= 1000));
  assert.equal(pool.diagnostic().startupFailures, 9); await pool.close(); assert.equal(timer, undefined);
  const h = fakePool(); h.workers[0].ready(); await flush();
  const failure = Error('synthetic termination failure'); h.workers[0].terminate = () => Promise.reject(failure);
  let finished = false; const closing = h.pool.close().finally(() => { finished = true; }); void closing.catch(() => {});
  await flush(); assert.equal(finished, false, 'termination_failure_does_not_skip_other_workers');
  h.workers[1].release(); await assert.rejects(closing, error => error === failure);
  h.workers[0].emit('exit', 1); assert.equal(h.pool.take(engine), undefined);
});

// This host is written only into an owned test workspace. Its import and all
// callbacks require bootstrap-owned shared state, unavailable to parked Workers.
const hostSource = `import {parentPort,workerData,threadId} from 'node:worker_threads';
import {createContextReadHost as base} from ${JSON.stringify(new URL('../testing/context-product-index-host.mjs', import.meta.url).href)};
const p=new Int32Array(workerData.host.configuration.probe); Atomics.add(p,0,1);
export async function createContextReadHost(c){
  Atomics.add(p,1,1); const h=await base(c); Atomics.store(p,10,threadId);
  for(const [kind,at] of [['lease',4],['provider',5]])c.resourceOwner.register(kind,()=>{
    Atomics.add(p,at,1); if(c.rejectDisposal===kind)throw Error('synthetic disposal refusal');
  });
  if(c.throwAtCreate)throw Error('synthetic host construction refusal');
  if(c.openGate)await new Promise(resolve=>{const release=m=>{if(m.method==='close'||m.fixtureRelease){parentPort.off('message',release);resolve();}};
    parentPort.on('message',release);Atomics.store(p,8,1);Atomics.notify(p,8);});
  return {...h,authorize(...a){Atomics.add(p,2,1);return h.authorize(...a);},isCurrent(...a){Atomics.add(p,3,1);return h.isCurrent(...a);},
    close(){Atomics.add(p,6,1);}};
}`;
function nativeHarness(t, { trap = false } = {}) {
  const workspace = createTestWorkspace(t), host = join(workspace.path, 'host.mjs'); writeFileSync(host, hostSource);
  const workers = [], packets = [], ready = new Map(), counts = { ready: 0 }; let onRef, onAck, onBootstrap;
  const waiting = n => { if (counts.ready >= n) return Promise.resolve(); if (!ready.has(n)) ready.set(n, deferred()); return ready.get(n).promise; };
  const trapEntry = new URL('data:text/javascript,' + encodeURIComponent(`
    import sqlite from 'node:sqlite';import {syncBuiltinESMExports} from 'node:module';import {parentPort} from 'node:worker_threads';
    const original=sqlite.DatabaseSync;sqlite.DatabaseSync=class {constructor(){throw Error('database_open_before_identity_ack');}};syncBuiltinESMExports();
    parentPort.on('message',m=>{if(m.kind==='identity-ack'){sqlite.DatabaseSync=original;syncBuiltinESMExports();}});
    await import(${JSON.stringify(entry.href)});`));
  const registry = createSupervisorRegistry({ createPool: () => createReaderWorkerPool({ spawnWorker(data, options) {
    assert.deepEqual(Object.keys(data).sort(), ['compatibility', 'generation'], 'parked_bootstrap_has_no_request_or_host');
    const worker = new Worker(trap ? trapEntry : entry, { ...options, workerData: data }); workers.push(worker);
    worker.on('message', m => { if (m.kind === 'context-reader-pool-ready') { counts.ready++; for (const [n, gate] of ready) if (counts.ready >= n) gate.resolve(); } });
    const post = worker.postMessage.bind(worker), ref = worker.ref.bind(worker);
    worker.postMessage = (m, list) => { if (m.kind === READER_POOL_BOOTSTRAP) packets.push({ worker, message: m });
      if (m.kind === 'identity-ack' && onAck) return onAck(() => post(m, list));
      const result = post(m, list); if (m.kind === READER_POOL_BOOTSTRAP) onBootstrap?.(worker); return result; };
    worker.ref = () => { ref(); onRef?.(worker); return worker; }; return worker;
  } }) });
  const supervisor = registry.supervisor({ readerWorkerPool: true });
  const h = { supervisor, registry, workers, packets, ready: waiting, allowFailed: false,
    onRef(fn) { onRef = fn; }, onBootstrap(fn) { onBootstrap = fn; }, onAck(fn) { onAck = fn; }, make(f, patch = {}, service = false) {
      const c = configured({ after() {} }, f.path, [personal], { supervisor, service });
      const probe = new SharedArrayBuffer(48); c.probe = new Int32Array(probe);
      c.options.host = { moduleUrl: pathToFileURL(host).href, configuration: { ...c.options.host.configuration, probe, ...patch } };
      // The harness owns shutdown, including deliberately quarantined records.
      c.open = () => openContextProductReader(c.options); return c;
    } };
  t.after(async () => {
    const result = await Promise.allSettled([supervisor.close()]);
    await Promise.all(workers.filter(w => w.threadId !== -1).map(w => w.terminate()));
    if (!h.allowFailed && result[0].status === 'rejected') throw result[0].reason;
  });
  return h;
}
const input = memory => ({ readSet: [personal], intent: 'current', refs: [{ type: 'memory', namespace: personal, memoryId: memory.id, revision: memory.revision }] });
async function flag(view, at) { while (!Atomics.load(view, at)) { const wait = Atomics.waitAsync(view, at, 0); if (wait.async) await wait.value; } }
// Linux descriptor metadata supplements the SQLite-constructor trap on all hosts.
const databaseFds = path => process.platform !== 'linux' ? undefined : readdirSync('/proc/self/fd').flatMap(name => {
  try { const target = readlinkSync('/proc/self/fd/' + name); return target.startsWith(path) ? [target] : []; } catch { return []; }
}).sort();

test('opted-in parent stays SQLite-free while its real Workers finish preloading', () => {
  const source = `import assert from 'node:assert/strict';import threads from 'node:worker_threads';
    import {register,syncBuiltinESMExports,createRequire} from 'node:module';
    const Module=createRequire(import.meta.url)('node:module'),load=Module._load;
    Module._load=function(id,...args){if(id==='node:sqlite')throw Error('parent_sqlite_require');return Reflect.apply(load,this,[id,...args]);};
    register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s==='node:sqlite')throw Error('parent_sqlite_import');return n(s,c);}"),import.meta.url);
    const {createContextReadSupervisor}=await import(${JSON.stringify(new URL('../context-read-supervisor.mjs', import.meta.url).href)});
    const Native=threads.Worker;let count=0,resolve;const ready=new Promise(r=>resolve=r);
    threads.Worker=class extends Native{constructor(...args){super(...args);this.on('message',m=>{if(m.kind==='context-reader-pool-ready'&&++count===2)resolve();});}};syncBuiltinESMExports();
    const supervisor=createContextReadSupervisor({readerWorkerPool:true});let timer;
    try{await Promise.race([ready,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('parent_import_watchdog')),10000))]);
      assert.deepEqual(process.moduleLoadList.filter(s=>/sqlite/i.test(s)),[]);}
    finally{clearTimeout(timer);await supervisor.close();threads.Worker=Native;syncBuiltinESMExports();}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: {}, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, 'pool_parent_does_not_link_sqlite: ' + result.stderr);
});

nativeTest('parked preloads construct no database or host; default-off evidence and phase DTOs stay identical', async t => {
  const f = fixture(t), memory = f.admit('synthetic pool exact evidence', personal), before = databaseFds(f.path), h = nativeHarness(t, { trap: true });
  const c = h.make(f); await h.ready(2);
  assert.deepEqual(databaseFds(f.path), before, 'parked_workers_have_no_database_descriptors');
  assert.deepEqual([...c.probe], Array(12).fill(0), 'no_host_import_construction_acl_before_bootstrap');
  const warm = await c.open(), warmResult = await warm.fetchCandidateEvidence(input(memory), c.token);
  assert.deepEqual([...c.probe.slice(0, 4)], [1, 1, 1, 2]);
  await warm.close();
  assert.ok(h.workers[0].threadId === -1, 'assigned_worker_exits_at_close');
  const phase = productOpenPhaseDiagnostic(warm); assert.equal(Object.keys(phase).length, 40);
  assert.ok(Object.values(phase).every(Number.isFinite));
  const results = [warmResult], keys = [Reflect.ownKeys(warm)];
  for (const enabled of [undefined, false]) {
    const supervisor = createContextReadSupervisor(enabled === undefined ? undefined : { readerWorkerPool: false }); t.after(() => supervisor.close());
    const cold = h.make(f); cold.options.supervisor = supervisor;
    const reader = await cold.open(); results.push(await reader.fetchCandidateEvidence(input(memory), cold.token)); keys.push(Reflect.ownKeys(reader));
    assert.deepEqual(ok(await reader.fetchCandidateEvidence({ readSet: [personal], snapshot: ok(warmResult).snapshot }, cold.token)), ok(warmResult));
    await reader.close(); assert.equal(readerPoolDiagnostic(supervisor), undefined);
  }
  assert.equal(JSON.stringify(results[0]), JSON.stringify(results[1])); assert.equal(JSON.stringify(results[1]), JSON.stringify(results[2]));
  assert.deepEqual(keys[0], keys[1]); assert.deepEqual(keys[1], keys[2]);
  assert.deepEqual(Object.keys(readerPoolDiagnostic(h.supervisor)), ['hits', 'misses', 'startupFailures']);
  assert.ok((await h.supervisor.drain()).every(r => r.state === 'complete' && r.leasesReleased && r.providersSettled));
});

nativeTest('host import and database construction wait for the original identity acknowledgement', async t => {
  const f = fixture(t), before = databaseFds(f.path), h = nativeHarness(t, { trap: true }); await h.ready(2);
  const c = h.make(f), ack = deferred(); let deliver;
  h.onAck(send => { deliver = send; ack.resolve(); });
  const opening = c.open(); await ack.promise;
  assert.deepEqual([...c.probe], Array(12).fill(0), 'host_waits_for_identity_ack');
  assert.deepEqual(databaseFds(f.path), before, 'database_waits_for_identity_ack');
  h.onAck(undefined); deliver(); const reader = await opening; await reader.close();
});

nativeTest('two simultaneous borrowers exhaust ready stock; third open is cold with no queue', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2);
  const configs = [h.make(f), h.make(f), h.make(f)], readers = await Promise.all(configs.map(c => c.open()));
  assert.deepEqual(readerPoolDiagnostic(h.supervisor), { hits: 2, misses: 1, startupFailures: 0 });
  assert.equal(h.registry.counters().live, 3); assert.equal(h.packets.length, 2);
  assert.equal(new Set(configs.map(c => c.probe[10])).size, 3);
  await Promise.all(readers.map(r => r.close()));
});

nativeTest('supervisor shutdown during handoff never sends authority or leaves a refill', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f); let closing;
  h.onRef(() => { h.onRef(undefined); closing = h.supervisor.close(); });
  await assert.rejects(c.open(), { code: 'store_closed' }); await closing;
  assert.equal(h.packets.length, 0); assert.ok(h.workers.every(w => w.threadId === -1));
});

nativeTest('cold incompatibility keeps one opening record/reservation; maintenance never borrows', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f); let bootstrap;
  const open = createProductReaderRuntime({ spawnWorker(data) { bootstrap = data; return new Worker(new URL(engine), { workerData: data, env: {}, execArgv: [], stdout: true, stderr: true }); } });
  const reader = await open(c.options); await reader.close();
  assert.equal(bootstrap.request.requestId, c.options.requestControl.requestId);
  assert.equal(Atomics.load(new Int32Array(c.options.host.configuration.requestReservation), 0), 1);
  assert.equal(h.registry.counters().records, 1, 'cold_fallback_reuses_opening_record');
  assert.deepEqual(readerPoolDiagnostic(h.supervisor), { hits: 0, misses: 1, startupFailures: 0 });
  const service = h.make(f, {}, true), maintainer = await openContextIndexMaintainer(service.options); await maintainer.close();
  assert.deepEqual(readerPoolDiagnostic(h.supervisor), { hits: 0, misses: 1, startupFailures: 0 });
  assert.equal(h.packets.length, 0, 'no_maintenance_admission_from_pool');
});

nativeTest('issuance and reservation replay never borrow; each credential gets a new Worker', async t => {
  const f = fixture(t), memory = f.admit('credential-local evidence', personal), h = nativeHarness(t); await h.ready(2);
  const bad = h.make(f); bad.options.host.configuration.requestBinding.requestId = 'not-the-issued-request';
  await assert.rejects(bad.open(), { code: 'authority_required' }); assert.equal(h.packets.length, 0);
  const a = h.make(f), reader = await a.open();
  const b = h.make(f), second = await b.open();
  assert.equal((await second.fetchCandidateEvidence(input(memory), a.token)).error.code, 'authority_required');
  await reader.close(); await second.close();
  await assert.rejects(a.open(), { code: 'authority_required' });
  await h.ready(3); const c = h.make(f), third = await c.open(); await third.close();
  assert.equal(new Set(h.packets.map(p => p.worker)).size, 3, 'never_assigns_a_second_credential');
  assert.equal(readerPoolDiagnostic(h.supervisor).hits, 3);
  for (const packet of h.packets) assert.equal(packet.message.data.operation.enteredMonoNs, packet.message.data.request.admittedMonoNs);
});

for (const cause of ['expiry', 'abort']) nativeTest('handoff ' + cause + ' sends no bootstrap and preserves cleanup ID', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f), abort = new AbortController();
  h.onRef(() => { h.onRef(undefined); if (cause === 'abort') abort.abort(); else void testClock.advance(5001, { waitForWorkers: false }); });
  const error = await openContextProductReader(c.options, { signal: abort.signal }).catch(e => e);
  assert.equal(error.code, cause === 'abort' ? 'read_cancelled' : 'read_timeout'); assert.equal(typeof error.cleanupId, 'string');
  await testClock.advance(1001, { waitForWorkers: false }); await h.supervisor.drain(error.cleanupId);
  assert.equal(h.packets.length, 0, 'no_authority_after_handoff_revocation');
  assert.equal(h.registry.counters().records, 1); assert.equal(readerPoolDiagnostic(h.supervisor).hits, 1);
});

nativeTest('timeout during module handoff reaches the unchanged graceful close listener', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f), exited = deferred();
  h.onBootstrap(worker => { h.onBootstrap(undefined); worker.once('exit', code => exited.resolve(code)); void testClock.advance(5001, { waitForWorkers: false }); });
  const error = await c.open().catch(e => e); assert.equal(error.code, 'read_timeout');
  assert.equal(await exited.promise, 0, 'handoff_close_is_delivered_to_merged_disposal');
  assert.equal((await h.supervisor.drain(error.cleanupId)).state, 'complete');
  assert.deepEqual([...c.probe], Array(12).fill(0));
});

for (const cause of ['expiry', 'abort']) nativeTest('loading ' + cause + ' stays request-local on cold fallback', async t => {
  const f = fixture(t), h = nativeHarness(t), c = h.make(f, { openGate: true }), abort = new AbortController();
  if (cause === 'expiry') { const expiry = Date.now() + 50; c.options.requestControl.credentialExpiresUtcMs = expiry; c.options.host.configuration.requestBinding.credentialExpiresUtcMs = expiry; }
  const opening = openContextProductReader(c.options, { signal: abort.signal }).catch(e => e);
  await flag(c.probe, 8);
  if (cause === 'expiry') await testClock.advance(51, { waitForWorkers: false }); else { h.allowFailed = true; abort.abort(); }
  const error = await opening; assert.equal(error.code, cause === 'expiry' ? 'read_timeout' : 'read_cancelled');
  if (cause === 'expiry') { await h.supervisor.drain(error.cleanupId); assert.equal(h.supervisor.getCleanupStatus(error.cleanupId).state, 'complete'); assert.deepEqual([...c.probe.slice(4, 6)], [1, 1]); }
  else { await assert.rejects(h.supervisor.drain(error.cleanupId), { code: 'reader_failed' }); assert.equal(h.supervisor.getCleanupStatus(error.cleanupId).state, 'failed'); }
  assert.equal(readerPoolDiagnostic(h.supervisor).hits, 0); assert.equal(readerPoolDiagnostic(h.supervisor).misses, 1);
});

nativeTest('pooled timeout retains merged graceful disposal for leases and providers', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f, { openGate: true });
  const expiry = Date.now() + 50; c.options.requestControl.credentialExpiresUtcMs = expiry; c.options.host.configuration.requestBinding.credentialExpiresUtcMs = expiry;
  const opening = c.open().catch(e => e); await flag(c.probe, 8); await testClock.advance(51, { waitForWorkers: false });
  const error = await opening; assert.equal(error.code, 'read_timeout'); const result = await h.supervisor.drain(error.cleanupId);
  assert.equal(result.state, 'complete'); assert.equal(result.leasesReleased && result.providersSettled, true);
  assert.deepEqual([...c.probe.slice(4, 7)], [1, 1, 1]); assert.equal(h.packets[0].worker.threadId, -1);
});

for (const failure of ['duplicate', 'crash', 'provider']) nativeTest('assigned ' + failure + ' retains quarantine and never recycles', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f, failure === 'provider' ? { rejectDisposal: 'provider' } : {});
  const reader = await c.open(); h.allowFailed = true;
  if (failure === 'duplicate') h.packets[0].worker.postMessage(h.packets[0].message);
  if (failure === 'crash') await h.packets[0].worker.terminate();
  if (failure === 'duplicate') await new Promise(resolve => h.packets[0].worker.once('exit', resolve));
  await assert.rejects(reader.close(), { code: 'reader_failed' });
  const next = h.make(f); await assert.rejects(next.open(), { code: 'reader_failed' });
  assert.equal(readerPoolDiagnostic(h.supervisor).hits, 1); assert.equal(readerPoolDiagnostic(h.supervisor).startupFailures, 0);
  assert.ok((await h.supervisor.drain()).some(r => r.state === 'failed'));
});

nativeTest('failed opening cleanup ID proves disposal; idle crash refills without authority', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2);
  await h.workers[0].terminate(); await testClock.advance(25, { waitForWorkers: false }); await h.ready(3);
  assert.equal(readerPoolDiagnostic(h.supervisor).startupFailures, 1);
  const c = h.make(f, { throwAtCreate: true }), error = await c.open().catch(e => e);
  assert.equal(error.code, 'reader_failed'); assert.equal((await h.supervisor.drain(error.cleanupId)).state, 'complete');
  assert.deepEqual([...c.probe.slice(4, 6)], [1, 1]);
});

nativeTest('public supervisors share 256 records; a pool supplies no admission quota', async t => {
  const supervisor = createContextReadSupervisor({ readerWorkerPool: true }), other = createContextReadSupervisor();
  const { registry, owner } = supervisorOwner(other), records = [];
  t.after(async () => { for (const r of records) registry.finish(r); await Promise.all([supervisor.close(), other.close()]); });
  for (let i = 0; i < 256; i++) records.push(registry.register(owner, { path: 'synthetic-quota', domain: 'synthetic-quota' }));
  const f = fixture(t), c = configured(t, f.path, [personal], { supervisor });
  await assert.rejects(openContextProductReader(c.options), { code: 'read_in_progress' });
  assert.deepEqual(readerPoolDiagnostic(supervisor), { hits: 0, misses: 0, startupFailures: 0 });
});

for (const reason of ['restore', 'erasure']) nativeTest(reason + ' shutdown drains idle/loading and assigned resources before fresh issuance', async t => {
  const f = fixture(t), h = nativeHarness(t); await h.ready(2); const c = h.make(f), reader = await c.open();
  // The product publishes denial before closing all service owners.
  Atomics.store(c.view, 0, 0); await reader.close(); await h.supervisor.close();
  assert.ok(h.workers.every(w => w.threadId === -1));
  await assert.rejects(c.open(), { code: 'authority_required' });
  await assert.rejects(h.make(f).open(), { code: 'store_closed' }, 'closed_generation_refuses_fresh_issuance');
  const fresh = nativeHarness(t); await fresh.ready(2); const next = fresh.make(f), replacement = await next.open(); await replacement.close();
  assert.equal(readerPoolDiagnostic(fresh.supervisor).hits, 1);
});
