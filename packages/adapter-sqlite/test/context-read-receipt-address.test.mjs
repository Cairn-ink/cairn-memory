import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "owner", namespace: null };
const session = { client: "client", sessionId: "session" };
const event = { ...session, eventId: "capture" };
const messages = [
  { id: "first", role: "user", content: "  Ｔhe amber\tmarker is tied to the east compass.  ", occurredAtMs: Date.UTC(2025, 0, 2, 3, 4) },
  { id: "second", role: "assistant", content: "The copper bracket protects the west compass.", occurredAtMs: Date.UTC(2025, 0, 3, 4, 5) },
];
const memories = ["The east compass has a marker.", "The west compass has a bracket."];
const excerpts = ["The amber marker is tied to the east compass.", messages[1].content];
const sourceWords = ["amber", "copper"];
const dates = ["2025-01-02T03:04Z", "2025-01-03T04:05Z"];
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const search = { query: "compass", types: ["memory"], intent: "current", raw: false, semantic: false };
const explicitSource = { kind: "mcp", client: null, sessionId: null };

async function open(t, contextRawRead = true) {
  const file = scratch();
  let adapter;
  t.after(async () => {
    try {
      await adapter?.close();
    } finally {
      file.remove();
    }
  });
  adapter = await openSqliteAdapter(file.path, { capabilities: { contextRead: true, contextRawRead } });
  return adapter;
}

function service(storage) {
  return createMemoryService({
    storage, clock: assemblyClock(), config: {},
    model: { model: "fixture", contextWindow: 16_384, countTokens: () => 1,
      async call(stage, { input }) {
        assert.equal(stage, "extract");
        assert.deepEqual(input.messages.map(({ index }) => index), [0, 1]);
        return { items: memories.map((content, index) => ({ content, kind: "fact", confidence: 0.9, sourceIndices: [index] })) };
      } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 1 },
    embedder: { model: "fixture", dimensions: 1, async embed(inputs) { return inputs.map(() => Float32Array.of(1)); } },
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
  });
}

