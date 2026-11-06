import { openContextProductFacade } from '../../context-read-facade.mjs';
import { productSidecar } from '../../context-product-sidecar.mjs';
import { productVectors } from '../../context-product-vectors.mjs';
import { accessDigest, digest } from '../../context-product-validation.mjs';
import { semanticClient } from '../../context-semantic-client.mjs';
// Import first: all real native Workers share the injected operation clock.
import { testClock } from '../../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as realDelay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok } from '../../testing/context-read-fixture.mjs';
import { createExclusiveSqliteFile } from '../../sqlite-journal-probe.mjs';
import { openSemanticLedger, provisionSemanticOwner, stateBytes, stateDigest } from '../../context-semantic-ledger.mjs';
import { canonicalJson } from '../../context-product-validation.mjs';
import { dollars } from '../../context-semantic-input.mjs';
import { createProductSqlitePolicy } from '../../context-product-sqlite.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../../context-product-control.mjs';
import { createProductReaderRuntime, maintenanceReaderFailureDiagnostic, maintenanceFailureDiagnostic } from '../../context-product-reader.mjs';
import { createMaintenancePumpRuntime, maintenancePumpDiagnostic } from '../../context-product-pump.mjs';
import { semanticHandle } from '../../context-semantic-coordinator.mjs';
import { supervisorOwner, createSupervisorRegistry } from '../../context-read-supervisor.mjs';
import { createContextReadSupervisor, openContextSemanticCoordinator,
  openContextIndexMaintainer, openMemoryCore } from '../../index.mjs';

const hostUrl = new URL('./context-semantic-pump-cutoff-host.mjs', import.meta.url).href;
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

