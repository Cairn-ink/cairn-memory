// Import first: all real native Workers share the injected operation clock.
import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as realDelay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { provisionSemanticOwner } from '../context-semantic-ledger.mjs';
import { canonicalJson } from '../context-product-validation.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { createProductReaderRuntime, maintenanceReaderFailureDiagnostic, maintenanceFailureDiagnostic } from '../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic } from '../context-product-pump.mjs';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { supervisorOwner, createSupervisorRegistry } from '../context-read-supervisor.mjs';
import { createContextReadSupervisor, openContextSemanticCoordinator,
  openContextIndexMaintainer, openMemoryCore } from '../index.mjs';

const hostUrl = new URL('./fixtures/context-semantic-pump-cutoff-host.mjs', import.meta.url).href;
const coverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
  requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const bits = ['workerStopped', 'nativeDisposed', 'leasesReleased', 'providersSettled'];
const input = { readSet: [ns], types: ['memory'], intent: 'current' };
let deadEnd = false;
let validationDispatches = 0;
let validationReplyGate;
const retainedWorkspaces=[];
test.after(async()=>{for(const cleanup of retainedWorkspaces)await cleanup();});
const workerPost = Worker.prototype.postMessage;
Worker.prototype.postMessage = function(message, ...args) {
  if (message.kind === 'call' && message.method === 'validateOwnerSemanticCoverage') {
    validationDispatches++;
    if (validationReplyGate) {
      const gate=validationReplyGate;validationReplyGate=undefined;const emit=this.emit;
      this.emit=function(event,response,...rest){
        if(event==='message'&&response.id===message.id){this.emit=emit;gate.enter();void gate.reply.then(()=>Reflect.apply(emit,this,[event,response,...rest]));return true;}
        return Reflect.apply(emit,this,[event,response,...rest]);
      };
    }
  }
  return Reflect.apply(workerPost, this, [message, ...args]);
};

// Real time is used only to fail a hang, never to choose the cutoff or assert
// success. timers/promises is independent of the injected global timers.
async function guard(promise, label, ms = 15000) {
  const abort = new AbortController();
  try {
    return await Promise.race([promise, realDelay(ms, undefined, { signal: abort.signal })
      .then(() => { throw Error('hang guard: ' + label); })]);
  } finally { abort.abort(); }
}
async function until(predicate, label) {
  let stopped = false;
  try { await guard((async () => { while (!stopped && !predicate()) await realDelay(2); })(), label); }
  finally { stopped = true; }
}
function release(control) {
  for (const at of [2, 12]) { Atomics.store(control, at, 1); Atomics.notify(control, at); }
}
const realNs = () => { const [seconds, nanos] = process.hrtime(); return BigInt(seconds) * 1000000000n + BigInt(nanos); };

async function setup(t, { expectedCleanupFailure = false, isolated = false, targetTypes = [['memory']], coordinatorHost = hostUrl } = {}) {
  // Same accounting identity as the existing offline semantic tests. A closed
  // fixture's inode binding must not be mistaken for the next fresh ledger.
  assert.equal(globalThis[Symbol.for('context-read-product-p2e-v1/coordinators')]?.size ?? 0, 0);
  globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  // Failed writer proofs intentionally live for the process lifetime. Retain
  // their files until file teardown so inode reuse cannot poison later fixtures.
  const f = fixture(isolated&&expectedCleanupFailure?{after:fn=>retainedWorkspaces.push(fn)}:t,
    {cards:targetTypes.some(types=>types.includes('card'))});
  f.admit('semantic cutoff alpha'); f.admit('semantic cutoff beta'); f.core.close();
  const registry=isolated?createSupervisorRegistry():null;
  const supervisor = registry?registry.supervisor():createContextReadSupervisor();
  f.workspace.defer(() => guard(supervisor.close(), 'supervisor close').catch(error => {
    if (!expectedCleanupFailure) throw error;
    assert.equal(error.code, 'reader_failed');
  }));
  const cutoffControl = new SharedArrayBuffer(64), control = new Int32Array(cutoffControl);
  const leaseTiming = new SharedArrayBuffer(24);
  f.workspace.defer(() => { release(control); Atomics.store(control, 5, 0); Atomics.store(control, 15, 1); Atomics.notify(control, 15); });
  const state = new SharedArrayBuffer(64); new Int32Array(state)[0] = 1;
  const utcClock = new SharedArrayBuffer(8), utc = new BigInt64Array(utcClock);
  utc[0] = BigInt(Date.now());
  const anchorPath = join(f.workspace.path, 'authority.sqlite'), ledgerPath = join(f.workspace.path, 'ledger.sqlite');
  createExclusiveSqliteFile(anchorPath);
  const authority = new DatabaseSync(anchorPath);
  authority.exec('CREATE TABLE anchors(owner TEXT PRIMARY KEY,anchor TEXT NOT NULL) STRICT;CREATE TABLE enrollments(owner TEXT PRIMARY KEY) STRICT;');
  f.workspace.defer(() => authority.close());
  const ledgerIdentity = { accountingDomainId: 'synthetic-accounting', ledgerId: 'synthetic-ledger' };
  await guard(provisionSemanticOwner({ path: ledgerPath, identity: ledgerIdentity, ownerId: ns.ownerId,
    deadlineAt: testClock.now() + 5000, enrollment: {
      authorizeNeverBound: owner => !authority.prepare('SELECT 1 FROM enrollments WHERE owner=?').get(owner),
      createIfNeverBound(a) {
        authority.exec('BEGIN IMMEDIATE');
        try {
          authority.prepare('INSERT INTO enrollments VALUES(?)').run(a.ownerId);
          authority.prepare('INSERT INTO anchors VALUES(?,?)').run(a.ownerId, canonicalJson(a));
          authority.exec('COMMIT'); return true;
        } catch (error) { authority.exec('ROLLBACK'); throw error; }
      },
    } }), 'provision owner');
  const token = { opaque: randomUUID() }, binding = {
    kind: 'semantic-service', serviceId: randomUUID(), credentialBindingId: randomUUID(),
    credentialExpiresUtcMs: null, credentialDigest: credentialDigest(token), ownerId: ns.ownerId,
    scope: 'owner', issuedAt: 0,
    methods: ['setOwnerSemantic', 'getOwnerSemanticStatus', 'validateOwnerSemanticCoverage', 'purgeOwnerVectors'],
    ...ledgerIdentity, ledgerEpoch: 1, bindingRevision: 1,
  };
  const priceTable = { authorityId: 'synthetic-price', revision: 'one', sequence: 1,
    effectiveFromUtcMs: Number(utc[0]) - 1000, effectiveUntilUtcMs: Number(utc[0]) + 3600000,
    usdPerMillionInputTokens: { 'text-embedding-3-small': '0.02' } };
  const coordinator = await guard(openContextSemanticCoordinator({
    version: 'context-read-product-p2e-v1', supervisor, ledgerPath, ledgerIdentity,
    provider: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536,
      normalization: 'l2', requestTimeoutMs: 3000, maxBatchDocuments: 64 },
    refreshCaps: { steady: { maxItemsPerUtcDay: 2000, maxUsdPerUtcDay: '0.05' },
      backfill: { maxItemsPerUtcDay: 20000, maxUsdPerUtcDay: '0.50', maxUsdTotal: '5' } },
    backfillTargets: targetTypes.map(types => ({ canonicalPath: f.path, readSet: [ns], types, intents: ['current', 'history'] })),
    priceTable, host: { moduleUrl: coordinatorHost, configuration: {
      semanticServiceBinding: binding, anchorPath, state, priceTable, utcClock, cutoffControl,
    } },
  }), 'coordinator open');
  f.workspace.defer(() => guard(coordinator.close(), 'coordinator close'));
  if(isolated&&expectedCleanupFailure)t.after(async()=>{await guard(coordinator.close(),'isolated coordinator close');await supervisor.close().catch(error=>assert.equal(error.code,'reader_failed'));});
  const coordinatorRecord = [...supervisorOwner(supervisor).owner.records]
    .find(r => r.domain === 'context-read-product-p2e-v1/coordinator');
  assert.ok(coordinatorRecord?.resources);
  const coordinatorResources = new Int32Array(coordinatorRecord.resources);
  function configure(selectedSupervisor = supervisor, semantic = true) {
    const credential = { opaque: randomUUID() }, serviceBinding = {
      kind: 'service', serviceId: randomUUID(), credentialBindingId: randomUUID(),
      credentialExpiresUtcMs: null, credentialDigest: credentialDigest(credential),
      ownerId: ns.ownerId, namespaces: { readSet: [ns], ownerCoverage: coverage }, issuedAt: 0,
    };
    return { credential, options: { supervisor: selectedSupervisor, path: f.path,
      version: 'context-read-v1', profile: PRODUCT_PROFILE, readSet: [ns], ownerCoverage: coverage,
      sidecarJournalMode: 'DELETE', diagnostics: true,
      ...(semantic ? { semanticConfig: { version: 'context-read-product-p2e-v1', coordinator } } : {}),
      host: { moduleUrl: hostUrl, configuration: { serviceBinding, state, cutoffControl, leaseTiming } },
    } };
  }
  ok(await guard(coordinator.setOwnerSemantic({ ownerId: ns.ownerId, semantic: true, expectedRevision: 0 }, token), 'enable owner'));
  const prebuild = configure(), h = await guard(openContextIndexMaintainer(prebuild.options), 'prebuild open');
  f.workspace.defer(() => guard(h.close(), 'prebuild close'));
  for (const types of targetTypes) for (const intent of ['current', 'history']) ok(await guard(h.refreshContextIndex({ ...input, types, intent,
    mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, prebuild.credential), 'prebuild lexical'));
  await guard(h.close(), 'prebuild close');
  function advance(ms, options) {
    assert.ok(Number.isSafeInteger(ms) && ms >= 0);
    Atomics.add(utc, 0, BigInt(ms));
    // Advance every native Worker's timers as well as the shared clock value.
    // Cancellation and the Worker's own expired RPC timeout may race normally.
    return testClock.advance(ms, options);
  }
  return { f, supervisor, coordinator, coordinatorResources, token, control, configure, advance, ledgerPath, leaseTiming, newSupervisor:()=>registry?registry.supervisor():createContextReadSupervisor() };
}

