import assert from "node:assert/strict";
import { test } from "node:test";
import { fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { coreDigest } from "@cairn-ink/core";
import { amount, day, dayMs, fixture, foreign, project, scope, source } from "./fixtures/context-read-quantity-ledger.mjs";

test("food totals use scoped source refs and the default formatter, with exact bytes outside the trigger", async () => {
  const f = fixture();
  const bread = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const tea = await f.capture("Tea cost 6 USD.", [amount("tea", 6)], { target: project });
  const on = f.reader(), off = f.reader({ enabled: false }), withoutPort = f.reader({ port: false });
  const namespaces = [scope.namespace, project.namespace];
  // The first index publication records different maintenance work from a settled read.
  await f.read(off, {}, namespaces);
  const expected = await f.read(off, {}, namespaces);
  assert.equal(JSON.stringify(await f.read(withoutPort, {}, namespaces)), JSON.stringify(expected));
  assert.equal(f.scans.length, 0);

  const result = await f.read(on, {}, namespaces);
  const { ledgerDigest: item, items } = result.assembly;
  assert.ok(item);
  assert.deepEqual(item.sources.map(({ memory, role }) => [memory.id, memory.rev, role]).sort(),
    [[bread.id, bread.revision, "user"], [tea.id, tea.revision, "user"]].sort());
  assert.equal(new Set(item.sources.map(({ memory }) => memory.ns)).size, 2);
  assert.match(item.body, /Food spending: total \$9\.00 in 2 records, average \$9\.00 per day/u);
  assert.equal(result.diagnostics.budget.used, fixtureCount(formatAssembly(result.assembly)));
  assert.deepEqual(items.filter(item => item.ref.id === bread.id).map(({ rank }) => rank),
    expected.assembly.items.filter(item => item.ref.id === bread.id).map(({ rank }) => rank));
  assert.deepEqual(result.snapshot, expected.snapshot);
  const scans = f.scans.slice();
  assert.equal(new Set(scans.map(scan => scan.tx)).size, 2);
  for (const snapshot of new Set(scans.map(scan => scan.tx))) {
    assert.deepEqual(scans.filter(scan => scan.tx === snapshot && scan.fromMs === day).map(scan => scan.target.namespace).sort(),
      namespaces.slice().sort());
  }
  for (const request of [{ query: "Where is the bread?" }, { types: ["card"] }]) {
    await f.read(off, request, namespaces);
    assert.equal(JSON.stringify(await f.read(on, request, namespaces)), JSON.stringify(await f.read(off, request, namespaces)));
  }
  assert.deepEqual(f.scans, scans);
});

test("a calendar goal includes earlier records in its period and older retained targets", async () => {
  const f = fixture();
  const budget = await f.capture("Food budget is 50 USD per month.", [
    { ...amount("", 50), kind: "goal", period: "month", comparator: "at_most" },
  ], { date: day - 30 * dayMs });
  const earlier = await f.capture("Food: soup cost 15 USD.", [amount("soup", 15)], { date: day - dayMs });
  const outside = await f.capture("Food: pies cost 80 USD.", [amount("pies", 80)], { date: day + dayMs });
  const today = await f.capture("Food: oats cost 5 USD.", [amount("oats", 5)]);
  const { assembly } = await f.read(f.reader());
  const { ledgerDigest: item } = assembly;
  assert.ok(item);
  assert.match(item.body, /Food spending: total \$5\.00 in 1 record/u);
  assert.match(item.body, /food budget goal at most \$50\.00 per month: actual \$20\.00 per month, goal met, under by \$30\.00/u);
  assert.deepEqual(item.sources.map(({ memory }) => memory.id).sort(), [budget.id, earlier.id, today.id].sort());
  assert.ok(item.sources.every(({ memory }) => memory.id !== outside.id));
});

test("forget and stale row gates exclude hidden, historical, corrected, unretained and out-of-scope evidence", async () => {
  const f = fixture();
  const keep = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const forgotten = await f.capture("Food: plums cost 7 USD.", [amount("plums", 7)]);
  const hidden = await f.capture("Food: fig cost 11 USD.", [amount("fig", 11)]);
  const historical = await f.capture("Food: leeks cost 13 USD.", [amount("leeks", 13)]);
  const corrected = await f.capture("Food: dates cost 17 USD.", [amount("dates", 17)]);
  const unretained = await f.capture("Food: lime cost 19 USD.", [amount("lime", 19)]);
  await f.capture("Food: berries cost 23 USD.", [amount("berries", 23)], { target: project });
  await f.capture("Food: peach cost 29 USD.", [amount("peach", 29)], { target: foreign });
  const api = f.reader();
  assert.match((await f.read(api)).assembly.ledgerDigest.body, /Food spending: total \$70\.00 in 6 records/u);

  const [forgottenRow] = await f.ledgerRows(forgotten.id);
  assert.equal((await f.writer.forget(scope, forgotten.id, source)).status, "forgotten");
  await f.inject(forgottenRow);
  await f.base.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget", actionId: "hide",
    memoryId: hidden.id });
  await f.write(tx => f.base.supersession.markHistorical(tx, scope, historical.id, day));
  for (const [memory, retain] of [[corrected, true], [unretained, false]]) {
    const [prior] = await f.ledgerRows(memory.id);
    const text = memory.messages[0].content + " Entry revised.";
    const textHash = "sha256:" + (await coreDigest(text)).value;
    assert.notEqual(prior.textHash, textHash);
    await f.write(tx => f.base.memories.replaceContent(tx, scope, memory.id, memory.revision, {
      text, textHash, embedding: null, origin: "explicit", kind: "fact", confidence: 1, source,
    }, retain ? null : [], day));
    const inspected = await f.writer.inspect(scope, { memoryId: memory.id });
    assert.equal(inspected.receipts.some(({ id }) => id === prior.receiptId), retain);
    if (!retain) await f.inject({ ...prior, textHash, ordinal: prior.ordinal + 1 });
  }
  const { assembly } = await f.read(api, { intent: "history" });
  const { ledgerDigest: item } = assembly;
  assert.ok(item, "The surviving total should still be delivered");
  assert.match(item.body, /Food spending: total \$3\.00 in 1 record/u);
  assert.deepEqual(item.sources.map(({ memory }) => memory.id), [keep.id]);
});

