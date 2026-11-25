import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { amount, fixture } from "./fixtures/context-read-quantity-ledger.mjs";

test("slow ledger terms preserve the revalidated ordinary pack after Raw fails", async () => {
  let elapsed = 0, termsCalls = 0, rawChecks = 0;
  const f = fixture({ monotonicMs: () => performance.now() + elapsed, beforeTerms() {
    termsCalls++;
    elapsed += 1100;
  } });
  const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  f.base.contextRead.raw.revalidate = async () => {
    rawChecks++;
    throw new Error("Raw revalidation unavailable");
  };
  const request = { query: "How much food today?", raw: true, deadlineMs: 1000 };
  const expected = await f.read(f.reader({ enabled: false }), request);
  assert.deepEqual(expected.assembly.items.map(({ ref }) => ref.id), [bread.id]);
  assert.equal(expected.diagnostics.stops.deadline, false);
  assert.equal(expected.diagnostics.coverage.raw, "partial");
  assert.equal(rawChecks, 1);

  const result = await f.read(f.reader(), request);
  assert.deepEqual(result.assembly, expected.assembly);
  assert.deepEqual(result.diagnostics.stops, expected.diagnostics.stops);
  assert.equal(result.snapshot, expected.snapshot);
  assert.equal(rawChecks, 2);
  assert.equal(termsCalls, 1);
});

test("a timed-out ledger lookup releases a read with a serialized reader", async () => {
  const gate = Promise.withResolvers();
  let termsStarted = false;
  const f = fixture({ beforeTerms() { termsStarted = true; return gate.promise; } });
  await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const { uow } = f.base;
  const run = uow.run.bind(uow);
  let queue = Promise.resolve();
  uow.run = (owner, options, work) => {
    if (!options.readOnly) return run(owner, options, work);
    const read = queue.then(() => run(owner, options, work));
    queue = read.catch(() => {});
    return read;
  };
  const request = { deadlineMs: 100 };
  const off = f.reader({ enabled: false });
  await f.read(off, request);
  const expected = await f.read(off, request);
  assert.equal(expected.assembly.items.length, 1);
  const watchdog = new AbortController();
  try {
    assert.deepEqual(await Promise.race([
      f.read(f.reader(), request),
      delay(3000, undefined, { signal: watchdog.signal }).then(() => assert.fail("ledger lookup blocked ordinary delivery")),
    ]), expected);
    assert.equal(termsStarted, true);
  } finally {
    watchdog.abort();
    gate.resolve();
    await queue;
  }
});
