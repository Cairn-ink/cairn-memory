import { maintenanceMarker, readMaintenanceMarker, prepareMaintenanceMarker, claimMaintenanceOrdinal, maintenanceControlState, bindMaintenanceControl, serializationDiagnostic, attributionFields, maintenanceWorkFields } from './context-product-attribution.mjs';
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

// Engine-internal only. A patch is added only after native and quiet-window
// qualification. Neither public configuration nor environment can enable this.
const qualifiedRuntimePatches = new Set();
export const maintenanceCutoffQualified = () => qualifiedRuntimePatches.has(process.versions.node);
const capabilities = new WeakMap(), diagnostics = new WeakMap();
export const maintenancePumpCutoffDiagnostic = observation => diagnostics.get(observation);
export const snapshotMaintenanceCutoff = (observation, value) => {
  if (value) diagnostics.set(observation, Object.freeze({ ...value }));
};
export function authorizeMaintenanceCutoff(control, identity) {
  if (!Number.isSafeInteger(identity.ordinal) || identity.ordinal < 1) return undefined;
  const capability = { ...identity, attested: false };
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
const openPhases = new WeakMap();
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
  setTimer = setTimeout, clearTimer = clearTimeout, spawnWorker = nativeWorker, maintenance = false } = {}) {
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
    const openingData = { path: options.path, readSet, ownerCoverage, request, binding: issuedBinding, maintenance,
      wal: options.wal === true, ...(maintenance ? { sidecarJournalMode: options.sidecarJournalMode } : {}),
      host: { moduleUrl: host.moduleUrl, configuration }, operation: first, frame, resources, deadlineMs: openDeadline };
    hostConfiguration(openingData);
    // Internal fixed storage does not consume the caller's bootstrap allowance.
    if (phaseBuffer) openingData.openPhases = phaseBuffer;
    if(maintenance)openingData.maintenanceMarker=marker;
    if(semantic) {
      openingData.semanticConfig=semantic.configuration;
      openingData.semanticPort=semantic.handle.attach({ownerId:readSet[0].ownerId,path:options.path,readSet,maintenance,bindingId:issuedBinding.credentialBindingId,cancellation:semantic.configuration.cancellation});
    }
    const reservation = configuration.requestReservation;
    if (!maintenance && (!types.isSharedArrayBuffer(reservation) || Reflect.apply(sharedLength, reservation, []) !== 4 ||
        Atomics.compareExchange(new Int32Array(reservation), 0, 0, 1) !== 0)) fail('authority_required');
    const resource = registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, request: maintenance ? undefined : request, frame, resources });
    let closed = false, terminal, idle, closePromise, ready = false, releaseWriter, writerReleased = false;
    const epoch = 1;
    // Timeout delivery remains prompt; disposal owns a separate bounded grace.
    function stopWorker(instance) {
      if (terminal !== 'read_timeout') return instance.terminate();
      const slot = lifecycle.pending;
      const cutoff = slot ? Math.min(Number(mono(slot.operation.operationCutoffMonoNs)) / 1e6, slot.cutoff?.cutoffAt ?? Infinity) : Number(now()) / 1e6;
      const graceMs = Math.max(0, Math.min(500, cutoff + 1000 - Number(now()) / 1e6));
      return new Promise((resolve, reject) => {
        let timer;
        const detach = () => { clearTimer(timer); instance.off('exit', exited); instance.off('error', failed); };
        const force = cause => {
          detach();
          try { Promise.resolve(instance.terminate()).then(value => cause ? reject(cause) : resolve(value), reject); }
          catch (error) { reject(error); }
        };
        const exited = code => { detach(); code === 0 ? resolve(code) : reject(coded('reader_failed')); };
        const failed = error => force(error);
        instance.once('exit', exited); instance.once('error', failed);
        timer = setTimer(() => force(), graceMs);
        try { instance.ref(); instance.postMessage({ method: 'close' }); } catch (error) { force(error); }
      });
    }
    const lifecycle = createReaderWorkerLifecycle({ clearTimer, stopWorker, onStop(termination) {
      registry.cleanup(resource);
      termination.then(() => {
        releaseSemanticWriter();
        registry.finish(resource); if (resource.state === 'complete') releaseWriter?.();
        const slot = lifecycle.pending;
        if (slot?.record && slot.record !== resource) registry.finish(slot.record);
      }, () => registry.finish(resource, false));
    } });
    resource.stop = code => closePromise ?? shutdown(code);
    function shutdown(code, parentDeadline) {
      closed = true; terminal ??= code; clearTimer(idle);
      const slot = lifecycle.pending;
      if (slot?.cutoff && code === 'read_timeout' && terminal === code && (now() >= mono(slot.operation.operationCutoffMonoNs) ||
          parentDeadline === slot.cutoff && Number(now()) / 1e6 >= slot.cutoff.cutoffAt)) slot.cutoff.attested = true;
      const stall=maintenance && code==='read_timeout' ? readMaintenanceMarker(marker,now()) : undefined;
      if(semantic){Atomics.store(new Int32Array(semantic.configuration.cancellation),0,1);if(slot)semantic.handle.cancel(slot.operation.operationId);}
      const stopped = lifecycle.stop();
      if (!lifecycle.worker && !resource.cleaning) { registry.cleanup(resource); registry.finish(resource); }
      if (slot) {
        if (slot.record !== resource) {
          registry.cleanup(slot.record);
          stopped.then(() => registry.finish(slot.record), () => registry.finish(slot.record, false));
        }
        const failure=productFailure(terminal);
        if(stall)maintenanceStalls.set(failure,stall);
        lifecycle.finish(slot, failure);
      }
      return stopped;
    }
    function message(instance, message) {
      if (lifecycle.worker !== instance || !lifecycle.pending) return;
      const slot = lifecycle.pending;
      // Old/duplicate frames are ignored. Conflicting current frames fail closed.
      if (message?.operation?.operationId !== slot.operation.operationId || message?.operation?.workerEpoch !== epoch) return;
      if (JSON.stringify(message.operation) !== JSON.stringify(slot.operation)) { shutdown('reader_failed'); return; }
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (message.kind === 'identity') {
        try {
          if (typeof message.fileIdentity !== 'string' || !/^[0-9]+:[0-9]+$/.test(message.fileIdentity)) fail('reader_failed');
          registry.bind(resource, message.fileIdentity);
          if (maintenance) {
            const release = claimMaintenanceWriter(message.fileIdentity,readSet);
            releaseWriter = () => { release(); writerReleased = true; };
          }
          instance.postMessage({ kind: 'identity-ack', operation: slot.operation });
        } catch (error) { shutdown(error.code ?? 'reader_failed'); }
        return;
      }
      if (slot.open) phase?.mark('openReceived');
      else if (slot.method === 'fetchCandidateEvidence') phase?.mark('readDelivered');
      let result;
      try {
        boundedData(message.result, 65536);
        result = structuredClone(message.result);
        if (typeof result.ok !== 'boolean' || result.ok && !Object.hasOwn(result, 'value') || !result.ok && !codes.has(result.error?.code)) fail('reader_failed');
        if (slot.open && result.ok) {
          if (typeof message.fileIdentity !== 'string' || !/^[0-9]+:[0-9]+$/.test(message.fileIdentity)) fail('reader_failed');
          registry.bind(resource, message.fileIdentity); ready = true;
        }
      } catch { shutdown('reader_failed'); return; }
      // Acceptance is checked again after bounded response validation.
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (signalCancelled(slot.signal)) result = productFailure('read_cancelled');
      if (!slot.open) registry.finish(slot.record);
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (signalCancelled(slot.signal)) result = productFailure('read_cancelled');
      if (slot.open && !result.ok) { shutdown(result.error.code); return; }
      if (maintenance && !slot.open) {
        if(result.ok && message.observedAtMonoMs !== undefined) {
          const at = message.observedAtMonoMs;
          if (!Number.isFinite(at) || at < Number(mono(slot.operation.enteredMonoNs)) / 1e6 || at > Number(now()) / 1e6) {
            shutdown('reader_failed'); return;
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
        if(result.error?.code==='read_timeout'){
          const stall=readMaintenanceMarker(marker,now());if(stall)maintenanceStalls.set(result,stall);
        }
      }
      if (now() >= mono(slot.operation.operationCutoffMonoNs)) { shutdown('read_timeout'); return; }
      if (slot.open) phase?.mark('openAccepted');
      else if (slot.method === 'fetchCandidateEvidence') phase?.mark('readAccepted');
      lifecycle.finish(slot, result);
      instance.unref(); idle = setTimer(() => shutdown('store_closed'), 60000); idle.unref?.(); lifecycle.idle = idle;
    }
    function dispatch(method, payload, credential, control, entered, opening = false) {
      if (closed) return Promise.resolve(productFailure(terminal === 'read_timeout' || terminal === 'read_cancelled' ? 'store_closed' : terminal ?? 'store_closed'));
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
        return Promise.resolve(productFailure(error.code));
      }
      if (lifecycle.pending) return Promise.resolve(productFailure('read_in_progress'));
      const callRequest = !opening && maintenance ? requestRecord(serviceControl(), entered, utc()) : request;
      const operation = opening ? first : operationRecord(callRequest, entered, duration, epoch);
      const callFrame = opening ? frame : options.diagnostics ? nativeTelemetry(operation.operationId, epoch) : null;
      const ordinal=maintenance ? opening ? firstOrdinal : claimMaintenanceOrdinal(control) : undefined;
      const outbound = opening ? openingData : { method, input, credential: token, request: callRequest, operation, frame: callFrame };
      if(maintenance){
        const {maintenanceMarker:internalMarker,semanticPort,openPhases,...data}=outbound;operationMessage(data);
        outbound.maintenanceOrdinal=ordinal;bindMaintenanceControl(control,marker);prepareMaintenanceMarker(marker,ordinal,entered);
      }else if(opening && (semantic || phaseBuffer)) {const {semanticPort,openPhases,...data}=outbound;operationMessage(data);}else operationMessage(outbound);
      const record = opening ? resource : registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, parent: resource, frame: callFrame });
      let subscription;
      const detach = () => {
        const previous = subscription; subscription = undefined;
        previous?.[Symbol.dispose]();
      };
      return new Promise(resolve => {
        const slot = { resolve, operation, record, signal, open: opening, method, detach, ordinal }; lifecycle.pending = slot;
        if (maintenance && !semantic && method === 'refreshContextIndex') {
          slot.cutoff = bindMaintenanceCutoff(control, ordinal, operation, resource, record, lifecycle, () => {
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
          const remaining = mono(operation.operationCutoffMonoNs) - now();
          slot.deadline = setTimer(() => shutdown('read_timeout'), Math.max(0, Number(remaining) / 1e6));
          if (remaining <= 0n) { shutdown('read_timeout'); return; }
          if (opening) {
            resource.workerStopped = false; resource.nativeDisposed = false;
            phase?.mark('spawn');
            const instance = spawnWorker(openingData);
            lifecycle.worker = instance;
            instance.stdout?.resume(); instance.stderr?.resume();
            instance.on('message', data => message(instance, data));
            instance.on('error', () => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed'); });
            instance.on('exit', () => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed'); });
          } else {
            lifecycle.worker.ref();
            if (method === 'fetchCandidateEvidence') phase?.mark('readSent');
            lifecycle.worker.postMessage(outbound);
          }
        } catch { shutdown('reader_failed'); }
      }).finally(() => {
        // Also disposes a handle returned after synchronous registration reentry.
        try { detach(); } catch { /* Public settlement is already terminal. */ }
      });
    }
    const opened = await dispatch('open', null, null, controls, admitted, true);
    if (!opened.ok || !ready) {
      const error=coded(opened.error?.code??'reader_failed',resource.id),stall=maintenanceStalls.get(opened);
      if(stall)maintenanceStalls.set(error,stall);throw error;
    }
    const call = (method, input, credential, control) => {
      const entered = now();
      if (method === 'fetchCandidateEvidence') phase?.mark('readEntered');
      try { return dispatch(method, input, credential, control, entered); }
      catch (error) { return Promise.resolve(productFailure(error.code)); }
    };
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
      close() {
        if(semantic)Atomics.store(new Int32Array(semantic.configuration.cancellation),0,1);
        return closePromise ??= (async () => {
          phase?.mark('closeEntered');
          if (!closed && !lifecycle.pending && lifecycle.worker) {
            // Graceful native close receives an independent cleanup acknowledgement.
            closed = true; clearTimer(idle); registry.cleanup(resource);
            const instance = lifecycle.worker;
            await new Promise((resolve, reject) => {
              instance.ref();
              instance.once('exit', code => { phase?.mark('closeExited'); code === 0 ? resolve() : reject(coded('reader_failed')); });
              instance.once('error', reject);
              instance.postMessage({ method: 'close' });
            }).then(() => { releaseSemanticWriter();registry.finish(resource); if (resource.state === 'complete') releaseWriter?.(); }, () => registry.finish(resource, false));
            lifecycle.worker = undefined;
          } else await shutdown('store_closed');
          await resource.delivery;
          phase?.mark('closeFinished');
        })();
      },
    });
    if (phaseBuffer) openPhases.set(handle, phaseBuffer);
    if(maintenance)maintenanceMarkers.set(handle,marker);
    return handle;
  };
}
export const openContextProductReader = createProductReaderRuntime();

export const openContextIndexMaintainer = createProductReaderRuntime({ maintenance: true });
