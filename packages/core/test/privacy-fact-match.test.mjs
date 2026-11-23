import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  blocksMemoryPassage, cleanContent, factBlocksIncoming, factHidesRow, fingerprintLegacyCapture, NEAR_DUPLICATE_DISTANCE,
  normalizeForHash, redactHostedCurrent, redactV1, SUPPRESSION_DISTANCE, userFingerprintKey, withholdsPassage,
} from "../src/index.mjs";
import {
  cases, decodeUtf16, expected, FAKE_MASTER, inputOf, OWNERS, withholding, TEST_FINGERPRINT_LABELS as labels,
} from "./privacy-vectors.mjs";

const ineligible = "ineligible";
const scope = { owner: OWNERS[0], namespace: null };
const client = "example-client";
const sessionId = "example-id";
const keyId = "fake-key";
const memoryId = "example-memory";
const baseRow = { scope, memoryId, revision: 3 };
const capture = { mode: "capture" };
const explicit = { mode: "explicitSave" };
const hex = (character) => character.repeat(64);
const digest = (value, alg = "sha256") => ({
  alg, value: hex(value), pipeline: "hosted-v1", redactionVersion: 1, keyId: alg === "hmac" ? keyId : null,
});
const source = { client, sessionId };
const hashed = { client, sessionKeyHash: hex("c") };

function store(fact, factScope = scope) {
  return {
    fact: { ...factScope, actionId: "example-action", origin: "forget", ...fact },
    factId: "example-fact", incarnation: hex("a"), epoch: 1n, createdAtMs: 0,
  };
}

function checkRows(name, table, row = baseRow) {
  for (const [label, fact, patch, want, policy] of table) {
    test(`${name} row: ${label}`, () => assert.equal(factHidesRow(store(fact), { ...row, ...patch }, policy), want));
  }
}

const identity = { kind: "identity", memoryId, throughRevision: 3 };
checkRows("identity", [
  ["revision just below", identity, { revision: 2 }, true],
  ["revision at the boundary", identity, {}, true],
  ["revision just above", identity, { revision: 4 }, false],
  ["different id", identity, { memoryId: "different" }, false],
  ["throughRevision absent", { ...identity, throughRevision: undefined }, { revision: undefined }, true],
  ["missing memory id", identity, { memoryId: undefined }, ineligible],
  ["missing revision", identity, { revision: undefined }, ineligible],
  ["malformed revision", identity, { revision: -1 }, ineligible],
  ["malformed fact", { ...identity, throughRevision: -1 }, {}, ineligible],
  ["raw type", identity, { type: "raw" }, false],
]);

const shingles = Array.from({ length: 100 }, (_, index) => index.toString(16));
const passage = { digests: [digest("b")], shingles: ["ff"], keyId };
const reference = { digests: [digest("a")], shingles, keyId, embedding: [1, 0] };
const text = { kind: "text", mode: "full", text: reference };
const exact = { ...text, mode: "exact" };
const vectorPolicy = { vectorSuppression: true };
const vectorAt = (distance) => [1 - distance, Math.sqrt(1 - (1 - distance) ** 2)];
const sharedDigest = { ...reference.digests[0], pipeline: "engine-legacy" };

