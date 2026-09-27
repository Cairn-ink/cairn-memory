// Test-only process isolation: install the monotonic clock before core imports.
// The parent test supplies no environment, provider key or operational ledger.
const nanosPerMs = 1_000_000n;
let now = process.hrtime.bigint();
process.hrtime.bigint = () => now;
globalThis[Symbol.for('cairn.test.d6.clock')] = Object.freeze({
  advance(milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new Error('invalid_synthetic_clock_advance');
    }
    now += BigInt(milliseconds) * nanosPerMs;
  },
});

await import('../test/case-deadline-guard.test.mjs');
