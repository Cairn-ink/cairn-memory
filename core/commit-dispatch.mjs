import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { fail, MemoryStoreError } from './validation.mjs';
import { withContentSuppressionRequest } from './content-suppression-storage.mjs';

// Internal host seam. Registries contain connection identities and diagnostics,
// never request data. The attempt closure and detached output stay on its stack.
const opening = new AsyncLocalStorage(), requests = new AsyncLocalStorage(), attempts = new AsyncLocalStorage();
const bindings = new WeakMap();
const synchronousScopes = new AsyncLocalStorage();
export const APPROVED_SYNCHRONOUS_SCOPES = Object.freeze([
  'daemon start install', 'sidecar create or repair at open',
  'lazy Card storage init', 'read_role_task_context',
]);
export function withSynchronousCommitScope(label, work) {
  if (!APPROVED_SYNCHRONOUS_SCOPES.includes(label)) fail('storage_error');
  return synchronousScopes.run(label, work);
}
export function assertCommitWriteRouted(db, site = 'transaction') {
  const binding = bindings.get(db);
  if (!binding || attempts.getStore()?.db === db) return;
  const label = synchronousScopes.getStore();
  if (label) { binding.host.namedScopes.add(label); return; }
  binding.host.unroutedWrites++;
  if (binding.host.strict) {
    const error = new MemoryStoreError('unrouted_synchronous_write');
    error.site = site;
    throw error;
  }
}
export function dispatchSynchronousCommit(connection, work) {
  const binding = bindings.get(connection);
  if (!binding || attempts.getStore()?.db === binding.db) return work();
  return binding.host.dispatch(binding.db, work, undefined, { retry: false });
}
const deliveries = new AsyncLocalStorage();
// The facade's delivery resumes the successful attempt's suppression account.
// Failed attempts never become a delivery authority.
export const withCommitDelivery = work => withContentSuppressionRequest(() => deliveries.run({ resume: work => work() }, work));
export const inCommitDelivery = work => { const scope = deliveries.getStore(); return scope ? scope.resume(work) : work(); };
const openingHost = () => { const scope = opening.getStore(); return scope?.active ? scope.host : undefined; };
const busyBudgets = new WeakSet();
export const isCommitBusy = error => Boolean(error && busyBudgets.has(error));
const busy = error => error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) &&
  [5, 6].includes(error.errcode & 0xff) || isCommitBusy(error);
function exhausted() {
  const error = new MemoryStoreError('storage_busy');
  busyBudgets.add(error);
  throw error;
}
// Keep the public envelope byte-identical. Retry provenance lives only in
// the current attempt, never in a code-string inference or caller payload.
export function commitFailure(error, result) {
  const attempt = attempts.getStore();
  if (attempt && busy(error)) attempt.busyResults.add(result);
  return result;
}

export function bindCommitConnection(db, source, { canonical = true } = {}) {
  const host = source ? bindings.get(source)?.host : openingHost();
  if (host && canonical && bindings.has(db) && bindings.get(db).restoreTimeoutMs !== 5000) fail('storage_error');
  if (host && !bindings.has(db)) {
    const restoreTimeoutMs = db.prepare('PRAGMA busy_timeout').get().timeout;
    // Canonical and context-sidecar openers retain today's native wait. Only
    // the synchronous attempt below may temporarily shorten it.
    if (canonical && restoreTimeoutMs !== 5000) fail('storage_error');
    const binding = { host, db, restoreTimeoutMs };
    bindings.set(db, binding);
    const ref = new WeakRef(db), close = db.close;
    host.connections.add(ref);
    Object.defineProperty(db, 'close', { configurable: true, value() {
      try { return Reflect.apply(close, db, []); }
      finally { if (!db.isOpen) { host.connections.delete(ref); bindings.delete(db); } }
    } });
  }
  return db;
}
export function bindCommitRuntime(runtime, db) {
  const binding = bindings.get(db);
  if (binding) bindings.set(runtime, binding);
  return runtime;
}
export const hasCommitDispatcher = value => bindings.has(value);
export function withCommitBinding(source, work) {
  const binding = bindings.get(source);
  if (!binding) return work();
  const scope = { host: binding.host, active: true };
  try { return opening.run(scope, work); }
  finally { scope.active = false; }
}
export function recordCommit(db) {
  const attempt = attempts.getStore();
  if (attempt?.db === db) attempt.commits++;
}

// Called only with an engine-owned synchronous closure encompassing one complete
// transaction (including its original guards), before any success projection.
export function dispatchCommit(connection, work, deadline, options) {
  const binding = bindings.get(connection);
  if (!binding) return work();
  return binding.host.dispatch(binding.db, work, deadline, options);
}

