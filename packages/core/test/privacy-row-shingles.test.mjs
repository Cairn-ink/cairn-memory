import assert from "node:assert/strict";
import { test } from "node:test";
import { factBlocksIncoming, factHidesRow, SUPPRESSION_DISTANCE } from "../src/index.mjs";
import { SUPPRESSION_DISTANCE_TOLERANCE } from "../src/privacy/fact-match.mjs";

const scope = { owner: "owner", namespace: "namespace" };
const memoryId = "memory";
const session = { client: "client", sessionId: "session" };
const hex = (digit) => digit.repeat(64);
const digest = (digit) => ({ alg: "sha256", value: hex(digit), pipeline: "core", redactionVersion: 1, keyId: null });
const text = { digests: [digest("a")], shingles: ["01", "02", "03"], keyId: "key", embedding: [1, 0] };
const full = { kind: "text", mode: "full", text };
const far = { digests: [digest("b")], embedding: [0, 1] };
const row = { scope, memoryId, revision: 1, ...far };
const vector = { vectorSuppression: true };
const withoutShingles = { ...vector, rowShingles: false };

function stored(fact) {
  return {
    fact: { ...scope, actionId: "action", origin: "forget", ...fact },
    factId: "fact", incarnation: hex("c"), epoch: 1n, createdAtMs: 0,
  };
}

function compare(fact, candidate, policy = withoutShingles) {
  const incoming = { scope, passages: [candidate] };
  const reference = stored(fact);
  return [
    factHidesRow(reference, { ...row, ...candidate }, policy),
    factBlocksIncoming(reference, incoming, { ...policy, mode: "capture" }),
    factBlocksIncoming(reference, incoming, { ...policy, mode: "explicitSave" }),
  ];
}

test("a full text fact allows an unrelated row and candidate in the same namespace without row shingles", () => {
  assert.deepEqual(compare(full, far, vector), ["ineligible", "ineligible", "ineligible"]);
  assert.deepEqual(compare(full, far, { ...vector, rowShingles: true }), ["ineligible", "ineligible", "ineligible"]);
  assert.deepEqual(compare(full, far, { ...vector, rowShingles: undefined }), ["ineligible", "ineligible", "ineligible"]);
  assert.equal(factHidesRow(stored(full), row, withoutShingles), false);
  assert.deepEqual(compare(full, far), [false, false, false]);
  assert.deepEqual(compare(full, { ...far, shingles: null, keyId: null }), [false, false, false]);
});

test("an exact digest hit on a later alias still blocks a full text fact comparison", () => {
  const alias = { ...text.digests[0], pipeline: "engine-legacy" };
  assert.deepEqual(compare(full, { ...far, digests: [...far.digests, alias] }), [true, true, true]);
});

test("the vector cutoff and tolerance apply to rows and capture", () => {
  for (const [toleranceFactor, match] of [[0, true], [0.5, true], [2, false]]) {
    const similarity = 1 - SUPPRESSION_DISTANCE - toleranceFactor * SUPPRESSION_DISTANCE_TOLERANCE;
    const embedding = [similarity, Math.sqrt(1 - similarity ** 2)];
    assert.deepEqual(compare(full, { ...far, embedding }), [match, match, false]);
  }
  assert.deepEqual(compare(full, { ...far, embedding: [1, 0] }, { rowShingles: false }), [false, false, false]);
});

test("an incomparable digest remains ineligible unless an applicable vector matches", () => {
  const candidate = { ...far, digests: [{ ...digest("a"), alg: "hmac", keyId: "key" }] };
  assert.deepEqual(compare(full, candidate), ["ineligible", "ineligible", "ineligible"]);
  assert.deepEqual(compare(full, { ...candidate, embedding: [1, 0] }), [true, true, "ineligible"]);
});

test("a malformed applicable embedding remains ineligible", () => {
  assert.deepEqual(compare(full, { ...far, embedding: [Infinity, 0] }), ["ineligible", "ineligible", false]);
});

test("non-boolean rowShingles values make the policy ineligible even with an exact hit", () => {
  for (const rowShingles of ["false", 0, null]) {
    assert.deepEqual(compare(full, { ...far, digests: text.digests }, { rowShingles }),
      ["ineligible", "ineligible", "ineligible"]);
  }
});

