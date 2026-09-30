import assert from "node:assert/strict";

// Delay the real guard's dispatch callback while it owns the usage lock. The
// contender polls real filesystem ownership, but its acquisition clock advances
// virtually: no sleep or scheduling race determines whether it gets state_busy.
export async function withHeldDispatch(t, dispatch, contend) {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const holder = dispatch(async () => {
    entered.resolve();
    await release.promise;
    return { operation: Promise.resolve({ terminated: true }) };
  });
  await Promise.race([entered.promise, holder.then(() => {
    throw new Error("holder did not enter the lock");
  })]);
  let clock = Date.now(), elapsed = 0;
  const timers = new Map();
  const originalClear = globalThis.clearTimeout;
  const now = t.mock.method(Date, "now", () => clock);
  // Mock only globals used by the lock/hook, leaving HTTP and child-process
  // internals on their own timers. Hook deadlines use the same virtual clock.
  const timeout = t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    const timer = {};
    timers.set(timer, { at: clock + ms, callback: () => callback(...args) });
    if (ms === 10) queueMicrotask(() => {
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
    return await contend();
  } finally {
    timeout.mock.restore();
    clear.mock.restore();
    now.mock.restore();
    release.resolve();
    assert.equal((await holder).ok, true);
    assert.ok(elapsed >= 250, `holder delayed for ${elapsed} virtual ms`);
  }
}