function pumpRuntime(s, hooks = {}) {
  const timers = new Map(), spawned = [], results = [], opened = [], errors = [], reservations = [], controlCalls = [];
  const client = semanticHandle(s.coordinator), pumpCall = client.pumpCall;
  client.pumpCall = (method, ...args) => {
    controlCalls.push(method);
    if (method === 'pumpReserve') reservations.push(args[0]);
    return pumpCall(method, ...args);
  };
  let next = 0;
  const nativeOpen = createProductReaderRuntime({ maintenance: true, spawnWorker(data) {
    const worker = new Worker(new URL('../context-product-worker.mjs', import.meta.url), {
      workerData: data, transferList: [data.semanticPort], env: {}, execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const cleanupId=[...supervisorOwner(s.supervisor).owner.records].find(record=>record.resources===data.resources)?.id;
    const capture = { worker, data, cleanupId, outbound: [], resources: new Int32Array(data.resources), errors: [], stderr: '' };
    let exited;
    capture.exited = new Promise(resolve => { exited = resolve; });
    worker.on('error', error => capture.errors.push({ message: error.message, code: error.code, stack: error.stack }));
    worker.once('exit', code => { capture.exitCode = code; exited(code); });
    worker.stderr.on('data', data => { capture.stderr = (capture.stderr + data).slice(-8192); });
    spawned.push(capture);
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message, ...args) => { capture.outbound.push(message); return post(message, ...args); };
    return worker;
  } });
  const renew = createMaintenancePumpRuntime({ now: testClock.now,
    setTimer(fn, ms) { const id = ++next; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id),
    async open(options, control) {
      try {
        const h = await nativeOpen(hooks.openingDeadline?{...options,deadlineMs:hooks.openingDeadline}:options, control); opened.push(h);
        if(hooks.open)await hooks.open(h);
        return { ...h, async getContextIndexStatus(...args) {
          const result=await h.getContextIndexStatus(...args);if(hooks.status)await hooks.status(result);return result;
        }, async refreshContextIndex(...args) {
          const result = await h.refreshContextIndex(...args); results.push({ input: args[0], result });if(hooks.refresh)await hooks.refresh(result);return result;
        } };
      } catch (error) { errors.push(error); throw error; }
    },
  });
  const configured = s.configure();
  const config = { supervisor: s.supervisor, id: randomUUID(), semanticConfig: configured.options.semanticConfig,
    semanticServiceCredential: s.token, serviceCredential: configured.credential,
    firstCoverageValidation: { maxTargets: 1, maxMs: 500 },
    projections: [{ options: configured.options, types: ['memory'], modes: ['lexical', 'embeddings'] }],
    window: { id: randomUUID(), endsAtMonoMs: testClock.now() + 10000, usedItems: 0, usedMs: 0, usedUsd: '0' },
    budgets: { maxItems: 100, maxMs: 20000, maxUsd: '0.50' },
    quantum: { maxItems: 1, maxMs: 500, maxUsd: '0.01' }, pollMs: 500, renewalMs: 60000,
  };
  return { renew, config, spawned, results, opened, errors, reservations, controlCalls, fireWatchdog(){const entry=[...timers].at(-1);assert.ok(entry,'parent_watchdog_is_armed');timers.delete(entry[0]);return entry[1].fn();},
    get nextDelay() { return timers.values().next().value?.ms; }, tick() {
    assert.equal(timers.size, 1, 'exactly one pump tick is scheduled');
    const [id, { fn }] = timers.entries().next().value; timers.delete(id); return fn();
  } };
}

async function cleanupRecords(t, s, records, onFailure) {
  const observations = [];
  for (const record of records) {
    let value;
    try { value = s.supervisor.getCleanupStatus(record.id);assert.equal(value.state,'complete','completion_owns_opening_cleanup'); }
    catch (error) {
      value = error.cleanup ?? s.supervisor.getCleanupStatus(record.id);
      if (value.state === 'failed') deadEnd = true;
      t.diagnostic('FAILED cleanup: ' + JSON.stringify(value));
      await onFailure?.();
      throw error;
    }
    observations.push(value);
    assert.equal(value.state, 'complete', JSON.stringify(value));
    for (const bit of bits) assert.equal(value[bit], true, bit);
    assert.equal(record.safety, false, 'completed record retains no quarantine');
  }
  assert.equal([...supervisorOwner(s.supervisor).owner.records].some(r => r.safety), false);
  return observations.map(({ state, ...value }) => ({ state, ...Object.fromEntries(bits.map(k => [k, value[k]])) }));
}

// Failure-only forensics: do not mistake a failed pump bookkeeping record for
// a process-wide reader quarantine. Probe the actual successors before stopping.
async function failureForensics(t, s, runtime, capture, records, terminal) {
  const timing = [...new BigInt64Array(s.leaseTiming)].map(String);
  const evidence = { terminal, cleanup: records.map(r => s.supervisor.getCleanupStatus(r.id)),
    readerResources: [...capture.resources], workerExitCode: capture.exitCode,
    workerErrors: capture.errors, workerStderr: capture.stderr, timing,
    readerFailure: runtime.opened[0] ? maintenanceReaderFailureDiagnostic(runtime.opened[0]) : null,
    successors: [], renewal: null };
  t.diagnostic('FAILURE evidence: ' + JSON.stringify(evidence));
  evidence.coordinatorResources = [...s.coordinatorResources];
  evidence.coordinatorStatus = await guard(s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token), 'forensic coordinator status');
  const another = createContextReadSupervisor();
  s.f.workspace.defer(() => guard(another.close(), 'forensic supervisor close'));
  for (const [name, supervisor] of [['same', s.supervisor], ['new', another]]) {
    for (const semantic of [true, false]) {
      const c = s.configure(supervisor, semantic);
      try {
        const h = await guard(openContextIndexMaintainer(c.options), 'forensic successor open');
        s.f.workspace.defer(() => guard(h.close(), 'forensic successor close'));
        const status = await guard(h.getContextIndexStatus({ ...input, deadlineMs: 5000 }, c.credential), 'forensic successor status');
        await guard(h.close(), 'forensic successor close');
        evidence.successors.push({ supervisor: name, semantic, open: 'ok', status });
      } catch (error) { evidence.successors.push({ supervisor: name, semantic, error: error.code ?? error.message }); }
    }
  }
  try {
    const renewed = runtime.renew({ ...runtime.config, window: { id: randomUUID(),
      endsAtMonoMs: testClock.now() + 10000, usedItems: 0, usedMs: 0, usedUsd: '0' } });
    s.f.workspace.defer(() => guard(renewed.close(), 'forensic renewed close'));
    await guard(runtime.tick(), 'forensic renewed quantum');
    evidence.renewal = renewed.getStatus(); await guard(renewed.close(), 'forensic renewed close');
  } catch (error) { evidence.renewal = { error: error.code ?? error.message }; }
  t.diagnostic('FAILURE successors: ' + JSON.stringify(evidence));
}

async function successors(s) {
  const another = createContextReadSupervisor(), results = [];
  s.f.workspace.defer(() => guard(another.close(), 'new supervisor close'));
  for (const [name, supervisor] of [['same', s.supervisor], ['new', another]]) {
    for (const semantic of [true, false]) {
      const c = s.configure(supervisor, semantic);
      const h = await guard(openContextIndexMaintainer(c.options), name + ' successor open');
      s.f.workspace.defer(() => guard(h.close(), 'successor close'));
      ok(await guard(h.getContextIndexStatus({ ...input, deadlineMs: 5000 }, c.credential), name + ' successor status'));
      await guard(h.close(), 'successor close');
      results.push(name + '/' + (semantic ? 'semantic' : 'lexical') + ':ok');
    }
  }
  return results;
}

