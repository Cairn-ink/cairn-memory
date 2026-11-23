import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest, legacyExactMac, passageShingles, userFingerprintKey } from "../src/index.mjs";
import { buildDocumentCard, documentCardVisible } from "../src/routing/index.mjs";

const scope = { owner: "sample-owner", namespace: "sample-project" };
const labels = Object.freeze({
  keyIdDomain: "fake-card-key-id",
  shingleKeyPrefix: "fake-card-shingles:",
  legacyExactPrefix: "fake-card-exact:\0",
});
const key = await userFingerprintKey("fake card fingerprint secret", scope.owner, labels);
const otherKey = await userFingerprintKey("fake rotated fingerprint secret", scope.owner, labels);
const legacyFingerprint = { key, labels };
const card = {
  id: "authored-card", scope, origin: "manual", sourceMessage: null, sourceMemories: [],
  title: "Garden guide", body: "A schedule for watering herbs",
};
const read = { card, requestedScope: scope, memoryStates: new Map() };
const visible = { visible: true, reason: null };
const withheld = { visible: false, reason: "text_withheld" };
const uncertain = { visible: false, reason: "uncertain" };

const textFact = (text, mode = "exact") => ({
  ...scope, actionId: "forget", kind: "text", origin: "forget", mode, text,
});
const legacyDigest = async (text, signingKey = key) => ({
  alg: "hmac", pipeline: "hosted-v1", redactionVersion: 1, keyId: signingKey.id,
  value: await legacyExactMac(text, signingKey, labels),
});
const matchingFact = textFact({ digests: [await legacyDigest(card.body)] });
const unrelatedFact = textFact({ digests: [await legacyDigest("A record of concert tickets")] });
const rotatedFact = textFact({ digests: [await legacyDigest("A record of concert tickets", otherKey)] });

test("the supplied legacy key withholds a card with a matching body MAC", async () => {
  assert.deepEqual(await documentCardVisible({
    ...read, textFacts: [matchingFact], legacyFingerprint,
  }), withheld);
});

test("the supplied legacy key clears a card with an unrelated MAC-only fact", async () => {
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, origin: "import" }, textFacts: [unrelatedFact], legacyFingerprint,
  }), visible);
});

test("a legacy fact with any other key ID still withholds the card", async () => {
  const mixedKeys = textFact({ digests: [...unrelatedFact.text.digests, ...rotatedFact.text.digests] });
  for (const fact of [rotatedFact, mixedKeys]) {
    assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact], legacyFingerprint }), withheld);
  }
});

test("omitting legacy fingerprint evidence still withholds for all MAC-only legacy facts", async () => {
  for (const fact of [matchingFact, unrelatedFact, rotatedFact]) {
    assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), withheld);
  }
});

test("invalid legacy labels or keys make the decision uncertain", async () => {
  const verifyOnly = await crypto.subtle.importKey(
    "raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  for (const invalid of [
    null,
    { key, labels: { ...labels } },
    { key, labels: Object.freeze({ ...labels, [Symbol("extra")]: true }) },
    { key: null, labels },
    { key: { ...key, id: "" }, labels },
    { key: { ...key, signingKey: {} }, labels },
    { key: { ...key, signingKey: verifyOnly }, labels },
  ]) {
    assert.deepEqual(await documentCardVisible({ ...read, textFacts: [], legacyFingerprint: invalid }), uncertain);
    assert.deepEqual(await documentCardVisible({
      ...read, textFacts: [rotatedFact], legacyFingerprint: invalid,
    }), uncertain);
  }
});

test("the supplied legacy key withholds a card with a matching title MAC", async () => {
  const titleFact = textFact({ digests: [await legacyDigest(card.title.toUpperCase())] });
  assert.deepEqual(await documentCardVisible({
    ...read, textFacts: [titleFact], legacyFingerprint,
  }), withheld);
});

test("legacy shingles use the shared containment threshold for each field", async () => {
  const reference = "abcdefgh";
  const fact = textFact({
    digests: [await legacyDigest(reference)], shingles: await passageShingles(reference, key, labels), keyId: key.id,
  }, "full");
  const input = { ...read, textFacts: [fact], legacyFingerprint };
  assert.deepEqual(await documentCardVisible({ ...input, card: { ...card, body: "abcdef unrelated" } }), withheld);
  assert.deepEqual(await documentCardVisible({ ...input, card: { ...card, body: "abcde unrelated" } }), visible);
  assert.deepEqual(await documentCardVisible({ ...input, card: { ...card, title: "abcde", body: "defgh" } }), visible);
});

test("legacy evidence checks the original and redacted forms of a passage", async () => {
  const body = 'Stored credential {"access_token":"fake-demo-value"}';
  const readWithSecret = { ...read, card: { ...card, body }, legacyFingerprint };
  const redacted = 'Stored credential {"access_token":"[REDACTED]"}';
  for (const wording of [body, redacted]) {
    const fact = textFact({ digests: [await legacyDigest(wording)] });
    assert.deepEqual(await documentCardVisible({ ...readWithSecret, textFacts: [fact] }), withheld);
  }
  assert.deepEqual(await documentCardVisible({ ...readWithSecret, textFacts: [unrelatedFact] }), visible);
});

