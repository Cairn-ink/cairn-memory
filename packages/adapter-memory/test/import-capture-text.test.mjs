import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter, TEST_FINGERPRINT_LABELS } from "@cairn-ink/adapter-memory";
import { coreDigest, legacyExactMac, passageShingles, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { coreFingerprintLabels } from "../../core/src/privacy/fingerprint.mjs";

const scope = { owner: "owner", namespace: null };
const session = { client: "client", sessionId: "session" };
const eventId = "event";
const target = "The orchard has a cedar gate and a path lined with rosemary";
const unrelated = { id: "unrelated", role: "assistant", content: "Copper conducts electricity.", occurredAtMs: 20 };
const canonical = () => coreDigest(target);
const legacy = async (key) => ({
  alg: "hmac",
  pipeline: "engine-legacy",
  redactionVersion: PRIVACY_REDACTION_VERSIONS.v1,
  keyId: key.id,
  value: await legacyExactMac(target, key, TEST_FINGERPRINT_LABELS),
});

function captureService(storage) {
  const unused = () => assert.fail("Admission does not call model, embedding, or token providers");
  return createMemoryService({
    storage,
    model: { model: "test", contextWindow: 1, call: unused, countTokens: unused },
    embedder: { model: "test", dimensions: 1, embed: unused },
    gate: { assertOpen: unused },
    clock: {
      nowMs: unused,
      monotonicMs: unused,
      sha256Hex: async (text) => createHash("sha256").update(text).digest("hex"),
      hmacHex: unused,
    },
    tokens: { countTokens: unused },
    config: {},
  });
}

const cases = [
  { name: "canonical SHA-256", digests: async () => [await canonical()], withheld: ["matching"] },
  {
    name: "core-domain HMAC",
    digests: async (key) => [{ ...await coreDigest(target, key), value: await legacyExactMac(target, key, coreFingerprintLabels) }],
    withheld: ["matching"],
  },
  {
    name: "adapter-domain HMAC only",
    digests: async (key) => [await legacy(key)],
    withheld: ["matching", "unrelated"],
  },
  {
    name: "adapter-domain HMAC with a nonmatching SHA-256 alias",
    digests: async (key) => [await legacy(key), await coreDigest("A different passage.")],
    withheld: [],
  },
  {
    name: "containment",
    digests: async (key) => [await coreDigest(target, key)],
    shingles: (key) => passageShingles(target, key, coreFingerprintLabels),
    matchingContent: `At the trailhead, ${target} next to the creek.`,
    withheld: ["matching"],
  },
  {
    name: "core-domain HMAC under a retained key",
    digests: async (key) => [await coreDigest(target, key)],
    rotate: true,
    withheld: ["matching", "unrelated"],
  },
];

for (const { name, digests, shingles, matchingContent = target, rotate, withheld } of cases) {
  test(`Raw import and capture admission withhold the same messages for ${name}`, async () => {
    const storage = createMemoryAdapter({
      capabilities: { rawArchive: true, fingerprintKey: true, shingleSuppression: true },
    });
    const { capture, harness, keys, raw, uow } = storage;
    const key = await keys.userKey(scope.owner);
    await harness.seedFact(scope.owner, {
      ...scope, kind: "text", origin: "forget", actionId: "forget", mode: shingles ? "full" : "exact",
      text: { digests: await digests(key), keyId: key.id, ...(shingles && { shingles: await shingles(key) }) },
    });
    if (rotate) {
      await harness.setFingerprintSecret("rotated-test-secret");
      assert.notEqual((await keys.userKey(scope.owner)).id, key.id);
    }
    const messages = [{ id: "matching", role: "user", content: matchingContent, occurredAtMs: 10 }, unrelated];

    assert.deepEqual(await captureService(storage).enqueueCapture(scope, { ...session, eventId, messages }),
      { status: "accepted" });
    const outbox = await uow.run(scope.owner, { readOnly: true },
      (tx) => capture.load(tx, { scope, ...session, eventId }));
    assert.deepEqual(outbox.messages.map(({ id }) => id), messages.map(({ id }) => id));
    const captureWithheld = outbox.messages.filter(({ content }) => content === "").map(({ id }) => id);
    assert.deepEqual(captureWithheld, withheld, "capture admission must match the fixture verdict");

    const counts = await uow.run(scope.owner, { pauseLock: true }, (tx) => raw.importArchive(tx, scope, session, messages));
    const [{ rawRows }] = await harness.dump();
    const storedIds = new Set(rawRows.map(({ messageId }) => messageId));
    const importWithheld = messages.filter(({ id }) => !storedIds.has(id)).map(({ id }) => id);
    assert.deepEqual(importWithheld, captureWithheld, "committed import must match capture admission");
    assert.deepEqual(counts, { archived: messages.length - withheld.length, existing: 0, withheld: withheld.length });
  });
}