export function createCommitDispatcher({ now = () => performance.now(), random = Math.random,
  onAwait, onBackoff, signal: hostSignal, strict = false } = {}) {
  const host = {
    connections: new Set(), namedScopes: new Set(), unroutedWrites: 0, strict,
    dispatch(db, work, deadline, { compensating = false, retry: retryAllowed = true } = {}) {
      if (typeof work !== 'function' || types.isAsyncFunction(work) || types.isGeneratorFunction(work)) fail('storage_error');
      const scope = compensating ? undefined : requests.getStore();
      const signal = compensating ? hostSignal : scope?.signal;
      const started = now();
      let end = Math.min(started + 5000, scope?.deadlineAt ?? Infinity);
      const checkIdle = point => {
        if (!db.isOpen) fail('store_closed');
        const refuseActive = () => { try { db.close(); } catch { /* Refuse reuse even when native close fails. */ } fail('storage_transaction_active'); };
        if (db.isTransaction !== false) refuseActive();
        onAwait?.({ point, isOpen: db.isOpen, isTransaction: db.isTransaction });
        // A diagnostic callback cannot leave a transaction open either.
        if (db.isTransaction !== false) refuseActive();
      };
      const checkAuthority = () => {
        if (hostSignal?.aborted) fail('store_closed');
        if (signal?.aborted) fail('authority_required');
        scope?.check?.();
      };
      const tryCommit = () => {
        checkAuthority();
        checkIdle('attempt');
        const state = { db, commits: 0, busyResults: new WeakSet() };
        const { restoreTimeoutMs } = bindings.get(db);
        try {
          db.exec('PRAGMA busy_timeout = 5');
          const value = withContentSuppressionRequest(() => attempts.run(state, () => {
            const value = work();
            const delivery = deliveries.getStore();
            if (delivery && !state.busyResults.has(value) && !(value && typeof value.then === 'function')) {
              delivery.resume = AsyncLocalStorage.snapshot();
            }
            return value;
          }), { fresh: true });
          // Never await caller work. An async transaction closure is invalid.
          if (value && typeof value.then === 'function') fail('storage_error');
          if (!state.busyResults.has(value)) { checkIdle('return'); return { value }; }
          if (state.commits || !retryAllowed) return { value };
        } catch (error) {
          checkIdle('failure');
          if (!busy(error)) throw error;
          if (state.commits || !retryAllowed) throw error;
        } finally {
          // checkIdle retires a connection with an active transaction. Keep
          // its fixed refusal, without attempting SQL on that closed handle.
          if (db.isOpen) db.exec(`PRAGMA busy_timeout = ${restoreTimeoutMs}`);
        }
        return null;
      };
      const first = tryCommit();
      if (first) return first.value;
      // The default attempt always runs. Only retries consume an explicit
      // caller budget; provider time never consumes an implicit request budget.
      let remaining = Infinity;
      try { if (!compensating && deadline?.remainingMs) remaining = deadline.remainingMs(Number.MAX_SAFE_INTEGER); }
      catch (error) { if (error?.code !== 'model_timeout') throw error; remaining = 0; }
      end = Math.min(end, now() + remaining);
      const retry = async () => {
        for (let attempt = 0; ; attempt++) {
        // BEGIN failure and rollback failure are distinguished by native state.
        checkIdle('backoff');
        checkAuthority();
        const left = end - now();
        if (left < 5) exhausted();
        const cap = Math.min(256, 16 * 2 ** Math.min(attempt, 4));
        const waitMs = Math.min(left, cap / 2 + random() * cap / 2);
        onBackoff?.({ attempt, waitMs, remainingMs: left });
        checkIdle('before_timer');
        try { await new Promise((resolve, reject) => {
          let timer;
          const finish = error => {
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve();
          };
          const abort = () => { try { checkAuthority(); } catch (error) { finish(error); } };
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => finish(), waitMs);
          if (signal?.aborted) abort();
        }); } finally { checkIdle('after_timer'); }
        checkAuthority();
        if (end - now() < 5) exhausted();
        const result = tryCommit();
        if (result) return result.value;
        }
      };
      return retry();
    },
  };
  return Object.freeze({
    open(work) {
      const scope = { host, active: true };
      try { return opening.run(scope, () => withSynchronousCommitScope('daemon start install', work)); }
      finally { scope.active = false; }
    },
    run(work, { signal, check, deadlineAt } = {}) {
      return requests.run({ signal, check, deadlineAt }, work);
    },
    inspectSynchronousWrites: () => ({ count: host.unroutedWrites, scopes: [...host.namedScopes].sort() }),
    inspectTransactions() {
      const result = [];
      for (const ref of host.connections) {
        const db = ref.deref();
        if (!db) { host.connections.delete(ref); continue; }
        result.push({ isOpen: db.isOpen, isTransaction: db.isOpen ? db.isTransaction : false });
      }
      return result;
    },
    // Internal test diagnostic: no native handles leave the engine.
    inspectBusyTimeouts() {
      return [...host.connections].flatMap(ref => {
        const db = ref.deref();
        return db?.isOpen ? [db.prepare('PRAGMA busy_timeout').get().timeout] : [];
      });
    },
  });
}
