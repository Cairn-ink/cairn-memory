import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

function hashSessionKey(client, sessionId) {
  return createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");
}

export function embeddingRequiredFactory({ vectors = true, embeddingDimensions = 16, wrap = (adapter) => adapter,
  enforce = true, sessionRefs = "plain" } = {}) {
  return {
    name: `memory with required embeddings, vectors ${vectors ? "on" : "off"}`,
    async open({ capabilities: requested }) {
      // The reference adapter has no span lineage port, so this fixture does not forward that request.
      // The flag then stays off and the kit reports its standard needs skip.
      const { spanLineage: _unsupported, ...capabilities } = requested;
      const memory = createMemoryAdapter({
        capabilities: {
          ...capabilities,
          embeddingRequiredOnInsert: enforce,
          nearDuplicate: vectors,
          vectorSuppression: vectors,
          semanticRetrieval: vectors,
        },
        sessionRefs,
        hashSessionKey,
        now: () => 0,
      });
      const adapter = wrap(enforce ? memory : {
        ...memory,
        capabilities: { ...memory.capabilities, embeddingRequiredOnInsert: true },
      });
      return {
        adapter, sessionRefs, embeddingDimensions,
        harness: { ...adapter.harness, hashSessionKey },
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        async close() {},
      };
    },
  };
}

const embedded = {
  kind: "fact",
  origin: "explicit",
  text: "Embedded fixture",
  textHash: `sha256:${"a".repeat(64)}`,
  confidence: 0.4,
  source: { kind: "mcp", client: null, sessionId: null },
  embedding: { model: "test", vector: [1, 0, ...Array(14).fill(0)] },
};
const unembedded = { ...embedded, text: "Unembedded fixture", textHash: `sha256:${"b".repeat(64)}`, embedding: null };
const invalidInput = { code: "invalid_input" };

function scope() {
  return { owner: crypto.randomUUID(), namespace: null };
}

export const guardChecks = {
  async insert({ uow, memories }) {
    const target = scope();
    await uow.run(target.owner, {}, async (tx) => {
      await assert.rejects(memories.insert(tx, target, unembedded, [], 1), invalidInput,
        "Insert must reject a null embedding");
      await memories.insert(tx, target, embedded, [], 1);
    });
  },

  async replaceContent({ uow, memories }) {
    const target = scope();
    await uow.run(target.owner, {}, async (tx) => {
      const { id, revision } = await memories.insert(tx, target, embedded, [], 1);
      await assert.rejects(memories.replaceContent(tx, target, id, revision, unembedded, null, 2), invalidInput,
        "Content replacement must reject a null embedding");
      await assert.rejects(memories.replaceContent(tx, target, id, revision + 1, unembedded, null, 2), invalidInput,
        "Null validation must precede the revision check");
      const valid = { ...unembedded, embedding: embedded.embedding };
      const result = await memories.replaceContent(tx, target, id, revision, valid, null, 2);
      assert.equal(result.outcome, "changed");
    });
  },

  async finish({ uow, capture }) {
    const target = scope();
    const key = { scope: target, client: "capture-client", sessionId: "capture-session", eventId: "event",
      payloadDigest: "c".repeat(64) };
    const item = {
      kind: embedded.kind, content: embedded.text, textHash: embedded.textHash, confidence: embedded.confidence,
      embedding: { model: embedded.embedding.model, vector: new Float32Array(embedded.embedding.vector) }, receipts: [],
    };
    const nullItem = { ...item, content: unembedded.text, textHash: unembedded.textHash, embedding: null };
    const claim = await uow.run(target.owner, { pauseLock: true },
      (tx) => capture.claim(tx, key, [{ id: "message", role: "user", content: "Capture fixture", occurredAtMs: null }],
        { leaseMs: 60_000 }));
    assert.equal(claim.status, "claimed");
    await uow.run(target.owner, { pauseLock: true }, async (tx) => {
      await assert.rejects(capture.finish(tx, claim.token, [item, nullItem]), invalidInput,
        "Finish must reject a batch containing a null embedding");
      await assert.rejects(capture.finish(tx, "unknown-token", [nullItem]), invalidInput,
        "Null validation must precede the token lookup");
      const result = await capture.finish(tx, claim.token, [item]);
      assert.deepEqual(result.memories.map(({ outcome }) => outcome), ["inserted"]);
    });
  },
};
