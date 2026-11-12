import { AsyncLocalStorage } from 'node:async_hooks';
import { fail } from './validation.mjs';

// Only the async invocation owns these maps. Services never register scoped
// state in a process-wide collection, including while detached work settles.
const requests = new AsyncLocalStorage();

export function createRawSearchRequestScope() {
  const states = new Map();
  let closed = false;
  return Object.freeze({
    run(work) {
      if (closed) fail('source_unavailable');
      return requests.run({ states, isClosed: () => closed }, work);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const state of states.values()) state.close();
      states.clear();
    },
    // Content-free lifecycle observation; no text, tickets or handles escape.
    inspect() {
      let prepared = 0, searches = 0, routes = 0;
      for (const state of states.values()) {
        prepared += state.prepared.size; searches += state.searches.size;
        routes += state.routes.size;
      }
      return { closed, services: states.size, prepared, searches, routes };
    },
  });
}

export async function withRawSearchRequestScope(work, { signal } = {}) {
  const scope = createRawSearchRequestScope();
  const abort = () => scope.close();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) scope.close();
    return await scope.run(() => work(scope));
  } finally {
    signal?.removeEventListener('abort', abort);
    scope.close();
  }
}

// Internal service seam. A closed inherited async context must never fall back
// to legacy storage, even if it has not previously touched this service.
export function rawSearchRequestState(owner, create) {
  const request = requests.getStore();
  if (!request) return undefined;
  if (request.isClosed()) fail('source_unavailable');
  let state = request.states.get(owner);
  if (!state) request.states.set(owner, state = create());
  return state;
}
