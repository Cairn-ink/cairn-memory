// Service-owned, authority-free standby resources. Never a request queue.
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

// Compatibility identity only: directory URL construction loads no module.
const engine = new URL('.', import.meta.url).href + 'context-product-worker.mjs';
export const READER_POOL_COMPATIBILITY = JSON.stringify({
  protocol: 'context-reader-pool-v1', engine, runtime: process.version, oldGenerationMiB: 192,
});
export const READER_POOL_BOOTSTRAP = 'context-reader-pool-bootstrap';
const spawn = (data, options) => new Worker(new URL('./context-product-reader-pool-worker.mjs', import.meta.url),
  { ...options, workerData: data });

export function createReaderWorkerPool({ spawnWorker = spawn, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const generation = randomUUID(), idle = new Set(), ready = [];
  const counts = { hits: 0, misses: 0, startupFailures: 0 };
  let loading, retry, failures = 0, closed = false, closing;
  const count = name => { counts[name] = Math.min(Number.MAX_SAFE_INTEGER, counts[name] + 1); };
  const later = () => queueMicrotask(refill);

  function backoff() {
    if (closed || retry) return;
    const ms = Math.min(1000, 25 * 2 ** Math.min(failures++, 6));
    retry = setTimer(() => {
      retry = undefined;
      refill();
    }, ms);
    retry.unref?.();
  }

  function forget(entry) {
    if (!idle.delete(entry)) return;
    clearTimer(entry.timer);
    const at = ready.indexOf(entry);
    if (at !== -1) ready.splice(at, 1);
    if (loading === entry) loading = undefined;
    entry.worker.off('message', entry.message);
    entry.worker.off('error', entry.error);
    entry.worker.off('exit', entry.exit);
    later();
  }

  function retire(entry) {
    if (entry.stopping) return entry.stopping;
    entry.state = 'retiring';
    clearTimer(entry.timer);
    const at = ready.indexOf(entry);
    if (at !== -1) ready.splice(at, 1);
    // Keep a failed loading entry until stopped: a retry must not overlap it.
    // Termination resolves only after the native Worker has stopped. Retain the
    // ledger entry on rejection, unless an independent exit already proved it.
    entry.stopping = Promise.resolve()
      .then(() => entry.worker.terminate())
      .then(value => {
        forget(entry);
        return value;
      });
    void entry.stopping.catch(() => {});
    return entry.stopping;
  }

  function failed(entry) {
    if (entry.state === 'retiring' || entry.state === 'assigned') return;
    if (!closed) {
      count('startupFailures');
      backoff();
    }
    void retire(entry);
  }

  function refill() {
    if (closed || retry || loading || ready.length >= 2 || idle.size >= 3) return;
    let worker;
    try {
      worker = spawnWorker({ compatibility: READER_POOL_COMPATIBILITY, generation }, {
        env: {}, execArgv: [], stdout: true, stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 192 },
      });
    } catch {
      count('startupFailures');
      backoff();
      return;
    }
    const entry = { worker, state: 'loading' };
    idle.add(entry);
    loading = entry;
    entry.message = message => {
      if (entry.state !== 'loading' || message?.kind !== 'context-reader-pool-ready' ||
          message.compatibility !== READER_POOL_COMPATIBILITY || message.generation !== generation ||
          Object.keys(message).length !== 3) {
        failed(entry);
        return;
      }
      clearTimer(entry.timer);
      loading = undefined;
      failures = 0;
      entry.state = 'ready';
      ready.push(entry);
      later();
    };
    entry.error = () => failed(entry);
    entry.exit = () => {
      if (!closed && entry.state !== 'retiring') {
        count('startupFailures');
        backoff();
      }
      forget(entry);
    };
    worker.on('message', entry.message);
    worker.on('error', entry.error);
    worker.on('exit', entry.exit);
    worker.stdout?.resume();
    worker.stderr?.resume();
    worker.unref();
    entry.timer = setTimer(() => failed(entry), 5000);
    entry.timer.unref?.();
  }

  refill();
  return Object.freeze({
    take(engineUrl) {
      if (!closed && engineUrl === engine) {
        while (ready.length) {
          const entry = ready.shift();
          if (entry.worker.threadId === -1) {
            failed(entry);
            continue;
          }
          // Ownership leaves the idle ledger before any authority is handed off.
          entry.state = 'assigned';
          forget(entry);
          count('hits');
          let bootstrapped = false;
          return {
            worker: entry.worker,
            bootstrap(data) {
              if (bootstrapped) throw Error('reader_pool_bootstrap_reused');
              bootstrapped = true;
              entry.worker.postMessage({ kind: READER_POOL_BOOTSTRAP, generation, data },
                data.semanticPort ? [data.semanticPort] : []);
            },
          };
        }
      }
      count('misses');
      return undefined;
    },
    diagnostic() { return Object.freeze({ ...counts }); },
    close() {
      if (closing) return closing;
      closed = true;
      clearTimer(retry);
      retry = undefined;
      const stops = [...idle].map(retire);
      return closing = Promise.allSettled(stops).then(results => {
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      });
    },
  });
}
