import assert from "node:assert/strict";
import { test } from "node:test";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { coreDigest } from "@cairn-ink/core";
import { ledgerDropSelector, ledgerRowKey } from "@cairn-ink/core/ledger";
import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "reader", namespace: "personal\0" };
const project = { ...scope, namespace: "project\0shared" };
const foreign = { ...scope, owner: "other" };
const day = Date.UTC(2025, 0, 15);
const dayMs = 86_400_000;
const input = { query: "How much did I spend on food today?", types: ["memory"], intent: "current", raw: false };
const source = { kind: "web", client: null, sessionId: null };
const isDigest = item => item.kind === "quantity-ledger";
const extract = content => ({ content, kind: "fact", confidence: 0.9, sourceIndices: [0] });
const amount = (category, value) =>
  ({ item: 0, measure: "spend", group: "food", category, value, unit: "USD", kind: "record", period: "none", comparator: "none" });

function fixture({ freezeGenerations = false } = {}) {
  const base = createMemoryAdapter({ capabilities: { contextRead: true, inspect: true, documentCards: true,
    supersession: true, rawArchive: true, contextRawRead: true } });
  const committed = new Map();
  const transactions = new WeakMap();
  const scans = [];
  const readFailures = { list: false, fence: false };
  function rows(tx, target, write = false) {
    assert.equal(tx.owner, target.owner);
    if (write) assert.equal(tx.readOnly, false);
    const active = transactions.get(tx);
    assert.ok(active);
    return active;
  }
  function scoped(tx, target) {
    return [...rows(tx, target).values()].flatMap(entry => entry.namespace === target.namespace ? [entry.row] : []);
  }
  const storage = {
    ...base,
    capabilities: { ...base.capabilities, quantityLedger: true },
    uow: {
      async run(owner, options, work) {
        let writes;
        const value = await base.uow.run(owner, options, async tx => {
          const active = new Map(committed.get(owner));
          transactions.set(tx, active);
          try {
            const value = await work(tx);
            if (!tx.readOnly) writes = active;
            return value;
          } finally {
            transactions.delete(tx);
          }
        });
        if (writes) committed.set(owner, writes);
        return value;
      },
    },
    quantityLedger: {
      async put(tx, target, incoming) {
        const active = rows(tx, target, true), before = active.size;
        for (const row of incoming) {
          const key = JSON.stringify([target.namespace, ledgerRowKey(row)]);
          if (!active.has(key)) active.set(key, { namespace: target.namespace, row: structuredClone(row) });
        }
        return { inserted: active.size - before };
      },
      async dropWhere(tx, target, selector) {
        const field = ledgerDropSelector(selector);
        const active = rows(tx, target, true), before = active.size;
        for (const [key, { namespace, row }] of active) {
          if (namespace === target.namespace && row[field] === selector.id) active.delete(key);
        }
        return { dropped: before - active.size };
      },
      async listForMemory(tx, target, id) {
        return scoped(tx, target).filter(row => row.memoryId === id);
      },
      async list(tx, target, { fromMs, toMs }) {
        assert.equal(tx.readOnly, true);
        scans.push({ tx, target, fromMs, toMs });
        if (readFailures.list) throw new Error("Ledger list unavailable");
        return scoped(tx, target).filter(row => fromMs <= row.date && row.date < toMs);
      },
      async terms(tx, target) {
        assert.equal(tx.readOnly, true);
        const current = [];
        for (const row of scoped(tx, target)) {
          const memory = await base.memories.get(tx, target, row.memoryId);
          if (memory && !memory.historical) current.push(row.measure, row.group, row.category);
        }
        return [...new Set(current)];
      },
    },
  };
  const clock = { ...assemblyClock(() => 0), nowMs: () => day + 5000 };
  let modelOutput;
  const writer = createMemoryService({ storage, clock, config: { quantityLedger: { enabled: true } },
    model: { model: "fixture", contextWindow: 32768, countTokens: () => 1, async call(stage) {
      assert.equal(stage, "extract");
      return modelOutput;
    } },
    embedder: { model: "fixture", dimensions: 1, async embed(texts) { return texts.map(() => Float32Array.of(1)); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
  });
  let beforeRead;
  const readerStorage = {
    ...storage,
    uow: {
      async run(owner, options, work) {
        if (options.readOnly && beforeRead) {
          const commit = beforeRead;
          beforeRead = undefined;
          await commit();
        }
        return storage.uow.run(owner, options, work);
      },
    },
    contextRead: {
      ...base.contextRead,
      // Isolate the digest's witness from the general generation check.
      ...(freezeGenerations && { async snapshotState(_tx, { namespaces }) {
        return namespaces.map(() => ({ memory: 1, card: 1 }));
      } }),
    },
    fence: {
      async assertVisible(...args) {
        if (readFailures.fence && args[2].some(({ id }) => id === readFailures.fence)) {
          throw new Error("Ledger source visibility unavailable");
        }
        return base.fence.assertVisible(...args);
      },
    },
  };
  const reader = ({ enabled = true, port = true, afterFormatting } = {}) => {
    const { quantityLedger, ...rest } = readerStorage;
    return createMemoryService({ profile: "keyless-local", clock,
      storage: { ...rest, capabilities: { ...rest.capabilities, quantityLedger: enabled }, ...(port && { quantityLedger }) },
      contextReadCounter: { count: fixtureCount },
      contextReadFormat(value) {
        if (afterFormatting && value.items.some(isDigest)) beforeRead = afterFormatting;
        return formatAssembly(value);
      },
    });
  };
  const read = (api, overrides = {}, namespaces = [scope.namespace]) => api.readContext({
    owner: scope.owner, namespaces, accessGenerations: namespaces.map(() => 1),
  }, { ...input, ...overrides });
  const ledgerRows = (id, target = scope) => storage.uow.run(target.owner, { readOnly: true },
    tx => storage.quantityLedger.listForMemory(tx, target, id));
  const write = (work, target = scope) => storage.uow.run(target.owner, { pauseLock: true }, work);
  const inject = (row, target = scope) => write(tx => storage.quantityLedger.put(tx, target, [row]), target);
  let sequence = 0;
  async function capture(content, quantities, { target = scope, date = day } = {}) {
    const id = "event-" + ++sequence;
    const address = { client: "fixture", sessionId: id, eventId: id };
    modelOutput = { items: [extract(content)], quantities };
    const messages = [{ id, role: "user", content, occurredAtMs: date }];
    assert.deepEqual(await writer.enqueueCapture(target, { ...address, messages }), { status: "accepted" });
    const finished = await writer.runCapture(target, address);
    assert.equal(finished.status, "done", JSON.stringify(finished));
    assert.equal(finished.result.memories.length, 1);
    const memory = finished.result.memories[0];
    assert.equal((await ledgerRows(memory.id, target)).length, quantities.length);
    return { ...memory, messages };
  }
  async function card() {
    await write(tx => base.documentCards.put(tx, scope, {
      id: "meal-card", scope, title: "Food", body: "A meal plan.", origin: "manual", contentHash: "meal-card",
      date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
    }));
  }
  return { base, capture, card, inject, ledgerRows, reader, read, scans, readFailures, write, writer };
}

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
  const [item, ...remainder] = result.assembly.items;
  assert.equal(item.kind, "quantity-ledger");
  assert.equal(item.rank, 1);
  assert.deepEqual(item.ref, item.sources[0].memory);
  assert.deepEqual(item.sources.map(({ memory, role }) => [memory.id, memory.rev, role]).sort(),
    [[bread.id, bread.revision, "user"], [tea.id, tea.revision, "user"]].sort());
  assert.equal(new Set(item.sources.map(({ memory }) => memory.ns)).size, 2);
  assert.match(item.body, /Food spending: total \$9\.00 in 2 records, average \$9\.00 per day/u);
  assert.equal(result.diagnostics.budget.used, fixtureCount(formatAssembly(result.assembly)));
  assert.deepEqual(remainder.filter(item => item.ref.id === bread.id).map(({ rank }) => rank),
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
  const [item] = assembly.items;
  assert.ok(isDigest(item));
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
  assert.match((await f.read(api)).assembly.items[0].body, /Food spending: total \$70\.00 in 6 records/u);

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
  const [item] = assembly.items;
  assert.ok(isDigest(item), "The surviving total should still be delivered");
  assert.match(item.body, /Food spending: total \$3\.00 in 1 record/u);
  assert.deepEqual(item.sources.map(({ memory }) => memory.id), [keep.id]);
});

test("a whole digest uses one slot and yields to normal items when it exceeds the token budget", async () => {
  const f = fixture();
  await f.capture("Food: soup cost 4 USD.", Array.from({ length: 12 }, (_, i) =>
    amount("category " + i + " with additional detail", 4)));
  await f.card();
  for (const raw of [false, true]) {
    const request = { types: ["memory", "card"], raw };
    const api = f.reader();
    const only = await f.read(api, { ...request, budget: { maxItems: 1 } });
    assert.equal(only.assembly.items.length, 1);
    assert.ok(isDigest(only.assembly.items[0]));
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
    assert.match(control.assembly.items[0].body, /Food spending: total \$9\.00/u);
    let commits = 0;
    const api = f.reader({ async afterFormatting() {
      commits++;
      assert.equal((await f.writer.forget(scope, remove.id, source)).status, "forgotten");
    } });
    const result = await f.read(api);
    assert.equal(commits, 1);
    assert.ok(!result.assembly.items.some(isDigest));
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
  assert.ok(!result.assembly.items.some(isDigest));
  assert.deepEqual(result.assembly.items.map(({ ref }) => ref.id), [keep.id]);
});
