import { performance } from 'node:perf_hooks';
import { absolutePath, closed, fail, refusal, QUARANTINED } from './common.mjs';
import { verifyPack } from './pack.mjs';
import { startBundle } from './bundle.mjs';
import { contextBudget, consumeLocalReservation } from '../../core/context-read-budget.mjs';
const shared = new Map();
export function localPolicy(maxRequests) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) fail('invalid_input');
  return Object.freeze({ family: 'local', maxRequests, maxConcurrent: 1, maxBatchDocuments: 1 });
}
function selection(value) {
  closed(value, ['packPath', 'threads', 'maxRequests']); absolutePath(value.packPath);
  const threads = value.threads === undefined ? 4 : value.threads;
  if (!Number.isInteger(threads) || threads < 1 || threads > 64) fail('invalid_input');
  return { packPath: value.packPath, threads, policy: localPolicy(value.maxRequests) };
}
// Construction injection is intentionally separate from the public options;
// the CLI never supplies a catalog, loader, environment or alternate runner.
export function localEmbeddingFactory({ verify = verifyPack, start = startBundle, registry = shared } = {}) {
  return async function create(value) {
    const { packPath, threads, policy } = selection(value);
    const pack = await verify(packPath), binding = JSON.stringify([pack.metadata.id, pack.metadata.revision]);
    let entry = registry.get(binding);
    if (entry && entry.threads !== threads) fail('invalid_input');
    if (!entry) {
      entry = { threads, owners: 0, bundle: null, starting: null, closing: null };
      registry.set(binding, entry);
      entry.starting = Promise.resolve().then(() => start(pack, threads)).then(bundle => { entry.bundle = bundle; return bundle; });
    }
    if (entry.closing) { await entry.closing; return create(value); }
    entry.owners++;
    let bundle;
    try { bundle = await entry.starting; }
    catch (e) {
      entry.quarantined ||= e?.[QUARANTINED] === true;
      if (--entry.owners === 0 && !entry.quarantined && registry.get(binding) === entry) registry.delete(binding);
      throw e;
    }
    let closedHandle = false, closePromise;
    const raw = { ...pack.metadata, embed: (texts, options) => bundle.embed(texts, options) };
    const dispatch = contextBudget({ embedder: raw, policy, budgetConfigured: true });
    const embedder = Object.freeze({ ...pack.metadata, embed(texts, options = {}) {
      if (closedHandle) return Promise.reject(refusal('provider_error'));
      if (consumeLocalReservation(options.localReservation, raw)) return raw.embed(texts, options);
      const signal = options.signal ?? new AbortController().signal;
      return dispatch(raw, texts, { signal, deadlineAt: Math.min(performance.now() + 5000, options.deadlineAt ?? Infinity), guard: options.beforeDispatch ?? (() => {}) });
    } });
    return Object.freeze({ embedder, policy,
      localStatus: () => closedHandle ? Object.freeze({ state: 'closed', reason: 'closed' }) : bundle.localStatus(),
      close() {
        if (closePromise) return closePromise;
        closedHandle = true;
        closePromise = (async () => {
          if (--entry.owners === 0) {
            entry.closing = bundle.close();
            await entry.closing;
            if (registry.get(binding) === entry) registry.delete(binding);
          }
        })(); return closePromise;
      }
    });
  };
}
export const createLocalContextEmbedding = localEmbeddingFactory();
