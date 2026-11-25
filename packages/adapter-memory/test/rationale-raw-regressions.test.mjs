import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError, coreDigest, decisionContext, relatePlaced } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "test-owner", namespace: null };
const editor = { kind: "web", client: null, sessionId: null };
const edge = { from: 1, to: 0, relation: "supports-decision", fromReceipt: 0, toReceipt: 0 };
const sha256Hex = async value => createHash("sha256").update(value).digest("hex");

function fixture({ fingerprintKey = true } = {}) {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, rationaleEdges: true, fingerprintKey } });
  const { uow, raw, rationale: store } = adapter;
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const sent = [];
  let providerCalls = 0;
  const model = { model: "fixture", contextWindow: 8192, countTokens: () => 1 };
  const gate = { async assertOpen(owner) {
    await uow.run(owner, { pauseLock: true, readOnly: true }, async tx => {
      if ((await adapter.pause.get(tx, owner)).paused) throw new CoreError("capture_paused");
    });
  } };
  const service = createMemoryService({
    storage: adapter, gate, model: { ...model, call: () => assert.fail("Unexpected service model call") },
    embedder: { model: "fixture", dimensions: 1, async embed() { return [Float32Array.of(1)]; } },
    clock: { nowMs: Date.now, monotonicMs: () => performance.now(), sha256Hex, hmacHex: () => assert.fail("Unexpected HMAC") },
    tokens: model, config: {},
  });
  const options = { uow, scope, store, retrieval: adapter, gate };
  return {
    adapter, read, write, service, sent,
    get providerCalls() { return providerCalls; },
    async capture(label, claim, content = claim, { eventId = label, archived = 1 } = {}) {
      const key = { scope, client: "test-client", sessionId: label, eventId, payloadDigest: await sha256Hex(content) };
      const message = { id: "message", role: "user", content, occurredAtMs: 1 };
      const receipt = { client: key.client, sessionId: label, messageId: message.id, role: message.role, occurredAtMs: 1 };
      const digest = await coreDigest(claim);
      const result = await write(async tx => {
        const { token, status } = await adapter.capture.claim(tx, key, [message], { leaseMs: 1000 });
        assert.equal(status, "claimed");
        assert.deepEqual(await raw.archive(tx, key, [message]), { archived });
        await adapter.capture.assertEligible(tx, key, [0]);
        return adapter.capture.finish(tx, token, [{
          content: claim, kind: "fact", confidence: 0.8, textHash: "sha256:" + digest.value,
          embedding: null, receipts: [receipt],
        }]);
      });
      const { id: memoryId, revision } = result.memories[0];
      return { key, message, ref: { memoryId, revision } };
    },
    evidence: ref => read(tx => store.sourceEvidence(tx, scope, [ref])),
    review(refs, edges = []) {
      return relatePlaced({ ...options, refs, model: { ...model, async call(_stage, { input }) {
        providerCalls++;
        sent.push(...input.memories.flatMap(({ receipts }) => receipts.map(({ excerpt }) => excerpt)));
        return { edges };
      } } });
    },
    context: ({ memoryId, revision }) => decisionContext({ ...options, memoryId, revision }),
  };
}

for (const change of ["pause", "forget"]) {
  test(`a committed ${change} during the freshness reread stops provider dispatch`, async () => {
    let intercepted = 0;
    // Exercise each pre-dispatch freshness read. The original path had a second reread
    // after the dispatch gate. Any reread after the provider call is outside this race.
    for (const target of [2, 3]) {
      const f = fixture();
      const { ref } = await f.capture("source", "Use the brass latch.");
      const { sourceEvidence } = f.adapter.rationale;
      let reads = 0;
      const reread = Promise.withResolvers();
      const committed = Promise.withResolvers();
      f.adapter.rationale.sourceEvidence = async (...args) => {
        const evidence = await sourceEvidence(...args);
        if (++reads === target && f.sent.length === 0) {
          reread.resolve(true);
          await committed.promise;
        }
        return evidence;
      };
      const review = f.review([ref]);
      if (!await Promise.race([reread.promise, review.then(() => false)])) continue;
      intercepted++;
      try {
        if (change === "pause") assert.equal((await f.service.setPause(scope.owner, true)).paused, true);
        else assert.equal((await f.service.forget(scope, ref.memoryId, editor)).status, "forgotten");
      } finally {
        committed.resolve();
      }
      const result = await review;
      assert.deepEqual(f.sent, [], "The provider must not receive evidence after the commit");
      assert.equal(result.status, "failed");
    }
    assert.ok(intercepted > 0, "The test must commit a change during a pre-dispatch freshness reread");
  });
}

async function assertWithheld(f, ref) {
  const evidence = await f.evidence(ref).then(
    sources => sources.flatMap(({ receipts }) => receipts.map(({ excerpt }) => excerpt)),
    error => error.code,
  );
  const review = await f.review([ref]);
  assert.deepEqual({ evidence, sent: f.sent, providerCalls: f.providerCalls, status: review.status, error: review.error?.code },
    { evidence: "revision_conflict", sent: [], providerCalls: 0, status: "failed", error: "revision_conflict" });
}

