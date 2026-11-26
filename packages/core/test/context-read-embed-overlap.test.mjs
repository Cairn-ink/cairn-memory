import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createMemoryService } from "../src/service/index.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const input = { query: "albatross", types: ["memory"], intent: "current", deadlineMs: 1000 };
const retained = memory("observation", { text: "An albatross keeps watch." });
const turn = { scope, conversationId: "conversation", messageId: "observation-turn", role: "user",
  occurredAtMs: null, ranges: [{ start: 0, text: "An albatross flew past the tower." }], witness: "retained" };
const evidence = { type: "memory", ref: { type: "memory", scope, id: retained.id, revision: retained.revision },
  text: retained.text, metadata: { state: "active", reviewState: "none", filing: { status: "unfiled" },
    kind: retained.kind, origin: retained.origin, confidence: retained.confidence },
  qualification: null, attribution: { status: "unassessed", commitment: "unknown" },
  sourceAccess: "available", receipts: [], receiptCoverage: { status: "complete", included: 0, omitted: 0 } };
const identity = { storeId: "fixture", cursorKey: new TextEncoder().encode("fixture signing material") };
const embedded = { vector: Float32Array.of(1), model: "fixture" };

function fixture({ now, embed, search, lexical, keyless = false }) {
  const { storage, deps, hooks } = serviceFake({ rows: [retained], recall: true, semantic: true });
  const events = [];
  const mark = (name, detail) => events.push({ name, at: performance.now(), detail });
  const names = () => events.map(({ name }) => name);
  let lastLexicalTx;
  let lexicalActive = false;
  const { run } = storage.uow;
  storage.uow.run = (owner, options, work) => run(owner, options, async tx => {
    try { return await work(tx); }
    finally {
      if (tx === lastLexicalTx) lexicalActive = false;
    }
  });
  const { vector } = storage.vector;
  storage.vector.vector = (tx, ...args) => {
    assert.equal(tx, lastLexicalTx, "vector and lexical share the ranking transaction");
    mark("vector");
    return vector(tx, ...args);
  };
  hooks.vectorDistance = () => 0;
  Object.assign(storage.capabilities, { contextRead: true, contextRawRead: true, inspect: true });
  storage.inspect = { identity() {}, item() {}, list() {} };
  storage.contextRead = {
    maintenanceAvailable: true,
    async identity() { return identity; },
    async prepareLexical() { mark("maintenance"); },
    async observeIndex() {
      return { indexState: "current", ready: true, byType: { memory: { eligible: 1, indexed: 1 } },
        maintenance: { available: true, state: "ready", buildState: "ready", reason: null, progress: null } };
    },
    async lexical(tx) {
      mark("lexical");
      lastLexicalTx = tx;
      lexicalActive = true;
      lexical?.();
      return { matched: 1, rows: [{ ref: evidence.ref, score: 1 }] };
    },
    async snapshotState() { return [{ memory: 1 }]; },
    async evidence() { mark("evidence"); return [evidence]; },
    raw: {
      async search(_tx, _set, _query, options) {
        mark("raw", { deadline: options.deadlineAtMs, lexicalOnly: options.lexicalOnly });
        await search?.();
        mark("raw-end");
        return { coverage: "included", turns: [turn] };
      },
      async revalidate(_tx, _set, turns) {
        mark("raw-revalidate");
        assert.deepEqual(turns, [turn]);
        return true;
      },
    },
  };
  const host = { storage, clock: { ...deps.clock, nowMs: () => 100, monotonicMs: now },
    contextReadCounter: { count: text => Math.ceil(Buffer.byteLength(text) / 8) }, contextReadFormat: JSON.stringify };
  const service = keyless ? createMemoryService({ profile: "keyless-local", ...host }) :
    createMemoryService({ ...deps, ...host, embedQuery: embed && { async embedQuery(owner, query, options) {
      mark("embed", options.deadlineAtMs);
      assert.deepEqual([owner, query, options.budgetClass], [scope.owner, input.query, "recall"]);
      const result = await embed(options);
      mark("embed-end", { lexicalActive });
      return result;
    } } });
  return { service, events, names };
}

