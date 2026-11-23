import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksMemoryPassage, cleanContent, exactDigestMatch, fingerprintLegacyCapture, normalizeForHash,
  redactHostedCurrent, redactV1, userFingerprintKey, withholdsAnyPassage, withholdsPassage,
} from "../src/index.mjs";
import {
  cases, decodeUtf16, expected, FAKE_MASTER, inputOf, OWNERS, withholding, TEST_FINGERPRINT_LABELS as labels,
} from "./privacy-vectors.mjs";

function digest(alg, value) {
  return { alg, value, pipeline: "hosted-v1", redactionVersion: 1, keyId: alg === "hmac" ? "fake-key" : null };
}

function passageOf({ sha, mac, taggedMac, shingles, keyId }) {
  const digests = [];
  if (sha) digests.push(digest("sha256", sha.repeat(64)));
  if (mac || taggedMac) digests.push(digest("hmac", (mac ?? taggedMac).repeat(64)));
  return { digests, shingles, keyId };
}

function textFact(text, { origin = "forget", sourceMemory = null, mode = "full" } = {}) {
  return { owner: OWNERS[0], actionId: "fake-action", kind: "text", text, origin, mode, sourceMemory };
}

const key = await userFingerprintKey(FAKE_MASTER, OWNERS[0], labels);
const encoder = new TextEncoder();

async function hostedReference(text) {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(normalizeForHash(text)));
  return {
    text_hash: Buffer.from(hash).toString("hex"),
    ...await fingerprintLegacyCapture(text, key, labels),
  };
}

function hostedDigests({ text_hash, text_hmac }) {
  const digests = [];
  if (text_hash) digests.push(digest("sha256", text_hash));
  if (text_hmac) digests.push(digest("hmac", text_hmac));
  return digests;
}

for (const vector of cases) {
  const row = expected[vector.id];
  if (row.withholdsPassage) test(`hosted containment: ${vector.id}`, async () => {
    const reference = await hostedReference(decodeUtf16(vector.containmentReference));
    const passage = await hostedReference(inputOf(vector));
    const fact = textFact({ digests: hostedDigests(reference), shingles: reference.shingles, keyId: key.id });
    const candidate = { digests: hostedDigests(passage), shingles: passage.shingles, keyId: key.id };
    assert.equal(reference.shingles.length, row.withholdsPassage.referenceShingles);
    assert.equal(reference.shingles.filter((shingle) => passage.shingles.includes(shingle)).length,
      row.withholdsPassage.matchingShingles);
    assert.equal(withholdsPassage(candidate, fact), row.withholdsPassage.withholds);
    assert.equal(withholdsPassage(candidate, fact, row.withholdsPassage.threshold), row.withholdsPassage.withholds);
  });

  if (row.history) test(`hosted history aliases: ${vector.id}`, async () => {
    const original = cleanContent(inputOf(vector)).normalize("NFKC");
    const references = {
      original: await hostedReference(original),
      v1: await hostedReference(redactV1(original)),
      current: await hostedReference(redactHostedCurrent(original)),
      stored: await fingerprintLegacyCapture("FAKE stored historical wording, distinct from every incoming variant", key, labels),
    };
    const variants = row.history.variants.map(hostedDigests);
    for (const [name, reference] of Object.entries(references)) {
      const matches = variants.flatMap((variant, index) =>
        exactDigestMatch(variant, hostedDigests(reference)) ? [index] : []);
      assert.deepEqual(matches, row.history.exactPassageMatch[name]);
    }

    const unknown = {
      digests: hostedDigests(row.history.wrongKeyLast),
      shingles: row.history.wrongKeyLast.shingles,
      keyId: row.history.wrongKeyId,
    };
    const fact = textFact({ digests: hostedDigests(references.stored), shingles: references.stored.shingles, keyId: key.id });
    assert.ok(withholdsPassage(unknown, fact));
  });

  if (row.storedFact) test(`hosted stored fact: ${vector.id}`, async () => {
    const stored = row.storedFact;
    const reference = await hostedReference(inputOf(vector));
    const tagged = stored.text_hash.startsWith("hmac:");
    const exact = tagged ? digest("hmac", stored.text_hash.slice(5)) : digest("sha256", stored.text_hash);
    assert.equal(stored.redaction_version, tagged ? 1 : 2);
    assert.equal(reference.text_hmac, stored.text_hmac);
    assert.equal(reference.key_id, stored.key_id);
    assert.ok(exactDigestMatch(hostedDigests(reference), [exact]));
  });
}

for (const row of withholding) {
  test(`hosted withholding policy: ${row.id}`, () => {
    const passages = row.passages.map(passageOf);
    const facts = row.facts.map((fact) => textFact(passageOf(fact), fact));
    const activeKey = row.key ? { id: row.key } : null;
    assert.deepEqual(passages.map((passage) => facts.map((fact) => withholdsPassage(passage, fact))), row.expected.comparison);
    assert.equal(withholdsAnyPassage(passages, facts), row.expected.any);
    assert.equal(blocksMemoryPassage(passages, facts, activeKey, undefined, row.edit), row.expected.memory);
  });
}

test("exact matching uses the union of algorithm and value across keys and versions", () => {
  const hash = digest("sha256", "a".repeat(64));
  const mac = digest("hmac", "a".repeat(64));
  const other = digest("sha256", "b".repeat(64));
  assert.ok(exactDigestMatch([other, hash], [{ ...hash, pipeline: "core", redactionVersion: 3 }]));
  assert.ok(exactDigestMatch([mac], [{ ...mac, keyId: "fake-old-key" }]));
  assert.ok(!exactDigestMatch([hash], [mac]));
});

test("exact-only facts work with the keyless profile", () => {
  const text = { digests: [digest("sha256", "a".repeat(64))], shingles: null, keyId: null };
  const other = { ...text, digests: [digest("sha256", "b".repeat(64))] };
  const fact = textFact(text, { mode: "exact" });
  assert.ok(withholdsPassage(text, fact));
  assert.ok(!withholdsPassage(other, fact));
  assert.ok(!blocksMemoryPassage([other, other], [fact], null));
});

test("full containment withholds on an unknown key, malformed shingles, or invalid threshold", () => {
  const text = passageOf({ sha: "a", shingles: ["aa"], keyId: "fake-key" });
  const disjoint = passageOf({ sha: "b", shingles: ["bb"], keyId: "fake-key" });
  const fact = textFact(text);
  assert.ok(withholdsPassage({ ...disjoint, keyId: null }, fact));
  assert.ok(withholdsPassage({ ...disjoint, shingles: Array(1) }, fact));
  assert.ok(withholdsPassage(disjoint, fact, Number.NaN));
});
