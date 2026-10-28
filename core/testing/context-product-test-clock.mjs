// Test-only clock domain. Import before product modules: reader factories capture
// their default timers at module evaluation. Workers enter through the bootstrap
// below so even bootstrap, SQLite admission and MessagePort deadlines share it.
import threads from 'node:worker_threads';
import timers from 'node:timers';
import { performance } from 'node:perf_hooks';
import { syncBuiltinESMExports } from 'node:module';

const NativeWorker = threads.Worker;
const bootstrap = new URL('./context-product-test-clock-worker.mjs', import.meta.url);
const envelope = threads.workerData?.productTestClock;
const state = new BigInt64Array(envelope?.state ?? new SharedArrayBuffer(16));
if (!envelope) {
  state[0] = 1000000000n;
  state[1] = BigInt(Date.UTC(2030, 0, 1));
}
const scheduled = new Map(), workers = new Set();
let source = () => Number(Atomics.load(state, 0)) / 1e6;
const now = () => source();
const delayMs = envelope?.delayMs ?? Number(process.env.CAIRN_TEST_SCHEDULING_DELAY_MS ?? 0);
if (![0, 300, 2000].includes(delayMs)) throw Error('unsupported_test_scheduling_delay');
const stallState = new Int32Array(new SharedArrayBuffer(4));

function flush() {
  for (;;) {
    const due = [...scheduled].filter(([, t]) => t.at <= now()).sort((a, b) => a[1].at - b[1].at);
    if (!due.length) return;
    const [id, timer] = due[0];
    scheduled.delete(id);
    timer.fn.apply(id, timer.args);
  }
}
function setTimer(fn, ms = 0, ...args) {
  let referenced = true;
  const id = {
    ref() { referenced = true; return this; },
    unref() { referenced = false; return this; },
    hasRef() { return referenced; },
    [Symbol.dispose]() { scheduled.delete(this); },
  };
  scheduled.set(id, { fn, args, at: now() + Math.max(0, ms) });
  return id;
}
const clearTimer = id => scheduled.delete(id);
process.hrtime.bigint = () => BigInt(Math.round(now() * 1e6));
Object.defineProperty(performance, 'now', { configurable: true, value: now });
Date.now = () => Number(Atomics.load(state, 1));
globalThis.setTimeout = timers.setTimeout = setTimer;
globalThis.clearTimeout = timers.clearTimeout = clearTimer;

export const testClock = {
  now,
  // Bind the existing per-test work-cost model to every monotonic sampler.
  bind(t, read) {
    let origin = now(), previous = 0;
    source = () => {
      const elapsed = read();
      // Existing work models restart elapsed cost at each quantum. Keep the
      // shared monotonic domain continuous across those operation boundaries.
      if (elapsed < previous) origin += previous;
      previous = elapsed;
      return origin + elapsed;
    };
    t.after(() => {
      Atomics.store(state, 0, BigInt(Math.round(now() * 1e6)));
      source = () => Number(Atomics.load(state, 0)) / 1e6;
    });
  },
  // This deliberately consumes real scheduling time without advancing test time.
  // It is an injected stall, never an elapsed-time assertion or a timing gate.
  stall() { if (delayMs) Atomics.wait(stallState, 0, 0, delayMs); },
  async advance(ms) {
    Atomics.add(state, 0, BigInt(ms) * 1000000n);
    flush();
    await Promise.all([...workers].map(port => new Promise(resolve => {
      port.once('message', resolve);
      port.postMessage('tick');
    })));
  },
};

threads.Worker = class extends NativeWorker {
  constructor(entry, options = {}) {
    const { port1, port2 } = new threads.MessageChannel();
    testClock.stall();
    super(bootstrap, { ...options, workerData: { productTestClock: {
      entry: entry instanceof URL ? entry.href : entry, data: options.workerData,
      state: state.buffer, port: port2, delayMs,
    } }, transferList: [...(options.transferList ?? []), port2] });
    workers.add(port1);
    port1.unref();
    this.once('exit', () => { workers.delete(port1); port1.close(); });
  }
};
if (envelope) {
  threads.workerData = envelope.data;
  envelope.port.on('message', () => { flush(); envelope.port.postMessage('ticked'); });
  envelope.port.unref();
}
syncBuiltinESMExports();
