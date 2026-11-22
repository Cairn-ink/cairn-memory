import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksMemoryPassage, exactDigestMatch, PRIVACY_REDACTION_VERSIONS, REDACTION_VERSIONS,
  withholdsAnyPassage, withholdsPassage,
} from "@cairn-ink/core";

const keyA = { id: "key-a" };
const keyB = { id: "key-b" };

function digest(alg, value, keyId = null) {
  return { alg, value: value.repeat(64), keyId, pipeline: "core", redactionVersion: 3 };
}

function textFact(text, mode = "full") {
  return { kind: "text", owner: "owner", actionId: "action", origin: "forget", mode, text };
}

const reference = { digests: [digest("sha256", "a")], shingles: ["aa"], keyId: keyA.id };
const disjoint = { digests: [digest("sha256", "b")], shingles: ["bb"], keyId: keyA.id };

function assertWithholds(passage, fact, key) {
  assert.equal(withholdsPassage(passage, fact), true);
  assert.equal(withholdsAnyPassage([passage], [fact]), true);
  assert.equal(blocksMemoryPassage([passage], [fact], key), true);
  assert.equal(blocksMemoryPassage([passage, passage], [fact], key), true);
}

test("package root exposes both redaction version constants", () => {
  assert.deepEqual(REDACTION_VERSIONS, { v1: 1, current: 2 });
  assert.deepEqual(PRIVACY_REDACTION_VERSIONS, { v1: 1, hostedCurrent: 2, core: 3 });
});

test("full facts withhold when candidate shingles are unavailable or signed under another key", () => {
  const fact = textFact(reference);
  assertWithholds({ ...disjoint, shingles: null, keyId: null }, fact, null);
  assertWithholds({ ...disjoint, keyId: keyB.id }, fact, keyB);
});

test("HMAC-only exact facts require a comparable keyed digest to decide a miss", () => {
  const fact = textFact({ ...reference, digests: [digest("hmac", "a", keyA.id)] }, "exact");
  const candidate = { ...disjoint, shingles: null, keyId: null };
  assertWithholds(candidate, fact, null);
  assertWithholds({ ...candidate, digests: [digest("hmac", "b", keyB.id)], keyId: keyB.id }, fact, keyB);

  const signed = { ...candidate, digests: [digest("hmac", "b", keyA.id)], keyId: keyA.id };
  assert.equal(withholdsPassage(signed, fact), false);
  assert.equal(withholdsAnyPassage([signed], [fact]), false);
  assert.equal(blocksMemoryPassage([signed], [fact], keyA), false);

  const shaFact = textFact({ ...reference, shingles: null, keyId: null }, "exact");
  assert.equal(withholdsPassage(candidate, shaFact), false);
  assert.equal(withholdsAnyPassage([candidate], [shaFact]), false);
  assert.equal(blocksMemoryPassage([candidate], [shaFact], null), false);
});

test("full facts require a shared digest algorithm even with matching shingle keys", () => {
  const candidate = { ...disjoint, digests: [digest("hmac", "b", keyA.id)] };
  assertWithholds(candidate, textFact(reference), keyA);
});

test("malformed shingles withhold on either side of a comparison", () => {
  for (const shingles of [["not-hex"], [""], [], Array(1)]) {
    assertWithholds({ ...disjoint, shingles }, textFact(reference), keyA);
    assertWithholds(disjoint, textFact({ ...reference, shingles }), keyA);
  }
});

test("malformed and missing digest lists withhold on either side of a comparison", () => {
  const malformed = [[{}], [null], [{ alg: "sha256", value: "not-hex" }], [], Array(1), undefined];
  for (const digests of malformed) {
    assert.equal(exactDigestMatch(digests, reference.digests), true);
    assert.equal(exactDigestMatch(disjoint.digests, digests), true);
    const candidate = { ...disjoint, digests };
    const stored = { ...reference, digests };
    if (digests === undefined) {
      delete candidate.digests;
      delete stored.digests;
    }
    assertWithholds(candidate, textFact(reference), keyA);
    assertWithholds(disjoint, textFact(stored), keyA);
  }
});

test("sparse passage and fact lists withhold even without an entry to compare", () => {
  assert.equal(withholdsAnyPassage([disjoint], Array(1)), true);
  assert.equal(withholdsAnyPassage(Array(1), []), true);
  assert.equal(blocksMemoryPassage([disjoint, disjoint], Array(1), keyA), true);
  assert.equal(blocksMemoryPassage(Array(1), [], keyA), true);
});
