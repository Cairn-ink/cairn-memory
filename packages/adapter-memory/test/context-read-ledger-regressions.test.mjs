import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { amount, day, fixture, readSet, scope, source } from "./fixtures/context-read-quantity-ledger.mjs";

test("every ranked ref can be fetched together and the ordinary snapshot replays", async () => {
  const f = fixture();
  const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  await f.capture("Food: tea cost 6 USD.", [amount("tea", 6)]);
  const api = f.reader();
  const expected = await f.read(f.reader({ enabled: false }));
  const result = await f.read(api);
  const set = readSet();
  const compact = result.assembly.items.map(item => item.ref);
  const refs = compact.map(({ id, rev, ns }) => ({
    type: "memory", scope: { owner: set.owner, namespace: set.namespaces[ns] }, id, revision: rev,
  }));
  const fetched = await api.fetchEvidence(set, { refs, intent: "current", fences: compact.map(ref => ref.f) });
  assert.deepEqual(fetched.items.map(item => item.ref), refs);
  const { ledgerDigest } = result.assembly;
  assert.ok(ledgerDigest.sources.some(({ memory }) => memory.id === bread.id && compact.some(ref => ref.id === memory.id)));
  assert.deepEqual(Object.keys(ledgerDigest).sort(), ["body", "sources"]);
  assert.deepEqual(Object.keys(JSON.parse(formatAssembly(result.assembly)).value), ["framing", "ledgerDigest", "items"]);
  assert.deepEqual(result.assembly.items, expected.assembly.items);
  assert.ok(result.snapshot);
  assert.equal(result.snapshot, expected.snapshot);
  assert.deepEqual(await api.fetchEvidence(set, { snapshot: result.snapshot }), fetched);
});

test("a read without a ledger cue never calls slow terms", async () => {
  let now = 0, calls = 0;
  const f = fixture({ monotonicMs: () => now, beforeTerms() { calls++; now += 1100; } });
  await f.capture("The bread is in the cupboard. It cost 3 USD.", [amount("bread", 3)]);
  const request = { query: "Where is the bread?", deadlineMs: 1000 };
  const off = f.reader({ enabled: false });
  await f.read(off, request);
  const expected = await f.read(off, request);
  assert.equal(expected.assembly.items.length, 1);
  assert.deepEqual(await f.read(f.reader(), request), expected);
  assert.equal(calls, 0);
  assert.deepEqual(f.scans, []);
});

for (const slowCall of [1, 2]) {
  test(`slow terms during ${slowCall === 1 ? "preparation" : "final validation"} preserve ordinary delivery`, async () => {
    let now = 0, calls = 0;
    const f = fixture({ monotonicMs: () => now, beforeTerms() { if (++calls === slowCall) now += 1100; } });
    await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
    const off = f.reader({ enabled: false });
    await f.read(off);
    const expected = await f.read(off);
    assert.equal(expected.assembly.items.length, 1);
    assert.equal(expected.diagnostics.stops.deadline, false);
    assert.deepEqual(await f.read(f.reader()), expected);
    assert.equal(calls, slowCall);
    assert.equal(f.scans.length, slowCall === 1 ? 0 : 2);
  });
}

test("the ledger deadline releases delivery while a lookup is still pending", async () => {
  const gate = Promise.withResolvers();
  let started = false;
  const f = fixture({ beforeTerms() { started = true; return gate.promise; } });
  await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const request = { deadlineMs: 60 };
  const off = f.reader({ enabled: false });
  await f.read(off, request);
  const expected = await f.read(off, request);
  const watchdog = new AbortController();
  try {
    assert.deepEqual(await Promise.race([
      f.read(f.reader(), request),
      delay(3000, undefined, { signal: watchdog.signal }).then(() => assert.fail("ledger lookup blocked delivery")),
    ]), expected);
    assert.equal(started, true);
  } finally {
    watchdog.abort();
    gate.resolve();
  }
  await delay(0);
  assert.deepEqual(f.scans, []);
});