// Genuine cutoffs remain terminal. Short tails are covered separately below:
// they must never create a truncated quantum in the first place.
for (const { kind, rendezvous } of [
  { kind: 'opening', rendezvous: 1 },
  { kind: 'in-flight refresh', rendezvous: 6 },
]) {
  test('semantic pump cutoff does not quarantine: ' + kind, async t => {
    if (deadEnd) { t.skip('earlier case found a quarantine dead end; stop'); return; }
    const s = await setup(t), runtime = pumpRuntime(s), { control } = s;
    const pump = runtime.renew(runtime.config);
    s.f.workspace.defer(() => guard(pump.close(), 'failed pump close'));
    s.f.workspace.defer(() => { release(control); Atomics.store(control, 5, 0); });
    const owner = supervisorOwner(s.supervisor).owner;
    const pumpRecord = [...owner.records].find(r => r.domain === 'context-read-product-p2e-v1/pump/' + runtime.config.id);
    assert.ok(pumpRecord);
    let transient = null, cutoffMs;
    if (kind === 'opening') {
      Atomics.store(control, 0, 1);
    } else {
      await guard(runtime.tick(), 'initial lexical quantum');
      assert.equal(pump.getStatus().error, null);
      assert.equal(runtime.results[0].input.mode, 'lexical'); ok(runtime.results[0].result);
      if (rendezvous === 6) Atomics.store(control, 5, 1);
      else Atomics.store(control, 10, 1);
    }
    const tick = runtime.tick();
    // A rejection is always observed even if a rendezvous assertion fails.
    tick.catch(() => {});
    await until(() => Atomics.load(control, rendezvous) === 1, kind + ' rendezvous');
    const capture = runtime.spawned[0];
    assert.ok(capture.worker instanceof Worker); assert.ok(capture.worker.threadId > 0);
    assert.equal(capture.resources[0], 1, 'host.close registered as a lease before cutoff');
    assert.equal(capture.resources[1], 0, 'host lease is still live at cutoff');
    assert.equal(capture.resources[2], 0, 'reader semantic port is not a registered provider');
    const readerRecord = [...owner.records].find(r => r.resources === capture.data.resources);
    assert.ok(readerRecord);
    const records = [pumpRecord, readerRecord, ...[...owner.records].filter(r => r.parent === readerRecord)];
    const operation = kind === 'opening' ? capture.data.operation : capture.outbound.at(-1).operation;
    cutoffMs = Number(BigInt(operation.operationCutoffMonoNs) - process.hrtime.bigint()) / 1e6;
    assert.equal(cutoffMs, 500);
    if (kind !== 'opening') {
      const dispatched = capture.outbound.at(-1);
      assert.equal(dispatched.method, 'refreshContextIndex'); assert.equal(dispatched.input.mode, 'embeddings');
      assert.equal(dispatched.input.budget.maxMs, cutoffMs);
      assert.equal(control[8], 0, 'embedding has not settled before cutoff');
      if (rendezvous === 6) assert.ok(s.coordinatorResources[2] > s.coordinatorResources[3], 'coordinator owns an in-flight provider');
      else assert.equal(s.coordinatorResources[2], s.coordinatorResources[3], '1 ms cannot admit a provider');
    }
    const leaseTiming = new BigInt64Array(s.leaseTiming);
    Atomics.store(leaseTiming, 1, 0n); Atomics.store(leaseTiming, 2, 0n);
    Atomics.store(leaseTiming, 0, realNs());
    const advanced = s.advance(cutoffMs);
    if (kind === 'opening') {
      // Synchronous admission happens before releasing the opening barrier.
      // This is the expected temporary quarantine, not a failed disposal.
      const c = s.configure(s.supervisor, false);
      const probe = openContextIndexMaintainer(c.options);
      const observed = assert.rejects(probe, error => { transient = error.code; return error.code === 'read_in_progress'; });
      release(control);
      await guard(observed, 'opening cleanup transient probe');
    }
    if (rendezvous === 11) release(control);
    // A terminating Worker may exit before acknowledging the clock pulse.
    // Its actual exit is sufficient; completion and cleanup are checked below.
    await guard(Promise.race([advanced, capture.exited]), 'cutoff clock delivery');
    await guard(tick, kind + ' tick');
    const terminal = await guard(pump.completion, kind + ' completion');
    const cleanup = await cleanupRecords(t, s, records, () => failureForensics(t, s, runtime, capture, records, terminal));
    const leaseProof = { workerExitCode: capture.exitCode,
      closeStartedAfterCutoffMs: Number(Atomics.load(leaseTiming, 1) - Atomics.load(leaseTiming, 0)) / 1e6,
      closeFinishedAfterCutoffMs: Number(Atomics.load(leaseTiming, 2) - Atomics.load(leaseTiming, 0)) / 1e6 };
    assert.equal(terminal.state, 'failed'); assert.equal(terminal.error, 'read_timeout');
    assert.deepEqual(pump.getStatus(), terminal);
    const cause=maintenancePumpDiagnostic(terminal),source=maintenanceFailureDiagnostic(kind==='opening'?runtime.errors[0]:runtime.results.at(-1).result);
    assert.ok(cause,'semantic_cutoff_has_private_cause');
    assert.equal(cause.lastFailure.engineCode,'read_timeout');
    if(kind!=='opening'&&source?.ordinal!==undefined)assert.equal(cause.lastFailure.ordinal,source.ordinal,'semantic_failure_joins_reader_ordinal');
    assert.equal(cause.failureCounts.engine,1,'semantic_cutoff_initiating_cause_counted_once');assert.equal(Object.hasOwn(cause.lastFailure,'stall'),false,'semantic_causes_exclude_stall_reporting');
    if (kind === 'opening') {
      assert.equal(runtime.errors.length, 1); assert.equal(runtime.errors[0].code, 'read_timeout');
      assert.equal(runtime.errors[0].cleanupId, readerRecord.id);
    } else {
      assert.deepEqual(runtime.results.at(-1).result, { ok: false, error: { code: 'read_timeout', retryable: false } });
    }
    assert.equal(capture.resources[0], capture.resources[1], 'host lease was released');
    if (rendezvous === 6) {
      await until(() => control[7] === 1 && control[8] === 1 &&
        s.coordinatorResources[2] === s.coordinatorResources[3], 'embedding cancellation and coordinator settlement');
    } else assert.equal(control[6], 0);
    assert.equal(semanticHandle(s.coordinator).closed(), false);
    const status = ok(await guard(s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token), 'coordinator status after cutoff'));
    assert.equal(status.owner.semantic, true);
    const ledger = new DatabaseSync(s.ledgerPath, { readOnly: true });
    let reservationStates;
    try {
      const row = ledger.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId);
      reservationStates = Object.values(JSON.parse(row.state).reservations).map(r => r.status);
      assert.ok(reservationStates.every(state => ['settled', 'unknown', 'released'].includes(state)), JSON.stringify(reservationStates));
    } finally { ledger.close(); }
    const successorResults = await successors(s);
    Atomics.store(control, 5, 0);
    await guard(s.advance(Math.max(0, runtime.config.window.endsAtMonoMs - testClock.now())), 'advance to renewal');
    const renewed = runtime.renew({ ...runtime.config, window: { id: randomUUID(),
      endsAtMonoMs: testClock.now() + 10000, usedItems: 0, usedMs: 0, usedUsd: '0' } });
    assert.notEqual(renewed, pump);
    s.f.workspace.defer(() => guard(renewed.close(), 'renewed pump close'));
    const before = runtime.results.length, providerSuccesses = control[9];
    await guard(runtime.tick(), 'renewed lexical quantum');
    await guard(runtime.tick(), 'renewed embedding quantum');
    assert.equal(renewed.getStatus().state, 'active'); assert.equal(renewed.getStatus().error, null);
    const resumed = runtime.results.slice(before);
    assert.deepEqual(resumed.map(r => r.input.mode), ['lexical', 'embeddings']);
    for (const r of resumed) ok(r.result);
    assert.ok(control[9] > providerSuccesses, 'same coordinator successfully embeds after cancellation');
    await guard(renewed.close(), 'renewed pump close');
    assert.equal(control[3], control[4], 'all product host leases closed');
    assert.equal(s.coordinatorResources[2], s.coordinatorResources[3]);
    t.diagnostic(JSON.stringify({ case: kind, cutoffMs, terminal, cleanup, quarantine: false, leaseProof,
      transient, successors: successorResults, renewed: 'lexical+embeddings:ok',
      embedding: { started: control[6], cancelled: control[7], settled: control[8], reservationStates },
      coordinator: 'healthy' }));
  });
}

const dispatchCount = runtime => runtime.spawned.reduce((n, c) => n + c.outbound.length, 0);
function nextWindow(runtime) {
  return { ...runtime.config, window: { ...runtime.config.window, id: randomUUID(), endsAtMonoMs: testClock.now() + 10000 } };
}
async function validationPending(s, runtime, maxItems = 1024) {
  runtime.config.quantum.maxItems = 64; runtime.config.budgets.maxItems = maxItems;
  const pump = runtime.renew(runtime.config);
  for (let n = 0; n < 4; n++) await guard(runtime.tick(), 'prepare validation');
  const status = ok(await s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token));
  assert.equal(status.firstCoverage.state, 'validating', 'validation rendezvous is durable');
  return pump;
}

for (const [stage, limit, tail] of [
  ['startup', 'window', 61], ['startup', 'window', 1], ['startup', 'renewal', 61],
  ['regular', 'window', 61], ['regular', 'window', 1], ['regular', 'renewal', 61],
  ['validation', 'window', 699], ['validation', 'renewal', 699],
]) test(`semantic parity ${stage} ${limit} ${tail} ms tail skips a full quantum`, async t => {
  const s = await setup(t), runtime = pumpRuntime(s);
  if (limit === 'renewal') runtime.config.renewalMs = 2000;
  if (stage === 'validation') runtime.config.firstCoverageValidation.maxMs = 700;
  const pump = stage === 'validation' ? await validationPending(s, runtime) : runtime.renew(runtime.config);
  s.f.workspace.defer(() => pump.close());
  if (stage === 'regular') await guard(runtime.tick(), 'initial lexical turn');
  const end = limit === 'window' ? runtime.config.window.endsAtMonoMs
    : testClock.now() + runtime.config.renewalMs;
  await guard(s.advance(end - testClock.now() - tail), 'enter tail');
  const before = { reserves: runtime.reservations.length, opens: runtime.spawned.length,
    dispatches: dispatchCount(runtime), validations: validationDispatches, controls: runtime.controlCalls.length, status: pump.getStatus() };
  await guard(runtime.tick(), 'skipped turn');
  assert.equal(runtime.reservations.length, before.reserves, 'tail_has_no_reservation');
  assert.equal(runtime.spawned.length, before.opens, 'tail_has_no_open');
  assert.equal(dispatchCount(runtime), before.dispatches, 'tail_has_no_dispatch');
  assert.equal(validationDispatches, before.validations, 'tail_has_no_validation_dispatch');
  assert.equal(runtime.controlCalls.length, before.controls, 'tail_has_no_control_dispatch');
  assert.deepEqual(pump.getStatus(), before.status, 'tail_has_no_charge_or_failure');
  assert.equal(runtime.nextDelay, tail, 'tail_parks_at_expiry_without_spinning');
  if (limit === 'window') {
    runtime.renew(runtime.config);
    assert.equal(runtime.nextDelay, tail, 'renewal_keeps_short_window_tail_parked');
  }
  await guard(s.advance(tail), 'expire tail'); await guard(runtime.tick(), 'expiry notification');
  assert.equal((await pump.completion).state, limit === 'window' ? 'budget_exhausted' : 'renewal_expired');
  runtime.renew(limit === 'window' ? nextWindow(runtime) : { ...runtime.config, renewalMs: 60000 });
  assert.equal(runtime.nextDelay, 0, 'tail_skip_does_not_delay_renewed_turn');
  await guard(runtime.tick(), 'full turn after renewal');
  assert.equal(pump.getStatus().error, null, 'authorized_renewal_resumes_full_turn');
  if (stage === 'regular') assert.deepEqual(
    [runtime.results.at(-1).input.mode, runtime.results.at(-1).input.intent],
    ['embeddings', 'current'], 'tail_skip_preserves_next_lane');
});

test('semantic parity initial short window parks at expiry without a quantum', async t => {
  const s = await setup(t), runtime = pumpRuntime(s); runtime.config.window.endsAtMonoMs = testClock.now() + 61;
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  assert.equal(runtime.nextDelay, 61, 'short_initial_window_parks_until_expiry');
  await guard(s.advance(61), 'initial expiry'); await runtime.tick();
  assert.equal((await pump.completion).state, 'budget_exhausted');
  assert.equal(runtime.reservations.length, 0); assert.equal(runtime.spawned.length, 0);
});

