import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "../src/service/index.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const ref = { type: "card", scope, id: "card", revision: 1, bodyRevision: 1 };
const input = { intent: "current", query: "trail", types: ["card"] };

function fixture(origin, { loaderless = false } = {}) {
  const item = { type: "card", ref, title: "Map", body: "The trail follows the river.",
    state: "confirmed", origin, support: {}, qualification: {}, provenance: {}, bindings: [], triggerMemoryRefs: [] };
  const lineage = origin === "manual" ? "namespace-lineage" : undefined;
  const lineageStamp = lineage ? [1, 1, "body-digest", "provenance-digest"] : null;
  const storage = {
    capabilities: { contextRead: true, inspect: true, ...(loaderless && { cards: true, documentCards: true }) },
    ...(loaderless && { documentCards: {} }),
    inspect: { identity() {}, list() {}, item() {} },
    uow: { async run(owner, options, run) { return run({ owner, readOnly: options.readOnly }); } },
    fence: { async assertVisible(_tx, _set, refs) { return refs; } },
    contextRead: {
      maintenanceAvailable: false,
      async identity() { return { storeId: "fixture", cursorKey: new TextEncoder().encode("fixture signing material") }; },
      async observeIndex() {
        return { indexState: "index", ready: true, byType: { card: { eligible: 1, indexed: 1 } },
          maintenance: { available: false, state: "ready", buildState: "ready", reason: null, progress: null } };
      },
      async lexical(_tx, _set, _selection, query) {
        return query === input.query ? { matched: 1, rows: [{ ref, score: 1 }] } : { matched: 0, rows: [] };
      },
      async snapshotState() { return [{ memory: 1, card: 1, ...(lineage && { lineage }) }]; },
      async evidence() { return [{ type: "card", item, lineageStamp }]; },
    },
  };
  return createMemoryService({ profile: "keyless-local", storage, clock: { nowMs: () => 1, monotonicMs: () => 0,
    hmacHex() { throw new Error("unexpected host HMAC"); } },
    contextReadCounter: { count: text => Math.ceil(text.length / 8) }, contextReadFormat: JSON.stringify });
}

test("legacy manual lineage card remains a candidate and an assembled item", async () => {
  for (const loaderless of [false, true]) {
    const service = fixture("manual", { loaderless });
    const found = await service.findCandidates(readSet, input);
    assert.deepEqual(found.items.map(hit => hit.ref), [ref]);
    const result = await service.readContext(readSet, input);
    assert.deepEqual(result.assembly.items.map(item => item.ref.id), [ref.id]);
    const fetched = await service.fetchEvidence(readSet, { snapshot: result.snapshot });
    assert.deepEqual(fetched.items.map(item => item.ref), [ref]);
  }
});

test("legacy engine card retains eligible and indexed totals when the query has zero matches", async () => {
  for (const loaderless of [false, true]) {
    const service = fixture("engine", { loaderless });
    const query = { ...input, query: "unmatched" };
    const found = await service.findCandidates(readSet, query);
    assert.deepEqual(found.items, []);
    assert.equal(found.coverage.byType.card.eligible, 1);
    assert.equal(found.coverage.byType.card.indexed, 1);
    const result = await service.readContext(readSet, query);
    assert.deepEqual(result.assembly.items, []);
    assert.equal(result.diagnostics.candidates.coverage.byType.card.eligible, 1);
    assert.equal(result.diagnostics.candidates.coverage.byType.card.indexed, 1);
  }
});
