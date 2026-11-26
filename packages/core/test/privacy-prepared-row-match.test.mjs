import assert from "node:assert/strict";
import test from "node:test";
import * as matcher from "../src/privacy/fact-match.mjs";

const { factHidesRow } = matcher;
const scope = { owner: "owner", namespace: null };
const hex = digit => digit.repeat(64);
const digest = digit => ({ alg: "sha256", value: hex(digit), pipeline: "core", redactionVersion: 1, keyId: null });
const text = { digests: [digest("a")], keyId: "key", shingles: ["01", "02"], embedding: [1, 0] };
const full = { kind: "text", mode: "full", text };
const cutoff = { ...full, explicitSaveExemptAfterUs: "10" };
const exact = { ...full, mode: "exact" };
const session = { kind: "session", session: { client: "client", sessionId: "session" } };
const stored = fact => ({ fact: { ...scope, actionId: "action", origin: "forget", ...fact } });
const row = {
  type: "memory", scope, memoryId: "memory", revision: 2, sourceKind: "mcp", createdAtUs: 11n,
  digests: [digest("b")], keyId: "key", shingles: ["03", "04"], embedding: [0, 1],
  source: { client: "client", sessionId: "session", occurredAtMs: 10 },
};
const throwing = () => { throw new Error("hostile evidence"); };
const getter = (object, key) => Object.defineProperty({ ...object }, key, { get: throwing });
const descriptorsOnly = object => new Proxy(object, { get: throwing, getPrototypeOf: throwing, ownKeys: throwing });
const revoked = () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
};

test("prepared matching agrees with the original matcher for every corpus combination", (t) => {
  const facts = [
    ...[null, "room", undefined].flatMap(namespace => [
      full, cutoff, exact, session,
      { ...session, session: { client: "client", sessionKeyHash: hex("a") } },
      { kind: "identity", memoryId: "memory" },
      { kind: "identity", memoryId: "memory", throughRevision: 1 },
      { kind: "window", client: "client", window: { startMs: 0, endMs: 20 }, unknownTime: true },
      { kind: "rawSpan", sessionKeyHash: hex("a"), messageKey: "message", startUtf16: 0, endUtf16: 5, contentDigest: hex("b") },
    ].map(fact => stored({ ...fact, namespace }))),
    stored({ ...full, owner: "foreign" }), stored({ ...full, mode: "unknown" }),
    stored({ ...full, text: { ...text, shingles: ["invalid"] } }),
    stored({ ...full, text: { ...text, embedding: new Float32Array([1, 0]) } }),
    stored({ ...full, text: { ...text, embedding: [Infinity, 0] } }),
    stored({ ...session, session: { ...session.session, sessionKeyHash: undefined } }),
    stored({ ...session, session: { ...session.session, sessionKeyHash: null } }),
    stored({ ...cutoff, explicitSaveExemptAfterUs: "01" }),
    stored({ ...full, text: getter(text, "digests") }), getter(stored(full), "fact"),
    { fact: descriptorsOnly(stored(full).fact) }, descriptorsOnly(stored(full)),
    { fact: Object.assign(new class Fact {}, stored(full).fact) },
    { fact: Object.create(stored(full).fact) }, { fact: undefined }, {}, null, revoked(),
    new Proxy(stored(full), { getOwnPropertyDescriptor: throwing }),
  ];
  const rows = [
    ...[scope, { ...scope, namespace: "room" }, { ...scope, namespace: undefined }, { owner: "foreign", namespace: null }]
      .flatMap(scope => [
        row, { ...row, digests: text.digests }, { ...row, shingles: text.shingles },
        { ...row, embedding: new Float32Array([1, 0]) }, { ...row, embedding: new Float64Array([1, 0]) },
        { ...row, embedding: [NaN, 0] }, { ...row, digests: [] },
        { ...row, source: { client: "client", sessionKeyHash: hex("a"), occurredAtMs: null } },
      ].map(row => ({ ...row, scope }))),
    { ...row, createdAtUs: 10n, embedding: text.embedding },
    { ...row, sourceKind: undefined, embedding: text.embedding },
    { ...row, embedding: new Proxy(new Float32Array([1, 0]), {}) },
    { ...row, scope: Object.create(scope) }, { ...row, scope: undefined }, {},
    { ...row, digests: descriptorsOnly(row.digests) }, { ...row, source: getter(row.source, "client") },
    getter(row, "shingles"), getter(row, "createdAtUs"), descriptorsOnly(row),
    Object.assign(new class Row {}, row), Object.create(row),
    { type: "raw", scope, sessionKeyHash: hex("a"), messageKey: "message", startUtf16: 3, endUtf16: 8 },
    { type: "raw", scope, sessionKeyHash: hex("a"), messageKey: "message", startUtf16: 3, endUtf16: 3 },
    null, undefined, revoked(), new Proxy(row, { getOwnPropertyDescriptor: throwing }),
  ];
  const policies = [
    undefined, {}, { rowShingles: undefined }, { rowShingles: false }, { rowShingles: true },
    { vectorSuppression: true, rowShingles: false }, { vectorSuppression: true },
    { vectorSuppression: true, suppressionDistance: undefined }, { vectorSuppression: null },
    { rowShingles: 0 }, { containmentThreshold: NaN }, { hashSessionKey: () => hex("a") },
    { hashSessionKey: throwing }, getter({}, "vectorSuppression"), getter({}, "rowShingles"),
    descriptorsOnly({ rowShingles: false, vectorSuppression: true }),
    Object.create({ rowShingles: false }), null, revoked(),
  ];
  const prepared = facts.map(matcher.prepareRowMatchFact);
  const verdicts = new Set();
  let count = 0;
  for (const [rowIndex, candidate] of rows.entries()) {
    for (const [policyIndex, policy] of policies.entries()) {
      const hides = matcher.prepareRowMatcher(candidate, policy);
      for (const [factIndex, fact] of facts.entries()) {
        const original = factHidesRow(fact, candidate, policy);
        assert.equal(hides(prepared[factIndex]), original, `fact ${factIndex}, row ${rowIndex}, policy ${policyIndex}`);
        verdicts.add(original);
        count++;
      }
    }
  }
  assert.equal(count, facts.length * rows.length * policies.length);
  assert.deepEqual(verdicts, new Set([true, false, "ineligible"]));
  t.diagnostic(`${count} fact–row–policy combinations`);
});