checkRows("text", [
  ...[59, 60, 61].map((n) => [`containment ${n}%`, text, { shingles: shingles.slice(0, n) }, n >= 60]),
  ...[0.19, 0.20, 0.21].map((d) => [`cosine distance ${d.toFixed(2)}`, text, { embedding: vectorAt(d) }, d <= 0.20, vectorPolicy]),
  ["exact floating-point cutoff is inclusive", text, { embedding: [0.8, 0.6] }, true,
    { ...vectorPolicy, suppressionDistance: 1 - 0.8 }],
  ["unit length is unnecessary", text, { embedding: [4, 3] }, true, vectorPolicy],
  ["antiparallel vectors", text, { embedding: [-1, 0] }, false, vectorPolicy],
  ["typed vector", text, { embedding: new Float32Array([1, 0]) }, true, vectorPolicy],
  ["custom distance cutoff", text, { embedding: vectorAt(0.21) }, true, { ...vectorPolicy, suppressionDistance: 0.25 }],
  ["custom containment cutoff", text, { shingles: shingles.slice(0, 60) }, false, { containmentThreshold: 0.61 }],
  ["vector withheld by capability", text, { embedding: [1, 0] }, false],
  ["candidate vector absent", text, {}, false, vectorPolicy],
  ["fact vector absent", { ...text, text: { ...reference, embedding: null } }, { embedding: [1, 0] }, false, vectorPolicy],
  ["exact mode disables fuzzy comparisons", exact, { shingles, embedding: [1, 0] }, false, vectorPolicy],
  ["exact alias across pipelines", text, { digests: [digest("b"), sharedDigest], shingles: null, keyId: null }, true],
  ["same bytes under a different digest algorithm", exact, { digests: [digest("a", "hmac")] }, ineligible],
  ["full fact needs a shared digest algorithm", text, { digests: [digest("b", "hmac")] }, ineligible],
  ["HMACs under different keys cannot establish a miss", { ...exact, text: { digests: [digest("a", "hmac")] } },
    { digests: [{ ...digest("b", "hmac"), keyId: "fake-rotated-key" }] }, ineligible],
  ["HMACs under the same key can establish a miss", { ...exact, text: { digests: [digest("a", "hmac")] } },
    { digests: [digest("b", "hmac")], shingles: null, keyId: null }, false],
  ["exact SHA can establish a miss without a key", { ...exact, text: { digests: [digest("a")] } },
    { shingles: null, keyId: null }, false],
  ["empty stored shingles fall back to a comparable digest miss", { ...text, text: { ...reference, shingles: [] } }, {}, false],
  ["empty candidate shingles need a comparable shingle key", text, { shingles: [], keyId: null }, ineligible],
  ["empty candidate shingles need comparable digests", text, { digests: [digest("b", "hmac")], shingles: [] }, ineligible],
  ["empty stored shingles still require a valid candidate list", { ...text, text: { ...reference, shingles: [] } },
    { shingles: ["not-hex"] }, ineligible],
  ["exact comparison ignores candidate shingles", exact, { shingles: ["not-hex"] }, false],
  ["candidate digests missing", text, { digests: undefined, shingles }, ineligible],
  ["candidate digests empty", exact, { digests: [] }, ineligible],
  ["candidate digests malformed", text, { digests: [{ alg: "sha256", value: "broken" }] }, ineligible],
  ["an invalid digest record prevents a miss alongside a comparable digest", exact,
    { digests: [digest("b"), { ...digest("c"), keyId }] }, ineligible],
  ["candidate shingle evidence absent", text, { shingles: null }, ineligible],
  ["candidate shingles have holes", text, { shingles: Array(1) }, ineligible],
  ["stored shingle evidence absent", { ...text, text: { ...reference, shingles: null } }, {}, ineligible],
  ["unknown key", text, { keyId: null }, ineligible],
  ["rotated key", text, { keyId: "fake-rotated-key" }, ineligible],
  ["vector can resolve unavailable shingles", text, { keyId: null, embedding: [1, 0] }, true, vectorPolicy],
  ["malformed threshold", text, {}, ineligible, { containmentThreshold: 0 }],
  ["malformed threshold on an exact comparison", exact, {}, ineligible, { containmentThreshold: null }],
  ["malformed distance cutoff", text, { embedding: [1, 0] }, ineligible, { ...vectorPolicy, suppressionDistance: 3 }],
  ["vector dimension mismatch", text, { embedding: [1] }, ineligible, vectorPolicy],
  ["zero vector", text, { embedding: [0, 0] }, ineligible, vectorPolicy],
  ["nonfinite vector", text, { embedding: [Infinity, 0] }, ineligible, vectorPolicy],
  ["malformed vector", text, { embedding: "bad" }, ineligible, vectorPolicy],
  ["empty vectors", { ...text, text: { ...reference, embedding: [] } }, { embedding: [] }, ineligible, vectorPolicy],
  ["invalid stored embedding even on an exact hit", { ...text, text: { ...reference, embedding: Array(1) } },
    { digests: [sharedDigest] }, ineligible],
  ["stored digest must really be a string", { ...text, text: { ...reference, digests: [{ ...digest("a"), value: [hex("a")] }] } },
    {}, ineligible],
], { ...baseRow, ...passage });

