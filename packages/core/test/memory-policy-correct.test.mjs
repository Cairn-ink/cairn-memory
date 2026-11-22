import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "../src/errors.mjs";
import { canonicalPair, planConflictInsert, planCorrect, planSupersede } from "../src/memory-policy/index.mjs";

const current = Object.freeze({
  id: "memory", scope: Object.freeze({ owner: "owner", namespace: null }),
  text: "Current text", textHash: "current-hash", kind: "fact", origin: "inferred", confidence: 0.4,
  source: Object.freeze({ kind: "capture", client: null, sessionId: "session" }),
  revision: 7, createdAtMs: 1, updatedAtMs: 2, updatedAtUs: 2000n,
});
const historical = Object.freeze({ ...current, historical: true });
const same = Object.freeze({ textHash: current.textHash, kind: "decision" });
const different = Object.freeze({ textHash: "other-hash", kind: "preference" });
const coreError = (code, kind) => error => {
  assert.ok(error instanceof CoreError);
  assert.equal(error.code, code);
  assert.equal(error.kind, kind);
  return true;
};

// Engine core/runtime.mjs:365–373 guards corrections. Phase 0 places identical text before collision.
for (const [name, row, revision, next, collides, code, kind] of [
  ["missing row precedes collision", null, 6, different, true, "memory_not_found", "not_found"],
  ["stale revision precedes historical and identical", historical, 6, same, true, "revision_conflict", "conflict"],
  ["historical precedes identical and collision", historical, 7, same, true, "memory_historical", "conflict"],
  ["another visible row with the replacement text is a conflict", current, 7, different, true, "memory_conflict", "conflict"],
]) {
  test(`correct: ${name}`, () => assert.throws(() => planCorrect(row, revision, next, collides), coreError(code, kind)));
}

test("correct: identical text leaves all planned fields and the revision unchanged before collision", () => {
  assert.deepEqual(planCorrect(current, 7, same, true), {
    outcome: "unchanged", textHash: current.textHash, kind: "fact", origin: "inferred", confidence: 0.4, revision: 7,
  });
});

test("correct: new text applies kind, makes the row explicit and advances the revision", () => {
  assert.deepEqual(planCorrect(current, 7, different, false), {
    outcome: "changed", textHash: different.textHash, kind: "preference", origin: "explicit", confidence: 1, revision: 8,
  });
});

// Engine core/runtime.mjs:477–486 guards supersession. core/supersession-storage.mjs:44–47 caps incoming edges.
for (const [name, row, revision, hash, incoming, code, kind] of [
  ["missing row precedes the limit", null, 6, current.textHash, 5, "memory_not_found", "not_found"],
  ["stale revision precedes historical, same hash, and the limit", historical, 6, current.textHash, 5, "revision_conflict", "conflict"],
  ["historical precedes same hash and the limit", historical, 7, current.textHash, 5, "memory_historical", "conflict"],
  ["same hash refuses below the limit", current, 7, current.textHash, 0, "invalid_ref", "invalid_input"],
  ["same hash refuses at the limit", current, 7, current.textHash, 5, "invalid_ref", "invalid_input"],
  ["sixth incoming supersession refuses", current, 7, different.textHash, 5, "supersession_limit", "limit"],
]) {
  test(`supersede: ${name}`, () => assert.throws(() => planSupersede(row, revision, hash, incoming), coreError(code, kind)));
}

test("supersede: fifth incoming supersession is allowed", () => {
  assert.doesNotThrow(() => planSupersede(current, 7, different.textHash, 4));
});

// Engine core/conflict-storage.mjs:48–65 checks self-edges first and caps both endpoint degrees.
test("conflict endpoints use ascending UTF-8 byte order", () => {
  assert.deepEqual(canonicalPair("😀", "～"), ["～", "😀"]);
  assert.deepEqual(canonicalPair("～", "😀"), ["～", "😀"]);
});

test("canonicalPair refuses a self-edge", () => {
  assert.throws(() => canonicalPair("a", "a"), coreError("invalid_ref", "invalid_input"));
});

test("conflict self-edge is refused before either endpoint degree is read", () => {
  const degreeAfter = { get() { assert.fail("degree checked before the self-edge"); } };
  assert.throws(() => planConflictInsert("m", ["a", "m"], degreeAfter), coreError("invalid_ref", "invalid_input"));
});

test("conflict with no hints has no pairs", () => {
  assert.deepEqual(planConflictInsert("m", [], new Map()), []);
});

test("conflict returns canonical pairs at degree five and collapses repeated hints", () => {
  assert.deepEqual(planConflictInsert("m", ["z", "a", "z"], new Map([["m", 5], ["z", 5], ["a", 5]])),
    [["m", "z"], ["a", "m"]]);
});

for (const [sourceDegree, targetDegree] of [[6, 5], [5, 6]]) {
  test(`conflict refuses projected degrees ${sourceDegree} and ${targetDegree}`, () => {
    assert.throws(() => planConflictInsert("m", ["z"], new Map([["m", sourceDegree], ["z", targetDegree]])),
      coreError("conflict_limit", "limit"));
  });
}

test("conflict requires a projected degree for each endpoint", () => {
  assert.throws(() => planConflictInsert("m", ["z"], new Map([["m", 1]])), coreError("invalid_input", "invalid_input"));
});
