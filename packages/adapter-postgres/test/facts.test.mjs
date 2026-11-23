import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CoreError, validateSuppressionFact } from "../../core/src/index.mjs";
import { assertRepresentable, slotHash } from "../src/facts.mjs";
import { canonicalDigests, factSlot } from "../src/index.mjs";

const base = { owner: "owner", namespace: "namespace", actionId: "action", origin: "edit" };
const hash = "a".repeat(64);
const earlier = { alg: "hmac", value: hash, pipeline: "core", redactionVersion: 1, keyId: "key" };
const text = {
  ...base, kind: "text", mode: "exact",
  text: { digests: [earlier], shingles: ["abcd"], embedding: [1, 2], keyId: "key" },
  sourceMemory: { id: "source", createdAtMs: 123 },
};
const session = { ...base, kind: "session", session: { client: "client", sessionId: hash } };
const window = { ...base, kind: "window", client: null, window: { startMs: -10, endMs: 20 } };
const invalidInput = { name: CoreError.name, code: "invalid_input", message: "invalid_input" };
const validatedSlot = (fact) => factSlot(validateSuppressionFact(fact));

for (const [name, fact, tuple] of [
  ["identity", { ...base, kind: "identity", memoryId: "memory" }, ["identity", "memory", null]],
  ["identity through a revision", { ...base, kind: "identity", memoryId: "memory", throughRevision: 0 }, ["identity", "memory", 0]],
  ["exact text", text, ["text", "exact", "hmac", hash]],
  ["full text", { ...text, mode: "full" }, ["text", "full", "hmac", hash]],
  ["session ID", session, ["session", "client", "id", hash]],
  ["session hash", { ...session, session: { client: "client", sessionKeyHash: hash } }, ["session", "client", "hash", hash]],
  ["all-client window", window, ["window", null, -10, 20, false, null]],
  ["anchored window", { ...window, client: "client", unknownTime: true, anchor: "pm30min" }, [
    "window", "client", -10, 20, true, "pm30min",
  ]],
  ["raw span", {
    ...base, kind: "rawSpan", sessionKeyHash: hash, messageKey: "message",
    startUtf16: 5, endUtf16: 10, contentDigest: "b".repeat(64),
  }, ["rawSpan", hash, "message", 5, 10]],
]) {
  test(`slot contains exactly the ${name} target tuple`, () => {
    assert.equal(validatedSlot(fact), JSON.stringify(tuple));
  });
}

test("canonical digest ordering uses pipeline, algorithm, and value without changing the input", () => {
  const laterValue = { ...earlier, value: "b".repeat(64) };
  const laterAlgorithm = { ...earlier, alg: "sha256", value: "0".repeat(64), keyId: null };
  const laterPipeline = { ...earlier, pipeline: "engine-legacy", value: "1".repeat(64) };
  const order = [earlier, laterValue, laterAlgorithm, laterPipeline];
  const shuffled = Object.freeze([laterAlgorithm, laterPipeline, laterValue, earlier]);
  assert.deepEqual(canonicalDigests(shuffled), order);
  assert.deepEqual(canonicalDigests(order), order);
  assert.equal(validatedSlot({ ...text, text: { digests: shuffled } }), validatedSlot(text));
  assert.equal(validatedSlot({ ...text, text: { digests: order } }), validatedSlot(text));
});

test("an all-client window and a client named * have distinct slots", () => {
  const star = { ...window, client: "*" };
  assert.equal(validatedSlot(star), JSON.stringify(["window", "*", -10, 20, false, null]));
  assert.notEqual(validatedSlot(window), validatedSlot(star));
});

test("session tuple boundaries survive delimiters, quotes, and backslashes", () => {
  const left = { ...session, session: { client: "a", sessionId: 'b:c|"d\\' } };
  const right = { ...session, session: { client: "a:b", sessionId: 'c|"d\\' } };
  assert.notEqual(validatedSlot(left), validatedSlot(right));
  assert.deepEqual(JSON.parse(validatedSlot(left)), ["session", "a", "id", left.session.sessionId]);
  assert.deepEqual(JSON.parse(validatedSlot(right)), ["session", "a:b", "id", right.session.sessionId]);
});

test("core validation refuses invalid facts before slot derivation", () => {
  assert.throws(() => validatedSlot({ ...text, text: { digests: [] } }), invalidInput);
  assert.throws(() => validatedSlot({ ...session, session: { ...session.session, sessionKeyHash: hash } }), invalidInput);
  assert.throws(() => validatedSlot({ ...window, window: { startMs: 20, endMs: 20 } }), {
    name: CoreError.name, code: "invalid_window",
  });
});

test("representability rejects U+0000 in owner fields and nested body strings", () => {
  assert.throws(() => assertRepresentable(validateSuppressionFact({ ...session, owner: "owner\u0000" })), invalidInput);
  const nested = { ...text, sourceMemory: { ...text.sourceMemory, id: "source\u0000" } };
  assert.throws(() => assertRepresentable(validateSuppressionFact(nested)), invalidInput);
  const escape = { ...session, session: { ...session.session, sessionId: "literal\\u0000" } };
  assert.doesNotThrow(() => assertRepresentable(validateSuppressionFact(escape)));
});

test("representability enforces the integer ceiling for all digest redaction versions", () => {
  const withVersion = (redactionVersion) => validateSuppressionFact({
    ...text,
    text: { digests: [earlier, { ...earlier, value: "b".repeat(64), redactionVersion }] },
  });
  assert.doesNotThrow(() => assertRepresentable(withVersion(2147483647)));
  assert.throws(() => assertRepresentable(withVersion(2147483648)), invalidInput);
});

test("representability enforces the slot's UTF-8 byte limit", () => {
  // Core's current identifier limits make this ceiling unreachable for a valid fact.
  const withId = (sessionId) => ({ ...session, session: { ...session.session, sessionId } });
  const prefixBytes = Buffer.byteLength(factSlot(withId("")));
  const id = "界".repeat(Math.floor((8192 - prefixBytes) / 3))
    + "a".repeat((8192 - prefixBytes) % 3);
  const atLimit = withId(id);
  const overLimit = withId(id + "a");
  assert.equal(Buffer.byteLength(factSlot(atLimit)), 8192);
  assert.equal(Buffer.byteLength(factSlot(overLimit)), 8193);
  assert.doesNotThrow(() => assertRepresentable(atLimit));
  assert.throws(() => assertRepresentable(overLimit), invalidInput);
});

test("slot hash is the lowercase SHA-256 of the JSON slot's UTF-8 bytes", async () => {
  const slot = validatedSlot({ ...session, session: { client: "用戶", sessionId: "会話😀" } });
  assert.equal(await slotHash(slot), createHash("sha256").update(slot, "utf8").digest("hex"));
});