test("float32 storage gets a one-sided vector cutoff tolerance", async () => {
  const embedding = Array(1536).fill(0);
  embedding[0] = 1;
  const fact = store({ ...text, text: { ...reference, embedding } });
  const candidate = new Float32Array(1536);
  candidate.set(vectorAt(0.20001));
  assert.equal(factHidesRow(fact, { ...baseRow, ...passage, embedding: candidate }, vectorPolicy), false);
  candidate.set(new Float32Array([0.8, 0.6]));
  assert.equal(factHidesRow(fact, { ...baseRow, ...passage, embedding: candidate }, vectorPolicy), true);
  const root = await import("../src/index.mjs");
  const direct = await import("../src/privacy/fact-match.mjs");
  assert.equal(root.SUPPRESSION_DISTANCE_TOLERANCE, 1e-6);
  assert.equal(direct.SUPPRESSION_DISTANCE_TOLERANCE, root.SUPPRESSION_DISTANCE_TOLERANCE);
});

for (const [label, policy, embedding] of [
  ["nonboolean switch", { vectorSuppression: 0 }, [1, 0]],
  ["null cutoff", { vectorSuppression: true, suppressionDistance: null }, [0, 1]],
  ["explicitly undefined switch", { vectorSuppression: undefined }, [1, 0]],
  ["explicitly undefined cutoff", { vectorSuppression: true, suppressionDistance: undefined }, [0, 1]],
  ["out-of-range cutoff without a candidate vector", { vectorSuppression: true, suppressionDistance: -1 }, undefined],
]) {
  test(`invalid vector policy denies comparison: ${label}`, () => {
    const candidate = { ...passage, embedding };
    assert.deepEqual([
      factHidesRow(store(text), { ...baseRow, ...candidate }, policy),
      factBlocksIncoming(store(text), { scope, passages: [candidate] }, { ...capture, ...policy }),
    ], [ineligible, ineligible]);
  });
}

const session = { kind: "session", session: source };
const hashSession = { kind: "session", session: hashed };
const hashSessionKey = (matchedClient, id) => {
  assert.deepEqual([matchedClient, id], [client, sessionId]);
  return hashed.sessionKeyHash;
};
checkRows("session", [
  ["same plain id", session, { source }, true],
  ["different plain id", session, { source: { client, sessionId: "different" } }, false],
  ["different client", session, { source: { ...source, client: "different" } }, false],
  ["same hash", hashSession, { source: hashed }, true],
  ["different hash", hashSession, { source: { client, sessionKeyHash: hex("d") } }, false],
  ["plain fact and hashed row", session, { source: hashed }, true, { hashSessionKey }],
  ["hashed fact and plain row", hashSession, { source }, true, { hashSessionKey }],
  ["hash conversion misses", session, { source: hashed }, false, { hashSessionKey: () => hex("d") }],
  ["hash conversion absent", session, { source: hashed }, ineligible],
  ["hash conversion fails", session, { source: hashed }, ineligible, { hashSessionKey() { throw new Error(); } }],
  ["hash conversion gives no valid hash", session, { source: hashed }, ineligible, { hashSessionKey: () => null }],
  ["source absent", session, {}, ineligible],
  ["client absent", session, { source: { sessionId } }, ineligible],
  ["reference absent", session, { source: { client } }, ineligible],
  ["reference ambiguous", session, { source: { ...source, ...hashed } }, ineligible],
  ["malformed plain reference", session, { source: { client, sessionId: "" } }, ineligible],
  ["malformed hash reference", hashSession, { source: { client, sessionKeyHash: "bad" } }, ineligible],
  ["malformed fact", { ...hashSession, session: { client, sessionKeyHash: [hex("c")] } }, { source: hashed }, ineligible],
]);

