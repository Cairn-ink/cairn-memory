import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const ttl = 5 * 60 * 1000;
const maxEntries = 128;
const maxBytes = 1024 * 1024;
const encoder = new TextEncoder();

export function createContinuations() {
  const entries = new Map();
  let bytes = 0;
  let timer;
  function remove(handle) {
    bytes -= entries.get(handle).size;
    entries.delete(handle);
  }
  function prune() {
    const now = performance.now();
    for (const [handle, entry] of entries) {
      if (entry.expires > now) break;
      remove(handle);
    }
  }
  function arm() {
    clearTimeout(timer);
    const first = entries.values().next().value;
    if (first) {
      timer = setTimeout(() => { prune(); arm(); }, Math.max(1, Math.ceil(first.expires - performance.now())));
      timer.unref();
    }
  }
  return {
    issue(kind, signed) {
      if (signed === null) return null;
      prune();
      const handle = randomBytes(32).toString('base64url');
      const size = encoder.encode(signed).length + handle.length;
      if (size > maxBytes) return null;
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
      entries.set(handle, { kind, signed, size, expires: performance.now() + ttl });
      bytes += size;
      arm();
      return handle;
    },
    get(kind, handle) {
      prune();
      const entry = entries.get(handle);
      return entry?.kind === kind ? entry.signed : undefined;
    },
    close() {
      clearTimeout(timer);
      entries.clear();
      bytes = 0;
    },
  };
}
