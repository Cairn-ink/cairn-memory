import { MemoryStoreError } from './validation.mjs';

// Budget exhaustion is transient even inside a foreign schema attestation.
export function rawSearchDeadline() {
  throw Object.assign(new MemoryStoreError('search_deadline'),{reason:'deadline'});
}

// Opening and operation deadlines share the native boundary, including cached
// statements. Disposal must remain possible after the caller's clock expires.
export function rawSearchSqlite(native, check) {
  let interrupted=false;
  const wrap = object => {
    const proxy = new Proxy(object, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function' || key === 'constructor') return value;
      return (...args) => {
        const cleanup = key === 'close' || key === 'return' || key === Symbol.dispose ||
          key === 'exec' && (/^ROLLBACK\b/.test(args[0]) || interrupted && /^PRAGMA query_only=(?:ON|OFF)$/.test(args[0]));
        if (!cleanup) {
          try { check(); interrupted=false; } catch(error) { interrupted=true; throw error; }
        }
        const result = Reflect.apply(value, target, args);
        return key === 'prepare' || key === 'iterate' ? wrap(result) : result === target ? proxy : result;
      };
    } });
    return proxy;
  };
  return wrap(native);
}