const window = { kind: "window", client, window: { startMs: -10, endMs: 10 } };
const globalWindow = { ...window, client: null };
const unknownWindow = { ...window, unknownTime: true };
checkRows("window", [
  ...[-11, -10, 9, 10].map((time) => [`time ${time}`, window, { source: { client, occurredAtMs: time } }, time >= -10 && time < 10]),
  ["different client", window, { source: { client: "different", occurredAtMs: 0 } }, false],
  ["all clients", globalWindow, { source: { client: "different", occurredAtMs: 0 } }, true],
  ["scoped client absent", window, { source: { occurredAtMs: 0 } }, ineligible],
  ["unknown time covered", unknownWindow, { source: { client, occurredAtMs: null } }, true],
  ["unknown time outside the ordinary window", window, { source: { client, occurredAtMs: null } }, false],
  ["unknown time under a different client", unknownWindow, { source: { client: "different", occurredAtMs: null } }, false],
  ["time absent", unknownWindow, { source: { client } }, ineligible],
  ["time malformed", window, { source: { client, occurredAtMs: 0.5 } }, ineligible],
  ["malformed window", { ...window, window: { startMs: 10, endMs: 10 } }, { source: { client, occurredAtMs: 0 } }, ineligible],
]);

const span = { kind: "rawSpan", sessionKeyHash: hashed.sessionKeyHash, messageKey: "example-message",
  startUtf16: 2, endUtf16: 6, contentDigest: hex("d") };
const raw = { type: "raw", scope, sessionKeyHash: span.sessionKeyHash, messageKey: span.messageKey, startUtf16: 2, endUtf16: 6 };
checkRows("raw span", [
  ["same range", span, {}, true],
  ["one UTF-16 unit overlaps at the left edge", span, { startUtf16: 0, endUtf16: 3 }, true],
  ["one UTF-16 unit overlaps at the right edge", span, { startUtf16: 5, endUtf16: 8 }, true],
  ["adjacent before", span, { startUtf16: 0, endUtf16: 2 }, false],
  ["adjacent after", span, { startUtf16: 6, endUtf16: 8 }, false],
  ["different message", span, { messageKey: "different" }, false],
  ["different session hash", span, { sessionKeyHash: hex("a") }, false],
  ["ordinary memory", span, { type: "memory", memoryId }, false],
  ["unknown row type", span, { type: "different" }, ineligible],
  ["unbound message", span, { messageKey: undefined }, ineligible],
  ["unbound session hash", span, { sessionKeyHash: undefined }, ineligible],
  ["unbound start", span, { startUtf16: undefined }, ineligible],
  ["unbound end", span, { endUtf16: undefined }, ineligible],
  ["invalid range", span, { startUtf16: 6 }, ineligible],
  ["malformed fact", { ...span, contentDigest: [span.contentDigest] }, {}, ineligible],
], raw);

test("an overlapping raw span requires a row tag or a tagged memory with an ID", () => {
  const overlap = { scope, sessionKeyHash: span.sessionKeyHash, messageKey: span.messageKey, startUtf16: 5, endUtf16: 8 };
  assert.equal(factHidesRow(store(span), { ...overlap, type: "raw" }), true);
  assert.equal(factHidesRow(store(span), { ...baseRow, type: "memory" }), false);
  assert.deepEqual([
    factHidesRow(store(span), overlap),
    factHidesRow(store(span), { ...overlap, type: "memory" }),
  ], [ineligible, ineligible]);
});

test("a fact needs a valid body and a bound candidate scope", () => {
  const incoming = { scope, passages: [] };
  for (const malformed of [undefined, {}, store({ kind: "unknown" }), store({ ...identity, owner: "" }),
    store({ ...text, text: { ...reference, shingles: Array(1) } })]) {
    assert.equal(factHidesRow(malformed, baseRow), ineligible);
    assert.equal(factBlocksIncoming(malformed, incoming, capture), ineligible);
  }
  for (const incomplete of [undefined, { namespace: null }, { owner: OWNERS[0] }]) {
    assert.equal(factHidesRow(store(identity), { ...baseRow, scope: incomplete }), ineligible);
    assert.equal(factBlocksIncoming(store(text), { ...incoming, scope: incomplete }, capture), ineligible);
  }
  const implicitNamespace = store({ ...identity, namespace: undefined });
  assert.equal(factHidesRow(implicitNamespace, baseRow), true);
  const project = { ...scope, namespace: "project\0example" };
  assert.equal(factHidesRow(store(identity, project), { ...baseRow, scope: project }), true);
  assert.equal(factHidesRow(store(identity, project), { ...baseRow, scope: { ...project, namespace: "project\0other" } }), false);
});

