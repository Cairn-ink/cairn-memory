import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CoreError, validateSuppressionFact } from "../../core/src/index.mjs";
import { slotHash } from "../src/facts.mjs";
import { canonicalDigests, factSlot } from "../src/index.mjs";

const base = { owner: "owner", namespace: "namespace", actionId: "action", origin: "edit" };
const hash = "a".repeat(64);
const earlier = { alg: "hmac", value: hash, pipeline: "core", redactionVersion: 1, keyId: "key" };
const earlierTarget = ["hmac", hash, "key", "core", "core", 1];
const text = {
  ...base, kind: "text", mode: "exact",
  text: { digests: [earlier], shingles: ["abcd"], embedding: [1, 2], keyId: "key" },
  sourceMemory: { id: "source", createdAtMs: 123 },
};
const full = {
  ...text, mode: "full",
  text: { ...text.text, embedding: [1, ...Array(1535).fill(0)] },
};
const session = { ...base, kind: "session", session: { client: "client", sessionId: hash } };
const window = { ...base, kind: "window", client: null, window: { startMs: -10, endMs: 20 } };
const invalidInput = { name: CoreError.name, code: "invalid_input", message: "invalid_input" };

for (const [name, fact, tuple] of [
  ["identity", { ...base, kind: "identity", memoryId: "memory" }, ["identity", "memory", null]],
  ["identity through a revision", { ...base, kind: "identity", memoryId: "memory", throughRevision: 0 }, ["identity", "memory", 0]],
  ["exact text", text, ["text", "exact", [earlierTarget], "source"]],
  ["full text", full, ["text", "full", [earlierTarget], "source"]],
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
    assert.equal(factSlot(fact), JSON.stringify([fact.namespace ?? null, ...tuple]));
  });
}

test("canonical digest ordering starts with algorithm then value without changing the input", () => {
  const laterValue = { ...earlier, value: "b".repeat(64) };
  const laterAlgorithm = { ...earlier, alg: "sha256", value: "0".repeat(64), keyId: null };
  const otherPipeline = { ...earlier, pipeline: "engine-legacy", value: "1".repeat(64) };
  const order = [otherPipeline, earlier, laterValue, laterAlgorithm];
  const shuffled = Object.freeze([laterAlgorithm, otherPipeline, laterValue, earlier]);
  assert.deepEqual(canonicalDigests(shuffled), order);
  assert.deepEqual(canonicalDigests(order), order);
  const expected = JSON.stringify(["namespace", "text", "exact", order.map(({ alg, value, keyId, pipeline, redactionVersion }) =>
    [alg, value, keyId, pipeline, pipeline, redactionVersion]), "source"]);
  assert.equal(factSlot({ ...text, text: { digests: shuffled } }), expected);
  assert.equal(factSlot({ ...text, text: { digests: order } }), expected);
});

test("text slots differ when digest sets share only the first canonical digest", () => {
  const withSecondDigest = (value) => ({
    ...text, text: { digests: [earlier, { ...earlier, value }] },
  });
  assert.notEqual(factSlot(withSecondDigest("b".repeat(64))), factSlot(withSecondDigest("c".repeat(64))));
});

test("an all-client window and a client named * have distinct slots", () => {
  const star = { ...window, client: "*" };
  assert.equal(factSlot(star), JSON.stringify(["namespace", "window", "*", -10, 20, false, null]));
  assert.notEqual(factSlot(window), factSlot(star));
});

test("session tuple boundaries survive delimiters, quotes, and backslashes", () => {
  const left = { ...session, session: { client: "a", sessionId: 'b:c|"d\\' } };
  const right = { ...session, session: { client: "a:b", sessionId: 'c|"d\\' } };
  assert.notEqual(factSlot(left), factSlot(right));
  assert.deepEqual(JSON.parse(factSlot(left)), ["namespace", "session", "a", "id", left.session.sessionId]);
  assert.deepEqual(JSON.parse(factSlot(right)), ["namespace", "session", "a:b", "id", right.session.sessionId]);
});

