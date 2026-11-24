import assert from "node:assert/strict";
import { test } from "node:test";
import { HOSTED_FINGERPRINT_LABELS as labels } from "../../adapter-postgres/src/fingerprint-labels.mjs";
import {
  coreDigest, coreFingerprintLabels, fingerprintLegacyCapture, fingerprintMemoryPassages,
  legacyExactMac, passageShingles, userFingerprintKey,
} from "../src/privacy/fingerprint.mjs";
import { redactHostedCurrent, redactV1 } from "../src/privacy/redact.mjs";
import { cleanContent, normalizeForHash, prepareCoreText } from "../src/privacy/text.mjs";
import { withholdsAnyPassage } from "../src/privacy/withholds.mjs";
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

const dummyPat = "crn_pat_" + "1234567890".repeat(4);
const captureRaw = `Note {"access_token":"demo-value"} ${dummyPat} ｐａｓｓｗｏｒｄ： demo-example`;
// Output of the hosted capture redactor. Its PAT rules leave this 40-hex dummy value alone.
const captureStored = `Note {"access_token":"[REDACTED]"} ${dummyPat} password: [REDACTED]`;

for (const field of ["title", "body"]) {
  test(`a sole hosted MAC of the NFKC then hosted-current ${field} hides the card`, async () => {
    const fact = textFact({ digests: [await legacyDigest(captureStored)] });
    assert.deepEqual(await documentCardVisible({
      ...read, card: { ...card, [field]: captureRaw }, textFacts: [fact],
    }), withheld);
  });
}

for (const [field, stored] of [["body", "J\u030c ab"], ["title", "H\u0331 yz"]]) {
  for (const mode of ["exact", "full"]) {
    test(`the one-pass hosted ${mode} fingerprint hides the combining-mark ${field}`, async () => {
      const { text_hmac, shingles, key_id: keyId } = await fingerprintLegacyCapture(stored, key, labels);
      assert.notEqual(text_hmac, await legacyExactMac(normalizeForHash(stored), key, labels));
      const digest = { alg: "hmac", pipeline: "hosted-v1", redactionVersion: 2, keyId, value: text_hmac };
      const fact = textFact({ digests: [digest], ...(mode === "full" && { shingles, keyId }) }, mode);
      assert.deepEqual(await documentCardVisible({
        ...read, card: { ...card, [field]: stored }, textFacts: [fact],
      }), withheld);
    });
  }
}

const composedStored = "\u01f0a \u01f0b \u01f0c \u01f0d \u01f0e \u01f0f \u01f0g";
const combiningOriginal = "J\u030ca J\u030cb J\u030cc J\u030cd J\u030ce J\u030cf J\u030cg";
const combiningWithSuffix = combiningOriginal + " extra notes";

for (const [form, stored] of [["composed", composedStored], ["one-pass", combiningOriginal]]) {
  const { text_hmac, shingles, key_id: keyId } = await fingerprintLegacyCapture(stored, key, labels);
  const digest = { alg: "hmac", pipeline: "hosted-v1", redactionVersion: 2, keyId, label: "hosted-v1", value: text_hmac };
  const full = textFact({ digests: [digest], shingles, keyId }, "full");

  for (const field of ["title", "body"]) {
    test(`a ${form} hosted full fact hides the combining-mark ${field} with a suffix`, async () => {
      const original = await fingerprintLegacyCapture(combiningWithSuffix, key, labels);
      const normalized = await fingerprintLegacyCapture(normalizeForHash(combiningWithSuffix), key, labels);
      assert.notEqual(original.text_hmac, text_hmac);
      assert.notEqual(normalized.text_hmac, text_hmac);
      const matching = new Set((form === "composed" ? normalized : original).shingles);
      const other = new Set((form === "composed" ? original : normalized).shingles);
      assert.equal(shingles.length, form === "composed" ? 17 : 24);
      assert.equal(shingles.filter(shingle => matching.has(shingle)).length, shingles.length);
      assert.equal(shingles.filter(shingle => other.has(shingle)).length, 0);
      assert.deepEqual(await documentCardVisible({
        ...read, card: { ...card, [field]: combiningWithSuffix }, textFacts: [full], containmentThreshold: 0.6,
      }), withheld);
    });
  }
}

for (const field of ["title", "body"]) {
  test(`a composed hosted exact fact hides the combining-mark ${field} without a suffix`, async () => {
    const digest = {
      ...await legacyDigest(composedStored), label: "hosted-v1", redactionVersion: 2,
    };
    assert.deepEqual(await documentCardVisible({
      ...read, card: { ...card, [field]: combiningOriginal }, textFacts: [textFact({ digests: [digest] })],
      containmentThreshold: 0.6,
    }), withheld);
  });
}

const labelledDigest = async (text, redactionVersion) => ({
  ...await legacyDigest(text), label: "hosted-v1", redactionVersion,
});

for (const version of [1, 2, 3]) {
  test(`a matching labelled hosted MAC at version ${version} hides the card`, async () => {
    const fact = textFact({ digests: [await labelledDigest(card.body, version)] });
    assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), withheld);
  });

  test(`an unrelated labelled hosted MAC at version ${version} leaves the card visible`, async () => {
    const fact = textFact({ digests: [await labelledDigest("Unrelated balcony notes", version)] });
    assert.deepEqual(await documentCardVisible({ ...read, textFacts: [fact] }), visible);
  });
}

test("an unrelated labelled hosted MAC stays comparable across distinct spellings", async () => {
  const fact = textFact({ digests: [await labelledDigest("Unrelated balcony notes", 2)] });
  assert.deepEqual(await documentCardVisible({
    ...read, card: { ...card, body: captureRaw }, textFacts: [fact],
  }), visible);
});

test("a numeric-string cutoff fails closed on an exact legacy miss", async () => {
  const fact = textFact({ digests: [await legacyDigest(reference)] });
  const input = { ...read, card: { ...card, body: candidate }, textFacts: [fact] };
  assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold: 0.3 }), visible);
  assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold: "0.3" }), withheld);
});

test("a Core-only full fact uses the default card cutoff", async () => {
  const fingerprintKey = await userFingerprintKey("synthetic fingerprint secret", scope.owner, coreFingerprintLabels);
  const fact = textFact({
    digests: [await coreDigest(reference, fingerprintKey)],
    shingles: await passageShingles(reference, fingerprintKey, coreFingerprintLabels), keyId: fingerprintKey.id,
  }, "full");
  const passages = await fingerprintMemoryPassages(candidate, prepareCoreText(candidate), fingerprintKey);
  assert.equal(withholdsAnyPassage(passages, [fact], 0.3), true);
  assert.equal(withholdsAnyPassage(passages, [fact], 0.6), false);

  const input = {
    card: { ...card, body: candidate }, requestedScope: scope, memoryStates: new Map(),
    textFacts: [fact], fingerprintKey,
  };
  for (const containmentThreshold of [undefined, 0.3, "0.3"]) {
    assert.deepEqual(await documentCardVisible({ ...input, containmentThreshold }), visible);
  }
});
