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
function signalAborted(signal) {
  if (signal === undefined) return false;
  if (!signal || typeof signal !== 'object' || types.isProxy(signal) ||
      Object.getPrototypeOf(signal) !== signalPrototype) fail('invalid_input');
  if (Reflect.ownKeys(signal).some(key =>
      !Object.hasOwn(Object.getOwnPropertyDescriptor(signal, key), 'value'))) fail('invalid_input');
  try { return Reflect.apply(aborted, signal, []); } catch { fail('invalid_input'); }
}
// After registration the shape may change legitimately (for example any()).
// An unreadable state discards this result without invalidating the reader.
function signalCancelled(signal) {
  if (signal === undefined) return false;
  try { return Reflect.apply(aborted, signal, []); } catch { return true; }
}
const nativeWorker = data => new Worker(new URL('./context-product-worker.mjs', import.meta.url), {
  workerData: data, env: {}, execArgv: [], stdout: true, stderr: true,
  // Lexical-only P2a has no vector cache or counter runtime. Reserve 192 MiB
  // rather than inheriting the topic reader's 64 MiB limit.
  resourceLimits: { maxOldGenerationSizeMb: 192 },
});
export function createProductReaderRuntime({ now = () => process.hrtime.bigint(), utc = () => Date.now(),
  setTimer = setTimeout, clearTimer = clearTimeout, spawnWorker = nativeWorker, maintenance = false } = {}) {
  return async function openContextProductReader(original, controls = {}) {
    // These samples precede even option reflection/validation.
    const admitted = now(), admissionUtc = utc();
    const options = ownData(original, ['supervisor', 'path', 'version', 'profile', 'readSet', 'ownerCoverage', 'requestControl', 'host', 'diagnostics', 'deadlineMs', ...(maintenance ? ['sidecarJournalMode'] : [])]);
    const { signal } = ownData(controls, ['signal']);
    signalAborted(signal);
    if (options.version !== 'context-read-v1' || options.profile !== PRODUCT_PROFILE ||
        options.diagnostics !== undefined && typeof options.diagnostics !== 'boolean') fail('invalid_input');
    if (typeof options.path !== 'string' || !isAbsolute(options.path) || options.path.includes('\0')) fail('invalid_path');
    const owner = supervisorOwner(options.supervisor), { registry } = owner;
    let readSet;
    try { readSet = contextReadSet(boundedData(options.readSet)); } catch { fail('invalid_read_set'); }
    const ownerCoverage = coverage(options.ownerCoverage, readSet);
    const host = ownData(options.host, ['moduleUrl', 'configuration']);
    try {
      if (typeof host.moduleUrl !== 'string') fail('invalid_input');
      const modulePath = fileURLToPath(host.moduleUrl);
      if (!isAbsolute(modulePath) || modulePath.includes('\0')) fail('invalid_input');
      host.moduleUrl = pathToFileURL(resolve(modulePath)).href;
    } catch { fail('invalid_input'); }
    const configuration = hostConfiguration(host.configuration);
    if (maintenance && options.sidecarJournalMode !== 'DELETE') {
      if (options.sidecarJournalMode === 'WAL') fail('index_unavailable');
      fail('invalid_input');
    }
    const binding = maintenance ? serviceIssuance(configuration.serviceBinding, readSet, ownerCoverage) : null;
    const serviceControl = () => ({ requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: binding.credentialBindingId,
      credentialExpiresUtcMs: binding.credentialExpiresUtcMs, requestMaxMs: 5000 });
    const request = requestRecord(maintenance ? serviceControl() : options.requestControl, admitted, admissionUtc);
    const issuedBinding = maintenance ? binding : issuance(configuration.requestBinding, request, readSet, ownerCoverage);
    const openDeadline = deadline(options.deadlineMs ?? 5000);
    // Bound complete bootstrap/control transport before reserving or dispatching.
    const bootstrap = { path: options.path, readSet, ownerCoverage, request, host: { moduleUrl: host.moduleUrl, configuration }, binding: issuedBinding };
    hostConfiguration(bootstrap);
    const first = operationRecord(request, admitted, openDeadline, 1);
    const frame = options.diagnostics ? nativeTelemetry(first.operationId, 1) : null;
    const resources = new SharedArrayBuffer(16);
    const openingData = { path: options.path, readSet, ownerCoverage, request, binding: issuedBinding, maintenance,
      host: { moduleUrl: host.moduleUrl, configuration }, operation: first, frame, resources, deadlineMs: openDeadline };
    hostConfiguration(openingData);
    const reservation = configuration.requestReservation;
    if (!maintenance && (!types.isSharedArrayBuffer(reservation) || Reflect.apply(sharedLength, reservation, []) !== 4 ||
        Atomics.compareExchange(new Int32Array(reservation), 0, 0, 1) !== 0)) fail('authority_required');
    const resource = registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, request: maintenance ? undefined : request, frame, resources });
    let closed = false, terminal, idle, closePromise, ready = false, releaseWriter;
    const epoch = 1;
    const lifecycle = createReaderWorkerLifecycle({ clearTimer, onStop(termination) {
      registry.cleanup(resource);
      termination.then(() => {
        registry.finish(resource); if (resource.state === 'complete') releaseWriter?.();
        const slot = lifecycle.pending;
        if (slot?.record && slot.record !== resource) registry.finish(slot.record);
      }, () => registry.finish(resource, false));
    } });
    resource.stop = code => closePromise ?? shutdown(code);
    function shutdown(code) {
      closed = true; terminal ??= code; clearTimer(idle);
      const slot = lifecycle.pending;
      const stopped = lifecycle.stop();
      if (!lifecycle.worker && !resource.cleaning) { registry.cleanup(resource); registry.finish(resource); }
      if (slot) {
        if (slot.record !== resource) {
          registry.cleanup(slot.record);
          stopped.then(() => registry.finish(slot.record), () => registry.finish(slot.record, false));
        }
        lifecycle.finish(slot, productFailure(terminal));
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
          if (maintenance) releaseWriter = claimMaintenanceWriter(message.fileIdentity,readSet);
          instance.postMessage({ kind: 'identity-ack', operation: slot.operation });
        } catch (error) { shutdown(error.code ?? 'reader_failed'); }
        return;
      }
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
          if (method !== 'getContextReadCapabilities' && (credential === undefined || credential === null)) fail('authority_required');
          input = boundedData(payload); token = method === 'getContextReadCapabilities' ? null : boundedData(credential, 16384);
          if (method !== 'getContextReadCapabilities' && credentialDigest(token) !== issuedBinding.credentialDigest) fail('authority_required');
          if (JSON.stringify(contextReadSet(input.readSet)) !== JSON.stringify(readSet)) fail('invalid_read_set');
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
      const outbound = opening ? openingData : { method, input, credential: token, request: callRequest, operation, frame: callFrame };
      operationMessage(outbound);
      const record = opening ? resource : registry.register(owner.owner, { path: options.path, domain: host.moduleUrl, parent: resource, frame: callFrame });
      let subscription;
      const detach = () => {
        const previous = subscription; subscription = undefined;
        previous?.[Symbol.dispose]();
      };
      return new Promise(resolve => {
        const slot = { resolve, operation, record, signal, open: opening, detach }; lifecycle.pending = slot;
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
            const instance = spawnWorker(openingData);
            lifecycle.worker = instance;
            instance.stdout?.resume(); instance.stderr?.resume();
            instance.on('message', data => message(instance, data));
            instance.on('error', () => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed'); });
            instance.on('exit', () => { if (!closed && lifecycle.worker === instance) shutdown('reader_failed'); });
          } else {
            lifecycle.worker.ref();
            lifecycle.worker.postMessage(outbound);
          }
        } catch { shutdown('reader_failed'); }
      }).finally(() => {
        // Also disposes a handle returned after synchronous registration reentry.
        try { detach(); } catch { /* Public settlement is already terminal. */ }
      });
    }
    const opened = await dispatch('open', null, null, { signal }, admitted, true);
    if (!opened.ok || !ready) throw coded(opened.error?.code ?? 'reader_failed', resource.id);
    const call = (method, input, credential, control) => {
      const entered = now();
      try { return dispatch(method, input, credential, control, entered); }
      catch (error) { return Promise.resolve(productFailure(error.code)); }
    };
    return Object.freeze({
      getContextReadCapabilities(control = {}) {
        // Public configuration only, no credential/private projection observation.
        return call('getContextReadCapabilities', { readSet, deadlineMs: 1000 }, null, control);
      },
      ...(!maintenance ? { fetchCandidateEvidence: (input, credential, control) => call('fetchCandidateEvidence', input, credential, control),
      findCandidates: (input, credential, control) => call('findCandidates', input, credential, control),
      contextRead: (input, credential, control) => call('contextRead', input, credential, control) } : {}),
      getContextIndexStatus: (input, credential, control) => call('getContextIndexStatus', input, credential, control),
      ...(maintenance ? { refreshContextIndex: (input, credential, control) => call('refreshContextIndex', input, credential, control) } : {}),
      close() {
        return closePromise ??= (async () => {
          if (!closed && !lifecycle.pending && lifecycle.worker) {
            // Graceful native close receives an independent cleanup acknowledgement.
            closed = true; clearTimer(idle); registry.cleanup(resource);
            const instance = lifecycle.worker;
            await new Promise((resolve, reject) => {
              instance.ref();
              instance.once('exit', code => code === 0 ? resolve() : reject(coded('reader_failed')));
              instance.once('error', reject);
              instance.postMessage({ method: 'close' });
            }).then(() => { registry.finish(resource); if (resource.state === 'complete') releaseWriter?.(); }, () => registry.finish(resource, false));
            lifecycle.worker = undefined;
          } else await shutdown('store_closed');
          await resource.delivery;
        })();
      },
    });
  };
}
export const openContextProductReader = createProductReaderRuntime();

export const openContextIndexMaintainer = createProductReaderRuntime({ maintenance: true });