test("core validation refuses invalid facts before slot derivation", () => {
  assert.throws(() => factSlot({ ...text, text: { digests: [] } }), invalidInput);
  assert.throws(() => factSlot({ ...session, session: { ...session.session, sessionKeyHash: hash } }), invalidInput);
  assert.throws(() => factSlot({ ...window, window: { startMs: 20, endMs: 20 } }), {
    name: CoreError.name, code: "invalid_window",
  });
});

test("storage preflight rejects arrays with a custom prototype", () => {
  const shingles = Object.setPrototypeOf(["abcd"], Object.create(Array.prototype));
  const fact = { ...text, text: { ...text.text, shingles } };
  assert.throws(() => factSlot(fact), invalidInput);
});

test("storage preflight rejects an array-index accessor without invoking it", () => {
  let reads = 0;
  const shingles = Object.defineProperty(["abcd"], "0", {
    get() {
      reads++;
      return "abcd";
    },
  });
  const fact = { ...text, text: { ...text.text, shingles } };
  assert.throws(() => factSlot(fact), invalidInput);
  assert.equal(reads, 0);
});

for (const [name, fact] of [
  ["a field declared for a different fact kind", { ...session, mode: "full" }],
  ["text.plaintext", { ...text, text: { ...text.text, plaintext: "example" } }],
  ["an extra digest field", { ...text, text: { digests: [{ ...earlier, extra: "example" }] } }],
  ["an extra session field", { ...session, session: { ...session.session, extra: "example" } }],
  ["an extra window field", { ...window, window: { ...window.window, extra: "example" } }],
  ["an extra sourceMemory field", { ...text, sourceMemory: { ...text.sourceMemory, extra: "example" } }],
  ["a non-enumerable extra field", Object.defineProperty({ ...session }, "extra", { value: "example" })],
  ["a symbol field", { ...session, [Symbol("extra")]: "example" }],
  ["a non-plain fact", Object.assign(Object.create({}), session)],
  ["an array used as a window record", { ...window, window: Object.assign([], window.window) }],
  ["a declared accessor", Object.defineProperty({ ...session }, "owner", { get: () => "owner" })],
  ["a non-enumerable declared field", Object.defineProperty({ ...window }, "window", {
    value: window.window, enumerable: false,
  })],
  ["a custom array property", { ...text, text: { ...text.text, shingles: Object.assign(["abcd"], { extra: true }) } }],
  ["U+0000 in owner", { ...session, owner: "owner\u0000" }],
  ["U+0000 in a nested string", { ...text, sourceMemory: { ...text.sourceMemory, id: "source\u0000" } }],
  ["an unpaired high surrogate in a session ID", { ...session, session: { ...session.session, sessionId: "\uD800" } }],
  ["an unpaired high surrogate in owner", { ...session, owner: "owner\uD800" }],
  ["an unpaired high surrogate in actionId", { ...session, actionId: "action\uD800" }],
  ["an unpaired low surrogate", { ...session, namespace: "\uDC00" }],
  ["a two-element full-mode embedding", { ...full, text: { ...full.text, embedding: [1, 2] } }],
  ["a full-mode embedding above the float4 limit", { ...full, text: { ...full.text, embedding: [1e100, ...full.text.embedding.slice(1)] } }],
  ["a full-mode embedding below the float4 limit", { ...full, text: { ...full.text, embedding: [-1e100, ...full.text.embedding.slice(1)] } }],
  ["full-mode shingles without a key ID", { ...full, text: { ...full.text, keyId: undefined } }],
]) {
  test(`storable facts reject ${name} after core validation`, () => {
    const validated = validateSuppressionFact(fact);
    assert.throws(() => factSlot(validated), invalidInput);
  });
}

