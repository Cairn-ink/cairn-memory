// Opening and operation deadlines share the native boundary, including cached
// statements. Disposal must remain possible after the caller's clock expires.
export function rawSearchSqlite(native, check) {
  const wrap = object => {
    const proxy = new Proxy(object, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function' || key === 'constructor') return value;
      return (...args) => {
        const cleanup = key === 'close' || key === 'return' || key === Symbol.dispose ||
          key === 'exec' && /^ROLLBACK\b/.test(args[0]);
        if (!cleanup) check();
        const result = Reflect.apply(value, target, args);
        return key === 'prepare' || key === 'iterate' ? wrap(result) : result === target ? proxy : result;
      };
    } });
    return proxy;
  };
  return wrap(native);
}