test("equal identifiers, ranges and digests cannot match across owners or namespaces", () => {
  const incoming = { scope, session: source, occurredAtMs: 0, passages: [{ ...passage, digests: [sharedDigest] }] };
  for (const [fact, row] of [
    [identity, baseRow], [text, { ...baseRow, digests: [sharedDigest] }],
    [session, { ...baseRow, source }], [window, { ...baseRow, source: { client, occurredAtMs: 0 } }], [span, raw],
  ]) {
    assert.equal(factHidesRow(store(fact), row), true);
    for (const foreignScope of [{ ...scope, owner: OWNERS[1] }, { ...scope, namespace: "example-namespace" }]) {
      const foreign = store(fact, foreignScope);
      assert.equal(factHidesRow(foreign, row), false);
      assert.equal(factBlocksIncoming(foreign, incoming, capture), false);
      assert.equal(factBlocksIncoming(foreign, incoming, explicit), false);
    }
  }
});

const edit = { id: memoryId, createdAtMs: 42 };
const editFact = { ...text, origin: "edit", sourceMemory: edit };
const near = { ...passage, embedding: [1, 0] };
const contained = { ...passage, shingles: shingles.slice(0, 60) };
const exactPassage = { ...passage, digests: [sharedDigest] };

const comparisons = [
  ["factHidesRow", (fact, candidate, policy) => factHidesRow(fact, { ...baseRow, ...candidate }, policy)],
  ["factBlocksIncoming", (fact, candidate, policy) =>
    factBlocksIncoming(fact, { scope, passages: [candidate, candidate] }, policy)],
];

for (const [name, compare] of comparisons) {
  test(`${name} denies a digest accessor without calling it`, () => {
    let reads = 0;
    const alternating = (record) => ({
      ...record,
      get value() { return ++reads % 2 === 1 ? record.value : hex("f"); },
    });
    assert.equal(compare(store(exact), { ...passage, digests: [alternating(passage.digests[0])] }, capture), ineligible);
    const fact = store({ ...exact, text: { ...reference, digests: [alternating(reference.digests[0])] } });
    assert.equal(compare(fact, passage, capture), ineligible);
    assert.equal(reads, 0);
  });

  test(`${name} denies a throwing policy getter and ignores an extra key`, () => {
    let reads = 0;
    const bomb = () => { reads++; throw new Error("unexpected getter"); };
    const policy = { ...capture, get containmentThreshold() { return bomb(); } };
    assert.equal(compare(store(exact), passage, policy), ineligible);
    const candidate = { ...passage, digests: [{ ...passage.digests[0], get extra() { return bomb(); } }] };
    assert.equal(compare(store(exact), candidate, capture), false);
    assert.equal(reads, 0);
  });

  test(`${name} takes one descriptor snapshot of a digest shared by its inputs`, () => {
    let reads = 0;
    const repeated = new Proxy(digest("a"), {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "value" && ++reads > 1) return { ...descriptor, value: hex("b") };
        return descriptor;
      },
      get() { throw new Error("expected an own property descriptor"); },
    });
    const evidence = { ...passage, digests: [repeated] };
    assert.equal(compare(store({ ...exact, text: evidence }), evidence, capture), true);
    assert.equal(reads, 1);
  });
}

test("scope snapshots ignore inherited fields", () => {
  const inherited = Object.create(scope);
  assert.equal(factHidesRow(store(identity), { ...baseRow, scope: inherited }), ineligible);
  assert.equal(factBlocksIncoming(store(text), { scope: inherited, passages: [exactPassage] }, capture), ineligible);
});