test('semantic parity review F1 fitting validation clears stale parking at a fast poll', async t => {
  const s = await setup(t), runtime = pumpRuntime(s); runtime.config.firstCoverageValidation.maxMs = 300;
  runtime.config.pollMs = 1;
  const pump = await validationPending(s, runtime); s.f.workspace.defer(() => pump.close());
  await guard(s.advance(runtime.config.window.endsAtMonoMs - testClock.now() - 350), 'validation-only tail');
  const before = runtime.reservations.length, dispatched = validationDispatches;
  await guard(runtime.tick(), 'full validation turn');
  assert.deepEqual(runtime.reservations.slice(before).map(r => [r.mode, r.maxMs]),
    [['validation', 300]], 'validation_uses_own_full_bound_then_parks_regular_turn');
  assert.equal(validationDispatches, dispatched + 1);
  const status = ok(await s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token));
  assert.equal(status.firstCoverage.state, 'validating', 'validation_remains_pending');
  assert.equal(runtime.nextDelay, 1, 'fitting_validation_clears_stale_parking');
  await s.advance(1); await guard(runtime.tick(), 'next fitting validation');
  assert.equal(validationDispatches, dispatched + 2, 'next_fitting_validation_is_dispatched');
  assert.equal(pump.getStatus().error, null);
});

test('semantic parity tail skip preserves round-robin position across renewal', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), pump = runtime.renew(runtime.config);
  s.f.workspace.defer(() => pump.close()); await guard(runtime.tick(), 'first lexical turn');
  await guard(s.advance(runtime.config.window.endsAtMonoMs - testClock.now() - 61), 'enter tail');
  await guard(runtime.tick(), 'tail turn'); await guard(s.advance(61), 'window handoff');
  runtime.renew(nextWindow(runtime)); await guard(runtime.tick(), 'resumed turn');
  assert.deepEqual([runtime.results.at(-1).input.mode, runtime.results.at(-1).input.intent],
    ['embeddings', 'current'], 'tail_skip_preserves_round_robin_position');
});

test('semantic parity incompatible constructor policies drain before replacement', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), p = runtime.config.projections[0];
  runtime.config.quantum.maxMs = runtime.config.pollMs = runtime.config.firstCoverageValidation.maxMs = 400;
  runtime.config.projections.push({ ...p, options: { ...p.options, host: { ...p.options.host,
    configuration: { ...p.options.host.configuration, constructorTag: 'second' } } } });
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  for (let n = 0; n < 5; n++) await guard(runtime.tick(), 'constructor policy turn');
  assert.equal(runtime.spawned.length, 2, 'constructor_policy_gets_distinct_resident');
  assert.equal(runtime.spawned[1].data.host.configuration.constructorTag, 'second');
  assert.equal(await runtime.spawned[0].exited, 0);
  assert.deepEqual([...runtime.spawned[0].resources], [1, 1, 0, 0], 'previous_constructor_disposed_before_open');
});

test('semantic parity review F2 signed-zero policies get distinct residents', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), p = runtime.config.projections[0];
  runtime.config.quantum.maxMs = runtime.config.pollMs = runtime.config.firstCoverageValidation.maxMs = 400;
  p.options.host.configuration.constructorNumber = 0;
  runtime.config.projections.push({ ...p, options: { ...p.options, host: { ...p.options.host,
    configuration: { ...p.options.host.configuration, constructorNumber: -0 } } } });
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  for (let n = 0; n < 5; n++) await guard(runtime.tick(), 'signed-zero policy turn');
  assert.equal(runtime.spawned.length, 2, 'signed_zero_policies_get_distinct_residents');
  assert.ok(Object.is(runtime.spawned[0].data.host.configuration.constructorNumber, 0));
  assert.ok(Object.is(runtime.spawned[1].data.host.configuration.constructorNumber, -0));
  assert.equal(await runtime.spawned[0].exited, 0);
  assert.deepEqual([...runtime.spawned[0].resources], [1, 1, 0, 0], 'signed_zero_predecessor_disposed_before_open');
});

test('semantic parity review F2 renewal rejects a signed-zero policy change', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), options = runtime.config.projections[0].options;
  options.host.configuration.constructorNumber = 0;
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  await guard(runtime.tick(), 'positive-zero resident');
  const changed = { ...runtime.config, projections: [{ ...runtime.config.projections[0], options: {
    ...options, host: { ...options.host, configuration: { ...options.host.configuration, constructorNumber: -0 } } } }] };
  assert.throws(() => runtime.renew(changed), { code: 'read_in_progress' }, 'renewal_rejects_signed_zero_policy_change');
});

test('semantic parity renewal constructor identity follows shared buffers, not their bytes', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), options = runtime.config.projections[0].options;
  const buffer = new SharedArrayBuffer(4); options.host.configuration.constructorBuffer = buffer;
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  Atomics.store(new Int32Array(buffer), 0, 1);
  assert.equal(runtime.renew(runtime.config), pump, 'shared_buffer_mutation_keeps_identity');
  const replacement = new SharedArrayBuffer(4); Atomics.store(new Int32Array(replacement), 0, 1);
  const changed = { ...runtime.config, projections: [{ ...runtime.config.projections[0], options: {
    ...options, host: { ...options.host, configuration: { ...options.host.configuration, constructorBuffer: replacement } } } }] };
  assert.throws(() => runtime.renew(changed), { code: 'read_in_progress' }, 'renewal_rejects_changed_constructor_policy');
});

for (const kind of ['continuous', 'window gap', 'renewal gap', 'closed resident', 'spent quota'])
test(`semantic parity ${kind} renewal owns the correct resident epoch`, async t => {
  const s = await setup(t), runtime = pumpRuntime(s);
  if (kind === 'renewal gap') runtime.config.renewalMs = 1000;
  if (kind === 'spent quota') runtime.config.budgets.maxMs = 1500;
  const pump = runtime.renew(runtime.config); s.f.workspace.defer(() => pump.close());
  await guard(runtime.tick(), 'initial turn');
  if (kind === 'closed resident') await guard(runtime.opened[0].close(), 'already closed resident');
  const end = kind === 'renewal gap' ? testClock.now() + 1000 : runtime.config.window.endsAtMonoMs;
  await guard(s.advance(end - testClock.now() + (['continuous', 'spent quota'].includes(kind) ? 0 : 1)), 'renewal boundary');
  const next = kind === 'renewal gap' ? { ...runtime.config, renewalMs: 60000 } : nextWindow(runtime);
  const closes = s.control[14];
  assert.equal(runtime.renew(next), pump, 'renewal_keeps_pump_identity');
  assert.equal(s.control[14], closes, 'renewal_does_not_drain_before_reservation');
  assert.equal(runtime.spawned.length, 1, 'renewal_does_not_open_before_reservation');
  await guard(runtime.tick(), 'renewed turn');
  assert.equal(runtime.spawned.length, kind === 'continuous' ? 1 : 2, 'inactive_renewal_retires_resident');
  assert.equal(pump.getStatus().error, null, 'renewal_never_reuses_closed_handle');
  if (kind !== 'continuous') {
    assert.equal(await runtime.spawned[0].exited, 0);
    assert.deepEqual([...runtime.spawned[0].resources], [1, 1, 0, 0]);
  }
});

test('semantic parity spent items retire an idle resident while validation remains pending', async t => {
  const s = await setup(t), runtime = pumpRuntime(s);
  runtime.config.window.endsAtMonoMs = testClock.now() + 60000;
  const pump = await validationPending(s, runtime, 256); s.f.workspace.defer(() => pump.close());
  assert.equal(pump.getStatus().usedItems, 256); assert.equal(pump.getStatus().state, 'active');
  await s.advance(runtime.config.window.endsAtMonoMs - testClock.now(), { waitForWorkers: false });
  await guard(runtime.spawned[0].exited, 'native idle disposal');
  await runtime.opened[0].close();
  runtime.renew(nextWindow(runtime)); await guard(runtime.tick(), 'renewal during pending validation');
  assert.equal(runtime.spawned.length, 2, 'spent_items_retire_idle_resident_during_pending_validation');
  assert.equal(pump.getStatus().error, null);
  assert.deepEqual([...runtime.spawned[0].resources], [1, 1, 0, 0]);
});

test('semantic parity blocked retirement holds the writer until confirmed disposal', async t => {
  const s = await setup(t), runtime = pumpRuntime(s), pump = runtime.renew(runtime.config);
  s.f.workspace.defer(() => pump.close()); await guard(runtime.tick(), 'initial resident');
  await guard(s.advance(runtime.config.window.endsAtMonoMs - testClock.now() + 1), 'inactive boundary');
  const before = s.control[14]; Atomics.store(s.control, 13, 1); runtime.renew(nextWindow(runtime));
  let settled = false; const turn = runtime.tick().finally(() => { settled = true; });
  s.f.workspace.defer(() => turn); // Release the rendezvous before waiting for pump close.
  s.f.workspace.defer(() => { Atomics.store(s.control, 15, 1); Atomics.notify(s.control, 15); });
  await until(() => settled || s.control[14] > before, 'retirement close entry');
  assert.ok(s.control[14] > before, 'inactive_retirement_enters_host_close');
  assert.equal(settled, false); assert.equal(runtime.spawned.length, 1, 'blocked_close_prevents_replacement');
  assert.equal(runtime.reservations.at(-1).maxMs, 500, 'replacement_reserves_before_drain');
  assert.equal(pump.getStatus().usedMs, 500, 'retirement_turn_is_fully_reserved');
  const other = createContextReadSupervisor(); s.f.workspace.defer(() => other.close());
  for (const supervisor of [s.supervisor, other]) {
    const c = s.configure(supervisor, false);
    await assert.rejects(openContextIndexMaintainer(c.options), { code: 'read_in_progress' }, 'blocked_close_keeps_writer_exclusion');
  }
  Atomics.store(s.control, 15, 1); Atomics.notify(s.control, 15); await guard(turn, 'retirement completion');
  assert.equal(runtime.spawned.length, 2, 'confirmed_close_allows_replacement');
  assert.deepEqual([...runtime.spawned[0].resources], [1, 1, 0, 0]);
});

