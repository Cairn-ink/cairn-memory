import assert from "node:assert/strict";
import { test } from "node:test";
import { fuseCandidates } from "../src/retrieval/fusion.mjs";
import { fetchForAssembly } from "../src/service/context-read-assembly-evidence.mjs";
import { readContextMethod } from "../src/service/context-read.mjs";
import { createMemoryService } from "../src/service/index.mjs";
import { format, readSet, tokenCount } from "./helpers/context-read-compact.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const request = { query: "observations", types: ["memory"], intent: "current", raw: false };
const search = { query: request.query, types: request.types, intent: request.intent, limit: 24 };
const representations = ["representation-v2", "representation-v2-dated"];
const observations = Array.from({ length: 36 }, (_, i) => memory(
  "item-" + String(i).padStart(2, "0"), { text: "Observation " + i },
));
const refOf = ({ id }) => ({ type: "memory", id, namespace: scope.namespace });
const qualified = ({ id, revision }) => ({ type: "memory", scope, id, revision });
const scored = (row, score) => ({ ref: refOf(row), qualified: qualified(row), score });
const lexical = observations.slice(0, 24).map((row, i) => scored(row, 24 - i));
const semantic = [...observations.slice(0, 12), ...observations.slice(24)]
  .map((row, i) => scored(row, 1 - i / 32));
const expectedDeepOrder = [
  ...observations.slice(0, 12),
  ...observations.slice(12, 18).flatMap((row, i) => [row, observations[24 + i]]),
].map(qualified);

function fixture() {
  const { storage, deps, hooks } = serviceFake({ rows: observations, recall: true, semantic: true });
  const vectorDistances = new Map(semantic.map(({ ref, score }) => [ref.id, 1 - score]));
  hooks.vectorDistance = ({ id }) => vectorDistances.get(id);
  Object.assign(storage.capabilities, { contextRead: true, inspect: true });
  storage.inspect = { identity() {}, item() {}, list() {} };
  const generations = [{ memory: 1 }];
  storage.contextRead = {
    maintenanceAvailable: true,
    async identity() {
      return { storeId: "fixture", cursorKey: new TextEncoder().encode("fixture signing material") };
    },
    async observeIndex() {
      return { indexState: "current", ready: true,
        byType: { memory: { eligible: observations.length, indexed: observations.length } },
        maintenance: { available: true, state: "ready", buildState: "ready", reason: null, progress: null } };
    },
    async lexical(_tx, _set, _selection, _query, depth) {
      return { matched: lexical.length,
        rows: lexical.slice(0, depth).map(({ qualified: ref, score }) => ({ ref, score })) };
    },
    async snapshotState() { return generations; },
    async evidence(tx, _set, refs) {
      return refs.map(ref => {
        const row = tx.rows.find(({ id }) => ref.id === id);
        if (!row) return null;
        return { type: "memory", ref, text: row.text, metadata: { state: "active", reviewState: "none",
          filing: { status: "unfiled" }, kind: row.kind, origin: row.origin, confidence: row.confidence },
        qualification: null, attribution: { status: "unassessed", commitment: "unknown" },
        sourceAccess: "available", receipts: [], receiptCoverage: { status: "complete", included: 0, omitted: 0 } };
      });
    },
  };
  const clock = { ...deps.clock, nowMs: () => 100, monotonicMs: () => 0 };
  const counter = { count: tokenCount };
  const service = createMemoryService({ ...deps, clock, contextReadCounter: counter, contextReadFormat: format });
  return { service, hooks, generations, storage, clock, counter };
}