async function setup(t, { expectedCleanupFailure = false, isolated = false, targetTypes = [['memory']], coordinatorHost = hostUrl, coordinatorConfiguration = {}, safety=false, maxBatchDocuments=64 } = {}) {
  // Same accounting identity as the existing offline semantic tests. A closed
  // fixture's inode binding must not be mistaken for the next fresh ledger.
  assert.equal(globalThis[Symbol.for('context-read-product-p2e-v1/coordinators')]?.size ?? 0, 0);
  globalThis[Symbol.for('context-read-product-p2e-v1/physical-policy')]?.clear();
  // Failed writer proofs intentionally live for the process lifetime. Retain
  // their files until file teardown so inode reuse cannot poison later fixtures.
  const f = fixture(isolated&&expectedCleanupFailure?{after:fn=>retainedWorkspaces.push(fn)}:t,
    {cards:targetTypes.some(types=>types.includes('card')),coreOptions:safety?{contentSafety:'s2h-v1'}:{}});
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
      normalization: 'l2', requestTimeoutMs: 3000, maxBatchDocuments },
    refreshCaps: { steady: { maxItemsPerUtcDay: 2000, maxUsdPerUtcDay: '0.05' },
      backfill: { maxItemsPerUtcDay: 20000, maxUsdPerUtcDay: '0.50', maxUsdTotal: '5' } },
    backfillTargets: targetTypes.map(types => ({ canonicalPath: f.path, readSet: [ns], types, intents: ['current', 'history'] })),
    priceTable, host: { moduleUrl: coordinatorHost, configuration: {
      semanticServiceBinding: binding, anchorPath, state, priceTable, utcClock, cutoffControl,...coordinatorConfiguration,
    } },
  }), 'coordinator open');
  f.workspace.defer(() => guard(coordinator.close(), 'coordinator close').catch(error=>{if(!expectedCleanupFailure)throw error;assert.equal(error.code,'reader_failed');}));
  if(isolated&&expectedCleanupFailure)t.after(async()=>{await guard(coordinator.close(),'isolated coordinator close').catch(error=>assert.equal(error.code,'reader_failed'));await supervisor.close().catch(error=>assert.equal(error.code,'reader_failed'));});
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
  return { f, state, supervisor, coordinator, coordinatorResources, token, control, configure, advance, ledgerPath, leaseTiming, newSupervisor:()=>registry?registry.supervisor():createContextReadSupervisor() };
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
    const worker = new Worker(new URL('../../context-product-worker.mjs', import.meta.url), {
      workerData: data, transferList: [data.semanticPort], env: {}, execArgv: [], stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    const cleanupId=[...supervisorOwner(s.supervisor).owner.records].find(record=>record.resources===data.resources)?.id;
    const capture = { worker, data, cleanupId, outbound: [], inbound: [], resources: new Int32Array(data.resources), errors: [], stderr: '' };
    let exited;
    capture.exited = new Promise(resolve => { exited = resolve; });
    worker.on('message', message => capture.inbound.push(message));
    worker.on('error', error => capture.errors.push({ message: error.message, code: error.code, stack: error.stack }));
    worker.once('exit', code => { capture.exitCode = code; exited(code); });
    worker.stderr.on('data', data => { capture.stderr = (capture.stderr + data).slice(-8192); });
    spawned.push(capture);
    const post = worker.postMessage.bind(worker);
    worker.postMessage = (message, ...args) => { capture.outbound.push(message); return post(message, ...args); };
    return worker;
  } });
  const runtimeRenew = createMaintenancePumpRuntime({ ...hooks.dispatch, now: testClock.now,
    setTimer(fn, ms) { const id = ++next; timers.set(id, { fn, ms, at:testClock.now()+ms }); return id; },
    clearTimer: id => timers.delete(id),
    async open(options, control) {
      try {
        const h = await nativeOpen(hooks.openingDeadline?{...options,deadlineMs:hooks.openingDeadline}:options, control); opened.push(h);
        if(hooks.open)await hooks.open(h);
        if(hooks.wrap)return hooks.wrap(h);
        if(hooks.native)return h;
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
  let pump,renewedEnd,activeWindowEnd,renewals=0;
  const renew=value=>{renewals++;renewedEnd=testClock.now()+value.renewalMs;activeWindowEnd=value.window.endsAtMonoMs;return pump=runtimeRenew(value);};
  // A step is one actual scheduled turn. Legacy disposal/accounting probes use
  // tick() to reach the next regular/validation operation across startup turns.
  // Every step advances the shared native clock to its scheduled admission.
  async function step({early=false}={}) {
    assert.equal(timers.size,1,'exactly one pump tick is scheduled');
    const [id,{fn,at}]=timers.entries().next().value;timers.delete(id);
    if(!early&&at<Math.min(activeWindowEnd,renewedEnd)&&at>testClock.now())await s.advance(Math.ceil(at-testClock.now()));
    return fn();
  }
  return { renew, config, spawned, results, opened, errors, reservations, controlCalls, step, fireWatchdog(){const entry=[...timers].at(-1);assert.ok(entry,'parent_watchdog_is_armed');timers.delete(entry[0]);return entry[1].fn();},
    get nextDelay() { const timer=timers.values().next().value;return timer?Math.max(0,timer.at-testClock.now()):undefined; }, async tick() {
      for(let n=0;n<8;n++){
        const before={results:results.length,validations:validationDispatches,controls:controlCalls.length,renewals};
        await step();
        if(renewals!==before.renewals||pump.getStatus().state!=='active'||results.length>before.results||validationDispatches>before.validations||controlCalls.slice(before.controls).includes('embeddingAdmission')||controlCalls.length===before.controls)return;
      }
      throw Error('native scheduler cursor did not reach work');
    }
  };
}

export { setup, pumpRuntime, guard, until, release, ns, ok, testClock };

async function nativeClient(t,s,m) {
 const sqlite=createProductSqlitePolicy();sqlite.start(Number(process.hrtime.bigint())/1e6+30000);
 const facade=openContextProductFacade(s.f.path,{sqlite});t.after(()=>facade.close());
 const storage=productSidecar({path:s.f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,sqlite});t.after(()=>storage.close());
 const handle=semanticHandle(s.coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:false});
 let operation;const client=semanticClient(port,{ownerState:handle.ownerState,writer:'0'},()=>operation);t.after(()=>client.close());
 function bind(epoch){operation={operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)};client.bindContentFence({ownerId:ns.ownerId,canonicalPath:s.f.path,storeId:s.f.storeId,readSet:[ns],suppressionEpoch:epoch});}
 bind('0:0');const snapshot=await client.snapshot(),p={...input,ownerCoverage:m.options.ownerCoverage};
 const observed=facade.port.read(()=>storage.observe(p,accessDigest(m.options.host.configuration.serviceBinding)));
 const vector=productVectors({storage,facade}).observe(p,observed.publication,snapshot);
 assert.equal(vector.status,'complete','control: native vector publication ready');
 const projection={...input,accessDigest:observed.publication.accessDigest,lexicalValidationDigest:digest(observed.publication),vectorValidationDigest:digest(vector.record),suppressionEpoch:'0:0'};
 return {client,bind,snapshot,projection,close(){client.close();storage.close();facade.close();}};
}

export { nativeClient };