function assertEvidence(result) {
  assert.equal(result.diagnostics.coverage.raw, "included");
  const { items } = result.assembly;
  assert.deepEqual(items.filter(({ ref }) => ref.type === "memory").map(({ body }) => body), [retained.text]);
  assert.deepEqual(items.filter(({ ref }) => ref.type === "raw").map(({ ref }) => ref.messageId), [turn.messageId]);
}

test("Raw and lexical search run during query embedding and Raw uses the read's cutoff", async t => {
  // The fixture uses logical time for the cutoff and real timers for the overlap.
  let time = 0;
  const { service, events, names } = fixture({
    now() {
      const current = time;
      if (time === 0) time = 10;
      return current;
    },
    async embed() {
      await delay(150);
      time = 160;
      return embedded;
    },
    async search() {
      const start = time;
      await delay(180);
      time = start + 370;
    },
  });
  const result = await service.readContext(readSet, input);
  const event = name => events.find(entry => entry.name === name);
  const started = Math.min(event("embed").at, event("raw").at, event("maintenance").at);
  t.diagnostic(JSON.stringify({ rawMs: event("raw").at - started, lexicalMs: event("lexical").at - started,
    embedMs: event("embed-end").at - started, rawEndMs: event("raw-end").at - started,
    rawCutoffMs: event("raw").detail.deadline, rawCoverage: result.diagnostics.coverage.raw }));
  assert.ok(event("raw").at < event("embed-end").at);
  assert.ok(event("maintenance").at < event("embed-end").at);
  assert.ok(event("lexical").at < event("embed-end").at);
  assert.equal(event("embed-end").detail.lexicalActive, false);
  assert.ok(event("vector").at >= event("embed-end").at);
  assert.equal(event("raw").detail.deadline, 400);
  assert.equal(event("embed").detail, 505);
  assert.equal(names().filter(name => name === "embed").length, 1);
  assert.deepEqual(result.diagnostics.candidates.channels.semantic, { state: "ready", causes: [] });
  assertEvidence(result);
  assert.deepEqual((await service.fetchEvidence(readSet, { snapshot: result.snapshot })).items.map(({ ref }) => ref),
    [evidence.ref]);
  assert.equal(names().filter(name => name === "embed").length, 1);
});

for (const cause of ["timeout", "unavailable"]) {
  test(`keeps lexical and Raw evidence when embedding is ${cause}`, async t => {
    let signal;
    const { service, names } = fixture({ now: () => performance.now(), async embed(options) {
      signal = options.signal;
      await delay(cause === "timeout" ? 1000 : 20, undefined, { signal });
      throw new Error("fixture provider failure");
    } });
    const result = await service.readContext(readSet, input);
    assertEvidence(result);
    assert.deepEqual(result.diagnostics.candidates.channels.semantic, { state: "unavailable", causes: [cause] });
    assert.equal(result.diagnostics.candidates.trace.effective, "lexical");
    assert.equal(signal.aborted, cause === "timeout");
    assert.equal(names().filter(name => name === "embed").length, 1);
    assert.ok(!names().includes("vector"));
    t.diagnostic(JSON.stringify({ cause, embedMs: result.diagnostics.candidates.trace.timings.embeddingMs }));
  });
}

test("reads without a query embedding keep the sequential call order and response bytes", async t => {
  const unexpected = () => assert.fail("unexpected embedding");
  for (const [mode, config, request] of [
    ["keyless", { keyless: true }, input],
    ["disabled", { embed: unexpected }, { ...input, semantic: false }],
    ["no embedder", {}, input],
  ]) {
    let now = 10;
    const { service, events, names } = fixture({ ...config, now: () => now, lexical() { now = 100; } });
    const result = await service.readContext(readSet, request);
    assertEvidence(result);
    assert.deepEqual(names(), ["maintenance", "lexical", "raw", "raw-end", "evidence", "evidence", "raw-revalidate"]);
    assert.deepEqual(events.find(({ name }) => name === "raw").detail,
      { deadline: 464, lexicalOnly: mode === "disabled" });
    const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex");
    assert.equal(digest, "392e374ea8cef70b461d3fce4a8cb5ab05ba50393a49bfeebfff8df9563ff302", mode);
    t.diagnostic(`${mode} ${digest}`);
  }
});
