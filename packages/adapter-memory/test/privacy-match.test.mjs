import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { capabilities, decideWrite, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { createMemoryStore } from "../src/memory-store.mjs";
import { createUnitOfWork } from "../src/unit-of-work.mjs";

const owner = "test-owner";
const scope = { owner, namespace: null };
const client = "test-client";
const sessionId = "test-session";
const source = { kind: "capture", client, sessionId };
const textHash = "sha256:" + "a".repeat(64);
const content = { kind: "fact", origin: "inferred", text: "test memory", textHash, confidence: 1, source, embedding: null };
const receipt = { client, sessionId, messageId: "test-message", role: "user", occurredAtMs: 15 };
const sessionKeyHash = "b".repeat(64);
const factBase = { owner, origin: "forget" };

test("capture finish and full write policy suppress the same exact digest", async () => {
  const { capture, harness, memories, uow } = createMemoryAdapter({ now: () => 1 });
  const item = { content: content.text, kind: content.kind, confidence: content.confidence,
    textHash, embedding: null, receipts: [] };
  await harness.seedFact(owner, {
    ...factBase, kind: "text", actionId: "test-exact", mode: "exact",
    text: { digests: [{ alg: "sha256", value: item.textHash.slice(7), pipeline: "core",
      redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null }] },
  });

  const result = await uow.run(owner, { pauseLock: true }, async (tx) => {
    const claim = await capture.claim(tx, {
      scope, client, sessionId, eventId: "test-event", payloadDigest: "d".repeat(64),
    }, [], { leaseMs: 100 });
    assert.equal(claim.status, "claimed");
    return capture.finish(tx, claim.token, [item]);
  });
  assert.equal(result.suppressedCount, 1);
  assert.deepEqual(result.memories, []);

  await uow.run(owner, { readOnly: true }, async (tx) => {
    const policy = await memories.readWritePolicy(tx, scope, [{ textHash: item.textHash }], source, "full");
    assert.deepEqual(policy.blockedPositions, [0]);
    assert.deepEqual(policy.matches, [[]]);
  });
});

const vectorFact = {
  ...factBase, kind: "text", actionId: "test-vector", mode: "full",
  text: { digests: [{ alg: "sha256", value: "b".repeat(64), pipeline: "core",
    redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null }], embedding: [1, 0] },
};

for (const [label, typedVector, plainVector] of [
  ["local", () => new Float32Array([1, 0]), () => [0, 1]],
  ["cross-realm", () => runInNewContext("new Float32Array([1, 0])"), () => runInNewContext("[0, 1]")],
]) {
  test(`${label} Float32Array privacy matching uses stored elements over the iterator`, async () => {
    const { capture, harness, memories, uow } = createMemoryAdapter({
      now: () => 1, capabilities: { vectorSuppression: true },
    });
    const embedding = Object.assign(typedVector(), {
      *[Symbol.iterator]() { yield 0; yield 1; }
    });
    await harness.seedFact(owner, vectorFact);

    const { policy, result } = await uow.run(owner, { pauseLock: true }, async (tx) => {
      const policy = await memories.readWritePolicy(tx, scope, [{ textHash, embedding }], source, "full");
      const claim = await capture.claim(tx, {
        scope, client, sessionId, eventId: "test-event", payloadDigest: "d".repeat(64),
      }, [], { leaseMs: 100 });
      assert.equal(claim.status, "claimed");
      const result = await capture.finish(tx, claim.token, [{
        content: content.text, kind: content.kind, confidence: content.confidence,
        textHash, embedding: { model: "test", vector: embedding }, receipts: [],
      }]);
      return { policy, result };
    });
    const { blockedPositions, matches } = await uow.run(owner, { readOnly: true }, (tx) =>
      memories.readWritePolicy(tx, scope, [{ textHash, embedding: [1, 0] }], source, "full"));
    assert.deepEqual({
      blockedPositions: policy.blockedPositions,
      decision: decideWrite(policy, 0),
      suppressedCount: result.suppressedCount,
      written: result.memories.length,
      matches,
    }, {
      blockedPositions: [0], decision: { status: "suppressed" }, suppressedCount: 1, written: 0, matches: [[]],
    });
    assert.deepEqual(blockedPositions, [0]);
  });

  test(`${label} accessor-backed embeddings are refused before state changes`, async () => {
    const { harness, memories, suppressions, uow } = createMemoryAdapter({
      capabilities: { vectorSuppression: true },
    });
    let reads = 0;
    const vector = plainVector();
    Object.defineProperty(vector, "0", { get() { reads++; return 0; } });
    await harness.seedFact(owner, vectorFact);
    const before = await harness.dump();

    await uow.run(owner, {}, async (tx) => {
      const invalid = { code: "invalid_input" };
      await assert.rejects(memories.readWritePolicy(tx, scope, [{ textHash, embedding: vector }], source, "full"), invalid);
      await assert.rejects(memories.insert(tx, scope, {
        ...content, embedding: { model: "test", vector },
      }, [], 1), invalid);
      await assert.rejects(memories.replaceContent(tx, scope, "missing", 1, {
        ...content, embedding: { model: "test", vector },
      }, null, 1), invalid);
      await assert.rejects(suppressions.snapshot(tx, scope, {
        passages: [{ digests: vectorFact.text.digests, shingles: null, keyId: null, embedding: vector }],
      }), invalid);
    });
    assert.equal(reads, 0);
    assert.deepEqual(await harness.dump(), before);
  });
}

test("typed-array overrides cannot change what rows store or what core compares", async () => {
  const { harness, memories, suppressions, uow } = createMemoryAdapter({
    capabilities: { vectorSuppression: true },
  });
  const vector = runInNewContext("new Float32Array([0, 1, 0]).subarray(1)");
  for (const key of ["buffer", "byteOffset", "length", Symbol.toStringTag, Symbol.iterator]) {
    Object.defineProperty(vector, key, { get() { throw new Error("unexpected instance property read"); } });
  }
  const near = { ...content, embedding: { model: "test", vector } };
  await harness.seedFact(owner, vectorFact);

  await uow.run(owner, {}, async (tx) => {
    const { id } = await memories.insert(tx, scope, near, [], 1);
    assert.deepEqual((await memories.get(tx, scope, id)).embedding.vector, [1, 0]);
    assert.equal((await suppressions.factsFor(tx, scope, { memoryId: id })).length, 1);
    const snapshot = await suppressions.snapshot(tx, scope, {
      passages: [{
        digests: [{ ...vectorFact.text.digests[0], value: textHash.slice(7) }],
        shingles: null, keyId: null, embedding: vector,
      }],
    });
    assert.equal(snapshot.passages.length, 1);

    const distant = { ...near, textHash: "sha256:" + "c".repeat(64),
      embedding: { model: "test", vector: [0, 1] } };
    await memories.replaceContent(tx, scope, id, 1, distant, null, 2);
    await memories.replaceContent(tx, scope, id, 2, near, null, 3);
    assert.deepEqual((await memories.get(tx, scope, id)).embedding.vector, [1, 0]);
  });
});

test("array proxies with throwing or conflicting embedding traps are refused", async () => {
  const { harness, memories, suppressions, uow } = createMemoryAdapter();
  const before = await harness.dump();
  const vectors = [
    new Proxy([1, 0], { getOwnPropertyDescriptor() { throw new Error("unavailable descriptor"); } }),
    new Proxy([1, 0], { get: (target, key) => key === "0" ? 0 : Reflect.get(target, key) }),
  ];

  await uow.run(owner, {}, async (tx) => {
    for (const vector of vectors) {
      await assert.rejects(memories.readWritePolicy(tx, scope, [{ textHash, embedding: vector }], source, "full"),
        { code: "invalid_input" });
      await assert.rejects(suppressions.writeFact(tx, {
        ...vectorFact, text: { ...vectorFact.text, embedding: vector },
      }, "test-incarnation"), { code: "invalid_input" });
    }
  });
  assert.deepEqual(await harness.dump(), before);
});

const distantEmbeddings = [
  ["array", [0, 1]],
  ["local Float32Array", new Float32Array([0, 1])],
  ["cross-realm Float32Array", runInNewContext("new Float32Array([0, 1])")],
];

for (const [label, embedding] of distantEmbeddings) {
  test(`distant ${label} is comparable in privacy matching`, async () => {
    const { uow, memories, suppressions, harness, fence } = createMemoryAdapter({
      capabilities: { vectorSuppression: true },
    });
    const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, {
      ...content, embedding: { model: "test", vector: embedding },
    }, [], 1));
    const digest = {
      alg: "sha256", value: textHash.slice(7), pipeline: "core",
      redactionVersion: PRIVACY_REDACTION_VERSIONS.core, keyId: null,
    };
    await harness.seedFact(owner, {
      ...factBase, kind: "text", actionId: "test-text", mode: "full",
      text: { digests: [{ ...digest, value: "b".repeat(64) }], embedding: [1, 0] },
    });

    await uow.run(owner, { readOnly: true }, async (tx) => {
      const ref = { type: "memory", id, namespace: null };
      assert.deepEqual(await fence.assertVisible(tx, { owner, namespaces: [null] }, [ref]), [ref], "row visibility");
      assert.deepEqual(await suppressions.factsFor(tx, scope, { memoryId: id }), [], "factsFor");
      const policy = await memories.readWritePolicy(tx, scope, [{ textHash, embedding }], source, "full");
      const snapshot = await suppressions.snapshot(tx, scope, {
        passages: [{ digests: [digest], shingles: null, keyId: null, embedding }],
      });
      assert.deepEqual({
        blockedPositions: policy.blockedPositions,
        hiddenIds: policy.hiddenIds,
        passages: snapshot.passages.map(({ fact }) => fact.actionId),
      }, { blockedPositions: [], hiddenIds: [], passages: [] });
    });
  });
}

