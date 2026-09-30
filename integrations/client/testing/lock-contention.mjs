import assert from "node:assert/strict";
import { withWriteObserver } from "../private-state.mjs";
import { deferred } from "./deferred.mjs";

// Only globals used by hook/lock code are mocked, never HTTP/child internals.
// Polls advance logical time; filesystem ownership and writes stay real.
export async function withLockClock(t, work, { pollMs = 10 } = {}) {
  let clock = Date.now(), elapsed = 0;
  const timers = new Map();
  const originalClear = globalThis.clearTimeout;
  const now = t.mock.method(Date, "now", () => clock);
  // Mock only globals used by the lock/hook, leaving HTTP and child-process
  // internals on their own timers. Hook deadlines use the same virtual clock.
  const timeout = t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    const timer = {};
    timers.set(timer, { at: clock + ms, callback: () => callback(...args) });
    if (ms === pollMs) queueMicrotask(() => {
      elapsed += ms;
      clock += ms;
      for (const [token, event] of timers) if (event.at <= clock) {
        timers.delete(token);
        event.callback();
      }
    });
    return timer;
  });
  const clear = t.mock.method(globalThis, "clearTimeout", (timer) => {
    if (!timers.delete(timer)) originalClear(timer);
  });
  try {
    return await work({ elapsed: () => elapsed });
  } finally {
    timeout.mock.restore();
    clear.mock.restore();
    now.mock.restore();
  }
}

export async function withHeldLock(t, dispatch, contend) {
  const entered = deferred(), release = deferred();
  const holder = dispatch(async () => {
    entered.resolve();
    await release.promise;
    return { operation: Promise.resolve({ terminated: true }) };
  });
  await Promise.race([entered.promise, holder.then(() => {
    throw new Error("holder did not enter the lock");
  })]);
  try {
    return await withLockClock(t, async (clock) => {
      try { return await contend(clock); }
      finally { assert.ok(clock.elapsed() >= 250, "holder remains live through acquisition timeout"); }
    });
  } finally {
    release.resolve();
    assert.equal((await holder).ok, true);
  }
}

// Freeze the first real publication while it owns the usage lock. The other
// operations must exhaust acquisition before publication can finish.
export async function withUsageContention(t, first, contend) {
  const entered = deferred(), release = deferred();
  let held = false;
  const holder = withWriteObserver(async ({ path, kind }) => {
    if (!held && kind === "write" && path.includes("/usage/") && path.endsWith(".json")) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  }, first);
  await Promise.race([entered.promise, holder.then(() => {
    throw new Error("usage holder did not publish");
  })]);
  let rest;
  try {
    rest = await withLockClock(t, contend);
  } finally {
    release.resolve();
    await holder;
  }
  return { first: await holder, rest };
}

// Test-only later eligible attempts, after EVERY initial caller has settled.
// An acquisition failure ran no guard mutation. Unknown errors are never retried.
export async function concurrentUsage(t, operations) {
  const later = operations.slice(1);
  const wave = await withUsageContention(t, operations[0], () =>
    Promise.allSettled(later.map((operation) => operation())));
  assert.equal(wave.first.ok, true);
  const results = [wave.first];
  for (const result of wave.rest) {
    assert.equal(result.status, "rejected", "forced live lock must deny acquisition");
    assert.equal(result.reason.message, "state_busy");
  }
  for (const operation of later) results.push(await operation());
  return results;
}
