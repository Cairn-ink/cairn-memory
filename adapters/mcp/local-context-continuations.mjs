import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const MAX_ENTRIES = 128, MAX_BYTES = 1024 * 1024, TTL_MS = 5 * 60 * 1000;
const stale = field => ({ ok: false, error: { code: field === 'snapshot' ? 'snapshot_stale' : 'cursor_stale', retryable: false } });

// Only signed engine metadata is retained. Neither a query nor response text
// enters this connection-owned table. Tokens fit both existing wire schemas.
export function createLocalContextContinuations({ now = () => performance.now() } = {}) {
  const entries = new Map();
  let bytes = 0, closed = false, timer;
  const remove = token => { const item = entries.get(token); if (item) bytes -= item.bytes; entries.delete(token); };
  const prune = () => { for (const [token, item] of entries) if (now() >= item.expires) remove(token); };
  function arm() {
    clearTimeout(timer); timer = undefined;
    if (closed || !entries.size) return;
    // Insertion order is expiry order: neither lookups nor reaping renew TTL.
    timer = setTimeout(() => { timer = undefined; prune(); arm(); },
      Math.max(1, entries.values().next().value.expires - now()));
    timer.unref();
  }
  function retain(field, value) {
    prune();
    const token = randomBytes(32).toString('base64url');
    const size = Buffer.byteLength(value) + Buffer.byteLength(token);
    if (closed || size > MAX_BYTES) return null;
    while (entries.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) remove(entries.keys().next().value);
    entries.set(token, { field, value, expires: now() + TTL_MS, bytes: size }); bytes += size;
    arm();
    return token;
  }
  return {
    unwrap(input) {
      prune();
      const copy = { ...input };
      for (const field of ['cursor', 'snapshot']) if (input[field] !== undefined) {
        const item = entries.get(input[field]);
        if (closed || !item || item.field !== field) return { error: stale(field) };
        copy[field] = item.value;
      }
      return { input: copy };
    },
    wrap(result) {
      if (!result.ok) return result;
      const value = { ...result.value };
      for (const [outgoing, field] of [['nextCursor', 'cursor'], ['snapshot', 'snapshot']]) {
        if (typeof value[outgoing] !== 'string') continue;
        const token = retain(field, value[outgoing]);
        if (!token) return stale(field);
        value[outgoing] = token;
      }
      return { ...result, value };
    },
    close() { closed = true; clearTimeout(timer); timer = undefined; entries.clear(); bytes = 0; },
    inspect() { prune(); return { entries: entries.size, bytes, closed }; },
  };
}
