import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksMemoryPassage, coreDigest, exactDigestMatch, passageShingles, PRIVACY_REDACTION_VERSIONS,
  REDACTION_VERSIONS, userFingerprintKey, validateSuppressionFact,
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

function assertMiss(passage, fact, key) {
  assert.equal(withholdsPassage(passage, fact), false);
  assert.equal(withholdsAnyPassage([passage], [fact]), false);
  assert.equal(blocksMemoryPassage([passage], [fact], key), false);
  assert.equal(blocksMemoryPassage([passage, passage], [fact], key), false);
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
  for (const shingles of [["not-hex"], [""], Array(1)]) {
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

for (const [field, value, description] of [
  ["keyId", "", "empty SHA key ID"],
  ["keyId", keyA.id, "nonempty SHA key ID"],
  ["keyId", undefined, "missing SHA key ID"],
  ["pipeline", "unknown", "unknown pipeline"],
  ["pipeline", undefined, "missing pipeline"],
  ["redactionVersion", 0, "zero redaction version"],
  ["redactionVersion", undefined, "missing redaction version"],
]) {
  test(`invalid digest metadata withholds on either side: ${description}`, () => {
    const keyless = { shingles: null, keyId: null };
    const candidate = { ...keyless, digests: disjoint.digests };
    const fact = textFact({ ...keyless, digests: reference.digests }, "exact");
    const invalidDigest = { ...digest("sha256", "c"), [field]: value };
    if (value === undefined) delete invalidDigest[field];

    const invalidFact = textFact({ ...keyless, digests: [invalidDigest] }, "exact");
    assert.throws(() => validateSuppressionFact(invalidFact), { code: "invalid_input" });
    assertWithholds({ ...candidate, digests: [invalidDigest] }, fact, null);
    assertWithholds(candidate, invalidFact, null);
    assertWithholds({ ...candidate, digests: [...candidate.digests, invalidDigest] }, fact, null);
    assertWithholds(candidate, { ...fact, text: { ...fact.text, digests: [...fact.text.digests, invalidDigest] } }, null);
  });
}

for (const profile of ["SHA-only", "same-key HMAC"]) {
  test(`exact mode ignores empty shingles on either side: ${profile}`, async () => {
    const signingKey = await userFingerprintKey("test-secret", "owner");
    const key = profile === "SHA-only" ? null : signingKey;
    const short = {
      digests: [await coreDigest("cat", key)],
      shingles: await passageShingles("cat", signingKey),
      keyId: key?.id ?? null,
    };
    const long = {
      digests: [await coreDigest("different wording", key)],
      shingles: key ? await passageShingles("different wording", key) : null,
      keyId: key?.id ?? null,
    };
    assert.deepEqual(short.shingles, []);
    assertMiss(short, textFact(long, "exact"), key);
    assertMiss(long, textFact(short, "exact"), key);
  });
}

test("exact mode ignores malformed shingles on either side", () => {
  assertMiss({ ...disjoint, shingles: ["not-hex"] }, textFact(reference, "exact"), keyA);
  assertMiss(disjoint, textFact({ ...reference, shingles: Array(1) }, "exact"), keyA);
});

test("full mode falls back to comparable digests when either shingle list is empty", () => {
  const short = { ...reference, shingles: [] };
  const incomparable = { ...disjoint, digests: [digest("hmac", "b", keyA.id)] };
  assertMiss(disjoint, textFact(short), keyA);
  assertMiss(short, textFact(disjoint), keyA);
  assertMiss(disjoint, textFact(short), null);
  assertMiss(short, textFact(disjoint), keyB);
  assertWithholds(reference, textFact(short), keyA);
  assertWithholds(short, textFact(reference), keyA);
  assertWithholds(incomparable, textFact(short), keyA);
  assertWithholds(short, textFact(incomparable), keyA);
});

test("sparse passage and fact lists withhold even without an entry to compare", () => {
  assert.equal(withholdsAnyPassage([disjoint], Array(1)), true);
  assert.equal(withholdsAnyPassage(Array(1), []), true);
  assert.equal(blocksMemoryPassage([disjoint, disjoint], Array(1), keyA), true);
  assert.equal(blocksMemoryPassage(Array(1), [], keyA), true);
});

const comparisons = [
  ["exactDigestMatch", (candidate, fact) => exactDigestMatch(candidate.digests, fact.text.digests)],
  ["withholdsPassage", (candidate, fact) => withholdsPassage(candidate, fact)],
  ["withholdsAnyPassage with one candidate", (candidate, fact) => withholdsAnyPassage([candidate], [fact])],
  ["withholdsAnyPassage with two candidates", (candidate, fact) => withholdsAnyPassage([candidate, candidate], [fact])],
  ["blocksMemoryPassage with one candidate", (candidate, fact) => blocksMemoryPassage([candidate], [fact], keyA)],
  ["blocksMemoryPassage with two candidates", (candidate, fact) => blocksMemoryPassage([candidate, candidate], [fact], keyA)],
];

const invalidRecords = [
  ["alternating digest accessor", (record) => {
    const hex = record.value;
    let reads = 0;
    return {
      ...record,
      get value() {
        reads++;
        return reads === 1 || reads === 4 ? hex : { toString: () => hex };
      },
    };
  }],
  ["throwing digest accessor", (record) => ({
    ...record,
    get value() { throw new Error("digest getter"); },
  })],
];

for (const [description, makeRecord] of invalidRecords) {
  for (const [helper, compare] of comparisons) {
    test(`${helper} withholds a candidate ${description}`, () => {
      const candidate = { ...disjoint, digests: [makeRecord(digest("sha256", "b"))] };
      assert.equal(compare(candidate, textFact(reference)), true);
    });

    test(`${helper} withholds a fact ${description}`, () => {
      const fact = textFact({ ...reference, digests: [makeRecord(digest("sha256", "a"))] });
      assert.equal(compare(disjoint, fact), true);
    });
  }
}

function assertAlternatingProxySnapshot(compare, record, matchingValue) {
  let coercions = 0;
  const object = { toString() { coercions++; return record.value; } };
  for (const [first, later, expected] of [
    [record.value, object, false],
    [matchingValue, object, true],
    [object, record.value, true],
  ]) {
    let reads = 0;
    const proxy = new Proxy(record, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "value") {
          return { ...descriptor, value: reads++ % 2 === 0 ? first : later };
        }
        return descriptor;
      },
    });
    const snapshotDecision = compare({ ...record, value: first });
    assert.equal(snapshotDecision, expected);
    assert.equal(compare(proxy), snapshotDecision);
    assert.equal(reads, 1);
  }
  assert.equal(coercions, 0);
}