test("legacy evidence and core evidence each apply to their own facts", async () => {
  const coreKey = await userFingerprintKey("fake core fingerprint secret", scope.owner, labels);
  const text = "abcdefgh";
  const coreFullFact = async (reference) => textFact({
    digests: [await coreDigest(reference, coreKey)],
    shingles: await passageShingles(reference, coreKey, labels),
    keyId: coreKey.id,
  }, "full");
  const input = { ...read, card: { ...card, body: text }, fingerprintKey: coreKey, legacyFingerprint };
  assert.deepEqual(await documentCardVisible({
    ...input, textFacts: [unrelatedFact, await coreFullFact("jklmnopq")],
  }), visible);
  assert.deepEqual(await documentCardVisible({
    ...input, textFacts: [unrelatedFact, await coreFullFact("abcdef")],
  }), withheld);
});

test("router card visibility uses the source verdict with or without legacy evidence", async () => {
  const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
  const canonicalSessionKey = "session-key";
  const { card: built } = await buildDocumentCard(
    { id: sourceMessage.messageId, role: "user", content: card.body },
    { scope, client: sourceMessage.client, canonicalSessionKey },
  );
  assert.ok(built);
  const routed = {
    ...read, card: { ...card, id: built.id, origin: "router", sourceMessage, canonicalSessionKey },
    textFacts: [matchingFact],
  };
  for (const evidence of [{}, { legacyFingerprint }, { legacyFingerprint: null }]) {
    assert.deepEqual(await documentCardVisible({ ...routed, ...evidence, sourceWithheld: false }), visible);
    assert.deepEqual(await documentCardVisible({ ...routed, ...evidence, sourceWithheld: true }),
      { visible: false, reason: "source_withheld" });
  }
});

for (const field of ["body", "title"]) {
  test(`legacy exact MACs use the cleaned ${field}`, async () => {
    const reference = 'Stored credential {"access_token":"fake-demo-value"}';
    const withNul = reference.replace("access_token", "access_\0token");
    const fact = textFact({ digests: [await legacyDigest(reference)] });
    assert.deepEqual(await documentCardVisible({
      ...read, card: { ...card, [field]: withNul }, textFacts: [fact], legacyFingerprint,
    }), withheld);
  });
}

test("legacy redaction runs after the stored passage is cleaned", async () => {
  const body = 'Stored credential {"access_\0token":"fake-demo-value"}';
  const reference = 'Stored credential {"access_token":"[REDACTED]"}';
  const fact = textFact({ digests: [await legacyDigest(reference)] });
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, body }, textFacts: [fact], legacyFingerprint,
  }), withheld);
});

test("legacy shingles use the cleaned passage when exact MACs miss", async () => {
  const reference = "abcdef";
  const fact = textFact({
    digests: [await legacyDigest(reference)], shingles: await passageShingles(reference, key, labels), keyId: key.id,
  }, "full");
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, body: "abc\0def extra" }, textFacts: [fact], legacyFingerprint,
  }), withheld);
});

for (const mode of ["exact", "full"]) {
  test(`a legacy MAC miss preserves a matching core alias in ${mode} mode`, async () => {
    const reference = "password: fake-alpha-123456789";
    const body = "password: fake-omega-987654321";
    const hosted = await legacyDigest(reference);
    const core = await coreDigest(reference, key);
    const fullEvidence = mode === "full" ? {
      shingles: await passageShingles(reference, key, labels), keyId: key.id,
    } : {};
    const withDigests = (...digests) => [textFact({ digests, ...fullEvidence }, mode)];
    const input = { ...read, card: { ...card, body }, fingerprintKey: key };

    assert.deepEqual(await documentCardVisible({
      ...input, legacyFingerprint, textFacts: withDigests(hosted),
    }), visible);
    assert.deepEqual(await documentCardVisible({
      ...input, legacyFingerprint, textFacts: withDigests(core),
    }), withheld);
    assert.deepEqual(await documentCardVisible({ ...input, textFacts: withDigests(hosted, core) }), withheld);
    assert.deepEqual(await documentCardVisible({
      ...input, legacyFingerprint, textFacts: withDigests(hosted, core),
    }), withheld);
  });
}

test("a core SHA alias miss preserves a matching legacy MAC", async () => {
  const core = await coreDigest("An unrelated core passage");
  const fact = textFact({ digests: [...matchingFact.text.digests, core] });
  assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), visible);
  assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact], legacyFingerprint }), withheld);
});

for (const [scenario, facts] of [["no facts", []], ["a rotated fact", [rotatedFact]]]) {
  test(`an unusable legacy signing key is uncertain with ${scenario}`, async () => {
    const signingKey = Object.create(CryptoKey.prototype, {
      type: { value: "secret" },
      usages: { value: ["sign"] },
      algorithm: { value: { name: "HMAC", hash: { name: "SHA-256" }, length: 256 } },
    });
    assert.ok(signingKey instanceof CryptoKey);
    await assert.rejects(crypto.subtle.sign("HMAC", signingKey, new Uint8Array(0)));
    assert.deepEqual(await documentCardVisible({
      ...read, textFacts: facts, legacyFingerprint: { key: { ...key, signingKey }, labels },
    }), uncertain);
  });
}
