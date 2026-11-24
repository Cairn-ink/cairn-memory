import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_CONTAINMENT_CASES, runCase } from "@cairn-ink/conformance";
import { createMemoryService } from "@cairn-ink/core/service";
import { fingerprintMemoryPassages } from "../../core/src/privacy/fingerprint.mjs";

const forgotten = "The stone bridge has a brass plaque beside the eastern railing";
const output = `The hiking route crosses the river. ${forgotten} near the bend.`;
const source = "Copper conducts electricity.";

async function assertCaptureOutcome(storage, forgetDuringEmbedding) {
  const scope = { owner: "test-owner", namespace: null };
  const key = await storage.keys.userKey(scope.owner);
  assert.ok(key);
  const [text] = await fingerprintMemoryPassages(forgotten, forgotten, key);
  let embeddedInputs = [];
  let factCommitted = false;
  const service = createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: [{ kind: "fact", content: output, confidence: 0.9, sourceIndices: [0] }] };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(inputs) {
        embeddedInputs = inputs;
        if (forgetDuringEmbedding) {
          await storage.harness.seedFact(scope.owner, {
            owner: scope.owner, actionId: "test-forget", kind: "text", mode: "full", origin: "forget", text,
          });
          factCommitted = true;
        }
        return inputs.map(() => Float32Array.of(1));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 100,
      async sha256Hex(text) { return createHash("sha256").update(text).digest("hex"); },
      hmacHex: () => assert.fail("Capture uses the owner fingerprint key"),
    },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  const selection = { client: "test-client", sessionId: "test-session", eventId: "test-event" };
  const messages = [{ id: "test-message", role: "user", content: source, occurredAtMs: 10 }];
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done");
  assert.equal(embeddedInputs.length, 1, "The output must reach the embedder");
  assert.ok(embeddedInputs[0].toLowerCase().includes(forgotten.toLowerCase()));
  assert.equal(factCommitted, forgetDuringEmbedding);

  const storedContents = (await storage.harness.dump()).flatMap(({ rows }) => rows.map(({ row }) => row.text));
  assert.deepEqual(storedContents, forgetDuringEmbedding ? [] : [output],
    forgetDuringEmbedding ? "Capture finish persisted a forgotten passage" : "Capture finish must persist the control output");
  assert.equal(completed.result.memories.length, forgetDuringEmbedding ? 0 : 1);
}

function keyedAdapter() {
  return createMemoryAdapter({ capabilities: { fingerprintKey: true, shingleSuppression: true } });
}

test("capture finish withholds a passage forgotten during embedding", async () => {
  await assertCaptureOutcome(keyedAdapter(), true);
});

test("capture finish persists the containing output when no forget fact lands", async () => {
  await assertCaptureOutcome(keyedAdapter(), false);
});

function cacheFirstSnapshot(storage, keyFor) {
  const { snapshot } = storage.suppressions;
  const cached = new Map();
  storage.suppressions.snapshot = (tx, scope, candidates) => {
    const key = keyFor(tx);
    if (!cached.has(key)) cached.set(key, snapshot(tx, scope, candidates));
    return cached.get(key);
  };
  return storage;
}

function runFreshnessCase(keyFor) {
  const testCase = CAPTURE_CONTAINMENT_CASES.find(({ id }) => id === "K-SNAP-C4");
  assert.ok(testCase);
  return runCase({
    name: "memory snapshot cache",
    async open({ capabilities }) {
      const adapter = cacheFirstSnapshot(createMemoryAdapter({ capabilities }), keyFor);
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  }, testCase);
}

test("a snapshot cache keyed only by owner fails the conformance case and capture pin", async () => {
  const ownerOf = (tx) => tx.owner;
  await assert.rejects(runFreshnessCase(ownerOf), /A new run must return the committed full fact/);
  await assert.rejects(assertCaptureOutcome(cacheFirstSnapshot(keyedAdapter(), ownerOf), true),
    /Capture finish persisted a forgotten passage/);
});

test("a snapshot cache keyed only by transaction fails the same-run conformance check", async () => {
  await assert.rejects(runFreshnessCase((tx) => tx), /A second snapshot in the same run must return the full fact/);
});