for (const [helper, compare] of comparisons) {
  test(`${helper} uses the first read of a candidate Proxy digest`, () => {
    const fact = textFact(reference);
    assertAlternatingProxySnapshot(
      (record) => compare({ ...disjoint, digests: [record] }, fact),
      digest("sha256", "b"), reference.digests[0].value,
    );
  });

  test(`${helper} uses the first read of a fact Proxy digest`, () => {
    assertAlternatingProxySnapshot(
      (record) => compare(disjoint, textFact({ ...reference, digests: [record] })),
      digest("sha256", "a"), disjoint.digests[0].value,
    );
  });
}

test("a malformed Proxy shingle length withholds", () => {
  for (const length of [-1, 0.5, 0x1_0000_0000]) {
    const shingles = new Proxy(disjoint.shingles, {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        return property === "length" ? { ...descriptor, value: length } : descriptor;
      },
    });
    assertWithholds({ ...disjoint, shingles }, textFact(reference), keyA);
  }
});

test("withholding decisions never coerce a digest value", () => {
  const hex = "1".repeat(64);
  let coercions = 0;
  const coercible = {
    [Symbol.toPrimitive]() { coercions++; return hex; },
    toString() { coercions++; return hex; },
    valueOf() { coercions++; return hex; },
  };

  for (const value of [Object(hex), BigInt(hex), coercible]) {
    const digests = [{ ...digest("sha256", "1"), value }];
    assert.equal(exactDigestMatch(digests, reference.digests), true);
    assert.equal(exactDigestMatch(disjoint.digests, digests), true);
    assertWithholds({ ...disjoint, digests }, textFact(reference), keyA);
    assertWithholds(disjoint, textFact({ ...reference, digests }), keyA);
  }
  assert.equal(coercions, 0);
});
