import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { capabilities } from "@cairn-ink/core";
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