for (const [label, fact, input, policy, want] of [
  ["identity is row only", identity, {}, capture, false],
  ["raw span is row only", span, {}, capture, false],
  ["session hit", session, { session: source }, capture, true],
  ["session unavailable", session, {}, capture, ineligible],
  ["session hash conversion", hashSession, { session: source }, { ...capture, hashSessionKey }, true],
  ["wildcard window with no session", globalWindow, { occurredAtMs: -10 }, capture, true],
  ["unknown time is explicit", unknownWindow, { session: source, occurredAtMs: null }, capture, true],
  ["scoped window without client", window, { occurredAtMs: 0 }, capture, ineligible],
  ["window without time", globalWindow, {}, capture, ineligible],
  ["invalid mode", text, {}, { mode: "other" }, ineligible],
  ["missing list", text, { passages: undefined }, capture, ineligible],
  ["missing exact evidence", text, { passages: [undefined, passage] }, capture, ineligible],
  ["later exact evidence decides", text, { passages: [undefined, exactPassage] }, capture, true],
  ["an inherited passage does not count as evidence", text,
    { passages: Object.setPrototypeOf(Array(1), [exactPassage]) }, capture, ineligible],
  ["capture checks containment", text, { passages: [contained] }, capture, true],
  ["capture checks enabled vectors", text, { passages: [near] }, { ...capture, ...vectorPolicy }, true],
  ["capture ignores disabled vectors", text, { passages: [near] }, capture, false],
  ["capture recognizes an edit's old wording by containment", editFact, { passages: [contained], sourceMemory: edit }, capture, true],
  ["explicit single passage uses exact matching", text, { passages: [contained] }, explicit, false],
  ["explicit single passage needs shingles", text, { passages: [{ ...passage, shingles: null }] }, explicit, ineligible],
  ["explicit single passage permits different known shingle keys", text,
    { passages: [{ ...passage, keyId: "fake-rotated-key" }] }, explicit, false],
  ["explicit aliases can match containment", text, { passages: [passage, contained] }, explicit, true],
  ["explicit aliases skip vector comparisons", text, { passages: [passage, near] }, { ...explicit, ...vectorPolicy }, false],
  ["explicit own edit exempts paraphrase", editFact, { passages: [contained], sourceMemory: edit }, explicit, false],
  ["explicit own edit needs comparable evidence", editFact,
    { passages: [{ ...passage, digests: [digest("b", "hmac")] }], sourceMemory: edit }, explicit, ineligible],
  ["explicit own edit still blocks exact wording", editFact, { passages: [exactPassage], sourceMemory: edit }, explicit, true],
  ["explicit edit with invalid incarnation", editFact, { passages: [contained], sourceMemory: { id: memoryId } }, explicit, ineligible],
  ["explicit active key unavailable", editFact, { passages: [contained] }, { ...explicit, key: null }, ineligible],
  ["explicit active key mismatch", editFact, { passages: [contained] }, { ...explicit, key: { id: "different" } }, ineligible],
  ["explicit empty candidate shingles still need an active key", editFact,
    { passages: [{ ...passage, shingles: [], keyId: null }] }, { ...explicit, key: null }, ineligible],
  ["explicit empty stored shingles still need a matching active key",
    { ...editFact, text: { ...reference, shingles: [] } }, { passages: [passage] }, { ...explicit, key: { id: "different" } }, ineligible],
  ["explicit fallback cannot clear another alias with unavailable containment evidence", editFact,
    { passages: [{ ...passage, shingles: [] }, contained] }, { ...explicit, key: null }, ineligible],
]) {
  test(`incoming: ${label}`, () => {
    assert.equal(factBlocksIncoming(store(fact), { scope, passages: [], ...input }, policy), want);
  });
}

test("vector suppression and near-duplicate distances are separate exports", async () => {
  const direct = await import("../src/privacy/fact-match.mjs");
  assert.equal(SUPPRESSION_DISTANCE, 0.20);
  assert.equal(NEAR_DUPLICATE_DISTANCE, 0.08);
  assert.equal(direct.SUPPRESSION_DISTANCE, SUPPRESSION_DISTANCE);
  assert.equal(direct.NEAR_DUPLICATE_DISTANCE, NEAR_DUPLICATE_DISTANCE);
});