test("a corrected claim embedded in a longer Raw message cannot return as evidence", async () => {
  const f = fixture();
  const claim = "Inventory belongs in the blue cabinet.";
  const content = "In the weekly stock review we discussed several options. " + claim +
    " We will update the checklist and tell the next shift after the meeting.";
  const { ref } = await f.capture("source", claim, content);
  assert.equal((await f.evidence(ref))[0].receipts[0].excerpt, content);
  const result = await f.service.correct(scope, ref.memoryId, ref.revision, "File the catalog beside the register.", editor);
  assert.equal(result.status, "saved");
  await assertWithheld(f, { ...ref, revision: result.item.revision });
});

test("a corrected three-character claim in Raw is withheld from rationale", async () => {
  const f = fixture();
  const content = "Send the shipment through LAX";
  const { ref } = await f.capture("source", "LAX", content);
  assert.equal((await f.evidence(ref))[0].receipts[0].excerpt, content);
  const result = await f.service.correct(scope, ref.memoryId, ref.revision, "SFO", editor);
  assert.equal(result.status, "saved");
  await assertWithheld(f, { ...ref, revision: result.item.revision });
});

test("an excerpt with an unavailable containment key is withheld", async () => {
  const f = fixture({ fingerprintKey: false });
  const claim = "Inventory belongs in the blue cabinet.";
  const { ref } = await f.capture("source", "An independent filing note.", `We agreed that ${claim}`);
  await f.adapter.harness.seedFact(scope.owner, {
    ...scope, actionId: "text-edit", kind: "text", mode: "full", origin: "edit",
    text: { digests: [await coreDigest(claim)], keyId: "1".repeat(16), shingles: ["a".repeat(64)] },
  });
  await assertWithheld(f, ref);
});

for (const removal of ["conversation deletion", "text purge"]) {
  const title = removal === "conversation deletion"
    ? "conversation deletion prevents replay and re-review from restoring a rationale edge"
    : `re-archiving identical Raw after ${removal} requires a new review`;
  test(title, async () => {
    const f = fixture();
    const root = await f.capture("root", "Keep the current layout.");
    const premise = await f.capture("premise", "The cabinet fits the current layout.");
    const refs = [root.ref, premise.ref];
    const { raw, rationale } = f.adapter;
    assert.equal((await f.review(refs, [edge])).inserted, 1);
    const before = await f.context(root.ref);
    assert.equal(before.refs.length, 1);
    const stored = {
      factId: "text-fact", incarnation: "test-incarnation", epoch: 1n, createdAtMs: 1,
      fact: { ...scope, actionId: "text-purge", kind: "text", mode: "exact", origin: "forget",
        text: { digests: [await coreDigest(premise.message.content)] } },
    };
    const incident = await f.write(async tx => {
      const removed = removal === "conversation deletion"
        ? await raw.deleteConversation(tx, scope, premise.key)
        : await raw.purgeWithheld(tx, scope, [stored]);
      assert.equal(removed.rawDeleted, 1);
      // Reading the edge port in the deletion transaction distinguishes deletion from hiding.
      return rationale.incident(tx, scope, root.ref.memoryId, { limit: 11 });
    });
    const archived = await f.write(tx => raw.archive(tx, premise.key, [premise.message]));
    assert.equal(archived.archived, removal === "conversation deletion" ? 0 : 1);
    const replayed = await f.context(root.ref);
    assert.deepEqual({ refs: replayed.refs, storedEdgesAfterRemoval: incident.length },
      { refs: [], storedEdgesAfterRemoval: 0 });
    if (removal === "conversation deletion") {
      const review = await f.review(refs, [edge]);
      assert.deepEqual({ status: review.status, error: review.error?.code },
        { status: "failed", error: "revision_conflict" });
      assert.deepEqual((await f.context(root.ref)).refs, []);
      assert.deepEqual(await f.read(tx => rationale.incident(tx, scope, root.ref.memoryId, { limit: 11 })), []);
      return;
    }
    assert.equal((await f.review(refs, [edge])).inserted, 1);
    assert.deepEqual(await f.context(root.ref), before);
  });
}

test("a conflicting body for the same Raw message key makes its receipts uncertain", async () => {
  const f = fixture();
  const { ref, key, message } = await f.capture("source", "Use the brass latch.");
  const content = "Use the steel latch.";
  const edited = await f.capture(key.sessionId, content, content, { eventId: "edited-capture", archived: 0 });
  assert.equal((await f.adapter.harness.counters()).rawKeyConflict, 1);
  const raw = await f.read(tx => f.adapter.raw.listRaw(tx, { owner: scope.owner, namespaces: [null] }, { cursor: null, limit: 1 }));
  assert.equal(raw.items[0].content, message.content);
  await assertWithheld(f, edited.ref);
  await assertWithheld(f, ref);
});

test("a conflicting Raw import keeps the original row and withholds its rationale evidence", async () => {
  const f = fixture();
  const { ref, key, message } = await f.capture("source", "Use the brass latch.");
  const importMessage = (content) => f.service.importRawMessages(scope, [
    { client: key.client, sessionId: key.sessionId, messages: [{ ...message, content }] },
  ]);
  const duplicate = { imported: 0, duplicate: 1, suppressed: 0, invalid: 0 };
  assert.deepEqual(await importMessage(message.content), duplicate);
  assert.equal((await f.evidence(ref))[0].receipts[0].excerpt, message.content);
  assert.deepEqual(await importMessage("Use the steel latch."), duplicate);
  const raw = await f.service.listRawMessages(scope, { cursor: null, limit: 1 });
  assert.equal(raw.items[0].content, message.content);
  await assertWithheld(f, ref);
});
