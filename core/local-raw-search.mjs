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

/** One bounded, non-overlapping lexical quantum per second, owned by the core. */
export function createLocalRawSearch(path, crypto) {
  const entries = new Map();
  let timer, running, closing, closed = false, next = 0;
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
    if (!entries.has(key)) entries.set(key, { key, readSet: namespaces, token: {}, grants: new WeakMap(), service: null, opening: null, error: null });
    return entries.get(key);
  }
  async function serviceFor(entry) {
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
        authority, crypto, maintenanceTurn });
      if (closed) { await service.close(); fail('store_closed'); }
      entry.error = null;
      return entry.service = service;
    })().finally(() => { entry.opening = null; });
    return entry.opening;
  }
  function arm(delay = 1000) {
    if (closed || timer || running || path === ':memory:' || !entries.size) return;
    timer = setTimeout(() => {
      timer = null;
      running = tick().finally(() => { running = null; arm(); });
    }, delay);
    timer.unref();
  }
  async function tick() {
    const values = [...entries.values()], entry = values[next++ % values.length];
    if (!entry || closed) return;
    try { await (await serviceFor(entry)).maintain({ maxItems: 16, maxMs: 25 }, entry.token); }
    catch (error) {
      entry.error = error?.code ?? 'raw_search_unavailable';
      // Optional indexing cannot fail capture. A fresh next turn recovers from
      // deadline or lock contention without permanently refusing the connection.
      const service = entry.service; entry.service = null;
      await service?.close().catch(() => {});
    }
  }
  async function call(method, input) {
    try {
      object(input, ['namespace', ...(method === 'search' ? ['query', 'intent'] : [])]);
      const { namespace, ...request } = input, entry = entryFor([namespace]);
      arm();
      const service = await serviceFor(entry);
      return success(await (method === 'status' ? service.status() : method === 'maintain'
        ? service.maintain({ maxItems: 16, maxMs: 25 }, entry.token) : service.search(request, entry.token)));
    } catch (error) { return failure(error); }
  }
  const manager = {
    schedule(namespace) {
      const ns = normalize(namespace);
      if (![...entries.values()].some(entry => entry.readSet.some(value => same(value, ns)))) entryFor([ns]);
      arm(0);
    },
    start() { arm(0); },
    /** Fixed read-set port for contextRead; credentials never enter tool input. */
    contextPort(readSet) {
      const entry = entryFor(readSet), handles = new WeakMap();
      const port = Object.freeze({
        async search(input) { arm(0); return (await serviceFor(entry)).search(input, entry.token); },
        async prepare(candidate, settings) {
          if (!entry.readSet.some(ns => same(ns, candidate?.namespace))) fail('authority_required');
          const service = await serviceFor(entry), handle = await service.prepare(candidate, settings, entry.token);
          handles.set(handle, service); return handle;
        },
        revalidate(selected) {
          if (closed) fail('store_closed');
          const service = entry.service;
          if (!service || !Array.isArray(selected) || selected.some(handle => handles.get(handle) !== service)) fail('stale_publication');
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
        await running;
        await Promise.allSettled([...entries.values()].map(async entry => {
          await entry.opening?.catch(() => {}); await entry.service?.close();
        }));
        entries.clear();
      })();
    },
  };
  return manager;
}