test("the Raw budget uses the adapter clock after the process passes the initial cutoff", async () => {
  const f = fixture({ monotonicMs: () => performance.now() });
  await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  while (performance.now() < 400) await delay(400 - performance.now());
  const result = await f.read(f.reader(), { raw: true, deadlineMs: 750, budget: { maxItems: 1 } });
  assert.equal(result.diagnostics.coverage.raw, "included");
  assert.ok(result.assembly.ledgerDigest);
  assert.deepEqual(result.assembly.items, []);
});

function forgetSession(f, memory) {
  return f.base.harness.seedFact(scope.owner, { ...scope, kind: "session", origin: "forget", actionId: "session-fence",
    session: { client: memory.address.client, sessionId: memory.address.sessionId } });
}

function forgetWindow(f, memory) {
  return f.base.harness.seedFact(scope.owner, { ...scope, kind: "window", origin: "forget", actionId: "window-fence",
    client: memory.address.client, window: { startMs: day + 30_000, endMs: day + 90_000 } });
}

async function correct(f, memory) {
  assert.equal((await f.writer.correct(scope, memory.id, memory.revision, "Lime cost 2 USD.", source)).status, "saved");
}

test("a hidden category does not trigger totals from an unrelated visible row", async () => {
  for (const budget of [undefined, { maxTokens: 64 }]) {
    const f = fixture();
    await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
    const api = f.reader();
    const request = { query: "How much therapy today?", ...(budget && { budget }) };
    const withoutHidden = await f.read(api, request);
    const hidden = await f.capture("Health: therapy cost 90 USD.", [amount("therapy", 90, "health")]);
    await forgetSession(f, hidden);
    assert.equal((await f.ledgerRows(hidden.id)).length, 1);
    const withHidden = await f.read(api, request);
    assert.deepEqual(withHidden.assembly, withoutHidden.assembly);
    assert.deepEqual(withHidden.diagnostics.stops, withoutHidden.diagnostics.stops);
    assert.equal(Object.hasOwn(withHidden.assembly, "ledgerDigest"), false);
  }
});

for (const [label, change] of [["window forget", forgetWindow], ["session forget", forgetSession], ["public correction", correct]]) {
  test(`${label} excludes the old amount from the digest`, async () => {
    const f = fixture();
    const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
    const lime = await f.capture("Food: lime cost 19 USD.", [amount("lime", 19)], { date: day + 60_000 });
    const api = f.reader();
    assert.match((await f.read(api)).assembly.ledgerDigest.body, /total \$22\.00/u);
    await change(f, lime);
    const { assembly } = await f.read(api);
    assert.match(assembly.ledgerDigest.body, /total \$3\.00/u);
    assert.deepEqual(assembly.ledgerDigest.sources.map(({ memory }) => memory.id), [bread.id]);
    if (change === forgetWindow) {
      const item = assembly.items.find(({ ref }) => ref.id === lime.id);
      assert.ok(item);
      assert.deepEqual(item.sources, []);
    }
    if (change === forgetSession) assert.ok(assembly.items.every(({ ref }) => ref.id !== lime.id));
  });
}

async function forgetIdentity(f, memory) {
  await f.base.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget", actionId: "identity-fence",
    memoryId: memory.id });
}

for (const [label, change] of [["window forget", forgetWindow], ["session forget", forgetSession],
  ["identity forget", forgetIdentity], ["public correction", correct]]) {
  test(`${label} between preparation and final assembly drops the digest with frozen generations`, async () => {
    const f = fixture({ freezeGenerations: true });
    const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
    const lime = await f.capture("Lime cost 19 USD.", [amount("lime", 19)], { date: day + 60_000 });
    const request = { query: "How much food today?" };
    const control = await f.read(f.reader(), request);
    assert.match(control.assembly.ledgerDigest.body, /total \$22\.00/u);
    assert.deepEqual(control.assembly.items.map(({ ref }) => ref.id), [bread.id]);
    let writes = 0;
    const api = f.reader({ async afterFormatting() { writes++; await change(f, lime); } });
    const result = await f.read(api, request);
    assert.equal(writes, 1);
    assert.equal(Object.hasOwn(result.assembly, "ledgerDigest"), false);
    assert.deepEqual(result.assembly.items, control.assembly.items);
    assert.deepEqual(result.diagnostics.stops, control.diagnostics.stops);
  });
}