for (const [label, hashSessionKey] of [
  ["absent", undefined],
  ["unavailable", () => null],
  ["throwing", () => { throw new Error("test hasher unavailable"); }],
]) {
  test(`session hasher (${label}) denies only the fact's client`, async () => {
    const { uow, memories, suppressions, harness, fence } = createMemoryAdapter({ hashSessionKey });
    const [same, other] = await uow.run(owner, {}, async (tx) => [
      await memories.insert(tx, scope, content, [receipt], 1),
      await memories.insert(tx, scope, content, [{ ...receipt, client: "other-client" }], 1),
    ]);
    await harness.seedFact(owner, {
      ...factBase, kind: "session", actionId: "test-session-fact", session: { client, sessionKeyHash },
    });

    await uow.run(owner, { readOnly: true }, async (tx) => {
      const refs = [same, other].map(({ id }) => ({ type: "memory", id, namespace: null }));
      const visible = await fence.assertVisible(tx, { owner, namespaces: [null] }, refs);
      assert.deepEqual(visible.map(({ id }) => id), [other.id]);
      const query = [{ textHash }];
      const sameClient = await memories.readWritePolicy(tx, scope, query, source, "full");
      assert.deepEqual(sameClient.hiddenIds, [same.id]);
      assert.equal(sameClient.blockedSession, true);
      const otherClient = await memories.readWritePolicy(tx, scope, query, { ...source, client: "other-client" }, "full");
      assert.equal(otherClient.blockedSession, false);
      assert.equal((await suppressions.snapshot(tx, scope, { client, sessionId })).blockedSession, true);
      assert.equal((await suppressions.snapshot(tx, scope, { client: "other-client", sessionId })).blockedSession, false);
      const facts = await suppressions.factsFor(tx, scope, { memoryId: same.id });
      assert.deepEqual(facts.map(({ fact }) => fact.kind), ["session"]);
    });
  });
}

