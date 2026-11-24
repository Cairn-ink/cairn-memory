import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_CONTAINMENT_CASES, PRIVACY_MATCH_CASES, runCase } from "@cairn-ink/conformance";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { fingerprintMemoryPassages } from "../../core/src/privacy/fingerprint.mjs";

function memoryFactory(createAdapter) {
  return {
    name: "memory capture containment",
    async open({ capabilities }) {
      const adapter = createAdapter({ capabilities });
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

const [keyed, noKey, mismatch] = CAPTURE_CONTAINMENT_CASES;
const scoped = PRIVACY_MATCH_CASES.find(({ id }) => id === "K-SNAP-F1");

for (const testCase of CAPTURE_CONTAINMENT_CASES) {
  test(`${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(memoryFactory(createMemoryAdapter), testCase), null);
  });
}

const forgotten = "The orchard has a cedar gate and a path lined with rosemary";
const containing = `At the trailhead, ${forgotten} next to the creek.`;
const unrelated = "Copper conducts electricity.";

async function assertCaptureWithholds(createAdapter) {
  const storage = createAdapter({ capabilities: { fingerprintKey: true, shingleSuppression: true } });
  const scope = { owner: "test-owner", namespace: null };
  const key = await storage.keys.userKey(scope.owner);
  assert.ok(key);
  const [text] = await fingerprintMemoryPassages(forgotten, forgotten, key);
  await storage.harness.seedFact(scope.owner, {
    owner: scope.owner, actionId: "test-forget", kind: "text", mode: "full", origin: "forget", text,
  });

  let extracted = false;
  const service = createMemoryService({
    storage,
    model: {
      model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        extracted = true;
        return { items: [{ kind: "fact", content: containing, confidence: 0.9, sourceIndices: [0] }] };
      },
    },
    embedder: {
      model: "test", dimensions: 1,
      async embed(inputs) {
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
  const messages = [{ id: "test-message", role: "user", content: unrelated, occurredAtMs: 10 }];
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done");
  assert.equal(extracted, true, "Capture must process the admitted source");
  assert.deepEqual(completed.result.memories, [], "Core capture finish inserted the containing output");
}

test("core capture admission and finish withhold a containing model output", async () => {
  await assertCaptureWithholds(createMemoryAdapter);
});

test("snapshot keeps partial or malformed evidence outside the no-key exception", async () => {
  const { harness, uow, suppressions } = createMemoryAdapter({ capabilities: { vectorSuppression: true } });
  const scope = { owner: "test-owner", namespace: null };
  const text = { digests: [await coreDigest(forgotten)], embedding: [1, 0] };
  await harness.seedFact(scope.owner, { ...scope, kind: "text", mode: "full", origin: "forget", actionId: "test-forget", text });
  const candidate = { digests: [await coreDigest(containing)], shingles: null, keyId: null };

  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    for (const [label, passage] of [
      ["shingles without a key", { ...candidate, shingles: ["ab"] }],
      ["key without shingles", { ...candidate, keyId: "test-key" }],
      ["malformed digest", { ...candidate, digests: [] }],
      ["incomparable vector", { ...candidate, embedding: [1] }],
      ["shingle accessor", { ...candidate, get shingles() { assert.fail("The accessor must remain unread"); } }],
    ]) {
      const result = await suppressions.snapshot(tx, scope, { passages: [passage] });
      assert.deepEqual(result.passages.map(({ fact }) => fact.actionId), ["test-forget"], label);
    }
  });
});

test("snapshot keeps a legacy MAC fact on a comparable core digest miss", async () => {
  const { keys, harness, uow, suppressions } = createMemoryAdapter({ capabilities: { fingerprintKey: true } });
  const scope = { owner: "test-owner", namespace: null };
  const key = await keys.userKey(scope.owner);
  assert.ok(key);
  const digest = await coreDigest(forgotten, key);
  await harness.seedFact(scope.owner, {
    ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "test-forget",
    text: { digests: [digest, { ...digest, pipeline: "engine-legacy", value: "a".repeat(64) }] },
  });
  const passages = await fingerprintMemoryPassages(unrelated, unrelated, key);
  const result = await uow.run(scope.owner, { readOnly: true }, (tx) => suppressions.snapshot(tx, scope, { passages }));
  assert.deepEqual(result.passages.map(({ fact }) => fact.actionId), ["test-forget"]);
});

async function mutantAdapter(name, before, after) {
  const entry = new URL("../src/index.mjs", import.meta.url);
  const matcher = new URL("./fact-match.mjs", entry);
  let source = readFileSync(matcher, "utf8");
  assert.equal(source.split(before).length, 2, `Expected one mutation site for ${name}`);
  source = source.replace(before, () => after);
  entry.searchParams.set("variant", name);
  matcher.searchParams.set("variant", name);
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === entry.href && request === "./fact-match.mjs") return nextResolve(matcher.href, context);
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (url === matcher.href) return { format: "module", source, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    return (await import(entry.href)).createMemoryAdapter;
  } finally {
    hooks.deregister();
  }
}

const incoming = "const incoming = { scope, passages };";

test("the old exact-only snapshot fails the keyed case and the core capture pin", async () => {
  const createAdapter = await mutantAdapter("exact-only snapshot", incoming, `${incoming}
    return stored.filter((fact) => factBlocksIncoming(fact, incoming, capture) !== false);`);
  await assert.rejects(runCase(memoryFactory(createAdapter), keyed), /Snapshot must retain the full fact/);
  await assert.rejects(assertCaptureWithholds(createAdapter), /Core capture finish inserted the containing output/);
});

test("an unfiltered snapshot fails the no-key case and K-SNAP-F1", async () => {
  const createAdapter = await mutantAdapter("unfiltered snapshot", incoming, `${incoming}
    return stored;`);
  const factory = memoryFactory(createAdapter);
  await assert.rejects(runCase(factory, noKey), /Core must admit the SHA-miss containing output without a key/);
  await assert.rejects(runCase(factory, scoped), /Snapshot must return only matching scoped passages/);
});

test("dropping ineligible shingle key mismatches fails the mismatch case", async () => {
  const match = "const result = factBlocksIncoming(fact, incoming, rules);";
  const createAdapter = await mutantAdapter("drop key mismatches", match, `${match}
    if (result === "ineligible" && passages.some((candidate) =>
      candidate.keyId && fact.fact.text.keyId && candidate.keyId !== fact.fact.text.keyId)) return false;`);
  await assert.rejects(runCase(memoryFactory(createAdapter), mismatch), /Snapshot must retain an ineligible full fact/);
});
