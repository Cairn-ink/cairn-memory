import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "../src/service/index.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const ref = { type: "card", scope, id: "card", revision: 1, bodyRevision: 1 };
const item = { type: "card", ref, title: "Map", body: "The trail follows the river.",
  state: "active", origin: "manual", support: {}, qualification: {}, provenance: {}, bindings: [], triggerMemoryRefs: [] };
const input = { intent: "current", query: "trail", types: ["card"] };
const amendment = { amendmentId: "change", date: "2025-05-01", sentence: "The trail now crosses the meadow.",
  quote: "It goes through the meadow now.", sourceMessage: { client: "source", sessionId: "archive-source", messageId: "turn" } };

function fixture({ loader = true, sourceProjection, forgetDuringEvidence = false } = {}) {
  let visibility = { card: { id: ref.id, scope, origin: item.origin, title: item.title, body: item.body,
    sourceMemories: [{ id: "link", revision: 1 }], sourceMessage: null }, requestedScope: scope,
    memoryStates: new Map([["link", { status: "visible", revision: 1, correctedRevisions: [] }]]), textFacts: [] };
  let current;
  let checks = 0;
  const storage = {
    capabilities: { contextRead: true, documentCards: true, inspect: true },
    inspect: { identity() {}, list() {}, item() {} },
    uow: { async run(owner, { readOnly }, run) {
      assert.equal(owner, scope.owner);
      assert.equal(readOnly, true);
      current = { owner, readOnly };
      try { return await run(current); } finally { current = null; }
    } },
    fence: { async assertVisible(tx, _set, refs) {
      assert.equal(tx, current);
      return refs;
    } },
    documentCards: {
      ...(loader && { async visibilityInputs(tx, requestedScope, refs) {
        assert.equal(tx, current);
        assert.deepEqual(requestedScope, scope);
        assert.deepEqual(refs, [{ type: "card", id: ref.id, namespace: scope.namespace }]);
        checks++;
        if (visibility instanceof Error) throw visibility;
        return [visibility];
      } }),
      async get(tx) {
        assert.equal(tx, current);
        return { ...visibility.card, amendments: [amendment] };
      },
    },
    contextRead: {
      maintenanceAvailable: false,
      async identity(tx) {
        assert.equal(tx, current);
        return { storeId: "fixture", cursorKey: new TextEncoder().encode("synthetic signing material") };
      },
      async observeIndex() {
        return { indexState: "index", ready: true, byType: { card: { eligible: 1, indexed: 1 } },
          maintenance: { available: false, state: "ready", buildState: "ready", reason: null, progress: null } };
      },
      async lexical() { return { matched: 1, rows: [{ ref, score: 1 }] }; },
      async snapshotState() { return [{ memory: 1, card: 1 }]; },
      async evidence(tx) {
        assert.equal(tx, current);
        if (forgetDuringEvidence) visibility.memoryStates.set("link", { status: "forgotten" });
        return [{ type: "card", item, lineageStamp: null }];
      },
      ...(sourceProjection && { async documentCardAmendmentSource(tx, requestedSet, requestedScope, { sourceMessage, quote }) {
        assert.equal(tx, current);
        assert.deepEqual(requestedSet, readSet);
        assert.deepEqual(requestedScope, scope);
        assert.deepEqual(sourceMessage, amendment.sourceMessage);
        assert.equal(quote, amendment.quote);
        return sourceProjection();
      } }),
    },
  };
  const service = createMemoryService({ profile: "keyless-local", storage, clock: { nowMs: () => 1, monotonicMs: () => 0,
    hmacHex() { throw new Error("unexpected host HMAC"); } },
  contextReadCounter: { count: text => Math.ceil(text.length / 8) }, contextReadFormat: JSON.stringify });
  return { service, checks: () => checks, missing() { visibility = null; },
    fail() { visibility = new Error("unavailable"); },
    forget() { visibility.memoryStates.set("link", { status: "forgotten" }); } };
}

test("the evidence gate withholds forgotten cards even when the adapter's generic fence allows them", async () => {
  const f = fixture();
  const fetched = await f.service.fetchEvidence(readSet, { refs: [ref], intent: "current" });
  assert.deepEqual(fetched.items, [item]);
  assert.equal(f.checks(), 1);
  f.forget();
  await assert.rejects(f.service.fetchEvidence(readSet, { refs: [ref], intent: "current" }), { code: "evidence_unavailable" });
  await assert.rejects(f.service.fetchEvidence(readSet, { snapshot: fetched.snapshot }), { code: "snapshot_stale" });
  assert.deepEqual((await f.service.findCandidates(readSet, input)).items, []);
  assert.deepEqual((await f.service.readContext(readSet, input)).assembly.items, []);
});

test("missing and failed visibility inputs withhold card evidence", async () => {
  for (const withhold of ["missing", "fail"]) {
    const f = fixture();
    f[withhold]();
    await assert.rejects(f.service.fetchEvidence(readSet, { refs: [ref], intent: "current" }), { code: "evidence_unavailable" });
    assert.deepEqual((await f.service.readContext(readSet, input)).assembly.items, []);
  }
  const disabled = fixture({ loader: false });
  const found = await disabled.service.findCandidates(readSet, input);
  assert.deepEqual(found.items, []);
  assert.equal(found.coverage.byType.card.eligible, 0);
  assert.equal(found.coverage.byType.card.indexed, 0);
});

test("the assembly gate runs for evidence after selection as well as for candidates", async () => {
  const f = fixture({ forgetDuringEvidence: true });
  assert.deepEqual((await f.service.findCandidates(readSet, input)).items.map(({ ref }) => ref), [ref]);
  const result = await f.service.readContext(readSet, input);
  assert.deepEqual(result.assembly.items, []);
  assert.equal(result.diagnostics.omitted.unavailable, 1);
});

test("an incomplete amendment is withheld and a source changing after metering invalidates delivery", async () => {
  let complete = false;
  let expireAfterProjection = false;
  const identity = { sessionKeyHash: "a".repeat(64), messageKey: "turn" };
  const f = fixture({ sourceProjection() {
    const rawRows = [{ ...identity, type: "raw", scope, source: amendment.sourceMessage, startUtf16: 0,
      endUtf16: complete ? 10 : 9 }];
    if (expireAfterProjection) complete = false;
    return { sourceIdentity: identity, source: { rawRows, sourceLengthUtf16: 10, sourceExcluded: false, facts: [] } };
  } });
  const { assembly } = await f.service.readContext(readSet, input);
  assert.equal(assembly.items[0].body, item.title + "\n" + item.body);
  assert.deepEqual(assembly.items[0].sources, []);
  complete = true;
  expireAfterProjection = true;
  await assert.rejects(f.service.readContext(readSet, input), { code: "snapshot_stale" });
});