async function capture(storage) {
  const api = service(storage);
  assert.deepEqual(await api.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  const finished = await api.runCapture(scope, event);
  assert.equal(finished.status, "done", JSON.stringify(finished));
  assert.equal(finished.result.memories.length, memories.length);
  const raw = await api.listRawMessages(scope, { limit: 10 });
  assert.deepEqual(raw.items.map(({ messageId }) => messageId).sort(), messages.map(({ id }) => id));
  return api;
}

function memorySources({ assembly }) {
  return memories.map(body => {
    const item = assembly.items.find(item => item.body === body);
    assert.ok(item, body);
    assert.equal(item.sources.length, 1, body);
    assert.equal(item.sourcesComplete, undefined, body);
    assert.equal(item.sources[0].date, item.date, body);
    return { date: item.date, excerpt: item.sources[0].excerpt };
  });
}

const write = (adapter, work) => adapter.uow.run(scope.owner, { pauseLock: true }, work);
const read = api => api.readContext(readSet, search);
const assertWithheld = (result, index) => {
  const item = result.assembly.items.find(item => item.body === memories[index]);
  assert.ok(item, memories[index]);
  assert.deepEqual(item.sources, []);
  assert.equal(item.sourcesComplete, false);
  assert.equal(item.date, undefined);
  assert.ok(!JSON.stringify(result).includes(sourceWords[index]));
  assert.ok(!JSON.stringify(result).includes(dates[index]));
  assert.ok(!formatAssembly(result.assembly).includes(sourceWords[index]));
};

test("Core capture delivers the same source excerpts and dates as the memory adapter", async t => {
  const memory = await capture(createMemoryAdapter({ capabilities: { contextRead: true, inspect: true, rawArchive: true } }));
  const expected = memorySources(await read(memory));
  assert.deepEqual(expected, dates.map((date, index) => ({ date, excerpt: excerpts[index] })));

  for (const contextRawRead of [true, false]) {
    const sqlite = await capture(await open(t, contextRawRead));
    const result = await read(sqlite);
    assert.equal(result.assembly.items.length, memories.length);
    assert.deepEqual(memorySources(result), expected);
    for (const item of result.assembly.items) {
      const inspected = await sqlite.inspect(scope, { memoryId: item.ref.id });
      assert.deepEqual(inspected.receipts, []);
    }
    const fetched = await sqlite.fetchEvidence(readSet, { snapshot: result.snapshot });
    for (const item of fetched.items) {
      assert.deepEqual(item.provenance.coverage, { status: "complete", included: 1, omitted: 0 });
    }
  }
});

test("A forgotten Raw passage hides the source and its attributed memory", async t => {
  const adapter = await open(t);
  const api = await capture(adapter);
  assert.deepEqual(memorySources(await read(api)), dates.map((date, index) => ({ date, excerpt: excerpts[index] })));
  const [{ id, content }] = messages;
  const fact = { ...scope, kind: "rawSpan", origin: "forget", actionId: "forget-passage",
    sessionKeyHash: adapter.hashSessionKey(scope, session.client, session.sessionId), messageKey: id,
    startUtf16: 0, endUtf16: content.length, contentDigest: sha256(content) };
  const incarnation = sha256(factIncarnationBody(fact));
  await write(adapter, async tx => {
    const stored = await adapter.suppressions.writeFact(tx, fact, incarnation);
    assert.equal(stored.created, true);
    const purged = await adapter.raw.purgeWithheld(tx, scope, [{ ...stored, fact, incarnation }]);
    assert.equal(purged.rawDeleted, 1);
  });

  for (const raw of [false, true]) {
    const result = await api.readContext(readSet, { ...search, raw });
    // Span suppression also hides Memories attributed to the affected turn.
    assert.deepEqual(result.assembly.items.map(item => item.body), [memories[1]]);
    assert.ok(!JSON.stringify(result).includes(sourceWords[0]));
    assert.ok(!JSON.stringify(result).includes(dates[0]));
  }
});

const privacyCases = [
  ["a Raw session fence", [0, 1], adapter => write(adapter, tx => adapter.raw.fenceSession(tx, scope, session))],
  ["a matching text suppression", [0], async adapter => {
    const result = await seedFact(adapter, { ...scope, kind: "text", mode: "exact", origin: "forget",
      actionId: "suppress-text", text: { digests: await allDigests(messages[0].content, null) } });
    assert.equal(result.created, true);
  }],
  ["an owner-wide window suppression", [0], async adapter => {
    const { occurredAtMs } = messages[0];
    const result = await seedFact(adapter, { owner: scope.owner, kind: "window", client: null, origin: "forget",
      actionId: "suppress-window", window: { startMs: occurredAtMs - 1, endMs: occurredAtMs + 1 } });
    assert.equal(result.created, true);
  }],
];

for (const [name, affected, withdraw] of privacyCases) {
  test(`Address-only receipts withhold ${name}`, async t => {
    const adapter = await open(t);
    const api = await capture(adapter);
    const before = await read(api);
    assert.deepEqual(memorySources(before), dates.map((date, index) => ({ date, excerpt: excerpts[index] })));
    await withdraw(adapter);

    // Exercise Raw search as well as receipt delivery after withdrawal.
    const result = await read(api);
    const withRaw = await api.readContext(readSet, { ...search, raw: true });
    for (const index of affected) {
      assertWithheld(result, index);
      assertWithheld(withRaw, index);
    }
    assert.equal(result.assembly.items.length, memories.length);
    const fetched = await api.fetchEvidence(readSet, { snapshot: result.snapshot });
    assert.equal(fetched.items.length, result.assembly.items.length);
    for (const item of fetched.items) {
      const index = memories.indexOf(item.text);
      if (!affected.includes(index)) {
        assert.equal(item.provenance.sources.length, 1);
        continue;
      }
      assert.deepEqual(item.provenance.sources, []);
      assert.deepEqual(item.provenance.receiptMetadata, []);
      assert.deepEqual(item.provenance.coverage, { status: "budget_exhausted", included: 0, omitted: 1 });
      assert.ok(!JSON.stringify(fetched).includes(sourceWords[index]));
    }
  });
}

test("Forgetting a captured memory removes its Context Read item", async t => {
  const api = await capture(await open(t));
  const before = await read(api);
  const item = before.assembly.items.find(item => item.body === memories[0]);
  assert.ok(item);
  assert.equal((await api.forget(scope, item.ref.id, explicitSource)).status, "forgotten");
  const after = await api.readContext(readSet, { ...search, raw: true });
  assert.ok(!after.assembly.items.some(candidate => candidate.ref.id === item.ref.id));
  assert.ok(!JSON.stringify(after).includes(sourceWords[0]));
  await assert.rejects(api.fetchEvidence(readSet, { snapshot: before.snapshot }), { code: "snapshot_stale" });
});

test("An explicit save without a Raw row has no source or date", async t => {
  const api = service(await open(t));
  const body = "The spare compass stays in the drawer.";
  assert.equal((await api.save(scope, body, explicitSource)).status, "saved");
  const { assembly: { items: [item] } } = await read(api);
  assert.equal(item.body, body);
  assert.deepEqual(item.sources, []);
  assert.equal(item.date, undefined);
});

test("A Raw row with different content cannot prove an address-only receipt", async t => {
  const adapter = await open(t);
  const unrelated = { ...messages[0], content: "An unrelated compass entry." };
  assert.deepEqual(await write(adapter, tx => adapter.raw.importArchive(tx, scope, session, [unrelated])),
    { archived: 1, existing: 0, withheld: 0 });
  const result = await read(await capture(adapter));
  assertWithheld(result, 0);
  assert.ok(!JSON.stringify(result).includes(unrelated.content));
  assert.equal(result.assembly.items.find(item => item.body === memories[1]).sources.length, 1);
});

test("Address-only receipt evidence is identical on snapshot and cursor replay", async t => {
  const api = await capture(await open(t));
  const first = await read(api);
  const replayed = await read(api);
  assert.deepEqual(replayed.assembly.items, first.assembly.items);

  const snapshot = await api.fetchEvidence(readSet, { snapshot: first.snapshot });
  assert.deepEqual(await api.fetchEvidence(readSet, { snapshot: replayed.snapshot }), snapshot);
  assert.deepEqual(await api.fetchEvidence(readSet, { snapshot: snapshot.snapshot }), snapshot);

  const { raw, ...query } = search;
  const { nextCursor: cursor } = await api.findCandidates(readSet, { ...query, limit: 1 });
  assert.ok(cursor);
  const page = () => api.findCandidates(readSet, { ...query, limit: 1, cursor });
  const next = await page();
  assert.equal(next.items.length, 1);
  assert.deepEqual((await page()).items, next.items);
  assert.deepEqual((await api.fetchEvidence(readSet, { refs: next.items.map(({ ref }) => ref), intent: search.intent })).items,
    snapshot.items.filter(item => item.ref.id === next.items[0].ref.id));
});
