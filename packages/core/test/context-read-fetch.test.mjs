import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { fetchEvidenceMethod } from "../src/service/context-read-fetch.mjs";

const storeId = "synthetic-store";
const cursorKey = new TextEncoder().encode("synthetic fixture signing material");
const owner = "test-owner";
const project = { owner, namespace: "project\0project" };
const personal = { owner, namespace: "personal\0" };
const projectNamespace = { ownerId: owner, scope: "project", projectId: "project" };
const personalNamespace = { ownerId: owner, scope: "personal", projectId: null };
const set = { owner, namespaces: [project.namespace, personal.namespace], accessGenerations: [8, 5] };
const scopeOf = scopes => createHmac("sha256", cursorKey)
  .update(JSON.stringify(["context-read-v1", "snapshot-scope", storeId, scopes])).digest("base64url");
const itemFence = item => createHmac("sha256", cursorKey)
  .update(JSON.stringify(["context-read-v1", "snapshot-item", storeId, item])).digest("base64url");
const snapshotPayload = snapshot => JSON.parse(Buffer.from(snapshot.split(".")[0], "base64url").toString("utf8"));

function fixture(rowFor, state = [{ memory: 2 }, { memory: 6 }]) {
  let permitted = true;
  let calls = [];
  const service = fetchEvidenceMethod({
    capabilities: { contextRead: true },
    uow: { async run(actualOwner, options, callback) {
      assert.equal(actualOwner, owner);
      assert.equal(options.readOnly, true);
      calls = [];
      return callback({ owner, options });
    } },
    contextRead: {
      async identity() { calls.push("identity"); return { storeId, cursorKey }; },
      async snapshotState(_tx, readSet) {
        calls.push("state");
        assert.deepEqual(readSet.namespaces, [personal.namespace, project.namespace]);
        assert.deepEqual(readSet.accessGenerations, [5, 8]);
        return state;
      },
      async evidence(_tx, _readSet, refs) {
        calls.push("evidence");
        return refs.map(ref => rowFor(ref));
      },
    },
    fence: { async assertVisible(_tx, _readSet, refs) {
      calls.push("fence");
      return permitted ? refs : [];
    } },
  });
  return { service, calls: () => calls, deny: () => { permitted = false; } };
}

test("receipt identity and full Memory fence match the legacy domains and field order", async () => {
  const ref = { type: "memory", scope: project, id: "memory-1", revision: 3 };
  const receipt = { id: "receipt-1", client: "client", sessionId: "session", eventId: "event", role: "user",
    excerpt: "the retained excerpt", createdAtMs: 1, messageId: "message", occurredAtMs: null };
  const anchor = { index: 0, text: "omit this anchor text", start: 0, end: 4 };
  const coverage = { status: "complete", included: 1, omitted: 0 };
  const metadata = { state: "active", reviewState: "none", filing: { status: "unfiled" }, kind: "fact",
    origin: "inferred", confidence: 0.8 };
  let retained = receipt;
  const { service, calls, deny } = fixture(() => ({
    type: "memory", ref, metadata, text: "the body",
    qualification: { anchors: [anchor], applicability: "current" },
    attribution: { status: "unassessed", commitment: "unknown" },
    sourceAccess: "available", receipts: [retained], receiptCoverage: coverage,
  }));
  const result = await service(set, { refs: [ref], intent: "current" });
  assert.deepEqual(calls(), ["identity", "state", "evidence", "fence"]);
  const contentIdentity = createHmac("sha256", cursorKey).update(JSON.stringify([
    "retained-receipt-content-v1", [storeId, [projectNamespace, ref.id, ref.revision, receipt.id,
      receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt]],
  ])).digest("base64url");
  const qualification = { anchors: [{ index: 0, start: 0, end: 4 }], applicability: "current", sourceText: "read-separately" };
  const receiptMeta = { memoryId: ref.id, memoryRevision: ref.revision, receiptId: receipt.id };
  const legacy = { type: "memory", ref: { type: "memory", namespace: projectNamespace, memoryId: ref.id, revision: ref.revision },
    ...metadata, content: "the body", qualification,
    provenance: {
      sources: [{ type: "receipt", namespace: projectNamespace, ...receiptMeta, contentIdentity, completeness: "excerpt-only" }],
      sourceAccess: "available", receiptMetadata: [receiptMeta], completeness: "excerpt-only", conversationCoverage: "unknown",
      meaning: "unassessed", attribution: { status: "unassessed", commitment: "unknown" }, corroboration: "not-assessed", coverage,
    } };
  const fullFence = itemFence(legacy);
  assert.deepEqual(result.items[0].qualification, qualification);
  assert.equal(result.items[0].provenance.sources[0].contentIdentity === contentIdentity, true);
  assert.deepEqual(snapshotPayload(result.snapshot), { v: 1, scope: scopeOf([personalNamespace, projectNamespace]),
    intent: "current", refs: [[1, "memory", ref.id, 3]], generations: [{ memory: 2 }, { memory: 6 }],
    access: [5, 8], fences: [fullFence] });
  const canonicalRequest = { ...set, namespaces: [personal.namespace, project.namespace], accessGenerations: [5, 8] };
  await service(canonicalRequest, { refs: [ref], intent: "current", fences: [fullFence.slice(0, 8)] });
  retained = { ...receipt, excerpt: "changed excerpt" };
  await assert.rejects(service(set, { snapshot: result.snapshot }), { code: "snapshot_stale" });
  retained = receipt;
  deny();
  await assert.rejects(service(set, { refs: [ref], intent: "current" }), { code: "evidence_unavailable" });
  await assert.rejects(service(set, { snapshot: result.snapshot }), { code: "snapshot_stale" });
});

test("Card namespace state, revision and lineage stamp all fence replay", async () => {
  let lineageStamp = [3, 1, "body-digest", "provenance-digest"];
  const ref = { type: "card", scope: personal, id: "card-1", revision: 5, bodyRevision: 3 };
  const item = {
    type: "card", ref, state: "confirmed", support: { status: "eligible" }, origin: "manual",
    title: "Synthetic manual card", body: "Card body",
    qualification: { applicability: "current" }, provenance: { sources: [] }, bindings: [], triggerMemoryRefs: [],
  };
  const states = [{ memory: 2, card: 5, lineage: "namespace-lineage" }, { memory: 6, card: 1, lineage: "empty-lineage" }];
  const { service } = fixture(() => ({ type: "card", item, lineageStamp }), states);
  const exact = await service(set, { refs: [ref], intent: "current" });
  assert.deepEqual(exact.items, [item]);
  const legacy = { ...item, ref: { type: "card", namespace: personalNamespace, cardId: "card-1", revision: 5, bodyRevision: 3 } };
  const fullFence = itemFence([legacy, lineageStamp]);
  assert.deepEqual(snapshotPayload(exact.snapshot), { v: 1, scope: scopeOf([personalNamespace, projectNamespace]),
    intent: "current", refs: [[0, "card", "card-1", 5, 3]], generations: states, access: [5, 8], fences: [fullFence] });
  await service(set, { refs: [ref], intent: "current", fences: [fullFence.slice(0, 8)] });
  await assert.rejects(service(set, { refs: [{ ...ref, bodyRevision: 2 }], intent: "current" }), { code: "revision_conflict" });
  lineageStamp = [3, 2, "body-digest", "new-provenance-digest"];
  await assert.rejects(service(set, { snapshot: exact.snapshot }), { code: "snapshot_stale" });
  await assert.rejects(service(set, { refs: [ref], intent: "current", fences: [fullFence.slice(0, 8)] }), { code: "snapshot_stale" });
});