test("exact-mode text facts have the same outcomes with and without row shingles", () => {
  const exact = { ...full, mode: "exact" };
  for (const [candidate, expected] of [
    [{ digests: text.digests }, true],
    [{ ...far, shingles: text.shingles, keyId: text.keyId, embedding: [1, 0] }, false],
    [{ ...far, digests: [] }, "ineligible"],
  ]) {
    assert.deepEqual(compare(exact, candidate, vector), [expected, expected, expected]);
    assert.deepEqual(compare(exact, candidate), [expected, expected, expected]);
  }
});

test("identity, session, window and raw span facts have the same outcomes with and without row shingles", () => {
  const sessionKeyHash = hex("d");
  const raw = { type: "raw", scope, sessionKeyHash, messageKey: "message", startUtf16: 1, endUtf16: 3 };
  const incoming = { scope, passages: [far], session, occurredAtMs: 10 };
  for (const [fact, candidate, writeMatch] of [
    [{ kind: "identity", memoryId, throughRevision: 1 }, row, false],
    [{ kind: "session", session }, { ...row, source: session }, true],
    [{ kind: "window", client: session.client, window: { startMs: 0, endMs: 20 } },
      { ...row, source: { ...session, occurredAtMs: 10 } }, true],
    [{ kind: "rawSpan", sessionKeyHash, messageKey: raw.messageKey, startUtf16: 2, endUtf16: 4,
      contentDigest: hex("e") }, raw, false],
  ]) {
    for (const policy of [vector, withoutShingles]) {
      assert.equal(factHidesRow(stored(fact), candidate, policy), true, fact.kind);
      assert.equal(factBlocksIncoming(stored(fact), incoming, { ...policy, mode: "capture" }), writeMatch, fact.kind);
      assert.equal(factBlocksIncoming(stored(fact), incoming, { ...policy, mode: "explicitSave" }), writeMatch, fact.kind);
    }
  }
});

test("supplied row and incoming shingles are ignored with rowShingles disabled", () => {
  const contained = { ...far, shingles: text.shingles, keyId: text.keyId };
  assert.deepEqual(compare(full, contained, vector), [true, true, false]);
  assert.deepEqual(compare(full, contained), [false, false, false]);

  const unreadable = () => { throw new Error("candidate shingle evidence was read"); };
  const trap = {
    getOwnPropertyDescriptor(target, key) {
      if (key === "shingles" || key === "keyId") unreadable();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  };
  assert.equal(factHidesRow(stored(full), new Proxy({ ...row, ...contained }, trap), withoutShingles), false);
  for (const mode of ["capture", "explicitSave"]) {
    assert.equal(factBlocksIncoming(stored(full), { scope, passages: [new Proxy(contained, trap)] },
      { ...withoutShingles, mode }), false);
  }
});

test("unavailable fact shingles and key IDs are ignored while stored fact validation still applies", () => {
  for (const absent of [undefined, null]) {
    const fact = { ...full, text: { ...text, shingles: absent, keyId: absent } };
    assert.deepEqual(compare(fact, far), [false, false, false]);
  }
  for (const invalidText of [{ ...text, shingles: ["invalid"] }, { ...text, keyId: "" }]) {
    const fact = { ...full, text: invalidText };
    assert.deepEqual(compare(fact, { ...far, digests: text.digests }), ["ineligible", "ineligible", "ineligible"]);
  }
});

test("explicit saves need no containment key even without passages", () => {
  const fact = stored({ ...full, origin: "edit", sourceMemory: { id: memoryId, createdAtMs: 0 } });
  for (const passages of [[], [far]]) {
    const incoming = { scope, passages };
    for (const key of [undefined, null, { id: "different-key" }]) {
      assert.equal(factBlocksIncoming(fact, incoming, { ...withoutShingles, mode: "explicitSave", key }), false);
    }
    assert.equal(factBlocksIncoming(fact, incoming, { ...withoutShingles, mode: "explicitSave", key: { id: "" } }),
      "ineligible");
  }
});

test("missing passages and malformed policy or edit data remain ineligible", () => {
  const fact = stored(full);
  const explicit = { ...withoutShingles, mode: "explicitSave" };
  assert.equal(factBlocksIncoming(fact, { scope }, explicit), "ineligible");
  assert.equal(factBlocksIncoming(fact, { scope, passages: [far], sourceMemory: { id: memoryId } }, explicit), "ineligible");
  assert.deepEqual(compare(full, far, { ...withoutShingles, containmentThreshold: 0 }),
    ["ineligible", "ineligible", "ineligible"]);
});
