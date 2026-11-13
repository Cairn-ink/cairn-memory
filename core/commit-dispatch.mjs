import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { fail } from './validation.mjs';
import { withContentSuppressionRequest } from './content-suppression-storage.mjs';

// Internal host seam. Registries contain connection identities and diagnostics,
// never request data. The attempt closure and detached output stay on its stack.
const opening = new AsyncLocalStorage(), requests = new AsyncLocalStorage(), attempts = new AsyncLocalStorage();
const bindings = new WeakMap();
const openingHost = () => { const scope = opening.getStore(); return scope?.active ? scope.host : undefined; };
const busy = error => error?.code === 'ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) &&
  [5, 6].includes(error.errcode & 0xff) || error?.code === 'storage_busy';
const busyResult = value => value?.ok === false && value.error?.code === 'storage_busy';

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
    host.connections.add(new WeakRef(db));
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
  onAwait, onBackoff, signal: hostSignal } = {}) {
  const host = {
    connections: new Set(),
    dispatch(db, work, deadline, { compensating = false } = {}) {
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
        const state = { db, commits: 0 };
        const { restoreTimeoutMs } = bindings.get(db);
        try {
          db.exec('PRAGMA busy_timeout = 5');
          const value = withContentSuppressionRequest(() => attempts.run(state, work), { fresh: true });
          // Never await caller work. An async transaction closure is invalid.
          if (value && typeof value.then === 'function') fail('storage_error');
          if (!busyResult(value)) { checkIdle('return'); return { value }; }
          if (state.commits) return { value };
        } catch (error) {
          checkIdle('failure');
          if (!busy(error)) throw error;
          if (state.commits) throw error;
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
        if (left < 5) fail('storage_busy');
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
        if (end - now() < 5) fail('storage_busy');
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
      try { return opening.run(scope, work); }
      finally { scope.active = false; }
    },
    run(work, { signal, check, deadlineAt } = {}) {
      return requests.run({ signal, check, deadlineAt }, work);
    },
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