for (const [validationMs, quantumMs, remainder] of [[700, 500, 600], [500, 300, 350]])
test(`semantic parity review R2 invalidated validation parks ${validationMs}/${quantumMs}/${remainder}`, async t => {
  const s = await setup(t), runtime = pumpRuntime(s);
  runtime.config.firstCoverageValidation.maxMs = validationMs;
  runtime.config.quantum.maxMs = quantumMs; runtime.config.pollMs = 1;
  const pump = await validationPending(s, runtime); s.f.workspace.defer(() => pump.close());
  const core = openMemoryCore({ path: s.f.path });
  try {
    ok(core.admit({ namespace: ns, memory: { content: 'semantic validation canonical change', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'parking', eventId: randomUUID(), role: 'user', excerpt: 'semantic validation canonical change' }] }));
  } finally { core.close(); }
  const state = ok(await s.coordinator.getOwnerSemanticStatus({ ownerId: ns.ownerId }, s.token));
  ok(await s.coordinator.validateOwnerSemanticCoverage({ ownerId: ns.ownerId,
    expectedTargetDigest: state.firstCoverage.targetSetDigest, budget: { maxTargets: 1, maxMs: validationMs } }, s.token));
  await guard(runtime.tick(), 'observe invalidated receipt while validation fits');
  const observed = await semanticHandle(s.coordinator).pumpCall('firstCoverage');
  assert.equal(observed.pending, false, 'invalidated_receipt_clears_pending');
  assert.equal(observed.complete, false, 'invalidated_coverage_still_requires_validation');
  await s.advance(runtime.config.window.endsAtMonoMs - testClock.now() - remainder);
  const before = { reserves: runtime.reservations.length, controls: runtime.controlCalls.length,
    opens: runtime.spawned.length, dispatches: dispatchCount(runtime), validations: validationDispatches, status: pump.getStatus() };
  await guard(runtime.tick(), 'validation cannot fit');
  assert.equal(runtime.reservations.length, before.reserves, 'invalidated_validation_tail_has_no_reservation');
  assert.equal(runtime.nextDelay, remainder, 'invalidated_validation_preserves_parking');
  for (let n = 0; n < 2; n++) await guard(runtime.tick(), 'early callback during parked validation');
  assert.equal(runtime.controlCalls.length, before.controls, 'parked_validation_has_no_repeated_control_rpcs');
  assert.equal(runtime.reservations.length, before.reserves);
  assert.equal(runtime.spawned.length, before.opens); assert.equal(dispatchCount(runtime), before.dispatches);
  assert.equal(validationDispatches, before.validations); assert.deepEqual(pump.getStatus(), before.status);
  assert.equal(runtime.nextDelay, remainder);
  await s.advance(remainder); await runtime.tick();
  assert.equal((await pump.completion).state, 'budget_exhausted');
});

// Each gate delays a reply after real work has settled. The injected clock,
// not a wall-clock sleep, chooses stop/renewal and parent-deadline orderings.
function replyGate() {
  let enter,release;const entered=new Promise(r=>enter=r),reply=new Promise(r=>release=r);
  return {entered,reply,enter,release,async hold(){enter();await reply;}};
}
function gateControl(s,method,gate) {
  const client=semanticHandle(s.coordinator),call=client.pumpCall;let armed=true;
  client.pumpCall=async(name,...args)=>{const result=await call(name,...args);if(armed&&name===method){armed=false;await gate.hold();}return result;};
}
async function expectPending(promise,label) {
  let settled=false;void promise.then(()=>settled=true,()=>settled=true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,label);
}

for(const finishFails of [false,true])test(`semantic lifecycle opening completion owns blocked drain, finish failure ${finishFails}`,async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s,{openingDeadline:finishFails?100:undefined}),pump=runtime.renew(runtime.config);
  s.f.workspace.defer(()=>pump.close());Atomics.store(s.control,0,1);Atomics.store(s.control,13,1);
  const client=semanticHandle(s.coordinator),call=client.pumpCall;
  if(finishFails)client.pumpCall=(method,...args)=>method==='pumpFinish'?Promise.reject(Object.assign(new Error('private finish'),{code:'ledger_unavailable'})):call(method,...args);
  const closes=s.control[14],ticking=runtime.tick();await until(()=>s.control[1]===1,'blocked opening');
  await s.advance(finishFails?100:500,{waitForWorkers:false});release(s.control);
  await until(()=>s.control[14]>closes,'opening disposal started');
  try{await guard(ticking,'opening turn before disposal');await expectPending(pump.completion,'opening_completion_waits_for_disposal');}
  finally{Atomics.store(s.control,15,1);Atomics.notify(s.control,15);}
  assert.equal(runtime.spawned.length,1);
  const terminal=await guard(pump.completion,'opening completion');
  const readerRecord=[...supervisorOwner(s.supervisor).owner.records].find(r=>r.id===runtime.errors[0].cleanupId);
  assert.equal(readerRecord.state,'complete','opening_cleanup_complete_before_completion');
  assert.equal(readerRecord.leasesReleased,true);assert.equal(readerRecord.safety,false);
  assert.equal(terminal.error,finishFails?'reader_failed':'read_timeout');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'opening_initiating_cause_exists');assert.equal(diagnostic.lastFailure.engineCode,'read_timeout','opening_initiating_timeout_retained');
  if(finishFails)assert.equal(diagnostic.secondaryFailure.cause,'unmapped:ledger_unavailable');
  for(const supervisor of [s.supervisor,s.newSupervisor()]){
    const c=s.configure(supervisor,false),h=await openContextIndexMaintainer(c.options);await h.close();if(supervisor!==s.supervisor)await supervisor.close();
  }
});

for(const cause of ['reject','unproven'])test(`semantic lifecycle failed opening drain ${cause} has public precedence`,async t=>{
  const s=await setup(t,{isolated:true,expectedCleanupFailure:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);
  s.f.workspace.defer(()=>pump.close().catch(()=>{}));Atomics.store(s.control,0,1);Atomics.store(s.control,13,cause==='reject'?2:1);
  const closes=s.control[14],ticking=runtime.tick();await until(()=>s.control[1]===1,'opening rendezvous');await s.advance(500,{waitForWorkers:false});release(s.control);
  await until(()=>s.control[14]>closes,'close rendezvous');
  if(cause==='unproven')await s.advance(10000,{waitForWorkers:false});
  await ticking;const terminal=await guard(pump.completion,'failed opening completion');
  assert.equal(terminal.error,'reader_failed','failed_opening_drain_precedes_timeout');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.equal(diagnostic.lastFailure.engineCode,'read_timeout');assert.ok(diagnostic.secondaryFailure,'failed_drain_retains_secondary_cause');assert.equal(diagnostic.secondaryFailureCounts[cause==='reject'?'exception':'cleanup'],1,'cleanup_secondary_counted_once');
  const record=[...supervisorOwner(s.supervisor).owner.records].find(r=>r.id===runtime.errors[0].cleanupId);assert.equal(record.state,'failed');assert.equal(record.safety,true);
  const other=s.newSupervisor();s.f.workspace.defer(()=>other.close());
  for(const supervisor of [s.supervisor,other])await assert.rejects(openContextIndexMaintainer(s.configure(supervisor,false).options),{code:'reader_failed'},'failed_opening_keeps_quarantine');
});

for(const action of ['stop','renew','window'])for(const stage of ['open','status','firstCoverage','embeddingAdmission','pumpReserve','pumpFinish','refresh','validation','retirement'])test(`semantic lifecycle ${action} owns late ${stage}`,async t=>{
  const s=await setup(t,{isolated:true}),gate=replyGate(),hooks={},runtime=pumpRuntime(s,hooks);
  let pump,config=runtime.config;
  if(stage==='embeddingAdmission'||stage==='refresh'||stage==='retirement'){pump=runtime.renew(config);await runtime.tick();}
  else if(stage==='validation')pump=await validationPending(s,runtime);
  else pump=runtime.renew(runtime.config);
  s.f.workspace.defer(()=>pump.close());
  if(stage==='retirement'){await s.advance(config.window.endsAtMonoMs-testClock.now()+1);config=nextWindow(runtime);config.window.endsAtMonoMs=testClock.now()+2000;runtime.renew(config);Atomics.store(s.control,13,1);const release=gate.release;gate.release=()=>{release();Atomics.store(s.control,15,1);Atomics.notify(s.control,15);};}
  if(['open','status','refresh'].includes(stage))hooks[stage]=()=>gate.hold();
  else if(stage==='validation')validationReplyGate=gate;
  else if(stage!=='retirement')gateControl(s,stage,gate);
  const closes=s.control[14],ticking=runtime.tick();if(stage==='retirement'){await until(()=>s.control[14]>closes,'retirement close');gate.enter();}
  await guard(gate.entered,'late '+stage).catch(error=>{gate.release();validationReplyGate=undefined;throw error;});
  const workDispatches=()=>runtime.spawned.reduce((n,c)=>n+c.outbound.filter(m=>m.method!=='close').length,0);
  const before={reserves:runtime.reservations.length,dispatches:workDispatches(),controls:runtime.controlCalls.length};
  const openingRecord=stage==='open'?[...supervisorOwner(s.supervisor).owner.records].find(r=>r.resources===runtime.spawned[0].data.resources):undefined;
  const previousCompletion=pump.completion;
  let closing;if(action==='stop')closing=pump.close();else{if(action==='window'){const advancing=s.advance(config.window.endsAtMonoMs-testClock.now(),{waitForWorkers:false});config=nextWindow(runtime);runtime.renew(config);await advancing;}else runtime.renew(config);}
  try{if(stage==='open'&&action==='stop')await expectPending(pump.completion,'close_during_open_owns_late_handle');if(stage==='open'&&action==='window')await expectPending(previousCompletion,'previous_completion_owns_opening_across_window');}finally{gate.release();}
  await ticking;if(closing)await guard(closing,'close after '+stage);
  assert.equal(workDispatches(),before.dispatches,'retired_await_has_no_next_worker_dispatch');
  assert.equal(runtime.reservations.length,before.reserves,'retired_await_has_no_next_reservation');
  assert.equal(runtime.controlCalls.length,before.controls,'retired_await_has_no_next_control_rpc');
  if(stage==='open'){
    assert.equal(runtime.results.length,0,'late_open_never_refreshes');assert.equal(openingRecord.state,'complete','late_open_is_drained');
  }
  if(action==='window'){await previousCompletion;const current=pump.completion;assert.equal((await current).error,['firstCoverage','embeddingAdmission','pumpReserve','pumpFinish','validation'].includes(stage)?'timeout':'read_timeout','late_old_window_keeps_terminal_cutoff');assert.equal(pump.completion,current,'old_completion_cannot_replace_current_cycle');}
  if(action==='renew')assert.equal(pump.getStatus().error,null);if(action!=='stop')await pump.close();
});

const causeOrdinals=new Set();
for(const code of ['timeout','ledger_unavailable','provider_error','budget_denied','not_enabled','purge_pending','backfill_ceiling','price_unavailable','rate_limited','dimension_mismatch','provider_unavailable','storage_busy','synthetic_secret_code/unsafe'])test(`semantic lifecycle control failure maps ${code}`,async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());await runtime.tick();
  const client=semanticHandle(s.coordinator),call=client.pumpCall;
  client.pumpCall=(method,...args)=>method==='firstCoverage'?Promise.reject(Object.assign(new TypeError('private marker'),{code})):call(method,...args);
  await runtime.tick();const terminal=await pump.completion;
  assert.equal(terminal.error,['ledger_unavailable','synthetic_secret_code/unsafe'].includes(code)?'reader_failed':code,'control_failure_uses_existing_public_code');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'semantic_cause_snapshot_exists');
  assert.equal(Object.values(diagnostic.failureCounts).reduce((a,b)=>a+b,0),1,'control_failure_counted_once');
  assert.equal(diagnostic.lastFailure.stage,'call');assert.ok(Number.isSafeInteger(diagnostic.lastFailure.ordinal)&&diagnostic.lastFailure.ordinal>0,'control_cause_has_valid_ordinal');
  assert.equal(JSON.stringify(diagnostic).includes('private marker'),false);assert.equal(JSON.stringify(diagnostic).includes('synthetic_secret'),false);
  assert.ok(Object.isFrozen(diagnostic)&&Object.isFrozen(diagnostic.failureCounts));assert.equal(Object.hasOwn(terminal,'lastFailure'),false);
  assert.equal(causeOrdinals.has(diagnostic.lastFailure.ordinal),false,'cause_ordinals_are_process_unique');causeOrdinals.add(diagnostic.lastFailure.ordinal);
  assert.deepEqual(Object.keys(diagnostic).sort(),['failureCounts','lastFailure','secondaryFailure','secondaryFailureCounts']);
  assert.ok(Object.values(diagnostic.failureCounts).every(n=>Number.isSafeInteger(n)&&n>=0),'cause_counters_are_bounded');assert.ok(JSON.stringify(diagnostic).length<4096,'cause_snapshot_has_fixed_size');
  await pump.close();assert.deepEqual(maintenancePumpDiagnostic(pump.getStatus()),diagnostic,'repeated_cleanup_does_not_recount_causes');
});