// Core validation rejects these shapes itself (own array data, no coercion of a
// one-element array to a string). The storage preflight still rejects them on an
// unvalidated fact, as defence in depth.
for (const [name, fact] of [
  ["a digest value passed as a one-element array", { ...text, text: { digests: [{ ...earlier, value: [hash] }] } }],
  ["a hashed session ID passed as an array", { ...session, session: { client: "client", sessionKeyHash: [hash] } }],
  ["a sparse embedding", { ...full, text: { ...full.text, embedding: full.text.embedding.slice(1).concat(Array(1)) } }],
  ["sparse shingles", { ...text, text: { ...text.text, shingles: Array(1) } }],
]) {
  test(`core validation and storage preflight both reject ${name}`, () => {
    assert.throws(() => validateSuppressionFact(fact), invalidInput);
    assert.throws(() => factSlot(fact), invalidInput);
  });
}

test("storage preflight rejects a string in a numeric field", () => {
  const fact = { ...text, sourceMemory: { ...text.sourceMemory, createdAtMs: "123" } };
  assert.throws(() => factSlot(fact), invalidInput);
});

test("storage preflight rejects non-finite embedding components", () => {
  const fact = { ...full, text: { ...full.text, embedding: [NaN, ...full.text.embedding.slice(1)] } };
  assert.throws(() => factSlot(fact), invalidInput);
});

test("storage preflight rejects an unpaired surrogate in a shingle array element", () => {
  const fact = { ...text, text: { ...text.text, shingles: ["abcd\uD800"] } };
  assert.throws(() => factSlot(fact), invalidInput);
});

test("storage preflight accepts valid supplementary characters and a literal Unicode escape", () => {
  const escape = { ...session, session: { ...session.session, sessionId: "literal\\u0000" } };
  const supplementary = { ...session, owner: "😀", session: { ...session.session, sessionId: "会話😀" } };
  assert.doesNotThrow(() => factSlot(escape));
  assert.doesNotThrow(() => factSlot(supplementary));
});

test("storage preflight enforces the integer ceiling for all digest redaction versions", () => {
  const withVersion = (redactionVersion) => ({
    ...text,
    text: { digests: [earlier, { ...earlier, value: "b".repeat(64), redactionVersion }] },
  });
  assert.doesNotThrow(() => factSlot(withVersion(2147483647)));
  const invalid = validateSuppressionFact(withVersion(2147483648));
  assert.throws(() => factSlot(invalid), invalidInput);
});

test("storage preflight enforces the slot's UTF-8 byte limit across all digests", () => {
  // Many digests plus a namespace padded so the slot lands exactly on the limit.
  const withNamespace = (namespace) => ({
    ...text, namespace,
    text: { digests: Array.from({ length: 82 }, (_, i) => ({ ...earlier, value: i.toString(16).padStart(64, "0") })) },
  });
  const pad = 8192 - Buffer.byteLength(factSlot(withNamespace("x"))) + 1;
  assert.ok(pad >= 1 && pad < 512);
  const atLimit = validateSuppressionFact(withNamespace("x".repeat(pad)));
  const overLimit = validateSuppressionFact(withNamespace("x".repeat(pad + 1)));
  assert.equal(Buffer.byteLength(factSlot(atLimit)), 8192);
  assert.throws(() => factSlot(overLimit), invalidInput);
});

test("exact-mode embeddings and shingles can stay in the body without lookup constraints", () => {
  const bodyOnly = { ...text, text: { ...text.text, embedding: [1e100, 2], keyId: null } };
  assert.doesNotThrow(() => factSlot(bodyOnly));
});

test("full-mode lookup accepts float4 endpoints and empty shingles without a key", () => {
  const embedding = [3.4028234663852886e38, -3.4028234663852886e38, ...full.text.embedding.slice(2)];
  const withEndpoints = { ...full, text: { ...full.text, embedding, shingles: [], keyId: null } };
  assert.doesNotThrow(() => factSlot(withEndpoints));
});

test("slot hash is the lowercase SHA-256 of the JSON slot's UTF-8 bytes", async () => {
  const slot = factSlot({ ...session, session: { client: "用戶", sessionId: "会話😀" } });
  assert.equal(await slotHash(slot), createHash("sha256").update(slot, "utf8").digest("hex"));
});

