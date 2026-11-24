import assert from "node:assert/strict";
import test from "node:test";
import { allDigests, coreFingerprintLabels, factBlocksIncoming, passageShingles, userFingerprintKey,
  withholdsAnyPassage } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { CAPTURE_CONTAINMENT_CASES, runCase } from "@cairn-ink/conformance";
import { SQLITE_ERROR_MAP } from "../src/index.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { seedFact, sha256 } from "./storage-fixtures.mjs";

for (const kitCase of CAPTURE_CONTAINMENT_CASES) {
  test(`${kitCase.id} ${kitCase.title}`, async t => {
    const reason = await runCase({
      name: "sqlite capture containment",
      async open() {
        const { adapter, close } = await captureFixture();
        return { adapter, close, embeddingDimensions: null, sessionRefs: "hashed",
          nativeErrorMap: SQLITE_ERROR_MAP, busyNativeCodes: ["SQLITE_BUSY", "SQLITE_LOCKED"],
          harness: { seedFact: (owner, fact) => {
            assert.equal(owner, fact.owner);
            return seedFact(adapter, fact);
          } } };
      },
    }, kitCase);
    if (reason !== null) t.skip(reason);
  });
}

const scope = { owner: "owner", namespace: null };
const forgotten = "The orchard has a cedar gate and a path lined with rosemary";
const longer = `At the trailhead, ${forgotten} next to the creek.`;
const unrelated = "Copper conducts electricity.";
const fullFact = (actionId, text) => ({ ...scope, actionId, kind: "text", mode: "full", origin: "forget", text });

async function fingerprint(text, key) {
  return { digests: await allDigests(text, key), shingles: key ? await passageShingles(text, key, coreFingerprintLabels) : null,
    keyId: key?.id ?? null };
}

test("capture snapshots retain containment and uncertain evidence from retained keyed facts", async t => {
  const { adapter, close } = await captureFixture();
  t.after(close);
  assert.equal(await adapter.keys.userKey(scope.owner), null);
  const key = await userFingerprintKey("orchard test seed", scope.owner, coreFingerprintLabels);
  const otherKey = await userFingerprintKey("another orchard test seed", scope.owner, coreFingerprintLabels);
  const text = await fingerprint(forgotten, key);
  const fact = fullFact("forgotten-orchard", text);
  await seedFact(adapter, fact);

  const contained = await fingerprint(longer, key);
  const differentKey = await fingerprint(longer, otherKey);
  const retained = { ...differentKey, retainedShingles: [{ keyId: key.id, shingles: contained.shingles }] };
  const noKey = await fingerprint(longer, null);
  const control = await fingerprint(unrelated, key);
  const snapshot = (scope, passages) => adapter.uow.run(scope.owner, { readOnly: true },
    tx => adapter.suppressions.snapshot(tx, scope, { passages }));
  for (const passage of [contained, differentKey, retained, noKey, { ...contained, shingles: ["invalid"] }]) {
    const { passages } = await snapshot(scope, [passage]);
    assert.deepEqual(passages.map(({ fact }) => fact.text.shingles), [text.shingles]);
    assert.equal(withholdsAnyPassage([passage], passages.map(({ fact }) => fact)), true);
  }
  assert.equal(withholdsAnyPassage([control], (await snapshot(scope, [control])).passages.map(({ fact }) => fact)), false);
  assert.deepEqual((await snapshot({ ...scope, namespace: "other" }, [contained])).passages, []);

  const legacy = fullFact("retained-digest", { keyId: key.id, shingles: text.shingles, digests: [{
    alg: "legacy-mac", value: sha256("orchard"), pipeline: "hosted-v1", redactionVersion: 1, label: "legacy", keyId: key.id,
  }] });
  await seedFact(adapter, legacy);
  const comparable = { ...control, digests: [{ ...legacy.text.digests[0], value: sha256(unrelated) }] };
  assert.equal(factBlocksIncoming({ fact: legacy }, { scope, passages: [comparable] }, { mode: "capture" }), false);
  for (const passage of [noKey, comparable]) {
    const facts = (await snapshot(scope, [passage])).passages.map(({ fact }) => fact);
    assert.deepEqual(facts.find(({ actionId }) => actionId === legacy.actionId), legacy);
  }
});

test("keyless capture rechecks a forget committed during embedding", async t => {
  const { adapter, close } = await captureFixture();
  t.after(close);
  const fingerprintOfForgotten = await fingerprint(forgotten, null);
  let embedded = 0;
  const service = createMemoryService({
    storage: adapter,
    model: { model: "test", contextWindow: 16_384, countTokens: () => 1,
      async call(stage) {
        assert.equal(stage, "extract");
        return { items: [forgotten, longer].map(content => ({ content, kind: "fact", confidence: 0.9, sourceIndices: [0] })) };
      } },
    embedder: { model: "test", dimensions: 2, async embed(inputs) {
      embedded += inputs.length;
      await seedFact(adapter, { ...fullFact("forgotten-while-embedding", fingerprintOfForgotten), mode: "exact" });
      return inputs.map(() => new Float32Array([1, 0]));
    } },
    gate: { async assertOpen() {} },
    clock: { nowMs: () => 1_000, monotonicMs: () => 1_000,
      async sha256Hex(text) { return sha256(text); }, hmacHex: () => assert.fail("Keyless capture requested an HMAC") },
    tokens: { countTokens: () => 1 },
    config: {},
  });
  const selection = { client: "client", sessionId: "session", eventId: "event" };
  const messages = [{ id: "message", role: "user", content: unrelated, occurredAtMs: 20 }];
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const completed = await service.runCapture(scope, selection);
  assert.equal(completed.status, "done", completed.code);
  assert.equal(embedded, 2);
  assert.equal(completed.result.memories.length, 1);
  const { items } = await adapter.uow.run(scope.owner, { readOnly: true },
    tx => adapter.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  assert.deepEqual(items.map(row => row.text), [longer]);
});
