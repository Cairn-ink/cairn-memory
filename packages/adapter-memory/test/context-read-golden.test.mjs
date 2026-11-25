import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "synthetic-owner", namespace: "project\0synthetic-project" };
const selection = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const search = { query: "albatross", types: ["memory"], intent: "current" };
const original = "The synthetic albatross wears a teal scarf.";
const corrected = "The synthetic albatross wears an amber scarf.";
const source = { kind: "mcp", client: null, sessionId: null };

const readyChannels = {
  lexical: { state: "ready", causes: [] },
  semantic: { state: "disabled", causes: ["disabled", "absent"] },
};

function checkTrace(trace, requested) {
  const { timings, maintenance, ...configuration } = trace;
  assert.deepEqual(configuration, { requested, effective: "lexical", family: "local", preset: "rrf-k60-d12",
    embedder: null, tokenizer: "hr1-t1-v1", representation: "candidate-text-v1" });
  assert.deepEqual(Object.keys(timings), ["maintenanceMs", "lexicalMs", "semanticPreflightMs", "embeddingMs", "fusionMs"]);
  for (const elapsed of Object.values(timings)) assert.ok(Number.isFinite(elapsed) && elapsed >= 0);
  if (requested === "hybrid") {
    assert.equal(maintenance, undefined);
    assert.deepEqual(Object.values(timings), [0, 0, 0, 0, 0]);
  } else {
    assert.ok(maintenance);
    for (const count of Object.values(maintenance)) assert.ok(Number.isFinite(count) && count >= 0);
  }
}

function checkFind(result, items, type, size, buildState, reason, [phase, checkpoint, sequence, baseSequence]) {
  assert.equal(result.version, "context-read-v1");
  assert.deepEqual(result.items, items);
  assert.deepEqual(result.channels, readyChannels);
  assert.deepEqual(result.coverage, {
    status: "complete",
    byType: { [type]: { eligible: size, indexed: size, embedded: null, scanned: 0, embeddedFraction: null,
      scannedFraction: size === 0 ? 1 : 0 } },
    freshness: "current",
    maintenance: { available: true, state: "ready", buildState, reason, progress: { phase, checkpoint, sequence, baseSequence } },
    depths: { lexical: 24, semantic: 0 }, omitted: { lexical: 0, semantic: null, horizon: 0 },
    stops: { deadline: false, budget: false },
  });
  checkTrace(result.trace, "lexical");
  assert.equal(result.nextCursor, null);
}

function code(expected) {
  return error => error.name === "CoreError" && error.code === expected && error.retryable === false;
}

function receipt(id, n) {
  return { id, client: "synthetic-client", sessionId: "synthetic-session", messageId: "message-" + n,
    eventId: "event-" + n, role: "user", occurredAtMs: null, createdAtMs: n, excerpt: original };
}