test('semantic lifecycle idle cleanup preserves its initiating control failure',async t=>{
  const s=await setup(t,{isolated:true,expectedCleanupFailure:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close().catch(()=>{}));await runtime.tick();
  Atomics.store(s.control,13,2);const client=semanticHandle(s.coordinator),call=client.pumpCall;
  client.pumpCall=(method,...args)=>method==='firstCoverage'?Promise.reject(Object.assign(new Error('private control failure'),{code:'ledger_unavailable'})):call(method,...args);
  await runtime.tick();const terminal=await guard(pump.completion,'control plus cleanup failure');assert.equal(terminal.error,'reader_failed');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'control_cleanup_has_private_causes');
  assert.equal(diagnostic.lastFailure.cause,'unmapped:ledger_unavailable','cleanup_preserves_initiating_control_cause');assert.equal(diagnostic.lastFailure.stage,'call');
  assert.equal(diagnostic.secondaryFailure.stage,'close');
  assert.equal(diagnostic.failureCounts.unmapped,1);assert.equal(diagnostic.failureCounts.exception,0);assert.equal(diagnostic.secondaryFailureCounts.exception,1);
  await assert.rejects(pump.close());assert.deepEqual(maintenancePumpDiagnostic(pump.getStatus()),diagnostic,'cleanup_cause_is_not_recounted');
  const other=s.newSupervisor();s.f.workspace.defer(()=>other.close());for(const supervisor of [s.supervisor,other])await assert.rejects(openContextIndexMaintainer(s.configure(supervisor,false).options),{code:'reader_failed'});
});

test('semantic lifecycle distinct resident cleanup failures are counted separately',async t=>{
  const s=await setup(t,{isolated:true,expectedCleanupFailure:true}),other=fixture({after:fn=>retainedWorkspaces.push(fn)});other.admit('second resident');other.core.close();
  const runtime=pumpRuntime(s),projection=runtime.config.projections[0];projection.modes=['lexical'];
  runtime.config.projections.push({...projection,options:{...projection.options,path:other.path}});
  const pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close().catch(()=>{}));for(let n=0;n<3;n++)await runtime.tick();
  assert.equal(runtime.spawned.length,2,'two_independent_native_residents');Atomics.store(s.control,13,2);
  const client=semanticHandle(s.coordinator),call=client.pumpCall;client.pumpCall=(method,...args)=>method==='firstCoverage'?Promise.reject(Object.assign(new Error('private control'),{code:'ledger_unavailable'})):call(method,...args);
  await runtime.tick();const terminal=await guard(pump.completion,'two cleanup failures');assert.equal(terminal.error,'reader_failed');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'distinct_disposals_have_private_counts');
  assert.equal(diagnostic.lastFailure.cause,'unmapped:ledger_unavailable');assert.equal(diagnostic.secondaryFailureCounts.exception,2,'distinct_disposal_failures_count_each_resident');
  assert.equal(Object.hasOwn(diagnostic.secondaryFailure,'ordinal'),false,'idle_disposal_never_borrows_active_ordinal');
  await assert.rejects(pump.close());assert.deepEqual(maintenancePumpDiagnostic(pump.getStatus()),diagnostic);
});

test('semantic lifecycle an active timeout never lends its ordinal to idle residents',async t=>{
  const s=await setup(t,{isolated:true,expectedCleanupFailure:true}),other=fixture({after:fn=>retainedWorkspaces.push(fn)});other.admit('idle resident');other.core.close();
  const hooks={},runtime=pumpRuntime(s,hooks),projection=runtime.config.projections[0];projection.modes=['lexical'];runtime.config.projections.push({...projection,options:{...projection.options,path:other.path}});
  const pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close().catch(()=>{}));for(let n=0;n<3;n++)await runtime.tick();assert.equal(runtime.opened.length,2);
  const gate=replyGate();hooks.refresh=()=>gate.hold();const ticking=runtime.tick();await gate.entered;Atomics.store(s.control,13,2);
  try{await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();await ticking;}finally{gate.release();}
  const terminal=await guard(pump.completion,'active and idle cleanup');assert.equal(terminal.error,'reader_failed');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'active_timeout_has_private_cause');
  const idle=maintenanceReaderFailureDiagnostic(runtime.opened[0]),active=maintenanceReaderFailureDiagnostic(runtime.opened[1]);
  assert.equal(Object.hasOwn(idle.lastFailure,'ordinal'),false,'idle_resident_does_not_borrow_active_ordinal');
  assert.equal(active.lastFailure.ordinal,diagnostic.lastFailure.ordinal,'active_resident_joins_its_own_dispatch');assert.ok(Number.isSafeInteger(active.lastFailure.ordinal));
  assert.equal(diagnostic.secondaryFailureCounts.exception,2);
});

test('semantic lifecycle exhausted ordinal allocator omits the join',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());await runtime.tick();
  const client=semanticHandle(s.coordinator),call=client.pumpCall,state=globalThis[Symbol.for('context-read-product/maintenance-dispatch-ordinal')],previous=state.next;
  client.pumpCall=(method,...args)=>method==='firstCoverage'?Promise.reject(new TypeError('private failure')):call(method,...args);
  state.next=Number.MAX_SAFE_INTEGER;
  try{await runtime.tick();const terminal=await pump.completion;assert.equal(terminal.error,'reader_failed');const diagnostic=maintenancePumpDiagnostic(terminal);assert.ok(diagnostic,'exhausted_allocator_keeps_private_cause');assert.equal(Object.hasOwn(diagnostic.lastFailure,'ordinal'),false,'exhausted_allocator_never_invents_join');}
  finally{state.next=previous;}
});

for(const method of ['firstCoverage','pumpFinish'])test(`semantic lifecycle parent watchdog bounds delayed ${method} and ignores its late reply`,async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());await runtime.tick();
  const gate=replyGate();gateControl(s,method,gate);const ticking=runtime.tick();await gate.entered;
  const before={reservations:runtime.reservations.length,dispatches:dispatchCount(runtime)};
  let terminal;
  try{await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();await guard(ticking,'watchdog releases tick');terminal=await guard(pump.completion,'watchdog completion');}
  finally{gate.release();}assert.equal(terminal.error,'timeout','parent_watchdog_maps_control_timeout');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.equal(diagnostic.lastFailure.cause,'engine');assert.equal(diagnostic.lastFailure.engineCode,'timeout');assert.equal(diagnostic.lastFailure.stage,'call');
  gate.release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.reservations.length,before.reservations,'late_control_never_reserves');assert.equal(dispatchCount(runtime),before.dispatches+1,'late_control_never_refreshes');
  assert.equal(diagnostic.failureCounts.engine,1,'watchdog_cause_counted_once');
});


