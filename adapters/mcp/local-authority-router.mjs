import { AsyncLocalStorage } from 'node:async_hooks';

// Routes contain only opaque identities and authority ports, never inputs.
// Dispatch stays synchronous: local access ports delete their token on return.
export function createLocalAuthorityRouter() {
  const current = new AsyncLocalStorage(), tokens = new WeakMap(), grants = new WeakMap();
  const authority = kind => ({
    authorize(request, token) {
      const owner = tokens.get(token);
      if (!owner || owner.closed || current.getStore() !== owner) return null;
      const port = owner.ports[kind];
      const grant = port?.authorize(request, token);
      if (grant) grants.set(grant, { owner, port, kind });
      return grant ?? null;
    },
    isCurrent(grant, request) {
      const route = grants.get(grant);
      if (!route || route.kind !== kind || route.owner.closed || current.getStore() !== route.owner) return null;
      return route.port.isCurrent(grant, request);
    },
  });
  const check = owner => { if (owner?.closed) throw Object.assign(Error('authority_required'), { code: 'authority_required' }); };
  return { authority,
    // A provider may settle after its requesting connection closes. Refuse
    // both a later invocation and that late result without interrupting SQL.
    protect(port) {
      if (!port) return port;
      const wrap = value => {
        return (...args) => {
          const owner = current.getStore(); check(owner);
          const result = Reflect.apply(value, port, args);
          if (result && typeof result.then === 'function') return Promise.resolve(result).then(value => { check(owner); return value; });
          check(owner); return result;
        };
      };
      // Engine model ports deliberately reject Proxies. Copy descriptors,
      // including frozen ports and inherited methods, without invoking getters.
      const copy = source => {
        const prototype = Object.getPrototypeOf(source);
        const result = Object.create(prototype && prototype !== Object.prototype ? copy(prototype) : prototype);
        for (const key of Reflect.ownKeys(source)) {
          const descriptor = Object.getOwnPropertyDescriptor(source, key);
          if (typeof descriptor.value === 'function') descriptor.value = wrap(descriptor.value);
          Object.defineProperty(result, key, descriptor);
        }
        return result;
      };
      return copy(port);
    },
    register(ports) {
      const owner = { ports, closed: false };
      return {
        run: work => current.run(owner, work),
        revoke() { owner.closed = true; owner.ports = {}; },
        core(core) {
          // Core facades are frozen. Copy method bindings instead of placing
          // a get trap over non-configurable, non-writable properties.
          return Object.fromEntries(Object.entries(core).map(([key, value]) => [key,
            typeof value !== 'function' ? value : (input, token) => {
              if (owner.closed) return { ok: false, error: { code: 'authority_required', retryable: false } };
              if (!token) return Reflect.apply(value, core, [input]);
              // A token already routed to another owner can never be rebound.
              if (tokens.has(token) && tokens.get(token) !== owner) return { ok: false, error: { code: 'authority_required', retryable: false } };
              tokens.set(token, owner);
              try { return Reflect.apply(value, core, [input, token]); }
              finally { tokens.delete(token); }
            }]));
        },
      };
    },
  };
}