test("an array shared by two fields of one fact yields two validated copies", () => {
  const shared = [];
  const fact = { ...text, text: { ...text.text, shingles: shared, embedding: shared } };
  assert.equal(factSlot(fact), factSlot({ ...text, text: { ...text.text, shingles: [], embedding: [] } }));
});

test("a proxy reached twice can never make the stored slot differ from the validated copy", () => {
  // The proxy shows a different digest value on each read; each visit is copied and
  // validated on its own, and the slot is derived from those validated copies only.
  let reads = 0;
  const digest = new Proxy({ ...earlier }, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === "value" && descriptor) descriptor.value = ++reads === 1 ? hash : "c".repeat(64);
      return descriptor;
    },
  });
  const fact = { ...text, text: { ...text.text, digests: [digest, digest] } };
  const copies = [{ ...earlier, value: hash }, { ...earlier, value: "c".repeat(64) }];
  assert.equal(factSlot(fact), factSlot({ ...text, text: { ...text.text, digests: copies } }));
});

test("a nested slot derivation inside a trap does not disturb the outer derivation", () => {
  // The trap fires on the first field of the root record, so any per-call state
  // shared at module level would be replaced before the outer copy finishes.
  for (const nested of [() => factSlot(session), () => assert.throws(() => factSlot({ ...session, extra: 1 }), invalidInput)]) {
    const outer = new Proxy({ ...text }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === "owner") nested();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    assert.equal(factSlot(outer), factSlot(text));
    assert.equal(factSlot(text), factSlot({ ...text }));
  }
});

test("array length comes from the descriptor, never from get", () => {
  let lengthGets = 0;
  const shingles = new Proxy(["abcd"], {
    get(target, key, receiver) {
      if (key === "length") lengthGets++;
      return Reflect.get(target, key, receiver);
    },
  });
  const fact = { ...text, text: { ...text.text, shingles } };
  assert.equal(factSlot(fact), factSlot(text));
  assert.equal(lengthGets, 0);
});

test("the snapshot reads each field through one descriptor lookup and never through get", () => {
  const descriptorReads = new Map();
  let gets = 0;
  const digest = new Proxy({ ...earlier }, {
    getOwnPropertyDescriptor(target, key) {
      descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      gets++;
      return Reflect.get(target, key, receiver);
    },
  });
  const fact = { ...text, text: { ...text.text, digests: [digest] } };
  assert.equal(factSlot(fact), JSON.stringify(["namespace", "text", "exact", [earlierTarget], "source"]));
  assert.equal(gets, 0);
  assert.deepEqual([...descriptorReads.values()], Object.keys(earlier).map(() => 1));
});

test("digest slots include the effective label, pipeline, and redaction version", () => {
  const withDigest = change => ({ ...text, text: { ...text.text, digests: [{ ...earlier, ...change }] } });
  assert.equal(factSlot(withDigest({ label: "core" })), factSlot(text));
  for (const change of [{ label: "alternate" }, { pipeline: "hosted-v1" }, { redactionVersion: 2 }]) {
    assert.notEqual(factSlot(withDigest(change)), factSlot(text));
  }
});

test("text facts that differ only in sourceMemory.id are distinct targets", () => {
  const other = { ...text, sourceMemory: { ...text.sourceMemory, id: "other-source" } };
  const none = { ...text, sourceMemory: null };
  assert.notEqual(factSlot(other), factSlot(text));
  assert.notEqual(factSlot(none), factSlot(text));
  assert.equal(factSlot({ ...text, sourceMemory: { ...text.sourceMemory, createdAtMs: 999 } }), factSlot(text));
});

test("the namespace is part of every slot, and an absent namespace equals null", () => {
  assert.notEqual(factSlot({ ...session, namespace: "other" }), factSlot(session));
  const { namespace: _omit, ...withoutNamespace } = session;
  assert.equal(factSlot(withoutNamespace), factSlot({ ...session, namespace: null }));
});