for(const validationMs of [700,300])test(`semantic round1 completed validation selects regular deadline ${validationMs}`,async t=>{
  const s=await setup(t,{isolated:true}),hooks={},runtime=pumpRuntime(s,hooks);
  runtime.config.firstCoverageValidation.maxMs=validationMs;runtime.config.pollMs=1;
  const pump=await validationPending(s,runtime);s.f.workspace.defer(()=>pump.close());
  const state=ok(await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token));
  ok(await s.coordinator.validateOwnerSemanticCoverage({ownerId:ns.ownerId,expectedTargetDigest:state.firstCoverage.targetSetDigest,budget:{maxTargets:64,maxMs:1000}},s.token));
  assert.equal((await semanticHandle(s.coordinator).pumpCall('firstCoverage')).complete,true,'external_validation_completed');
  const gate=replyGate();hooks.refresh=()=>gate.hold();const ticking=runtime.tick();await guard(gate.entered,'regular dispatch after validation');
  try{
    assert.equal(runtime.reservations.at(-1).maxMs,500,'regular_reservation_uses_quantum');
    assert.equal(runtime.results.at(-1).input.budget.maxMs,500,'regular_dispatch_uses_quantum_deadline');
    await s.advance(350,{waitForWorkers:false});runtime.fireWatchdog();
    assert.equal(pump.getStatus().error,null,'regular_turn_keeps_its_full_reserved_deadline');
    await s.advance(150,{waitForWorkers:false});runtime.fireWatchdog();await guard(ticking,'regular watchdog');
    assert.equal((await pump.completion).error,'read_timeout','regular_watchdog_expires_at_reserved_deadline');
  }finally{gate.release();await ticking;}
});

for(const code of ['storage_error','read_timeout'])test(`semantic round1 renewal retains observed terminal ${code}`,async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),gate=replyGate();
  const host=runtime.config.projections[0].options.host;
  host.moduleUrl=new URL('./fixtures/context-semantic-pump-failure-host.mjs',import.meta.url).href;
  host.configuration.failureCode=code;
  const client=semanticHandle(s.coordinator),call=client.pumpCall;let finishes=0;
  client.pumpCall=async(method,...args)=>{const result=await call(method,...args);if(method==='pumpFinish'&&++finishes===3)await gate.hold();return result;};
  const pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());
  const ticking=runtime.tick();await guard(gate.entered,'failed refresh before settlement');
  assert.equal(runtime.results.at(-1).result.error.code,code);const before=dispatchCount(runtime);
  runtime.renew(runtime.config);gate.release();await ticking;
  assert.equal(pump.getStatus().error,code,'observed_terminal_result_survives_accounting_interruption');
  await guard(pump.completion,'known failure completion');assert.equal(dispatchCount(runtime),before+1,'known_failure_dispatches_only_disposal');
  assert.equal(maintenancePumpDiagnostic(pump.getStatus()).lastFailure.engineCode,code);
});

test('semantic round1 renewal retains observed validation authority failure',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=await validationPending(s,runtime),gate=replyGate();
  s.f.workspace.defer(()=>pump.close());gateControl(s,'pumpFinish',gate);
  const state=new Int32Array(runtime.config.projections[0].options.host.configuration.state);Atomics.store(state,0,0);
  const ticking=runtime.tick();await guard(gate.entered,'failed validation before settlement');
  runtime.renew(runtime.config);Atomics.store(state,0,1);gate.release();await ticking;
  assert.equal(pump.getStatus().error,'authority_required','observed_validation_failure_survives_accounting_interruption');
  await guard(pump.completion,'validation failure completion');
});

// Passing control: a real accounting failure keeps its existing public mapping.
test('semantic round1 control validation accounting exception retains precedence',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=await validationPending(s,runtime),gate=replyGate();
  s.f.workspace.defer(()=>pump.close());const client=semanticHandle(s.coordinator),call=client.pumpCall;let armed=true;
  client.pumpCall=async(method,...args)=>{const result=await call(method,...args);if(method==='pumpFinish'&&armed){armed=false;await gate.hold();throw Object.assign(new Error('synthetic accounting failure'),{code:'ledger_unavailable'});}return result;};
  const state=new Int32Array(runtime.config.projections[0].options.host.configuration.state);Atomics.store(state,0,0);
  const ticking=runtime.tick();await guard(gate.entered,'failed validation accounting exception');Atomics.store(state,0,1);gate.release();await ticking;
  const terminal=await pump.completion;assert.equal(terminal.error,'reader_failed','accounting_exception_retains_normalized_public_code');
  const diagnostic=maintenancePumpDiagnostic(terminal);assert.equal(diagnostic.lastFailure.engineCode,'authority_required');assert.equal(diagnostic.secondaryFailure.cause,'unmapped:ledger_unavailable');
});

test('semantic round1 renewal evicts a confirmed predecessor across type policies',async t=>{
  const s=await setup(t,{isolated:true,targetTypes:[['memory'],['card']]}),runtime=pumpRuntime(s),p=runtime.config.projections[0];
  p.modes=['lexical'];runtime.config.projections.push({...p,types:['card']});
  const pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());
  const closes=s.control[14];Atomics.store(s.control,13,1);const ticking=runtime.tick();
  await until(()=>s.control[14]>closes,'predecessor close');runtime.renew(runtime.config);
  Atomics.store(s.control,15,1);Atomics.notify(s.control,15);await ticking;
  assert.deepEqual([...runtime.spawned[0].resources],[1,1,0,0],'predecessor_disposal_is_confirmed');
  await guard(runtime.tick(),'startup after continuous renewal');
  assert.equal(pump.getStatus().error,null,'confirmed_predecessor_is_not_reused_after_renewal');
  assert.ok(runtime.spawned.length>=3,'type_policy_startup_opens_replacements_after_eviction');
});

test('semantic round1 early watchdog rearms against its absolute deadline',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());await runtime.tick();
  const gate=replyGate();gateControl(s,'firstCoverage',gate);const ticking=runtime.tick();await gate.entered;
  try{
    await s.advance(499,{waitForWorkers:false});runtime.fireWatchdog();
    assert.equal(pump.getStatus().error,null,'early_watchdog_preserves_absolute_deadline');assert.equal(runtime.nextDelay,1,'early_watchdog_rearms_only_the_remainder');
    await s.advance(1,{waitForWorkers:false});runtime.fireWatchdog();await ticking;
    assert.equal((await pump.completion).error,'timeout','watchdog_terminates_at_unchanged_deadline');assert.equal(runtime.nextDelay,undefined,'watchdog_cleanup_clears_rearmed_timer');
  }finally{gate.release();await ticking;}
});

test('semantic round1 opening timeout joins the actual Worker ordinal',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());Atomics.store(s.control,0,1);
  const ticking=runtime.tick();await until(()=>s.control[1]===1,'opening ordinal barrier');const ordinal=runtime.spawned[0].data.maintenanceOrdinal;
  const advancing=s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();await advancing;release(s.control);await ticking;
  const terminal=await pump.completion;assert.equal(terminal.error,'read_timeout');
  assert.equal(maintenancePumpDiagnostic(terminal).lastFailure.ordinal,ordinal,'opening_watchdog_joins_actual_worker_ordinal');
});

test('semantic round1 shared-window refusal preserves budget_denied',async t=>{
  const s=await setup(t,{isolated:true}),a=pumpRuntime(s);a.config.projections[0].modes=['lexical'];a.config.quantum.maxMs=300;a.config.budgets.maxMs=2000;
  const first=a.renew(a.config);s.f.workspace.defer(()=>first.close());for(let n=0;n<4;n++)await a.tick();assert.equal(first.getStatus().usedMs,1800);
  const b=pumpRuntime(s);b.config.projections[0].modes=['lexical'];b.config.budgets.maxMs=2000;b.config.window={...a.config.window,usedItems:0,usedMs:0,usedUsd:'0'};
  const second=b.renew(b.config);s.f.workspace.defer(()=>second.close());await b.tick();const terminal=await second.completion;
  assert.equal(terminal.error,'budget_denied','shared_window_refusal_retains_public_code');assert.equal(b.spawned.length,0);
  assert.equal(maintenancePumpDiagnostic(terminal).lastFailure.engineCode,'budget_denied','preserved_control_failure_keeps_sanitized_cause');
});


function assertTimeoutDisposal(s,runtime,terminal,pendingReserve=false) {
  assert.equal(runtime.reservations.every(r=>r.maxMs===500),true,'timeout_reserves_full_quantum');
  const chargedMs=runtime.reservations.length*500,chargedItems=runtime.reservations.reduce((n,r)=>n+r.maxItems,0);
  const ledger=new DatabaseSync(s.ledgerPath,{readOnly:true});try{
    const stored=JSON.parse(ledger.prepare('SELECT state FROM semantic_owners').get().state).windows[terminal.windowId];
    assert.equal(stored.usedMs,chargedMs,'timeout_keeps_all_time_reservations');assert.equal(stored.usedItems,chargedItems,'timeout_keeps_all_item_reservations');
  }finally{ledger.close();}
  assert.equal(terminal.usedMs,chargedMs-(pendingReserve?500:0),'unreceived_reserve_does_not_rewrite_local_time_snapshot');
  assert.equal(terminal.usedItems,chargedItems-(pendingReserve?runtime.reservations.at(-1).maxItems:0),'unreceived_reserve_does_not_rewrite_local_item_snapshot');
  for(const opened of runtime.opened){const diagnostic=maintenanceReaderFailureDiagnostic(opened);assert.equal(diagnostic.lastFailure.engineCode,'read_timeout','timeout_disposal_reason_stays_read_timeout');}
  for(const capture of runtime.spawned){
    const record=s.supervisor.getCleanupStatus(capture.cleanupId);
    assert.equal(record.state,'complete','timeout_has_confirmed_disposal');for(const bit of bits)assert.equal(record[bit],true,bit);
    assert.deepEqual([...capture.resources],[1,1,0,0]);
  }
}

