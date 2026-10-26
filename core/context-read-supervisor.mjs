import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drainNative } from './context-product-telemetry.mjs';
import { fail } from './validation.mjs';

export const SUPERVISOR_LIMITS = Object.freeze({ live: 256, completed: 1024, metadataBytes: 1048576,
  diagnosticBytes: 16777216, historyMs: 300000 });
const processKey = Symbol.for('context-read-product-v1.1/supervision');
const processState = globalThis[processKey] ??= { owners: new WeakMap(), registry: null };
const owners = processState.owners;
const statusKeys = ['cleanupId', 'state', 'workerStopped', 'nativeDisposed', 'leasesReleased', 'providersSettled', 'telemetry', 'expiresAt'];

// A factory is internal to permit deterministic clocks. Public supervisors all
// use the single registry below; a new supervisor never creates a new quota.
export function createSupervisorRegistry({ now = () => Number(process.hrtime.bigint()) / 1e6, limits = SUPERVISOR_LIMITS } = {}) {
  const records = new Map(), history = new Map(), reservations = new Map();
  let live = 0, metadataBytes = 0, diagnosticBytes = 0;
  function remove(record) {
    if (!history.delete(record.id)) return;
    metadataBytes -= record.metadataBytes; diagnosticBytes -= record.diagnosticBytes;
    records.delete(record.id); record.owner.records.delete(record);
  }
  function expire() {
    const time = now();
    for (const record of history.values()) if (time >= record.expiresAt) remove(record);
    for (const [key, cutoff] of reservations) if (time >= cutoff) reservations.delete(key);
  }
  function status(record) {
    if (record.resources && record.expiresAt === null) {
      const state = new Int32Array(record.resources);
      record.leasesReleased = Atomics.load(state, 0) === Atomics.load(state, 1);
      record.providersSettled = Atomics.load(state, 2) === Atomics.load(state, 3);
    }
    return Object.freeze(Object.fromEntries(statusKeys.map(key => [key, key === 'cleanupId' ? record.id : record[key]])));
  }
  function lookup(owner, id) {
    expire();
    const record = records.get(id);
    if (!record || record.owner !== owner) fail('invalid_input');
    return record;
  }
  function quarantine(key, identity, domain) {
    for (const record of records.values()) {
      if (!record.safety || record.domain !== domain) continue;
      if (record.key === key || identity && record.identity === identity) fail(record.state === 'failed' ? 'reader_failed' : 'read_in_progress');
    }
  }
  function finalize(record, fields, diagnostics) {
    if (record.expiresAt !== null) return;
    Object.assign(record, fields);
    record.telemetry = diagnostics.coverage;
    record.diagnostics = diagnostics;
    record.state = ['workerStopped', 'nativeDisposed', 'leasesReleased', 'providersSettled'].every(k => record[k]) ? 'complete' : 'failed';
    if (record.state === 'failed') {
      record.safety = true;
      record.reject(Object.assign(Error('reader_failed'), { code: 'reader_failed' }));
      return;
    }
    record.safety = false; live--;
    record.expiresAt = now() + limits.historyMs;
    const delivery = Object.freeze({ ...status(record), diagnostics });
    record.resolve(delivery);
    record.metadataBytes = 2 * Buffer.byteLength(JSON.stringify(status(record)));
    record.diagnosticBytes = Buffer.byteLength(JSON.stringify(diagnostics));
    if (record.diagnosticBytes > limits.diagnosticBytes) {
      // Waiting drains already own delivery; otherwise explicitly lose coverage.
      record.diagnostics = { coverage: 'incomplete', records: [] };
      record.telemetry = 'incomplete'; record.diagnosticBytes = Buffer.byteLength(JSON.stringify(record.diagnostics));
      record.delivery = Promise.resolve(Object.freeze({ ...status(record), diagnostics: record.diagnostics }));
    }
    record.metadataBytes = 2 * Buffer.byteLength(JSON.stringify(status(record)));
    // Completed history retains sanitized delivery only, never the bootstrap,
    // path/domain indexes, Worker closures, shared buffers or owner resources.
    record.key = record.domain = record.identity = record.stop = record.parent = record.resources = record.frame = null;
    record.resolve = record.reject = null;
    history.set(record.id, record); metadataBytes += record.metadataBytes; diagnosticBytes += record.diagnosticBytes;
    while (history.size > limits.completed || metadataBytes > limits.metadataBytes || diagnosticBytes > limits.diagnosticBytes) remove(history.values().next().value);
  }
  function register(owner, { path, domain, frame, parent, request, resources }) {
    expire();
    if (owner.closed) fail('store_closed');
    if (live >= limits.live) fail('read_in_progress');
    const key = resolve(path);
    quarantine(key, parent?.identity, domain);
    if (request) {
      const keys = [request.handleId, request.requestId, request.credentialBindingId];
      if (keys.some(key => reservations.has(key))) fail('authority_required');
      if (reservations.size + keys.length > limits.live * 3) fail('read_in_progress');
      for (const key of keys) reservations.set(key, Number(BigInt(request.requestCutoffMonoNs)) / 1e6);
    }
    let resolveDelivery, reject;
    const delivery = new Promise((resolve, refused) => { resolveDelivery = resolve; reject = refused; });
    void delivery.catch(() => {});
    const record = { id: randomUUID(), owner, key, domain, frame, parent, resources, identity: parent?.identity,
      state: 'pending', workerStopped: true, nativeDisposed: true, leasesReleased: true, providersSettled: true,
      telemetry: frame ? 'pending' : 'disabled', expiresAt: null, safety: false, cleaning: false,
      delivery, resolve: resolveDelivery, reject, diagnostics: null, draining: false, stop: null };
    records.set(record.id, record); owner.records.add(record); live++;
    return record;
  }
  function supervisor() {
    const owner = { records: new Set(), closed: false };
    const api = Object.freeze({
      getCleanupStatus(id) { return status(lookup(owner, id)); },
      drain(id) {
        if (id !== undefined) { const record = lookup(owner, id); record.draining = true; return record.delivery; }
        expire(); return Promise.all([...owner.records].filter(r => r.cleaning).map(r => { r.draining = true; return r.delivery; }));
      },
      ackCleanup(id) {
        const record = lookup(owner, id);
        if (record.state === 'failed') fail('reader_failed');
        if (record.expiresAt === null) fail('read_in_progress');
        remove(record);
      },
      close() {
        owner.closed = true;
        const active = [...owner.records].filter(r => r.expiresAt === null);
        for (const record of active) { record.draining = true; record.stop?.('store_closed'); }
        return Promise.all(active.map(r => r.delivery));
      },
    });
    owners.set(api, { registry: instance, owner }); return api;
  }
  const instance = {
    supervisor, register,
    bind(record, identity) { quarantine(record.key, identity, record.domain); record.identity = identity; },
    cleanup(record) { record.cleaning = true; record.safety = true; },
    finalize,
    finish(record, stopped = true) {
      record.cleaning = true;
      let diagnostics;
      try { diagnostics = drainNative(record.frame, stopped); }
      catch { diagnostics = { coverage: 'incomplete', records: [] }; }
      const state = record.resources && new Int32Array(record.resources);
      finalize(record, { workerStopped: stopped, nativeDisposed: stopped,
        leasesReleased: !state || Atomics.load(state, 0) === Atomics.load(state, 1),
        providersSettled: !state || Atomics.load(state, 2) === Atomics.load(state, 3) }, diagnostics);
    },
    // Explicit recovery is internal/operator-only and requires a disposal proof.
    recover(record, verifyDisposal) {
      if (typeof verifyDisposal !== 'function') fail('reader_failed');
      const proof = verifyDisposal();
      const state = record.resources && new Int32Array(record.resources);
      if (state && (Atomics.load(state, 0) !== Atomics.load(state, 1) || Atomics.load(state, 2) !== Atomics.load(state, 3))) fail('reader_failed');
      if (record.state !== 'failed' || !proof || !['workerStopped', 'nativeDisposed', 'leasesReleased', 'providersSettled'].every(k => proof[k] === true)) fail('reader_failed');
      record.state = 'pending';
      record.delivery = new Promise((resolve, reject) => { record.resolve = resolve; record.reject = reject; });
      void record.delivery.catch(() => {});
      finalize(record, proof, record.diagnostics);
    },
    counters() { expire(); return { live, completed: history.size, metadataBytes, diagnosticBytes, reservations: reservations.size, records: records.size }; },
  };
  return instance;
}
const registry = processState.registry ??= createSupervisorRegistry();
export const createContextReadSupervisor = () => registry.supervisor();
export function supervisorOwner(supervisor) {
  const owner = owners.get(supervisor);
  if (!owner) fail('invalid_input');
  return owner;
}