test("a legacy client-less receipt is ignored and a stored legacy digest is compared", async () => {
  const { uow, port, appendFact } = createUnitOfWork({});
  const { memories } = createMemoryStore(port, capabilities({}), () => "test-memory");
  const legacyHash = "sha256:" + "c".repeat(64);
  const { id } = await uow.run(owner, {}, async (tx) => {
    const result = await memories.insert(tx, scope, content, [receipt], 1);
    port(tx, scope, true, (state) => {
      const entry = state.rows.get(null).get(result.id);
      entry.receipts[0].client = null;
      entry.row.legacyHash = legacyHash;
    });
    return result;
  });
  await appendFact(owner, { ...factBase, kind: "session", actionId: "session", session: { client, sessionId } });

  const exportedIds = () => uow.run(owner, { readOnly: true }, async (tx) =>
    (await memories.exportPage(tx, scope, { cursor: null, limit: 10 })).items.map((row) => row.id));
  assert.deepEqual(await exportedIds(), [id]);

  await appendFact(owner, {
    ...factBase, kind: "text", actionId: "legacy", mode: "exact",
    text: { digests: [{ alg: "sha256", value: legacyHash.slice(7), pipeline: "engine-legacy", redactionVersion: 1, keyId: null }] },
  });
  assert.deepEqual(await exportedIds(), []);

  await uow.run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, {
    ...content, text: "corrected memory", textHash: "sha256:" + "d".repeat(64),
  }, null, 2));
  assert.deepEqual(await exportedIds(), [id]);
});

test("raw span facts have no memory matching effect", async () => {
  const { uow, memories, suppressions, harness, lexical, vector, recent } = createMemoryAdapter({
    capabilities: { rawSpans: true, semanticRetrieval: true },
    hashSessionKey: () => sessionKeyHash,
  });
  const embedding = { model: "test", vector: [1, 0] };
  const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, { ...content, embedding }, [receipt], 1));
  await harness.seedFact(owner, {
    ...factBase, kind: "rawSpan", actionId: "test-span", sessionKeyHash, messageKey: receipt.messageId,
    startUtf16: 0, endUtf16: 1, contentDigest: "c".repeat(64),
  });

  await uow.run(owner, { readOnly: true }, async (tx) => {
    const readSet = { owner, namespaces: [null] };
    assert.deepEqual((await lexical.lexical(tx, readSet, "memory", 10, {})).rows.map(({ ref }) => ref.id), [id]);
    assert.deepEqual((await vector.vector(tx, readSet, embedding.vector, embedding.model, 10)).rows.map(({ ref }) => ref.id), [id]);
    assert.deepEqual((await recent.recent(tx, readSet, { cursor: null, limit: 10 })).items.map((row) => row.id), [id]);
    assert.deepEqual(await suppressions.factsFor(tx, scope, { memoryId: id }), []);
  });
});
