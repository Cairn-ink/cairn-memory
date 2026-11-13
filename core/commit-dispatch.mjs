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

export function bindCommitConnection(db, source) {
  const host = source ? bindings.get(source)?.host : openingHost();
  if (host && !bindings.has(db)) {
    const binding = { host, db };
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
export const commitBusyTimeout = value => bindings.has(value) || openingHost() ? 5 : undefined;
export function recordCommit(db) {
  const attempt = attempts.getStore();
  if (attempt?.db === db) attempt.commits++;
}

// Called only with an engine-owned synchronous closure encompassing one complete
// transaction (including its original guards), before any success projection.
export function dispatchCommit(connection, work, deadline) {
  const binding = bindings.get(connection);
  if (!binding) return work();
  return binding.host.dispatch(binding.db, work, deadline);
}

export function createCommitDispatcher({ now = () => performance.now(), random = Math.random,
  onAwait, onBackoff } = {}) {
  const host = {
    connections: new Set(),
    dispatch(db, work, deadline) {
      if (typeof work !== 'function' || types.isAsyncFunction(work) || types.isGeneratorFunction(work)) fail('storage_error');
      const scope = requests.getStore();
      const started = now();
      const remaining = deadline?.remainingMs ? deadline.remainingMs(Number.MAX_SAFE_INTEGER) : Infinity;
      const end = Math.min(scope?.deadlineAt ?? started + 5000, started + remaining);
      const checkIdle = point => {
        if (!db.isOpen) fail('store_closed');
        const refuseActive = () => { try { db.close(); } catch { /* Refuse reuse even when native close fails. */ } fail('storage_transaction_active'); };
        if (db.isTransaction !== false) refuseActive();
        onAwait?.({ point, isOpen: db.isOpen, isTransaction: db.isTransaction });
        // A diagnostic callback cannot leave a transaction open either.
        if (db.isTransaction !== false) refuseActive();
      };
      const checkAuthority = () => {
        if (scope?.signal?.aborted) fail('authority_required');
        scope?.check?.();
      };
      const tryCommit = () => {
        checkAuthority();
        checkIdle('attempt');
        if (end - now() < 5) fail('storage_busy');
        const state = { db, commits: 0 };
        try {
          const value = withContentSuppressionRequest(() => attempts.run(state, work), { fresh: true });
          // Never await caller work. An async transaction closure is invalid.
          if (value && typeof value.then === 'function') fail('storage_error');
          if (!busyResult(value)) { checkIdle('return'); return { value }; }
          if (state.commits) return { value };
        } catch (error) {
          checkIdle('failure');
          if (!busy(error)) throw error;
          if (state.commits) throw error;
        }
        return null;
      };
      const first = tryCommit();
      if (first) return first.value;
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
          const signal = scope?.signal;
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
    run(work, { signal, check, deadlineAt = now() + 5000 } = {}) {
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
  });
}