test("only a genuine prepared fact can use the saved evidence", () => {
  const original = stored({ ...exact, text: { digests: [digest("b")] } });
  const prepared = matcher.prepareRowMatchFact(original);
  const hides = matcher.prepareRowMatcher(row);
  assert.equal(hides(prepared), true);
  original.fact.text.digests[0].value = hex("a");
  assert.equal(hides(prepared), true);
  for (const forged of [
    { ...prepared, fact: original.fact, prepared: true },
    new Proxy(prepared, {}),
    Object.create(prepared),
    original,
  ]) {
    assert.equal(hides(forged), factHidesRow(forged, row));
    assert.notEqual(hides(forged), true);
  }
});

test("matching captures the fact once and the row once per requested projection", () => {
  let factReads = 0;
  const fact = matcher.prepareRowMatchFact(new Proxy(stored(full), {
    getOwnPropertyDescriptor(target, key) {
      factReads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  }));
  const withCutoff = matcher.prepareRowMatchFact(stored(cutoff));
  const exactMatch = matcher.prepareRowMatchFact(stored(exact));
  const reads = new Map();
  const candidate = new Proxy(row, {
    getOwnPropertyDescriptor(target, key) {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const hides = matcher.prepareRowMatcher(candidate, { rowShingles: false, vectorSuppression: true });
  for (let i = 0; i < 3; i++) {
    assert.equal(hides(fact), false);
    assert.equal(hides(withCutoff), false);
    assert.equal(hides(exactMatch), false);
  }
  assert.equal(factReads, 1);
  assert.equal(reads.get("scope"), 3);
  assert.equal(reads.get("shingles"), 1);
  assert.equal(reads.get("createdAtUs"), 1);
});

test("the unprepared path re-reads changing descriptors and ignores getters", () => {
  let calls = 0;
  const candidate = new Proxy(row, {
    get: throwing,
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return key === "digests" ? { ...descriptor, value: [digest(calls++ === 0 ? "a" : "b")] } : descriptor;
    },
  });
  const hides = matcher.prepareRowMatcher(candidate);
  assert.equal(hides(stored(exact)), true);
  assert.equal(hides(stored(exact)), false);
  assert.equal(calls, 2);
});