for (const [label, stored, candidate, key] of [
  ["rotated active key with empty stored shingles", { keyId: "old", shingles: [] },
    { keyId: "new", shingles: ["aa"] }, { id: "new" }],
  ["null active key with empty candidate shingles", { keyId: "k", shingles: ["aa"] },
    { keyId: "k", shingles: [] }, null],
]) {
  test(`explicit save denies ${label}`, () => {
    const fact = store({ ...editFact, sourceMemory: { id: "m", createdAtMs: 42 }, text: { ...reference, ...stored } });
    const incoming = { scope, passages: [{ ...passage, ...candidate }] };
    assert.equal(factBlocksIncoming(fact, incoming, { ...explicit, key }), ineligible);
  });
}

const rotatedReference = { ...reference, keyId: "old", shingles: [] };
const rotatedPassage = { ...passage, keyId: "new", shingles: ["aa"] };
const rotatedKey = { id: "new" };

test("an exempt edit clears a comparable digest miss after key rotation", () => {
  const sourceMemory = { id: "m", createdAtMs: 42 };
  const fact = store({ ...editFact, sourceMemory, text: rotatedReference });
  const passages = [rotatedPassage];
  assert.deepEqual([
    factBlocksIncoming(fact, { scope, passages, sourceMemory }, { ...explicit, key: rotatedKey }),
    blocksMemoryPassage(passages, [fact.fact], rotatedKey, undefined, sourceMemory),
  ], [false, false]);
});

test("a single-passage explicit save clears a comparable digest miss against a forget fact after key rotation", () => {
  const fact = store({ ...text, text: rotatedReference });
  const passages = [rotatedPassage];
  assert.deepEqual([
    factBlocksIncoming(fact, { scope, passages }, { ...explicit, key: rotatedKey }),
    blocksMemoryPassage(passages, [fact.fact], rotatedKey),
  ], [false, false]);
});

for (const [label, unavailable] of [["null", { shingles: null }], ["missing", {}]]) {
  for (const [side, stored, candidate] of [
    ["stored", unavailable, { shingles: [] }],
    ["candidate", { shingles: [] }, unavailable],
  ]) {
    test(`full comparison denies ${label} ${side} shingles against an empty list`, () => {
      const fact = store({ ...text, text: { digests: reference.digests, keyId: "k", ...stored } });
      const candidatePassage = { digests: passage.digests, keyId: "k", ...candidate };
      assert.equal(factHidesRow(store(text), { ...baseRow, ...passage, shingles: [] }), false);
      assert.deepEqual([
        factHidesRow(fact, { ...baseRow, ...candidatePassage }),
        factBlocksIncoming(fact, { scope, passages: [candidatePassage] }, capture),
      ], [ineligible, ineligible]);
    });
  }
}

test("containment includes seven of a hundred shingles at a 0.07 threshold", () => {
  const candidate = { ...passage, shingles: shingles.slice(0, 7) };
  const policy = { containmentThreshold: 0.07 };
  assert.equal(factHidesRow(store(text), { ...baseRow, ...passage, shingles: shingles.slice(0, 6) }, policy), false);
  assert.equal(factHidesRow(store(text), { ...baseRow, ...candidate }, policy), true);
});

test("a tiny positive containment threshold still misses disjoint shingles", () => {
  const fact = store({ ...text, text: { ...reference, shingles: ["aa"] } });
  const candidate = { ...passage, shingles: ["bb"] };
  const containmentThreshold = 1e-13;
  assert.deepEqual([
    factHidesRow(fact, { ...baseRow, ...candidate }, { containmentThreshold }),
    factBlocksIncoming(fact, { scope, passages: [candidate] }, { ...capture, containmentThreshold }),
    withholdsPassage(candidate, fact.fact, containmentThreshold),
  ], [false, false, false]);
});

function recordedPassage({ sha, mac, taggedMac, ...fields }) {
  const digests = [];
  if (sha) digests.push(digest(sha));
  if (mac || taggedMac) digests.push(digest(mac ?? taggedMac, "hmac"));
  return { ...fields, digests };
}

