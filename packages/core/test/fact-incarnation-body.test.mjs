import assert from "node:assert/strict";
import test from "node:test";
import { factBody, factIncarnationBody } from "../src/index.mjs";

const digest = { alg: "hmac", value: "a".repeat(64), pipeline: "core", redactionVersion: 1, keyId: "k" };
const text = (embedding, extra = {}) => ({
  owner: "o", actionId: "a", origin: "forget", kind: "text", mode: "full",
  text: { digests: [digest], shingles: ["ab", "cd"], embedding, keyId: "k", ...extra },
});

test("two forgets of the same text with different embeddings share an incarnation body", () => {
  const first = text([0.1, 0.2]);
  const second = text([0.1000001, 0.2]);
  assert.equal(factIncarnationBody(first), factIncarnationBody(second));
  assert.notEqual(factBody(first), factBody(second));
  assert.equal(factIncarnationBody(text(null)), factIncarnationBody(first));
  assert.equal(factIncarnationBody(text(undefined)), factIncarnationBody(first));
});

test("the incarnation body still separates every other text field", () => {
  const base = factIncarnationBody(text([1]));
  assert.notEqual(factIncarnationBody(text([1], { shingles: ["ab"] })), base);
  assert.notEqual(factIncarnationBody(text([1], { keyId: "other" })), base);
  assert.notEqual(factIncarnationBody({ ...text([1]), mode: "exact" }), base);
  assert.notEqual(factIncarnationBody({ ...text([1]), sourceMemory: { id: "m", createdAtMs: 1 } }), base);
  assert.notEqual(factIncarnationBody({ ...text([1]), origin: "edit" }), base);
});

test("the incarnation body equals factBody for every non-text kind and leaves the fact untouched", () => {
  const facts = [
    { owner: "o", actionId: "a", origin: "forget", kind: "identity", memoryId: "m" },
    { owner: "o", actionId: "a", origin: "forget", kind: "session", session: { client: "c", sessionId: "s" } },
    { owner: "o", actionId: "a", origin: "forget", kind: "window", client: null, window: { startMs: 0, endMs: 1 } },
  ];
  for (const fact of facts) assert.equal(factIncarnationBody(fact), factBody(fact));
  const fact = Object.freeze({ ...text([1, 2]), text: Object.freeze(text([1, 2]).text) });
  factIncarnationBody(fact);
  assert.deepEqual(fact.text.embedding, [1, 2]);
});
