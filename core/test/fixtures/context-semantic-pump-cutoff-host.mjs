// Offline only. Extend the existing semantic fixture with a real host lease,
// an opening rendezvous, and an embedder that can settle only through abort.
import { createContextReadHost as offlineHost } from '../../testing/context-semantic-host.mjs';
import { testClock } from '../../testing/context-product-test-clock.mjs';

// An RPC created after its cutoff schedules a zero-delay timeout. Deliver it
// at the current injected time, including when no later advance is needed.
// Otherwise an expired RPC can wait forever on a frozen test clock, unlike
// the native timer, and incorrectly exhaust the real disposal safety bound.
const schedule = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...args) => {
  const timer = schedule(fn, ms, ...args);
  if (ms <= 0) queueMicrotask(() => { void testClock.advance(0, { waitForWorkers: false }); });
  return timer;
};

export async function createContextReadHost(c) {
  const host = await offlineHost(c), control = new Int32Array(c.cutoffControl);
  if (c.semanticServiceBinding) {
    const embedding = host.contextEmbedding, embedder = embedding.embedder;
    return { ...host, contextEmbedding: { ...embedding, embedder: {
      ...embedder,
      async embed(texts, controls) {
        if (Atomics.load(control, 5) !== 1) {
          const result = await embedder.embed(texts, controls);
          Atomics.add(control, 9, 1);
          return result;
        }
        controls.beforeDispatch();
        Atomics.add(control, 6, 1); Atomics.notify(control, 6);
        try {
          return await new Promise((resolve, reject) => {
            const aborted = () => {
              Atomics.add(control, 7, 1); Atomics.notify(control, 7);
              reject(Object.assign(Error('offline embedding cancelled'), { code: 'timeout' }));
            };
            if (controls.signal.aborted) aborted();
            else controls.signal.addEventListener('abort', aborted, { once: true });
          });
        } finally {
          Atomics.add(control, 8, 1); Atomics.notify(control, 8);
        }
      },
    } } };
  }
  Atomics.add(control, 3, 1);
  const leaseTiming = new BigInt64Array(c.leaseTiming);
  const realNs = () => { const [seconds, nanos] = process.hrtime(); return BigInt(seconds) * 1000000000n + BigInt(nanos); };
  let closed = false;
  return {
    ...host,
    authorize(request, credential) {
      if (request.method === 'refreshContextIndex' && Atomics.compareExchange(control, 10, 1, 0) === 1) {
        Atomics.store(control, 11, 1); Atomics.notify(control, 11);
        while (Atomics.load(control, 12) === 0) Atomics.wait(control, 12, 0);
      }
      return host.authorize(request, credential);
    },
    // The Worker has registered close() as a lease and opened its facade
    // before evaluating host.counter to construct the product index.
    get counter() {
      if (Atomics.compareExchange(control, 0, 1, 0) === 1) {
        Atomics.store(control, 1, 1); Atomics.notify(control, 1);
        while (Atomics.load(control, 2) === 0) Atomics.wait(control, 2, 0);
      }
      return host.counter;
    },
    async close() {
      if (!closed) {
        Atomics.store(leaseTiming, 1, realNs());
        closed = true; Atomics.add(control, 14, 1); Atomics.notify(control, 14);
        if (Atomics.load(control, 13) === 1) {
          while (Atomics.load(control, 15) === 0) await Atomics.waitAsync(control, 15, 0).value;
        }
        if (Atomics.load(control, 13) === 2) throw new TypeError('synthetic close failure');
        Atomics.add(control, 4, 1);
        Atomics.store(leaseTiming, 2, realNs());
      }
    },
  };
}