// The hosted helpers return boolean. At admission and read time a core
// ineligible result withholds just as a positive hosted result does.
const denies = (result) => result !== false;
for (const row of withholding) {
  test(`recorded withholding decision: ${row.id}`, () => {
    const passages = row.passages.map(recordedPassage);
    const facts = row.facts.map(({ origin = "forget", mode = "full", sourceMemory, ...fields }) =>
      store({ kind: "text", mode, origin, sourceMemory, text: recordedPassage(fields) }));
    const incoming = { scope, passages, sourceMemory: row.edit };
    const explicitPolicy = { ...explicit, key: row.key ? { id: row.key } : null };
    assert.deepEqual(passages.map((candidate) => facts.map((fact) => denies(factHidesRow(fact, { ...baseRow, ...candidate })))),
      row.expected.comparison);
    assert.equal(facts.some((fact) => denies(factBlocksIncoming(fact, incoming, capture))), row.expected.any);
    assert.equal(facts.some((fact) => denies(factBlocksIncoming(fact, incoming, explicitPolicy))), row.expected.memory);
  });
}

const legacyKey = await userFingerprintKey(FAKE_MASTER, OWNERS[0], labels);

function hostedDigests({ text_hash, text_hmac }, key = legacyKey.id) {
  const digests = [];
  if (text_hash?.startsWith("hmac:")) digests.push({ ...digest("a", "hmac"), value: text_hash.slice(5), keyId: key });
  else if (text_hash) digests.push({ ...digest("a"), value: text_hash });
  if (text_hmac) digests.push({ ...digest("a", "hmac"), value: text_hmac, keyId: key });
  return digests;
}

async function hostedPassage(input) {
  const mac = await fingerprintLegacyCapture(input, legacyKey, labels);
  const text_hash = createHash("sha256").update(normalizeForHash(input)).digest("hex");
  return { digests: hostedDigests({ text_hash, ...mac }), shingles: mac.shingles, keyId: mac.key_id };
}

for (const vector of cases) {
  const row = expected[vector.id];
  if (row.withholdsPassage) test(`hosted recorded text containment: ${vector.id}`, async () => {
    const fact = store({ ...text, text: await hostedPassage(decodeUtf16(vector.containmentReference)) });
    const candidate = await hostedPassage(inputOf(vector));
    const { withholds, threshold } = row.withholdsPassage;
    assert.equal(factHidesRow(fact, { ...baseRow, ...candidate }, { containmentThreshold: threshold }), withholds);
    assert.equal(factBlocksIncoming(fact, { scope, passages: [candidate] }, capture), withholds);
  });

  if (row.history) test(`hosted recorded exact aliases: ${vector.id}`, async () => {
    const original = cleanContent(inputOf(vector)).normalize("NFKC");
    const inputs = { original, v1: redactV1(original), current: redactHostedCurrent(original) };
    const facts = row.history.variants.map((variant) => store({ ...exact, text: { digests: hostedDigests(variant) } }));
    for (const [pipeline, input] of Object.entries(inputs)) {
      const candidate = await hostedPassage(input);
      const matched = facts.flatMap((fact, index) =>
        factBlocksIncoming(fact, { scope, passages: [candidate] }, explicit) === true ? [index] : []);
      assert.deepEqual(matched, row.history.exactPassageMatch[pipeline]);
    }
    const wrongKey = { digests: [], shingles: row.history.wrongKeyLast.shingles, keyId: row.history.wrongKeyId };
    const stored = row.history.variants[row.history.exactPassageMatch.stored[0]];
    const fact = store({ ...text, text: { digests: hostedDigests(stored), shingles: [], keyId: legacyKey.id } });
    assert.equal(factBlocksIncoming(fact, { scope, passages: [wrongKey] }, capture), ineligible);
  });

  if (row.storedFact) test(`hosted recorded stored digest: ${vector.id}`, async () => {
    const { text_hash, key_id } = row.storedFact;
    const fact = store({ ...exact, text: { digests: hostedDigests({ text_hash }, key_id) } });
    assert.equal(factBlocksIncoming(fact, { scope, passages: [await hostedPassage(inputOf(vector))] }, explicit), true);
  });
}