test("installed-local 0.6.11 canonical find and fetch sequence", async t => {
  const adapter = createMemoryAdapter({ capabilities: { contextRead: true, fingerprintKey: true } });
  const service = contextReadTestService(adapter);
  await t.test("find empty", async () => {
    checkFind(await service.findCandidates(selection, search), [], "memory", 0, "rebuilt", "missing", [1, 1, 1, 0]);
  });

  // The unchanged explicit core save entry has no receipt input. Seed the two
  // retained receipts through the adapter's real Memory write port, with the
  // revision and confidence that the installed transcript delivers.
  const ref = await adapter.uow.run(scope.owner, {}, async tx => {
    const { id } = await adapter.memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text: original, source, confidence: 0.5, embedding: null,
      textHash: "sha256:" + createHash("sha256").update(original.toLowerCase()).digest("hex"),
    }, [receipt("receipt-1", 1)], 1);
    const { revision } = await adapter.memories.touchDuplicate(tx, scope, id, [receipt("receipt-2", 2)],
      { confidence: 1, kind: "fact", origin: "explicit" }, 2);
    return { type: "memory", scope, id, revision };
  });

  await t.test("find populated", async () => {
    checkFind(await service.findCandidates(selection, search), [{
      ref, rank: 1, fusionScore: null, channels: { lexical: { rank: 1, rawScore: 0.28768207245178085 }, semantic: null },
    }], "memory", 1, "ready", null, [1, 2, 2, 1]);
  });
  await t.test("find semantic keyless", async () => {
    await assert.rejects(service.findCandidates(selection, { ...search, semantic: true }), error => {
      assert.ok(code("invalid_input")(error));
      const { channels, coverage, trace } = error.diagnostics;
      assert.deepEqual(channels, { lexical: { state: "unavailable", causes: ["unavailable"] },
        semantic: { state: "absent", causes: ["absent"] } });
      assert.deepEqual(coverage, {
        status: "unavailable", freshness: "unverified", byType: { memory: {
          eligible: null, indexed: null, embedded: null, scanned: null, embeddedFraction: null, scannedFraction: null,
        } },
        maintenance: { available: true, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null },
        depths: { lexical: 0, semantic: 0 }, omitted: { lexical: null, semantic: null, horizon: null },
        stops: { deadline: false, budget: false },
      });
      checkTrace(trace, "hybrid");
      return true;
    });
  });
  await t.test("find cards disabled", async () => {
    checkFind(await service.findCandidates(selection, { ...search, types: ["card"] }),
      [], "card", 0, "rebuilt", "missing", [4, 1, 1, 0]);
  });
  await t.test("find invalid cursor", async () => {
    // The transcript uses a public handle, for which the host returns cursor_stale.
    await assert.rejects(service.findCandidates(selection, { ...search, cursor: "synthetic-invalid-cursor" }),
      code("invalid_cursor"));
  });

  let exact;
  await t.test("fetch by ref", async () => {
    exact = await service.fetchEvidence(selection, { refs: [ref], intent: "current" });
    const sourceIds = exact.items[0].provenance.sources.map(value => value.contentIdentity);
    assert.match(exact.snapshot, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    assert.equal(new Set(sourceIds).size, 2);
    assert.ok(sourceIds.every(value => /^[A-Za-z0-9_-]{43}$/.test(value)));
    const metadata = ["receipt-1", "receipt-2"].map(receiptId => ({ memoryId: ref.id, memoryRevision: 2, receiptId }));
    assert.deepEqual(exact.items, [{
      type: "memory", ref, state: "active", reviewState: "none", filing: { status: "unfiled" },
      kind: "fact", origin: "explicit", confidence: 1, text: original, qualification: null,
      provenance: {
        sources: metadata.map((entry, i) => ({ type: "receipt", scope, ...entry,
          contentIdentity: sourceIds[i], completeness: "excerpt-only" })),
        sourceAccess: "available", receiptMetadata: metadata, completeness: "excerpt-only",
        conversationCoverage: "unknown", meaning: "unassessed", attribution: { status: "unassessed", commitment: "unknown" },
        corroboration: "not-assessed", coverage: { status: "complete", included: 2, omitted: 0 },
      },
    }]);
  });
  await t.test("fetch foreign ref", async () => {
    await assert.rejects(service.fetchEvidence(selection, { refs: [{ ...ref, scope: { ...scope, owner: "other-synthetic-owner" } }],
      intent: "current" }), code("authority_required"));
  });
  await t.test("fetch invalid snapshot", async () => {
    await assert.rejects(service.fetchEvidence(selection, { snapshot: "synthetic-invalid-snapshot" }), code("snapshot_stale"));
  });
  await t.test("fetch by snapshot", async () => {
    const replay = await service.fetchEvidence(selection, { snapshot: exact.snapshot });
    assert.deepEqual(replay.items, exact.items);
    assert.equal(replay.snapshot, exact.snapshot);
  });
  const correction = await service.correct(scope, ref.id, ref.revision, corrected, source);
  assert.equal(correction.status, "saved");
  assert.equal(correction.item.revision, 3);
  await t.test("fetch stale snapshot after correction", async () => {
    await assert.rejects(service.fetchEvidence(selection, { snapshot: exact.snapshot }), code("snapshot_stale"));
  });
  assert.equal((await service.forget(scope, ref.id, source)).status, "forgotten");
  await t.test("find forgotten", async () => {
    checkFind(await service.findCandidates(selection, search), [], "memory", 0, "ready", null, [1, 3, 3, 2]);
    await assert.rejects(service.fetchEvidence(selection, { refs: [ref], intent: "current" }), code("evidence_unavailable"));
  });
});

test("admitted capture retains one bounded, redacted receipt with stable identity", async () => {
  const adapter = createMemoryAdapter({ capabilities: { contextRead: true } });
  const service = contextReadTestService(adapter);
  const key = { scope, client: "capture", sessionId: "conversation", eventId: "event", payloadDigest: "a".repeat(64) };
  const content = "  API_KEY=sk-synthetic_example_for_redaction  " + "z".repeat(900);
  const message = { id: "turn", role: "user", content, occurredAtMs: 1 };
  const write = action => adapter.uow.run(scope.owner, { pauseLock: true }, action);
  assert.equal((await write(tx => adapter.capture.admit(tx, key, [message]))).status, "admitted");
  const claim = await write(tx => adapter.capture.claim(tx, key, [message], { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(tx => adapter.capture.beginDispatch(tx, claim.token));
  const finished = await write(async tx => {
    await adapter.capture.assertEligible(tx, key, [0]);
    return adapter.capture.finish(tx, claim.token, [{
      content: original, kind: "fact", confidence: 0.8, embedding: null,
      textHash: "sha256:" + createHash("sha256").update(original.toLowerCase()).digest("hex"),
      receipts: [{ client: key.client, sessionId: key.sessionId, messageId: message.id, role: "user", occurredAtMs: null }],
    }]);
  });
  const { id, revision } = finished.memories[0];
  const ref = { scope, type: "memory", id, revision };
  const retained = await adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.contextRead.evidence(tx, selection, [ref], "current"));
  const [row] = retained;
  assert.equal(row.receipts.length, 1);
  const [stored] = row.receipts;
  assert.equal(stored.excerpt.length, 800);
  assert.ok(!stored.excerpt.includes("sk-synthetic_example"));
  assert.equal(stored.eventId, message.id);
  assert.equal(stored.occurredAtMs, 1);
  const first = await service.fetchEvidence(selection, { refs: [ref], intent: "current" });
  const second = await service.fetchEvidence(selection, { snapshot: first.snapshot });
  assert.deepEqual(first.items, second.items);
  assert.equal(first.items[0].provenance.sources[0].receiptId, stored.id);
  const oldRead = await service.read(scope, { type: "memory", id });
  assert.deepEqual(oldRead.receipts, [{ client: key.client, sessionId: key.sessionId, messageId: message.id,
    role: "user", occurredAtMs: 1 }]);
});
