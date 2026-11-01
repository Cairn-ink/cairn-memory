import { setTimeout as safetyDelay } from 'node:timers/promises';
import { hrtime } from 'node:process';
import { maintenanceFailureCounts, maintenanceFailureRecord, maintenanceFailureKind, readMaintenanceFailure, maintenanceErrorName } from './context-product-attribution.mjs';
import { maintenanceMarker, readMaintenanceMarker, prepareMaintenanceMarker, claimMaintenanceOrdinal, maintenanceControlState, bindMaintenanceControl, serializationDiagnostic, attributionFields, maintenanceWorkFields } from './context-product-attribution.mjs';
import { memoryComparisonQualified, verificationBatchingQualified, verificationBatchControl, attachMaintenanceComparison } from './context-product-attribution.mjs';
import { types } from 'node:util';
import { randomUUID } from 'node:crypto';
import { serviceIssuance, claimMaintenanceWriter } from './context-product-service.mjs';
import { addAbortListener } from 'node:events';
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { ownData } from './local-authority-input.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { createReaderWorkerLifecycle } from './reader-worker-lifecycle.mjs';
import { supervisorOwner } from './context-read-supervisor.mjs';
import { nativeTelemetry } from './context-product-telemetry.mjs';
import { PRODUCT_PROFILE, boundedData, hostConfiguration, requestRecord, operationRecord, issuance, coverage,
  credentialDigest, deadline, mono, operationMessage } from './context-product-control.mjs';
import { fail } from './validation.mjs';
import { semanticConfiguration } from './context-semantic-coordinator.mjs';
import { openDiagnosticBuffer, openDiagnosticClock, openDiagnosticSnapshot } from './context-product-open-diagnostic.mjs';

const DISPOSAL_GRACE_MS = 10_000;

// Engine-internal only. A patch is added only after native and quiet-window
// qualification. Neither public configuration nor environment can enable this.
const qualifiedRuntimePatches = new Set();
export const maintenanceCutoffQualified = () => qualifiedRuntimePatches.has(process.versions.node);
const capabilities = new WeakMap(), diagnostics = new WeakMap(), disposals = new WeakMap();
// Private pump-to-reader cleanup cause; no caller option or handle property.
export const disposeProductReader = (handle, code, cutoffAt, failure) => {
  const dispose = disposals.get(handle.close);
  return dispose ? dispose(code, cutoffAt, failure) : handle.close();
};
export const maintenancePumpCutoffDiagnostic = observation => diagnostics.get(observation);
export const snapshotMaintenanceCutoff = (observation, value) => {
  if (value) diagnostics.set(observation, Object.freeze({ ...value }));
};
export function authorizeMaintenanceCutoff(control, identity) {
  if (!Number.isSafeInteger(identity.ordinal) || identity.ordinal < 1) return undefined;
  const capability = { ...identity, attested: false };
  capability.tighten = earlier => {
    if (earlier >= capability.cutoffAt) return;
    capability.cutoffAt = Math.min(capability.cutoffAt, earlier);
    capability.rescheduleProof?.();
  };
  capabilities.set(control, capability);
  return capability;
}
// Only a control issued by the owned pump can acquire this private bridge.
function bindMaintenanceCutoff(control, ordinal, operation, resource, record, lifecycle, expire, released) {
  const capability = capabilities.get(control);
  if (!capability || capability.ordinal !== ordinal || capability.operation) return undefined;
  capability.operation = operation;
  capability.expire = expire;
  capability.proof = async () => {
    await lifecycle.termination;
    const records = await Promise.all([resource.delivery, record.delivery]);
    if (!released() || records.some(r => r.state !== 'complete' ||
      !['workerStopped','nativeDisposed','leasesReleased','providersSettled'].every(k => r[k] === true))) {
      throw Object.assign(Error('reader_failed'), { code: 'reader_failed' });
    }
    return records;
  };
  return capability;
}

// Private Worker timing, kept outside the public result DTO. Pump and reader
// share the process hrtime domain; only timings and fixed work counts are kept.
const maintenanceObservations = new WeakMap(), maintenancePhases = new WeakMap(), maintenanceMarkers = new WeakMap(), maintenanceStalls = new WeakMap();
export const maintenanceStallDiagnostic = (value, atMs) => maintenanceStalls.get(value) ?? readMaintenanceMarker(maintenanceMarkers.get(value)??maintenanceControlState(value)?.buffer, atMs===undefined?undefined:BigInt(Math.floor(atMs*1e6)));
export const maintenancePhaseDiagnostic = result => maintenancePhases.get(result);
export const maintenanceObservation = result => maintenanceObservations.get(result);
const maintenanceFailures=new WeakMap(),maintenanceReaderFailures=new WeakMap();
export const maintenanceFailureDiagnostic=value=>maintenanceFailures.get(value)??maintenanceReaderFailures.get(value)?.lastFailure;
export const maintenanceReaderFailureDiagnostic=value=>{const state=maintenanceReaderFailures.get(value);return state?Object.freeze({lastFailure:state.lastFailure,failureCounts:Object.freeze({...state.failureCounts}),secondaryFailure:state.secondaryFailure,secondaryFailureCounts:Object.freeze({...state.secondaryFailureCounts})}):undefined;};
const openPhases = new WeakMap(), registryHolds = new WeakMap();
// Fixed parent-side statistics, internal only like the other reader accessors.
export const readerRegistryHoldDiagnostic = value => registryHolds.get(value);
// Internal accessor only; never a property of a public handle or result DTO.
export const productOpenPhaseDiagnostic = reader => {
  const buffer = openPhases.get(reader);
  return buffer ? openDiagnosticSnapshot(buffer) : undefined;
};