test("a whole digest uses one slot and yields to normal items when it exceeds the token budget", async () => {
  const f = fixture({ monotonicMs: () => performance.now() });
  await f.capture("Food: soup cost 4 USD.", Array.from({ length: 12 }, (_, i) =>
    amount("category " + i + " with additional detail", 4)));
  await f.card();
  for (const raw of [false, true]) {
    const request = { types: ["memory", "card"], raw };
    const api = f.reader();
    const only = await f.read(api, { ...request, budget: { maxItems: 1 } });
    assert.equal(only.assembly.items.length, 0);
    assert.ok(only.assembly.ledgerDigest);
    assert.equal(only.diagnostics.budget.used, fixtureCount(formatAssembly(only.assembly)));
    if (raw) assert.equal(only.diagnostics.coverage.raw, "included");

    const off = f.reader({ enabled: false });
    const maxTokens = (await f.read(off, request)).diagnostics.budget.used + 8;
    assert.ok(maxTokens >= 64 && only.diagnostics.budget.used > maxTokens);
    const baseline = await f.read(off, { ...request, budget: { maxTokens } });
    assert.deepEqual(new Set(baseline.assembly.items.map(({ ref }) => ref.type)), new Set(["memory", "card"]));
    const bounded = await f.read(api, { ...request, budget: { maxTokens } });
    assert.deepEqual(bounded.assembly, baseline.assembly);
    assert.equal(bounded.diagnostics.budget.used, fixtureCount(formatAssembly(bounded.assembly)));
  }
});

for (const freezeGenerations of [false, true]) {
  test("a forget after preparation drops the whole digest" + (freezeGenerations ? " even with stable generations" : ""), async () => {
    const f = fixture({ freezeGenerations });
    const keep = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
    const remove = await f.capture("Tea cost 6 USD.", [amount("tea", 6)]);
    const control = await f.read(f.reader());
    assert.match(control.assembly.ledgerDigest.body, /Food spending: total \$9\.00/u);
    let commits = 0;
    const api = f.reader({ async afterFormatting() {
      commits++;
      assert.equal((await f.writer.forget(scope, remove.id, source)).status, "forgotten");
    } });
    const result = await f.read(api);
    assert.equal(commits, 1);
    assert.equal(Object.hasOwn(result.assembly, "ledgerDigest"), false);
    assert.deepEqual(result.assembly.items.map(({ ref }) => ref.id), [keep.id]);
  });
}

test("optional ledger list and final fence failures leave normal delivery available", async () => {
  const f = fixture();
  const keep = await f.capture("Food: bread cost 3 USD.", [amount("bread", 3)]);
  const extra = await f.capture("Tea cost 6 USD.", [amount("tea", 6)]);
  f.readFailures.list = true;
  assert.deepEqual((await f.read(f.reader())).assembly.items.map(({ ref }) => ref.id), [keep.id]);
  f.readFailures.list = false;
  let injected = false;
  const api = f.reader({ async afterFormatting() {
    injected = true;
    f.readFailures.fence = extra.id;
  } });
  const result = await f.read(api);
  assert.equal(injected, true);
  assert.equal(Object.hasOwn(result.assembly, "ledgerDigest"), false);
  assert.deepEqual(result.assembly.items.map(({ ref }) => ref.id), [keep.id]);
});
