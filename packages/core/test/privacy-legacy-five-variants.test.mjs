import assert from "node:assert/strict";
import { test } from "node:test";
import { HOSTED_FINGERPRINT_LABELS as labels } from "../../adapter-postgres/src/fingerprint-labels.mjs";
import { legacyExactMac, passageShingles, userFingerprintKey } from "../src/privacy/fingerprint.mjs";
import { redactHostedCurrent, redactV1 } from "../src/privacy/redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText } from "../src/privacy/text.mjs";
import { documentCardSourceWithheld, documentCardVisible } from "../src/routing/visibility.mjs";

const scope = { owner: "sample-owner", namespace: null };
const key = await userFingerprintKey("synthetic fingerprint secret", scope.owner, labels);
const legacyFingerprint = { key, labels };
const card = {
  id: "authored-card", scope, origin: "import", sourceMessage: null, sourceMemories: [],
  title: "Garden guide", body: "A schedule for watering herbs",
};
const read = { card, requestedScope: scope, memoryStates: new Map(), legacyFingerprint };
const visible = { visible: true, reason: null };
const withheld = { visible: false, reason: "text_withheld" };

const textFact = (text, mode = "exact") => ({
  ...scope, actionId: "forget", kind: "text", origin: "forget", mode, text,
});
const legacyDigest = async (text, domain = labels) => ({
  alg: "hmac", pipeline: "hosted-v1", redactionVersion: 1, keyId: key.id,
  value: await legacyExactMac(text, key, domain),
});

const raw = 'Note {"access_token":"demo-value"} crn_pat_0123456789abcdef0123456789ab\0cdef ｐａｓｓｗｏｒｄ： demo-example';
const cleaned = cleanContent(raw);
const variants = [
  ["cleaned original", cleaned],
  ["V1", redactV1(cleaned)],
  ["hostedCurrent", redactHostedCurrent(cleaned)],
  ["core-prepared", prepareCoreText(raw)],
  ["NFKC then V1", redactV1(cleaned.normalize("NFKC"))],
];
assert.equal(new Set(variants.map(([, text]) => normalizeForHash(text))).size, 5);

for (const [name, text] of variants) {
  for (const field of ["title", "body"]) {
    test(`a sole hosted MAC of the ${name} ${field} hides the card`, async () => {
      const fact = textFact({ digests: [await legacyDigest(text)] });
      assert.deepEqual(await documentCardVisible({
        ...read, card: { ...card, [field]: raw }, textFacts: [fact],
      }), withheld);
    });
  }
}

test("an unrelated hosted MAC leaves the card visible", async () => {
  const fact = textFact({ digests: [await legacyDigest("A record of concert tickets")] });
  assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), visible);
});

test("a MAC over matching text under different labels leaves the card visible", async () => {
  // Keep the key ID so this exercises MAC domain separation without triggering key rotation.
  const wrongLabels = Object.freeze({ ...labels, legacyExactPrefix: "other-exact\0" });
  const fact = textFact({ digests: [await legacyDigest(card.body, wrongLabels)] });
  assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), visible);
});

const reference = "abcdefghijklmnopqrstuvwxyz0123";
const candidate = "abcdefghijklm extra material";
const fullFact = textFact({
  digests: [await legacyDigest(reference)], shingles: await passageShingles(reference, key, labels), keyId: key.id,
}, "full");
const candidateShingles = await passageShingles(candidate, key, labels);

test("a legacy full fact uses the caller's containment threshold", async () => {
  const candidateSet = new Set(candidateShingles);
  const shared = fullFact.text.shingles.filter(shingle => candidateSet.has(shingle)).length;
  assert.equal(shared / fullFact.text.shingles.length, 10 / 27);
  assert.notEqual((await legacyDigest(candidate)).value, fullFact.text.digests[0].value);

  const input = { ...read, card: { ...card, body: candidate }, textFacts: [fullFact] };
  assert.deepEqual(await documentCardVisible(input), visible);
  assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold: 0.6 }), visible);
  assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold: 0.3 }), withheld);
  for (const containmentThreshold of [0, 1.1, NaN, null]) {
    assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold }), withheld);
  }
});

test("a Raw source projection uses the Raw policy threshold for legacy shingles", async () => {
  const input = {
    sourceExcluded: false, sourceLengthUtf16: candidate.length,
    rawRows: [{
      type: "raw", scope, sessionKeyHash: "a".repeat(64), messageKey: "message",
      startUtf16: 0, endUtf16: candidate.length,
      digests: [await legacyDigest(candidate)], shingles: candidateShingles, keyId: key.id,
    }],
    facts: [{ fact: fullFact, factId: "fact", incarnation: "incarnation", epoch: 1n, createdAtMs: 100 }],
  };
  assert.equal(documentCardSourceWithheld(input), false);
  assert.equal(documentCardSourceWithheld({ ...input, policy: { containmentThreshold: 0.6 } }), false);
  assert.equal(documentCardSourceWithheld({ ...input, policy: { containmentThreshold: 0.3 } }), true);
});