const codes = new Set(['invalid_input', 'invalid_read_set', 'authority_required', 'scope_changed', 'invalid_snapshot', 'snapshot_stale', 'invalid_cursor', 'cursor_stale', 'token_count_unavailable',
  'revision_conflict', 'evidence_unavailable', 'context_item_too_large', 'index_unavailable', 'storage_busy', 'storage_error',
  'read_timeout', 'read_cancelled', 'read_in_progress', 'reader_failed', 'store_closed', 'invalid_path', 'database_not_found', 'unsafe_database_file', 'unsupported_database']);
export const productFailure = code => ({ ok: false, error: { code: codes.has(code) ? code : 'reader_failed', retryable: code === 'storage_busy' } });
const coded = (code, cleanupId) => Object.assign(Error(codes.has(code) ? code : 'reader_failed'), { code: codes.has(code) ? code : 'reader_failed', ...(cleanupId ? { cleanupId } : {}) });
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
// Validate entry descriptors before invoking native signal machinery. Native
// timeout/composite signals and their sources may carry extra data properties.
const signalPrototype = AbortSignal.prototype;
const sharedLength = Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, 'byteLength').get;
export function signalAborted(signal) {
  if (signal === undefined) return false;
  if (!signal || typeof signal !== 'object' || types.isProxy(signal) ||
      Object.getPrototypeOf(signal) !== signalPrototype) fail('invalid_input');
  if (Reflect.ownKeys(signal).some(key =>
      !Object.hasOwn(Object.getOwnPropertyDescriptor(signal, key), 'value'))) fail('invalid_input');
  try { return Reflect.apply(aborted, signal, []); } catch { fail('invalid_input'); }
}
// After registration the shape may change legitimately (for example any()).
// An unreadable state discards this result without invalidating the reader.
export function signalCancelled(signal) {
  if (signal === undefined) return false;
  try { return Reflect.apply(aborted, signal, []); } catch { return true; }
}
const nativeWorker = data => new Worker(new URL('./context-product-worker.mjs', import.meta.url), {
  workerData: data, env: {}, execArgv: [], stdout: true, stderr: true,
  ...(data.semanticPort ? {transferList:[data.semanticPort]} : {}),
  // Lexical-only P2a has no vector cache or counter runtime. Reserve 192 MiB
  // rather than inheriting the topic reader's 64 MiB limit.
  resourceLimits: { maxOldGenerationSizeMb: 192 },
});
export function createProductReaderRuntime({ now = () => process.hrtime.bigint(), utc = () => Date.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, spawnWorker = nativeWorker, maintenance = false,
  comparisonQualified = memoryComparisonQualified, verificationQualified = verificationBatchingQualified } = {}) {
  return async function openContextProductReader(original, controls = {}) {
    // These samples precede even option reflection/validation.
    const admitted = now(), admissionUtc = utc();
    const options = ownData(original, ['supervisor', 'path', 'version', 'profile', 'readSet', 'ownerCoverage', 'requestControl', 'host', 'diagnostics', 'deadlineMs', 'wal', 'semanticConfig', ...(maintenance ? ['sidecarJournalMode'] : [])]);
    const semantic=options.semanticConfig===undefined?null:semanticConfiguration(options.semanticConfig,{maintenance,requestMaxMs:maintenance?5000:ownData(options.requestControl,['requestId','handleId','credentialBindingId','credentialExpiresUtcMs','requestMaxMs']).requestMaxMs});
    const releaseSemanticWriter=()=>{if(semantic){const state=new BigInt64Array(semantic.configuration.ownerState);if(Atomics.compareExchange(state,5,BigInt(semantic.configuration.writer),0n)===BigInt(semantic.configuration.writer))Atomics.notify(state,5);}};
    const { signal } = ownData(controls, ['signal']);
    signalAborted(signal);
    if (options.version !== 'context-read-v1' || options.profile !== PRODUCT_PROFILE ||
        options.diagnostics !== undefined && typeof options.diagnostics !== 'boolean' ||
        options.wal !== undefined && typeof options.wal !== 'boolean') fail('invalid_input');
    if (typeof options.path !== 'string' || !isAbsolute(options.path) || options.path.includes('\0')) fail('invalid_path');
    const owner = supervisorOwner(options.supervisor), { registry } = owner;
    let readSet;
    try { readSet = contextReadSet(options.readSet, PRODUCT_PROFILE); } catch { fail('invalid_read_set'); }
    const ownerCoverage = coverage(options.ownerCoverage, readSet);
    if(semantic && semantic.handle.ownerId!==readSet[0].ownerId)fail('authority_required');
    const host = ownData(options.host, ['moduleUrl', 'configuration']);
    try {
      if (typeof host.moduleUrl !== 'string') fail('invalid_input');
      const modulePath = fileURLToPath(host.moduleUrl);
      if (!isAbsolute(modulePath) || modulePath.includes('\0')) fail('invalid_input');
      host.moduleUrl = pathToFileURL(resolve(modulePath)).href;
    } catch { fail('invalid_input'); }
    const configuration = hostConfiguration(host.configuration);
    if (maintenance && options.sidecarJournalMode !== 'DELETE' && !(options.wal === true && options.sidecarJournalMode === 'WAL')) {
      if (options.sidecarJournalMode === 'WAL') fail('index_unavailable');
      fail('invalid_input');
    }
    const binding = maintenance ? serviceIssuance(configuration.serviceBinding, readSet, ownerCoverage) : null;
    const serviceControl = () => ({ requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: binding.credentialBindingId,
      credentialExpiresUtcMs: binding.credentialExpiresUtcMs, requestMaxMs: 5000 });
    const request = requestRecord(maintenance ? serviceControl() : options.requestControl, admitted, admissionUtc);
    const issuedBinding = maintenance ? binding : issuance(configuration.requestBinding, request, readSet, ownerCoverage);
    const phaseBuffer = options.diagnostics === true ? openDiagnosticBuffer(admitted) : null;
    const phase = openDiagnosticClock(phaseBuffer);
    phase?.mark('issued');
    const openDeadline = deadline(options.deadlineMs ?? 5000);
    // Bound complete bootstrap/control transport before reserving or dispatching.
    const bootstrap = { path: options.path, readSet, ownerCoverage, request, host: { moduleUrl: host.moduleUrl, configuration }, binding: issuedBinding };
    hostConfiguration(bootstrap);
    const first = operationRecord(request, admitted, openDeadline, 1);
    const firstOrdinal=maintenance ? claimMaintenanceOrdinal(controls) : undefined;
    const frame = options.diagnostics ? nativeTelemetry(first.operationId, 1) : null;
    const resources = new SharedArrayBuffer(16);
    const marker=maintenance ? maintenanceMarker() : undefined;
    const failureState=maintenance?{lastFailure:null,failureCounts:maintenanceFailureCounts(),secondaryFailure:null,secondaryFailureCounts:maintenanceFailureCounts()}:undefined;
    let terminalFailure,callFailure;
    const openingData = { path: options.path, readSet, ownerCoverage, request, binding: issuedBinding, maintenance,
      wal: options.wal === true, ...(maintenance ? { sidecarJournalMode: options.sidecarJournalMode } : {}),
      host: { moduleUrl: host.moduleUrl, configuration }, operation: first, frame, resources, deadlineMs: openDeadline };
    hostConfiguration(openingData);
    // Internal fixed storage does not consume the caller's bootstrap allowance.
    if (phaseBuffer) openingData.openPhases = phaseBuffer;
    if(maintenance)openingData.maintenanceMarker=marker;
    // Internal qualification seam, never a public reader/pump input knob.
    if(maintenance&&comparisonQualified())openingData.memoryComparison=true;
    if(maintenance&&verificationQualified()) {
      openingData.verificationBatching=true;
      openingData.verificationBatchState=verificationBatchControl(options.supervisor);
    }
    if(semantic) {
      openingData.semanticConfig=semantic.configuration;
      openingData.semanticPort=semantic.handle.attach({ownerId:readSet[0].ownerId,path:options.path,readSet,maintenance,bindingId:issuedBinding.credentialBindingId,cancellation:semantic.configuration.cancellation});
    }
    const reservation = configuration.requestReservation;
    if (!maintenance && (!types.isSharedArrayBuffer(reservation) || Reflect.apply(sharedLength, reservation, []) !== 4 ||
        Atomics.compareExchange(new Int32Array(reservation), 0, 0, 1) !== 0)) fail('authority_required');
    const resource = registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, request: maintenance ? undefined : request, frame, resources }, true);
    let closed = false, terminal, idle, closePromise, ready = false, releaseWriter, writerReleased = false, cutoffCapability, forcedCleanup = false, disposalWorkerError = false;
    const epoch = 1;
    // Timeout delivery remains prompt; disposal owns a separate bounded grace.
    function stopWorker(instance) {
      // A validated opening held in admission is idle and trusted. Its deadline
      // or cancellation keeps the public refusal while disposing gracefully.
      // Executing cancellation and protocol/identity failures still terminate.
      const heldOpening = lifecycle.pending?.open && lifecycle.pending.heldOpeningResult;
      const admissionStop = heldOpening && (terminal === 'read_in_progress' || terminal === 'read_cancelled');
      if (terminal !== 'read_timeout' && terminal !== 'store_closed' && !admissionStop) return instance.terminate();
      const until = Number(now()) / 1e6 + DISPOSAL_GRACE_MS;
      return new Promise((resolve, reject) => {
        let timer, safety, live = true, realUntil = Infinity;
        const realNow = () => { const [seconds, nanos] = hrtime(); return seconds * 1000 + nanos / 1e6; };
        const detach = () => { live = false; clearTimer(timer); safety?.abort(); instance.off('exit', exited); instance.off('error', failed); if(maintenance)instance.off('message',closeDiagnostic); };
        // An injected operation clock/timer cannot suspend the safety fallback.
        const armSafety = remaining => {
          realUntil = Math.min(realUntil, realNow() + Math.max(0, remaining));
          safety?.abort(); safety = new AbortController();
          void safetyDelay(Math.ceil(Math.max(0, realUntil - realNow())), undefined, { signal: safety.signal })
            .then(() => {
              if (!live) return;
              const remaining = realUntil - realNow();
              if (remaining > 0) armSafety(remaining);
              else force();
            }, error => { if (error.name !== 'AbortError') force(error); });
        };
        const force = cause => {
          if (!live) return;
          if(maintenance&&!cause&&!forcedCleanup){forcedCleanup=true;closingFailure(undefined,'cleanup',{stage:'close'});}
          detach();
          try { Promise.resolve(instance.terminate()).then(value => cause ? reject(cause) : resolve(value), reject); }
          catch (error) { reject(error); }
        };
        const exited = code => { detach(); if(code!==0)closingFailure(undefined,'worker_exit',{exitCode:code,stage:'close'});code === 0 ? resolve(code) : reject(coded('reader_failed')); };
        const failed = error => {disposalWorkerError=true;closingFailure(error,error?.code==='ERR_WORKER_OUT_OF_MEMORY'?'worker_heap_limit':'worker_error',{errorName:maintenanceErrorName(error),stage:'close'});force(error);};
        const closeDiagnostic=message=>{if(message?.kind!=='maintenance-close-failure')return;const detail=readMaintenanceFailure(message.maintenanceFailure);if(detail)closingFailure(undefined,detail.kind,{...detail,stage:'close'});workerSecondary(message,'close');};
        if(maintenance)instance.on('message',closeDiagnostic);
        instance.once('exit', exited); instance.once('error', failed);
        try {
          const remaining = Math.max(0, until - Number(now()) / 1e6);
          armSafety(remaining); timer = setTimer(() => force(), remaining);
          instance.ref(); instance.postMessage({ method: 'close' });
        } catch (error) { force(error); }
      });
    }
    const lifecycle = createReaderWorkerLifecycle({ clearTimer, stopWorker, onStop(termination) {
      registry.cleanup(resource, terminal);
      termination.then(() => {
        releaseSemanticWriter();
        registry.finish(resource); if (resource.state === 'complete') releaseWriter?.();
        const slot = lifecycle.pending;
        if (slot?.record && slot.record !== resource) registry.finish(slot.record);
      }, () => registry.finish(resource, false));
    } });
    resource.stop = code => { const stopped = dispose(code); void stopped.catch(() => {}); return stopped; };
    if(maintenance)void resource.delivery.catch(error=>{
      if(!maintenanceFailures.has(error)){
        if(forcedCleanup)attachFailure(error,terminalFailure??callFailure);
        else closingFailure(error,'cleanup',{stage:'close'});
      }
    });
    function noteFailure(value,kind,detail={},slot=lifecycle.pending){
      if(!maintenance)return;
      let failure=slot?.failure;
      if(!failure){
        failure=maintenanceFailureRecord(kind,{...detail,ordinal:slot?.ordinal??detail.ordinal,stage:detail.stage??(slot?slot.open?'open':'refresh':'idle'),
          ...(slot?{stall:readMaintenanceMarker(marker,now())}:{})});
        if(slot&&!slot.open||slot===null&&detail.stage!=='close')callFailure=failure;
        if(slot){slot.failure=failure;if(slot.control&&typeof slot.control==='object'){maintenanceFailures.set(slot.control,failure);maintenanceReaderFailures.set(slot.control,failureState);}}
        failureState.lastFailure=failure;const key=maintenanceFailureKind(failure);
        failureState.failureCounts[key]=Math.min(Number.MAX_SAFE_INTEGER,failureState.failureCounts[key]+1);
      }
      if(value&&typeof value==='object'){maintenanceFailures.set(value,failure);maintenanceReaderFailures.set(value,failureState);}
      return failure;
    }
    function attachFailure(value,failure){
      if(maintenance&&value&&typeof value==='object'){maintenanceFailures.set(value,failure);maintenanceReaderFailures.set(value,failureState);}
    }
    function noteSecondary(value,kind,detail={}){
      if(!maintenance)return;
      const failure=maintenanceFailureRecord(kind,{...detail,stage:detail.stage??'close'}),key=maintenanceFailureKind(failure);
      failureState.secondaryFailure=failure;failureState.secondaryFailureCounts[key]=Math.min(Number.MAX_SAFE_INTEGER,failureState.secondaryFailureCounts[key]+1);
      attachFailure(value,terminalFailure??failureState.lastFailure);
    }
    function closingFailure(value,kind,detail){
      const primary=terminalFailure??callFailure;
      if(primary){noteSecondary(value,kind,detail);attachFailure(value,primary);}
      else terminalFailure=noteFailure(value,kind,detail,null);
    }
    function workerSecondary(message,stage){const detail=readMaintenanceFailure(message.maintenanceSecondaryFailure);if(detail)noteSecondary(undefined,detail.kind,{...detail,stage});}
    function failureFor(code){return {kind:codes.has(code)?'engine':'unmapped',engineCode:code};}
    function shutdown(code, parentDeadline, cause) {
      closed = true; terminal ??= code; clearTimer(idle);
      const slot = lifecycle.pending;
      if(maintenance&&!terminalFailure&&(code!=='store_closed'||slot||callFailure)){const detail=cause??failureFor(code);terminalFailure=!slot&&code==='store_closed'&&callFailure?callFailure:noteFailure(undefined,detail.kind,detail,slot);}
      if (slot?.cutoff && code === 'read_timeout' && terminal === code && (now() >= mono(slot.operation.operationCutoffMonoNs) ||
          parentDeadline === slot.cutoff && Number(now()) / 1e6 >= slot.cutoff.cutoffAt)) slot.cutoff.attested = true;
      const stall=maintenance && code==='read_timeout' ? readMaintenanceMarker(marker,now()) : undefined;
      if(semantic){Atomics.store(new Int32Array(semantic.configuration.cancellation),0,1);if(slot)semantic.handle.cancel(slot.operation.operationId);}
      const stopped = lifecycle.stop();
      if (!lifecycle.worker && !resource.cleaning) {
        openingData.semanticPort?.close(); // A held opening never transferred it.
        registry.cleanup(resource, terminal); registry.finish(resource);
      }
      if (slot) {
        if (slot.record !== resource) {
          registry.cleanup(slot.record, terminal);
          stopped.then(() => registry.finish(slot.record), () => registry.finish(slot.record, false));
        }
        const failure=productFailure(terminal);
        if(stall)maintenanceStalls.set(failure,stall);
        if(maintenance){maintenanceFailures.set(failure,terminalFailure);maintenanceReaderFailures.set(failure,failureState);}
        settle(slot, failure);
      }
      return stopped;
    }
    const messageAccepted = (instance, value) => message(instance, value, true);
    function message(instance, message, admitted = false) {
      if (lifecycle.worker !== instance || !lifecycle.pending) return;
      const slot = lifecycle.pending;
      // Old/duplicate frames are ignored. Conflicting current frames fail closed.
      if (message?.operation?.operationId !== slot.operation.operationId || message?.operation?.workerEpoch !== epoch) return;
      if (JSON.stringify(message.operation) !== JSON.stringify(slot.operation)) { shutdown('reader_failed',undefined,{kind:'protocol'}); return; }
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (slot.open && message.kind !== 'identity' && !admitted) phase?.mark('openReceived');
      if (!admitted && (message.kind === 'identity' || slot.open && message.result?.ok === true)) {
        if (typeof message.fileIdentity !== 'string' || !/^[0-9]+:[0-9]+$/.test(message.fileIdentity)) { shutdown('reader_failed',undefined,{kind:'protocol'}); return; }
        // Retain only the validated bounded frame, never arbitrary IPC extras.
        const retained = { operation: slot.operation, fileIdentity: message.fileIdentity };
        if (message.kind === 'identity') retained.kind = 'identity';
        else { try { boundedData(message.result, 65536); retained.result = structuredClone(message.result);
          const result = retained.result;
          if (typeof result.ok !== 'boolean' || result.ok && !Object.hasOwn(result, 'value') || !result.ok && !codes.has(result.error?.code)) fail('reader_failed'); }
          catch { shutdown('reader_failed',undefined,{kind:'protocol'}); return; } }
        gate(slot, resource, message.fileIdentity, messageAccepted.bind(null, instance, retained), true, slot.open && retained.kind !== 'identity'); return;
      }
      if (message.kind === 'identity') {
        try {
          if (typeof message.fileIdentity !== 'string' || !/^[0-9]+:[0-9]+$/.test(message.fileIdentity)){shutdown('reader_failed',undefined,{kind:'protocol'});return;}
          registry.bind(resource, message.fileIdentity);
          if (maintenance) {
            const release = claimMaintenanceWriter(message.fileIdentity,readSet);
            releaseWriter = () => { release(); writerReleased = true; };
          }
          instance.postMessage({ kind: 'identity-ack', operation: slot.operation });
        } catch (error) { shutdown(error.code ?? 'reader_failed',undefined,{kind:'identity'}); }
        return;
      }
      if (!slot.open && slot.method === 'fetchCandidateEvidence') phase?.mark('readDelivered');
      let result,invalidCause={kind:'protocol'};
      try {
        boundedData(message.result, 65536);
        result = structuredClone(message.result);
        if(result?.ok===false&&!codes.has(result.error?.code))invalidCause={kind:'unmapped',engineCode:result.error?.code};
        if (typeof result.ok !== 'boolean' || result.ok && !Object.hasOwn(result, 'value') || !result.ok && !codes.has(result.error?.code)) fail('reader_failed');
        if (slot.open && result.ok) {
          if (typeof message.fileIdentity !== 'string' || !/^[0-9]+:[0-9]+$/.test(message.fileIdentity)){shutdown('reader_failed',undefined,{kind:'protocol'});return;}
          registry.bind(resource, message.fileIdentity); ready = true;
        }
      } catch { shutdown('reader_failed',undefined,invalidCause); return; }
      // Acceptance is checked again after bounded response validation.
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (signalCancelled(slot.signal)) result = productFailure('read_cancelled');
      if (!slot.open) registry.finish(slot.record);
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (signalCancelled(slot.signal)) result = productFailure('read_cancelled');
      if (slot.open && !result.ok) { shutdown(result.error.code,undefined,readMaintenanceFailure(message.maintenanceFailure)??failureFor(result.error.code));workerSecondary(message,'open'); return; }
      if (maintenance && !slot.open) {
        if(result.ok && message.observedAtMonoMs !== undefined) {
          const at = message.observedAtMonoMs;
          if (!Number.isFinite(at) || at < Number(mono(slot.operation.enteredMonoNs)) / 1e6 || at > Number(now()) / 1e6) {
            shutdown('reader_failed',undefined,{kind:'observation_timing'}); return;
          }
          maintenanceObservations.set(result, at);
        }
        // Only fixed numeric fields cross into the process-local diagnostic.
        // Optional telemetry never supplies authority, usage refunds or timing proof.
        const detail=message.maintenancePhases, safe={};
        for(const name of ['dispatchMs','epochObservationMs',...maintenanceWorkFields,...attributionFields]){
          const n=detail?.[name];if(Number.isFinite(n)&&n>=0)safe[name]=n;
        }
        const finished=detail?.finishedAtMonoMs, delivered=Number(now())/1e6;
        if(Number.isFinite(finished)&&finished>=Number(mono(slot.operation.enteredMonoNs))/1e6&&finished<=delivered)safe.deliveryMs=delivered-finished;
        Object.assign(safe,serializationDiagnostic(marker,now()));
        if(slot.ordinal!==null)safe.ordinal=slot.ordinal;
        safe.returnMs=Number(now()-mono(slot.operation.enteredMonoNs))/1e6;
        maintenancePhases.set(result,Object.freeze(safe));
        if(openingData.memoryComparison&&message.comparison){
          try {
            const c=message.comparison;
            if(c.status==='incomplete')attachMaintenanceComparison(result,boundedData(c));
            else {
              if(!result.ok)fail('reader_failed');
              if(!['complete/equal','complete/different'].includes(c.status)||typeof c.envelope!=='string')fail('reader_failed');
              if(Buffer.byteLength(c.envelope)>262144)fail('reader_failed');
              const envelope=boundedData(JSON.parse(c.envelope));
              if(envelope.domain!=='context-read/b3-input-v2'||
                !Number.isSafeInteger(c.rows)||c.rows<0||c.rows>131072||!Number.isSafeInteger(c.bytes)||c.bytes<0||c.bytes>33554432||
                envelope.usage?.rows!==c.rows||envelope.usage?.bytes!==c.bytes||
                !Array.isArray(c.manifest)||!Array.isArray(c.payloads)||!Array.isArray(c.locations)||!Array.isArray(envelope.descriptors)||
                c.manifest.length+c.payloads.length+c.locations.length+envelope.descriptors.length>1024)fail('reader_failed');
              let bytes=Buffer.byteLength(c.envelope);
              for(const chunks of [c.manifest,c.payloads,c.locations])for(const chunk of chunks){
                if(typeof chunk!=='string'||!chunk.isWellFormed()||Buffer.byteLength(chunk)>262144||(bytes+=Buffer.byteLength(chunk))>33554432)fail('reader_failed');
                boundedData(chunk);
              }
              Object.freeze(c.manifest);Object.freeze(c.payloads);Object.freeze(c.locations);Object.freeze(c);
              attachMaintenanceComparison(result,c);
            }
          } catch {shutdown('reader_failed',undefined,{kind:'protocol'});return;}
          if(now()>=mono(slot.operation.operationCutoffMonoNs)){shutdown('read_timeout');return;}
        }
        if(result.error?.code==='read_timeout'){
          const stall=readMaintenanceMarker(marker,now());if(stall)maintenanceStalls.set(result,stall);
        }
      }
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if(maintenance&&!result.ok){const detail=readMaintenanceFailure(message.maintenanceFailure)??failureFor(result.error.code);noteFailure(result,detail.kind,detail,slot);workerSecondary(message,'refresh');}
      if(maintenance&&!slot.open&&result.ok)callFailure=undefined;
      if (slot.open) phase?.mark('openAccepted');
      else if (slot.method === 'fetchCandidateEvidence') phase?.mark('readAccepted');
      settle(slot, result);
      armIdle();
    }
    function dispatch(method, payload, credential, control, entered, opening = false) {
      if (closed){const result=productFailure(terminal === 'read_timeout' || terminal === 'read_cancelled' ? 'store_closed' : terminal ?? 'store_closed');if(maintenance&&terminalFailure){maintenanceFailures.set(result,terminalFailure);maintenanceReaderFailures.set(result,failureState);}return Promise.resolve(result);}
      let input, token, signal, duration;
      try {
        ({ signal } = ownData(control ?? {}, ['signal']));
        signalAborted(signal);
        if (!opening) {
          if ((method !== 'getContextReadCapabilities'||semantic) && (credential === undefined || credential === null)) fail('authority_required');
          let selected;
          try {
            if (types.isProxy(payload)) fail('invalid_read_set');
            const descriptor = Object.getOwnPropertyDescriptor(payload, 'readSet');
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_read_set');
            selected = contextReadSet(descriptor.value, PRODUCT_PROFILE);
          } catch { fail('invalid_read_set'); }
          input = boundedData(payload); token = method === 'getContextReadCapabilities'&&!semantic ? null : boundedData(credential, 16384);
          if ((method !== 'getContextReadCapabilities'||semantic) && credentialDigest(token) !== issuedBinding.credentialDigest) fail('authority_required');
          if (JSON.stringify(selected) !== JSON.stringify(readSet)) fail('invalid_read_set');
          duration = deadline(method === 'refreshContextIndex' ? input.budget?.maxMs : input.deadlineMs);
        } else duration = openDeadline;
      } catch (error) {
        if (opening) shutdown(error.code ?? 'reader_failed');
        const result=productFailure(error.code);if(maintenance){const detail=failureFor(error.code);noteFailure(result,detail.kind,detail,null);}return Promise.resolve(result);
      }
      if (lifecycle.pending){const result=productFailure('read_in_progress');noteFailure(result,'engine',{engineCode:'read_in_progress'},null);return Promise.resolve(result);}
      const callRequest = !opening && maintenance ? requestRecord(serviceControl(), entered, utc()) : request;
      const operation = opening ? first : operationRecord(callRequest, entered, duration, epoch);
      const callFrame = opening ? frame : options.diagnostics ? nativeTelemetry(operation.operationId, epoch) : null;
      const ordinal=maintenance ? opening ? firstOrdinal : claimMaintenanceOrdinal(control) : undefined;
      const outbound = opening ? openingData : { method, input, credential: token, request: callRequest, operation, frame: callFrame };
      if(maintenance){
        const {maintenanceMarker:internalMarker,semanticPort,openPhases,memoryComparison:internalComparison,verificationBatching:internalBatching,verificationBatchState:internalBatchState,...data}=outbound;operationMessage(data);
        outbound.maintenanceOrdinal=ordinal;bindMaintenanceControl(control,marker);prepareMaintenanceMarker(marker,ordinal,entered);
      }else if(opening && (semantic || phaseBuffer)) {const {semanticPort,openPhases,...data}=outbound;operationMessage(data);}else operationMessage(outbound);
      const record = opening ? resource : registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, parent: resource, frame: callFrame }, true);
      let subscription;
      const detach = () => {
        const previous = subscription; subscription = undefined;
        previous?.[Symbol.dispose]();
      };
      return new Promise(resolve => {
        const slot = { resolve, operation, record, signal, open: opening, method, detach, ordinal, control }; lifecycle.pending = slot;
        if (maintenance && !semantic && method === 'refreshContextIndex') {
          cutoffCapability = slot.cutoff = bindMaintenanceCutoff(control, ordinal, operation, resource, record, lifecycle, () => {
            if (lifecycle.pending !== slot || Number(now()) / 1e6 < slot.cutoff.cutoffAt) return false;
            shutdown('read_timeout', slot.cutoff); return slot.cutoff.attested;
          }, () => writerReleased);
        }
        const abort = () => shutdown('read_cancelled');
        try {
          clearTimer(idle);
          if (signalCancelled(signal)) { shutdown('read_cancelled'); return; }
          if (signal !== undefined) subscription = addAbortListener(signal, abort);
          // Registration may synchronously close the owner or settle the slot.
          // Never dispatch after it has lost ownership, even without a Worker.
          if (closed || owner.owner.closed || lifecycle.pending !== slot) {
            shutdown('store_closed'); return;
          }
          gate(slot, record, record.identity, () => {
            slot.dispatched = true;
            if (opening) {
              resource.workerStopped = false; resource.nativeDisposed = false;
              phase?.mark('spawn');
              const lease = !maintenance && owner.owner.readerPool?.take(spawnWorker === nativeWorker
                ? new URL('.', import.meta.url).href + 'context-product-worker.mjs' : undefined);
              const instance = lease ? lease.worker : spawnWorker(openingData);
              lifecycle.worker = instance;
              instance.stdout?.resume(); instance.stderr?.resume();
              instance.on('message', data => message(instance, data));
              instance.on('error', error => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed',undefined,{kind:error?.code==='ERR_WORKER_OUT_OF_MEMORY'?'worker_heap_limit':'worker_error',errorName:maintenanceErrorName(error)}); });
              instance.on('exit', exitCode => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed',undefined,{kind:'worker_exit',exitCode});else if(maintenance&&exitCode!==0&&(['worker_error','worker_heap_limit'].includes(terminalFailure?.cause)||disposalWorkerError))noteSecondary(undefined,'worker_exit',{exitCode,stage:disposalWorkerError?'close':terminalFailure.stage}); });
              if (lease) {
                instance.ref();
                if (closed || owner.owner.closed || lifecycle.pending !== slot) shutdown(terminal ?? 'store_closed');
                else if (signalCancelled(signal)) shutdown('read_cancelled');
                else if (now() >= mono(operation.operationCutoffMonoNs)) shutdown('read_timeout');
                else lease.bootstrap(openingData);
              }
            } else {
              lifecycle.worker.ref();
              if (method === 'fetchCandidateEvidence') phase?.mark('readSent');
              lifecycle.worker.postMessage(outbound);
            }
          });
        } catch(error) { shutdown('reader_failed',undefined,{kind:opening?'spawn':'dispatch',errorName:maintenanceErrorName(error)}); }
      }).finally(() => {
        // Also disposes a handle returned after synchronous registration reentry.
        try { detach(); } catch { /* Public settlement is already terminal. */ }
      });
    }
    function armIdle() {
      lifecycle.worker?.unref(); idle = setTimer(() => { void dispose('store_closed').catch(() => {}); }, 60000); idle.unref?.(); lifecycle.idle = idle;
    }
    function settle(slot, result) {
      const diagnostic = registry.takeHoldDiagnostic(slot.record);
      if (diagnostic) registryHolds.set(result, diagnostic);
      return lifecycle.finish(slot, result);
    }
    function gate(slot, record, identity, run, binding = false, validatedOpening = false) {
      let waited = false;
      registry.admit(record, identity, { cutoff: Number(mono(slot.operation.operationCutoffMonoNs)) / 1e6,
        now: () => Number(now()) / 1e6, setTimer, clearTimer, waiting: () => { waited = true; slot.heldOpeningResult = validatedOpening; clearTimer(slot.deadline); } }, () => {
        if (closed || owner.owner.closed || lifecycle.pending !== slot) return;
        slot.heldOpeningResult = false;
        if (binding && !waited) { run(); return; }
        const remaining = mono(slot.operation.operationCutoffMonoNs) - now();
        clearTimer(slot.deadline);
        try {
          slot.deadline = setTimer(() => shutdown('read_timeout'), Math.max(0, Number(remaining) / 1e6));
          if (remaining <= 0n) { shutdown('read_timeout'); return; }
          run();
        } catch (error) { shutdown(binding ? error.code ?? 'reader_failed' : 'reader_failed',undefined,{kind:binding?'identity':slot.open?'spawn':'dispatch',errorName:maintenanceErrorName(error)}); }
      }, error => {
        if (closed || lifecycle.pending !== slot) return;
        if (slot.open || slot.dispatched) shutdown(error.code,undefined,binding?{kind:'identity'}:undefined);
        else {
          registry.finish(slot.record); const result = productFailure(error.code);
          if (maintenance) noteFailure(result,'engine',{engineCode:error.code},slot);
          settle(slot,result); armIdle();
        }
      });
    }
    const opened = await dispatch('open', null, null, controls, admitted, true);
    if (!opened.ok || !ready) {
      const error=coded(opened.error?.code??'reader_failed',resource.id),stall=maintenanceStalls.get(opened);
      if(stall)maintenanceStalls.set(error,stall);
      if(registryHolds.has(opened))registryHolds.set(error,registryHolds.get(opened));
      if(maintenance){const failure=maintenanceFailures.get(opened);if(failure)maintenanceFailures.set(error,failure);maintenanceReaderFailures.set(error,failureState);}throw error;
    }
    const call = (method, input, credential, control) => {
      const entered = now();
      if (method === 'fetchCandidateEvidence') phase?.mark('readEntered');
      try { return dispatch(method, input, credential, control, entered); }
      catch (error) {const result=productFailure(error.code);const detail=error.code===undefined?{kind:'call_error',errorName:maintenanceErrorName(error)}:failureFor(error.code);noteFailure(result,detail.kind,detail,null);return Promise.resolve(result);}
    };
    function dispose(code = 'store_closed', cutoffAt, failure) {
      // The owned pump can retain its active call snapshot after a late reply
      // has already settled the reader slot. Never infer it from an idle marker.
      if(maintenance&&code==='read_timeout'&&!terminalFailure&&failure?.cause==='engine'&&failure.engineCode==='read_timeout')
        terminalFailure=noteFailure(undefined,'engine',{engineCode:'read_timeout',ordinal:failure.ordinal,stage:failure.stage,stall:failure.stall},null);
      // Earlier cutoffs tighten expedited eligibility, never the disposal grace.
      if (code === 'read_timeout' && Number.isFinite(cutoffAt)) cutoffCapability?.tighten(cutoffAt);
      if(semantic)Atomics.store(new Int32Array(semantic.configuration.cancellation),0,1);
      return closePromise ??= (async () => {
        phase?.mark('closeEntered');
        await shutdown(code).catch(() => {});
        phase?.mark('closeExited');
        await resource.delivery;
        phase?.mark('closeFinished');
      })().catch(error=>{if(maintenance&&!maintenanceFailures.has(error))closingFailure(error,'cleanup',{stage:'close'});throw error;});
    }
    const handle=Object.freeze({
      getContextReadCapabilities(input = {},credential,control) {
        if(semantic) {
          try {const data=ownData(input,['deadlineMs']);return call('getContextReadCapabilities',{readSet,deadlineMs:deadline(data.deadlineMs)},credential,control);}
          catch(error){return Promise.resolve(productFailure(error.code));}
        }
        // Public configuration only, no credential/private projection observation.
        return call('getContextReadCapabilities', { readSet, deadlineMs: 1000 }, null, input);
      },
      ...(!maintenance ? { fetchCandidateEvidence: (input, credential, control) => call('fetchCandidateEvidence', input, credential, control),
      findCandidates: (input, credential, control) => call('findCandidates', input, credential, control),
      contextRead: (input, credential, control) => call('contextRead', input, credential, control) } : {}),
      getContextIndexStatus: (input, credential, control) => call('getContextIndexStatus', input, credential, control),
      ...(maintenance ? { refreshContextIndex: (input, credential, control) => call('refreshContextIndex', input, credential, control) } : {}),
      close() { return dispose('store_closed'); },
    });
    disposals.set(handle.close, dispose);
    const holdDiagnostic = registryHolds.get(opened); if (holdDiagnostic) registryHolds.set(handle, holdDiagnostic);
    if (phaseBuffer) openPhases.set(handle, phaseBuffer);
    if(maintenance){maintenanceMarkers.set(handle,marker);maintenanceReaderFailures.set(handle,failureState);}
    return handle;
  };
}
export const openContextProductReader = createProductReaderRuntime();

export const openContextIndexMaintainer = createProductReaderRuntime({ maintenance: true });