for (const representation of representations) {
  test(`${representation} fills a 24-item pack in fused rank order`, async () => {
    const { service } = fixture();
    const read = await service.readContext(readSet, { ...request, representation, budget: { maxItems: 24 } });
    const { count, ranks, coverage } = read.diagnostics.candidates;
    assert.equal(count, 24);
    assert.deepEqual(read.diagnostics.items.map(({ ref }) => ref), expectedDeepOrder);
    assert.deepEqual(read.assembly.items.map(({ ref, rank }) => [ref.id, rank]),
      expectedDeepOrder.map(({ id }, i) => [id, i + 1]));
    assert.deepEqual(ranks.slice(12, 16), [
      { lexical: 13, semantic: null }, { lexical: null, semantic: 13 },
      { lexical: 14, semantic: null }, { lexical: null, semantic: 14 },
    ]);
    assert.equal(coverage.depths.semantic, 24);
    assert.equal(coverage.omitted.semantic, 0);
    assert.equal(read.diagnostics.stops.budget, false);

    const intermediate = await service.readContext(readSet, { ...request, representation, budget: { maxItems: 18 } });
    assert.equal(intermediate.diagnostics.candidates.coverage.depths.semantic, 18);
    assert.equal(intermediate.diagnostics.candidates.coverage.omitted.semantic, 6);
    assert.equal(intermediate.assembly.items.length, 18);
  });

  test(`${representation} preserves the shallow preset and response bytes at 12 and 6 items`, async () => {
    const { service, storage, clock, counter, generations } = fixture();
    const oldFusion = fuseCandidates(lexical, semantic, {
      preset: "rrf-k60-d12", semanticState: "ready", coverageComplete: true,
    });
    const oldItems = oldFusion.rows.map(({ qualified: ref, fusionScore, channels }, i) =>
      ({ ref, fusionScore, channels, rank: i + 1 }));
    const candidates = await service.findCandidates(readSet, search);
    assert.deepEqual(candidates.items, oldItems);
    assert.equal(candidates.coverage.depths.semantic, 12);
    assert.equal(candidates.coverage.omitted.semantic, 12);
    const readReference = readContextMethod({ storage, clock, counter, format, fetch: fetchForAssembly(storage),
      async find() { return { generations, result: { ...candidates, items: oldItems } }; },
    });
    for (const maxItems of [12, 6]) {
      const input = { ...request, representation, budget: { maxItems } };
      const actual = await service.readContext(readSet, input);
      assert.equal(actual.assembly.items.length, maxItems);
      assert.equal(JSON.stringify(actual), JSON.stringify(await readReference(readSet, input)));
    }
  });
}

test("assembly depths leave candidate cursors and exact-evidence snapshot replay intact", async () => {
  const { service } = fixture();
  const first = await service.findCandidates(readSet, { ...search, limit: 6 });
  assert.ok(first.nextCursor);
  const shallow = await service.readContext(readSet, { ...request, budget: { maxItems: 6 } });
  const deep = await service.readContext(readSet, request);
  assert.notEqual(deep.snapshot, shallow.snapshot);
  for (const read of [shallow, deep]) {
    assert.ok(read.snapshot);
    const replay = await service.fetchEvidence(readSet, { snapshot: read.snapshot });
    assert.deepEqual(replay.items.map(({ ref }) => ref), read.diagnostics.items.map(({ ref }) => ref));
  }
  const next = await service.findCandidates(readSet, { ...search, cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...next.items].map(({ ref }) => ref), expectedDeepOrder.slice(0, 12));
  assert.equal(next.nextCursor, null);
  await assert.rejects(service.findCandidates(readSet, { ...search, query: "another query", cursor: first.nextCursor }),
    { code: "invalid_cursor" });
});

test("the deeper semantic pool drops a candidate hidden at the visibility fence", async () => {
  const { service, hooks } = fixture();
  const hidden = observations[24].id;
  const shallow = await service.findCandidates(readSet, search);
  assert.ok(!shallow.items.some(({ ref }) => ref.id === hidden));
  const deep = await service.readContext(readSet, request);
  assert.ok(deep.assembly.items.some(({ ref }) => ref.id === hidden));

  hooks.hideAtFence = ({ id }) => id === hidden;
  const visible = await service.readContext(readSet, request);
  assert.equal(visible.diagnostics.candidates.coverage.depths.semantic, 23);
  assert.equal(visible.diagnostics.candidates.coverage.omitted.semantic, 1);
  assert.equal(visible.assembly.items.length, 24);
  assert.ok(!visible.diagnostics.items.some(({ ref }) => ref.id === hidden));
  assert.ok(!visible.assembly.items.some(({ ref }) => ref.id === hidden));
  const replay = await service.fetchEvidence(readSet, { snapshot: visible.snapshot });
  assert.ok(!replay.items.some(({ ref }) => ref.id === hidden));
  await assert.rejects(service.fetchEvidence(readSet, { snapshot: deep.snapshot }), { code: "snapshot_stale" });
});
