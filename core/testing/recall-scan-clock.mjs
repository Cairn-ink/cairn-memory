import { performance } from 'node:perf_hooks';

const clocks = new WeakMap();
// Test-only clock injection follows the Raw search clock seam. Runtime code
// reads the monotonic performance clock and exposes no timing option.
export function installRecallScanClock(t, read = () => 0) {
  if (clocks.has(t)) {
    const set = clocks.get(t); set(read); return set;
  }
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => read() });
  t.after(() => {
    if (own) Object.defineProperty(performance, 'now', own);
    else delete performance.now;
  });
  const set = next => { read = next; };
  clocks.set(t, set);
  return set;
}