for(const kind of ['reply','watchdog'])test(`semantic round2 native accounting ${kind} retains distinct engine causes`,async t=>{
  const s=await setup(t,{isolated:true,coordinatorHost:new URL('./fixtures/context-semantic-pump-accounting-host.mjs',import.meta.url).href});
  const runtime=pumpRuntime(s),host=runtime.config.projections[0].options.host;
  host.moduleUrl=new URL('./fixtures/context-semantic-pump-failure-host.mjs',import.meta.url).href;host.configuration.failureCode='storage_error';
  const state=new Int32Array(host.configuration.state),client=semanticHandle(s.coordinator),call=client.pumpCall,gate=replyGate();let finishes=0;
  client.pumpCall=async(method,...args)=>{if(method==='pumpFinish'&&++finishes===3){if(kind==='reply')Atomics.store(state,3,1);else await gate.hold();}return call(method,...args);};
  const pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());const ticking=runtime.tick();
  try{
    if(kind==='watchdog'){await gate.entered;await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();}
    await ticking;const terminal=await guard(pump.completion,'accounting timeout completion'),diagnostic=maintenancePumpDiagnostic(terminal);
    assert.ok(diagnostic.secondaryFailure,'distinct_engine_accounting_cause_is_retained');
    assert.equal(diagnostic.lastFailure.engineCode,'storage_error');assert.equal(diagnostic.lastFailure.stage,'refresh');
    assert.equal(diagnostic.secondaryFailure.engineCode,'timeout');assert.equal(diagnostic.secondaryFailure.stage,'call');
    assert.equal(diagnostic.failureCounts.engine,1);assert.equal(diagnostic.secondaryFailureCounts.engine,1,'same_family_failures_count_independently');
    assert.equal(terminal.error,'timeout','accounting_timeout_keeps_coordinator_code');
    const ledger=new DatabaseSync(s.ledgerPath,{readOnly:true});try{
      const stored=JSON.parse(ledger.prepare('SELECT state FROM semantic_owners').get().state);
      assert.equal(Object.values(stored.windows).flatMap(w=>Object.values(w.quanta)).filter(q=>q.status==='reserved').length,1,'unknown_accounting_keeps_reservation');
    }finally{ledger.close();}
    assertTimeoutDisposal(s,runtime,terminal);await pump.close();
    assert.deepEqual(maintenancePumpDiagnostic(pump.getStatus()),diagnostic,'propagated_accounting_error_is_not_recounted');
  }finally{gate.release();await ticking;}
});

for(const method of ['firstCoverage','pumpReserve','pumpFinish','embeddingAdmission','validation'])test(`semantic round2 coordinator watchdog ${method} preserves disposal`,async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),gate=replyGate();
  const pump=method==='validation'?await validationPending(s,runtime):runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());
  if(method!=='validation')await runtime.tick();
  if(method==='validation')validationReplyGate=gate;else gateControl(s,method,gate);
  const ticking=runtime.tick();await guard(gate.entered,'coordinator stage barrier');
  try{
    await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();await ticking;const terminal=await pump.completion;
    assert.equal(terminal.error,'timeout','coordinator_watchdog_keeps_timeout_code');
    const diagnostic=maintenancePumpDiagnostic(terminal);assert.equal(diagnostic.lastFailure.engineCode,'timeout');assert.equal(diagnostic.lastFailure.stage,'call');
    assertTimeoutDisposal(s,runtime,terminal,method==='pumpReserve');
  }finally{gate.release();validationReplyGate=undefined;await ticking;}
});

// Passing controls: reader-stage cutoffs keep main's read_timeout semantics.
for(const method of ['open','status','refresh'])test(`semantic round2 reader watchdog ${method} preserves read_timeout`,async t=>{
  const s=await setup(t,{isolated:true}),hooks={},runtime=pumpRuntime(s,hooks),gate=replyGate(),pump=runtime.renew(runtime.config);s.f.workspace.defer(()=>pump.close());
  if(method==='refresh')await runtime.tick();hooks[method]=()=>gate.hold();const ticking=runtime.tick();await gate.entered;
  try{
    await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();gate.release();await ticking;const terminal=await pump.completion;
    assert.equal(terminal.error,'read_timeout','reader_watchdog_keeps_reader_cutoff_code');
    const diagnostic=maintenancePumpDiagnostic(terminal);assert.equal(diagnostic.lastFailure.engineCode,'read_timeout');assert.equal(diagnostic.lastFailure.stage,method==='status'?'call':method==='open'?'open':'refresh');
    assertTimeoutDisposal(s,runtime,terminal);
  }finally{gate.release();await ticking;}
});

// Fractional work before validation lets its own API timer win by 0.5 ms.
for(const settlement of ['close','release','watchdog'])test(`semantic round3 validation own deadline ${settlement}`,async t=>{
  const s=await setup(t,{isolated:true,coordinatorHost:new URL('./fixtures/context-semantic-pump-accounting-host.mjs',import.meta.url).href}),runtime=pumpRuntime(s);
  const pump=await validationPending(s,runtime);s.f.workspace.defer(()=>pump.close());
  const state=new Int32Array(runtime.config.projections[0].options.host.configuration.state),client=semanticHandle(s.coordinator),call=client.pumpCall;
  let armed=true,entered;const accounting=new Promise(resolve=>entered=resolve);
  client.pumpCall=async(method,...args)=>{
    if(method==='pumpFinish')entered();
    const result=await call(method,...args);
    if(method==='pumpReserve'&&armed){armed=false;await testClock.advance(0.5,{waitForWorkers:false});}
    return result;
  };
  const post=Worker.prototype.postMessage,start=testClock.now(),chargedUsd=pump.getStatus().usedUsd;let cutoff;
  Worker.prototype.postMessage=function(message,...args){
    if(message.kind==='call'&&message.method==='validateOwnerSemanticCoverage'){
      cutoff=Number(BigInt(message.operation.operationCutoffMonoNs))/1e6;Atomics.store(state,3,2);
    }
    return Reflect.apply(post,this,[message,...args]);
  };
  const ticking=runtime.tick();
  try{
    await until(()=>Atomics.load(state,10)===1,'validation authority blocked');
    assert.equal(cutoff,start+499.5,'validation_API_deadline_precedes_turn_deadline');
    if(settlement==='watchdog'){
      await testClock.advance(499.5,{waitForWorkers:false});runtime.fireWatchdog();
    }else{
      await testClock.advance(499,{waitForWorkers:false});await guard(accounting,'API timeout starts accounting');
      assert.ok(testClock.now()<start+500,'validation_settles_before_parent_deadline');
      if(settlement==='close')await guard(pump.close(),'close during accounting');
      else{Atomics.store(state,11,1);Atomics.notify(state,11);}
    }
    await guard(ticking,'validation turn settles');const terminal=await guard(pump.completion,'validation timeout completion');
    assert.equal(terminal.error,'timeout','validation_coordinator_deadline_keeps_timeout');
    const diagnostic=maintenancePumpDiagnostic(terminal);
    assert.equal(diagnostic.lastFailure.engineCode,settlement==='watchdog'?'timeout':'read_timeout','private_cause_distinguishes_API_deadline_from_watchdog');
    assert.equal(diagnostic.lastFailure.stage,'call');assert.ok(Number.isSafeInteger(diagnostic.lastFailure.ordinal));
    assert.equal(diagnostic.failureCounts.engine,1);assert.equal(diagnostic.secondaryFailureCounts.engine,0,'validation_timeout_is_not_recounted');
    assertTimeoutDisposal(s,runtime,terminal);assert.equal(terminal.usedUsd,chargedUsd,'zero_USD_validation_keeps_prior_charges');
    if(settlement==='close'){
      const retry=s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId,deadlineMs:1},s.token);
      await testClock.advance(1,{waitForWorkers:false});assert.equal((await retry).error.code,'read_timeout','pump_close_does_not_unblock_coordinator');
    }
  }finally{
    Worker.prototype.postMessage=post;Atomics.store(state,11,1);Atomics.notify(state,11);
    await testClock.advance(2+Math.ceil(testClock.now())-testClock.now(),{waitForWorkers:false});await ticking;
  }
});

test('semantic round3 opening cutoff counts one reconstructed failure',async t=>{
  const s=await setup(t,{isolated:true}),runtime=pumpRuntime(s),pump=runtime.renew(runtime.config);
  s.f.workspace.defer(()=>pump.close());Atomics.store(s.control,0,1);
  const ticking=runtime.tick();await until(()=>s.control[1]===1,'opening barrier');
  try{
    await s.advance(500,{waitForWorkers:false});runtime.fireWatchdog();release(s.control);await ticking;
    const terminal=await guard(pump.completion,'opening cutoff cleanup'),diagnostic=maintenancePumpDiagnostic(terminal);
    assert.equal(terminal.error,'read_timeout');assert.equal(diagnostic.failureCounts.engine,1);
    assert.equal(diagnostic.secondaryFailureCounts.engine,0,'opening_cutoff_reconstructed_record_counts_once');
    assert.equal(diagnostic.secondaryFailure,null,'opening_cutoff_has_only_primary_cause');
    assert.equal(diagnostic.lastFailure.stage,'open');assert.equal(diagnostic.lastFailure.ordinal,runtime.spawned[0].data.maintenanceOrdinal);
    assertTimeoutDisposal(s,runtime,terminal);await pump.close();
    assert.deepEqual(maintenancePumpDiagnostic(pump.getStatus()),diagnostic,'opening_propagation_never_recounts');
  }finally{release(s.control);await ticking;}
});

// Last: the deliberately failed proof retains process-wide inode quarantine.
test('semantic parity rejected retirement keeps reader_failed and quarantine', async t => {
  const s = await setup(t, { expectedCleanupFailure: true }), runtime = pumpRuntime(s), pump = runtime.renew(runtime.config);
  s.f.workspace.defer(() => pump.close().catch(() => {})); await guard(runtime.tick(), 'initial resident');
  await guard(s.advance(runtime.config.window.endsAtMonoMs - testClock.now() + 1), 'inactive boundary');
  Atomics.store(s.control, 13, 2); runtime.renew(nextWindow(runtime)); await guard(runtime.tick(), 'rejected retirement');
  assert.equal(pump.getStatus().error, 'reader_failed', 'rejected_retirement_is_reader_failed');
  const terminal = await guard(pump.completion, 'failed retirement completion');
  assert.equal(terminal.error, 'reader_failed');
  assert.equal(terminal.usedItems, 1); assert.equal(terminal.usedMs, 500, 'failed_retirement_keeps_full_reservation');
  assert.equal(runtime.spawned.length, 1, 'failed_disposal_never_opens_replacement');
  const record = [...supervisorOwner(s.supervisor).owner.records].find(r => r.resources === runtime.spawned[0].data.resources);
  assert.equal(record.state, 'failed'); assert.equal(record.safety, true);
  assert.equal(await runtime.spawned[0].exited, 1, 'rejected_host_close_exits_worker');
  assert.equal(record.leasesReleased, false); assert.equal(record.providersSettled, true);
  const other = createContextReadSupervisor(); s.f.workspace.defer(() => other.close());
  for (const supervisor of [s.supervisor, other]) {
    const c = s.configure(supervisor, false);
    await assert.rejects(openContextIndexMaintainer(c.options), { code: 'reader_failed' }, 'rejected_retirement_keeps_quarantine');
  }
});
