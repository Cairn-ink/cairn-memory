import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openRawSearch } from './raw-search-index.mjs';
import { rawNamespace } from './raw-input.mjs';
import { fail, object } from './validation.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const success = value => ({ ok: true, value });
const failure = error => ({ ok: false, error: { code: error?.code ?? 'raw_search_unavailable', retryable: true } });
const owners = new WeakMap();
export const localRawSearchManager = port => owners.get(port) ?? null;

/** Bounded, non-overlapping maintenance turns, owned by the core. */
export function createLocalRawSearch(path, crypto, { embedder, policy } = {}) {
  const embeddingPolicy = embedder ? rawEmbeddingPolicy(policy) : null;
  const entries = new Map();
  let timer, running, closing, closed = false, unsupported = false, serviced = 0;
  const unsupportedStatus = () => ({ state: 'unavailable', raw: 'unsupported_store', coverage: 'unknown' });
  const unsupportedSearch = () => ({ candidates: [], coverage: { status: 'unsupported_store' } });
  const maintenanceTurn = { version: 1, maxWaitMs: 25, createTurn() {
    return { enter: () => closed ? 'defer' : 'admitted', release() {} };
  } };
  const normalize = namespace => {
    const ns = rawNamespace(namespace);
    return { ...ns, projectId: ns.projectId || null };
  };
  function entryFor(readSet) {
    if (closed) fail('store_closed');
    if (!Array.isArray(readSet) || !readSet.length || readSet.length > 2) fail('invalid_read_set');
    const namespaces = readSet.map(normalize).sort((a,b) => Buffer.compare(Buffer.from(JSON.stringify(a)), Buffer.from(JSON.stringify(b))));
    if (namespaces.some(ns => ns.ownerId !== namespaces[0].ownerId) || new Set(namespaces.map(ns => JSON.stringify(ns))).size !== namespaces.length) fail('invalid_read_set');
    const key = hash(namespaces.length === 1 ? namespaces[0] : namespaces);
    if (!entries.has(key)) entries.set(key, { key, readSet: namespaces, token: {}, grants: new WeakMap(), readers: new Map(), service: null, opening: null, error: null, lastServed: 0, dirty: false });
    return entries.get(key);
  }
  async function serviceFor(entry, lexical = false) {
    if (lexical && embedder) {
      entry.lexical ??= { ...entry, service: null, opening: null, lexicalOnly: true };
      return serviceFor(entry.lexical);
    }
    if (closed) fail('store_closed');
    if (entry.service) return entry.service;
    if (!entry.opening) entry.opening = (async () => {
      if (path === ':memory:') fail('raw_search_backend_unavailable');
      const directory = resolve(path) + '.raw-search/' + entry.key;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const authority = {
        authorize(request, token) {
          if (closed || token !== entry.token) return null;
          const { input, ...binding } = request, grant = {};
          entry.grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
        },
        isCurrent: grant => closed ? null : entry.grants.get(grant) ?? null,
      };
      const service = await openRawSearch({ version: 'raw-search-v1', enabled: true, backend: 'local',
        path: resolve(path), directory, ownerId: entry.readSet[0].ownerId, readSet: entry.readSet,
        authority, crypto, maintenanceTurn, ...(embedder && !entry.lexicalOnly ? { embedder, policy: embeddingPolicy } : {}) });
      if (closed) { await service.close(); fail('store_closed'); }
      entry.error = null;
      return entry.service = service;
    })().finally(() => { entry.opening = null; });
    return entry.opening;
  }
  function arm(delay = 1000) {
    if (closed || unsupported || timer || running || path === ':memory:' || !entries.size) return;
    timer = setTimeout(() => {
      timer = null;
      running = tick().finally(() => { running = null; arm(); });
    }, delay);
    timer.unref();
  }
  async function tick() {
    const values = [...entries.values()];
    // Oldest service wins; dirty saves break ties without starving polling of
    // other-process writers. A finite namespace population remains required.
    values.sort((a,b)=>a.lastServed-b.lastServed||Number(b.dirty)-Number(a.dirty)||a.key.localeCompare(b.key));
    const entry=values[0];
    if(entry){entry.lastServed=++serviced;entry.dirty=false;}
    if (!entry || closed) return;
    try { await maintain(entry, await serviceFor(entry)); }
    catch (error) {
      entry.error = error?.code ?? 'raw_search_unavailable';
      // Optional indexing cannot fail capture. A fresh next turn recovers from
      // deadline or lock contention without permanently refusing the connection.
      const service = entry.service; entry.service = null;
      await service?.close().catch(() => {});
    }
  }
  async function maintain(entry, service) {
    // Explicit and scheduled maintenance share the same in-flight operation.
    // Capture only schedules a timer and never joins this provider work.
    if (!entry.maintaining) entry.maintaining = service.maintain({ maxItems: 16, maxMs: 25,
      embeddings: Boolean(embedder) }, entry.token).finally(() => { entry.maintaining = null; });
    return entry.maintaining;
  }
  async function search(entry, service, request) {
    const { semantic, ...input } = request;
    if (semantic !== undefined && typeof semantic !== 'boolean') fail('invalid_input');
    const reader = semantic === false ? await serviceFor(entry, true) : service;
    const result = await reader.search(input, entry.token);
    // Native readers each retain four search proofs. Remember which reader
    // issued a proof so copied candidates keep the native preparation contract.
    if (result.candidates.length) {
      entry.readers.set(result.candidates[0].proof, reader);
      while (entry.readers.size > 8) entry.readers.delete(entry.readers.keys().next().value);
    }
    entry.semantic = result.semantic;
    return result;
  }
  async function call(method, input) {
    try {
      object(input, ['namespace', ...(method === 'search' ? ['query', 'intent', 'semantic'] : [])]);
      const { namespace, ...request } = input, entry = entryFor([namespace]);
      if (unsupported) return success(method === 'search' ? unsupportedSearch() : unsupportedStatus());
      arm();
      const service = await serviceFor(entry);
      return success(await (method === 'status' ? service.status().then(status => ({ ...status,
        semantic: entry.semantic ?? { state: 'bm25-only', reason: embedder ? 'partial_coverage' : 'disabled' },
        embeddingBudget: embedder ? { scope: 'process', sharedWith: 'memory',
          maxRequests: embeddingPolicy.maxRequests, maxUsd: embeddingPolicy.maxUsd } : null })) : method === 'maintain'
        ? maintain(entry, service) : search(entry, service, request)));
    } catch (error) { return failure(error); }
  }
  const manager = {
    unsupportedStore() { unsupported = true; clearTimeout(timer); timer = null; },
    schedule(namespace) {
      const ns = normalize(namespace);
      const entry=[...entries.values()].find(entry=>entry.readSet.some(value=>same(value,ns)))??entryFor([ns]);
      entry.dirty=true;
      arm(0);
    },
    start() { arm(0); },
    /** Fixed read-set port for contextRead; credentials never enter tool input. */
    contextPort(readSet) {
      const entry = entryFor(readSet), handles = new WeakMap();
      const port = Object.freeze({
        async search(input) {
          if (closed) fail('store_closed');
          if (unsupported) return unsupportedSearch();
          arm(0); return search(entry, await serviceFor(entry), input);
        },
        async prepare(candidate, settings) {
          if (!entry.readSet.some(ns => same(ns, candidate?.namespace))) fail('authority_required');
          const service = entry.readers.get(candidate?.proof);
          if (!service || ![entry.service, entry.lexical?.service].includes(service)) fail('stale_publication');
          const handle = await service.prepare(candidate, settings, entry.token);
          handles.set(handle, service); return handle;
        },
        revalidate(selected) {
          if (closed) fail('store_closed');
          const service = Array.isArray(selected) && selected.length ? handles.get(selected[0]) : entry.service;
          if (!service || ![entry.service, entry.lexical?.service].includes(service) || !Array.isArray(selected) || selected.some(handle => handles.get(handle) !== service)) fail('stale_publication');
          // One native batch preserves final canonical validation across the
          // whole authorized read set, including personal + project reads.
          return service.revalidate(selected);
        },
      });
      owners.set(port, manager); return port;
    },
    methods: { searchRaw: input => call('search', input), maintainRawSearch: input => call('maintain', input),
      getRawSearchStatus: input => call('status', input) },
    close() {
      if (closing) return closing;
      closed = true; clearTimeout(timer); timer = null;
      return closing = (async () => {
        // Start native cancellation before joining a scheduled provider wait.
        const stopped = [...entries.values()].map(async entry => {
          const current = Promise.allSettled([entry.service?.close(), entry.lexical?.service?.close()]);
          await entry.opening?.catch(() => {}); await entry.lexical?.opening?.catch(() => {});
          await current;
        });
        await Promise.allSettled([running, ...stopped]);
        entries.clear();
      })();
    },
  };
  return manager;
}

// Memory's explicit local policy omits maxUsd because local calls are free;
// the native Raw policy requires that field even for local providers.
function rawEmbeddingPolicy(policy) {
  return { ...policy, ...(policy?.family === 'local' ? { maxUsd: 0 } : {}) };
}
