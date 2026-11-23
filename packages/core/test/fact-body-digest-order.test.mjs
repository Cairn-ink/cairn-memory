import assert from "node:assert/strict";
import test from "node:test";
import { factBody } from "../src/index.mjs";

const digest = (alg, value) => ({ alg, value: value.repeat(64), pipeline: "core", redactionVersion: 1, keyId: alg === "hmac" ? "k" : null });
const text = (digests) => ({
  owner: "o", actionId: "a", origin: "forget", kind: "text", mode: "exact", text: { digests },
});

test("factBody gives the same body for the same digest set in any order", () => {
  const a = digest("sha256", "b");
  const b = digest("hmac", "c");
  const c = digest("hmac", "a");
  const expected = factBody(text([c, b, a]));
  for (const order of [[a, b, c], [b, a, c], [c, a, b], [a, c, b]]) assert.equal(factBody(text(order)), expected);
  const parsed = JSON.parse(expected);
  assert.deepEqual(parsed.text.digests.map((d) => [d.alg, d.value[0]]), [["hmac", "a"], ["hmac", "c"], ["sha256", "b"]]);
});

test("factBody leaves the caller's digest array untouched and other arrays in their given order", () => {
  const digests = Object.freeze([digest("sha256", "b"), digest("hmac", "a")]);
  const fact = { ...text(digests), text: { digests, shingles: ["ff", "00"] } };
  const parsed = JSON.parse(factBody(fact));
  assert.deepEqual(parsed.text.shingles, ["ff", "00"]);
  assert.equal(digests[0].alg, "sha256");
});

test("factBody differs when the digest sets differ", () => {
  assert.notEqual(factBody(text([digest("hmac", "a"), digest("hmac", "b")])), factBody(text([digest("hmac", "a"), digest("hmac", "c")])));
});

test("factBody order is deterministic even for unvalidated duplicate digest keys", () => {
  const a = digest("hmac", "a");
  const b = { ...a, pipeline: "hosted-v1" };
  assert.equal(factBody(text([a, b])), factBody(text([b, a])));
});

test("factBody order is total even for lone surrogates that share UTF-8 bytes", () => {
  const a = { ...digest("hmac", "a"), keyId: "\uD800" };
  const b = { ...a, keyId: "\uD801" };
  assert.equal(factBody(text([a, b])), factBody(text([b, a])));
});
