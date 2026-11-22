import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  CAPABILITIES, CoreError, ERROR_CODES, ERROR_KINDS, FORGET_POLICY, FUSION_PRESETS, NEAR_DUPLICATE_DISTANCE,
  assertAdapterCapabilities, capabilities, compareSortKey, compareUtf8, factBody, requireCapability, toCoreError, validateSuppressionFact,
} from "../src/index.mjs";

const src = new URL("../src/", import.meta.url).pathname;

test("every error code maps to a known kind, and the message is the code only", () => {
  for (const [code, kind] of Object.entries(ERROR_CODES)) {
    assert.ok(ERROR_KINDS.includes(kind), code);
    const error = new CoreError(code);
    assert.equal(error.message, code);
    assert.equal(error.retryable, kind === "retryable");
  }
  assert.throws(() => new CoreError("made_up"), TypeError);
});

test("toCoreError never copies a foreign message", () => {
  const wrapped = toCoreError(new Error("SELECT secret FROM users WHERE text = 'my password'"));
  assert.equal(wrapped.message, "internal_error");
  assert.equal(toCoreError(new Error("x"), {}, "storage_busy").retryable, true);
  const pg = Object.assign(new Error("deadlock detected"), { code: "40P01" });
  assert.equal(toCoreError(pg, { "40P01": "storage_busy" }).code, "storage_busy");
  assert.equal(toCoreError(Object.assign(new Error("x"), { code: "memory_suppressed" })).kind, "denied");
  assert.equal(toCoreError(Object.assign(new Error("x"), { code: "constructor" })).code, "internal_error");
});

test("prototype property names are not error codes", () => {
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.throws(() => new CoreError(name), TypeError, name);
  }
});

test("adapter capability check runs both directions", () => {
  const base = { capabilities: capabilities({}) };
  assertAdapterCapabilities(base);
  assert.throws(() => assertAdapterCapabilities({ ...base, raw: {} }), { code: "capability_unavailable" });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({ rawArchive: true }) }), { code: "capability_unavailable" });
  assertAdapterCapabilities({ capabilities: capabilities({ rawArchive: true, sessionLineage: true }), raw: {}, sessionLineage: {} });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({ spanLineage: true }) }), { code: "capability_unavailable" });
  assert.throws(() => assertAdapterCapabilities({ capabilities: capabilities({}), sessionLineage: {} }), { code: "capability_unavailable" });
});

test("capabilities default to false, reject unknown names, and requireCapability fails closed", () => {
  const caps = capabilities({ nearDuplicate: true });
  assert.equal(caps.nearDuplicate, true);
  assert.equal(caps.vectorSuppression, false);
  assert.equal(Object.keys(caps).length, CAPABILITIES.length);
  assert.throws(() => capabilities({ teleport: true }), { code: "invalid_input" });
  assert.throws(() => requireCapability(caps, "relations"), { code: "capability_unavailable" });
  requireCapability(caps, "nearDuplicate");
});

const base = { owner: "u1", actionId: "a1", origin: "forget" };
const hex = (c) => c.repeat(64);
const sha = (pipeline = "core", c = "a") => ({ alg: "sha256", value: hex(c), pipeline, redactionVersion: 2, keyId: null });
const mac = (c = "b") => ({ alg: "hmac", value: hex(c), pipeline: "core", redactionVersion: 2, keyId: "k1" });

test("SuppressionFact validation accepts each kind and rejects malformed facts", () => {
  validateSuppressionFact({ ...base, kind: "identity", memoryId: "m1" });
  validateSuppressionFact({ ...base, origin: "edit", kind: "identity", memoryId: "m1", throughRevision: 3 });
  validateSuppressionFact({ ...base, kind: "text", mode: "full", text: { digests: [mac(), sha("hosted-v1", "c"), { ...sha("engine-legacy", "d"), redactionVersion: 1 }], shingles: ["ab12"], embedding: [0.1], keyId: "k1" } });
  validateSuppressionFact({ ...base, origin: "edit", kind: "text", mode: "exact", text: { digests: [sha()], shingles: ["ab"], embedding: [0.2] }, sourceMemory: { id: "m1", createdAtMs: 5 } });
  validateSuppressionFact({ ...base, kind: "session", session: { client: "claude-code", sessionId: "s1" } });
  validateSuppressionFact({ ...base, kind: "session", session: { client: "claude-code", sessionKeyHash: hex("e") } });
  validateSuppressionFact({ ...base, kind: "window", client: null, window: { startMs: -5, endMs: 2 }, unknownTime: true, anchor: "pm30min" });
  validateSuppressionFact({ ...base, kind: "rawSpan", sessionKeyHash: hex("1"), messageKey: "msg-1", startUtf16: 0, endUtf16: 10, contentDigest: hex("2") });
  const bad = [
    [{ ...base, kind: "text", mode: "full", text: { digests: [] } }, "invalid_input"],
    [{ ...base, kind: "text", mode: "full", text: { digests: [sha(), sha()] } }, "invalid_input"],
    [{ ...base, kind: "text", mode: "full", text: { digests: [{ ...mac(), keyId: null }] } }, "invalid_input"],
    [{ ...base, kind: "text", mode: "full", text: { digests: [{ ...sha(), pipeline: "guess" }] } }, "invalid_input"],
    [{ ...base, kind: "session", session: { client: "c", sessionId: "s", sessionKeyHash: hex("e") } }, "invalid_input"],
    [{ ...base, kind: "session", session: { client: "c" } }, "invalid_input"],
    [{ ...base, kind: "window", client: null, window: { startMs: 5, endMs: 5 } }, "invalid_window"],
    [{ ...base, kind: "rawSpan", sessionKeyHash: hex("1"), messageKey: "m", startUtf16: 4, endUtf16: 4, contentDigest: hex("2") }, "invalid_input"],
    [{ ...base, kind: "identity", memoryId: "m", throughRevision: -1 }, "invalid_input"],
    [{ ...base, origin: "guess", kind: "identity", memoryId: "m" }, "invalid_input"],
  ];
  for (const [fact, code] of bad) assert.throws(() => validateSuppressionFact(fact), { code }, JSON.stringify(fact).slice(0, 80));
});

test("factBody excludes owner and actionId and is key-order independent", () => {
  const a = factBody({ ...base, kind: "identity", memoryId: "m1", throughRevision: 2 });
  const b = factBody({ throughRevision: 2, memoryId: "m1", kind: "identity", origin: "forget", owner: "other", actionId: "other" });
  assert.equal(a, b);
  assert.ok(!a.includes("u1") && !a.includes("a1"));
});

test("pinned decisions match the recorded product decisions", () => {
  assert.equal(NEAR_DUPLICATE_DISTANCE, 0.08);
  assert.deepEqual([...FORGET_POLICY.withoutKey], ["exact", "lineage"]);
  assert.deepEqual({ ...FUSION_PRESETS.hosted, tieBreak: [...FUSION_PRESETS.hosted.tieBreak] },
    { k: 60, lexicalWeight: 0.5, vectorWeight: 1, pool: 50, tieBreak: ["updatedAt:desc", "id:desc"] });
});

const BANNED = [
  ["node: specifier", /["'`]node:/u],
  ["fs import", /from\s+["'`]fs["'`]/u],
  ["child_process", /child_process/u],
  ["sqlite import", /(?:from|import)\s*\(?\s*["'`][^"'`]*sqlite/iu],
  ["pg driver", /from\s+["'`]pg["'`]/u],
  ["require", /\brequire\s*\(/u],
  ["Buffer", /\bBuffer\b/u],
  ["process global", /\bprocess\s*\./u],
  ["non-literal dynamic import", /\bimport\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))/u],
  ["relative import leaving src", /from\s+["'`]\.\.\/\.\.\//u],
];

/** @param {string} text */
const violations = (text) => BANNED.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);

test("core source has no host or storage imports (closure rule)", () => {
  const files = readdirSync(src, { recursive: true }).filter((f) => /\.(mjs|d\.ts|d\.mts)$/u.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.deepEqual(violations(readFileSync(join(src, file), "utf8")), [], file);
  }
});

test("the closure rule catches each banned form (negative control)", () => {
  for (const [name, sample] of [
    ["node: specifier", 'import { readFileSync } from "node:fs";'],
    ["fs import", "import fs from 'fs';"],
    ["sqlite import", 'import Database from "better-sqlite3";'],
    ["require", "const x = require('y');"],
    ["Buffer", "Buffer.from('x');"],
    ["process global", "const v = process.env.X;"],
    ["non-literal dynamic import", "await import(name);"],
    ["relative import leaving src", 'import x from "../../adapters/x.mjs";'],
  ]) {
    assert.ok(violations(sample).includes(name), name);
  }
  assert.deepEqual(violations('const m = await import("./local.mjs");'), []);
});

test("compareUtf8 orders by UTF-8 bytes, not UTF-16 code units", () => {
  // U+FF5E (3 bytes) vs U+1F600 (4 bytes, a surrogate pair in UTF-16): UTF-16 puts the emoji first.
  assert.equal(compareUtf8("～", "\u{1f600}"), -1);
  assert.equal(compareUtf8("a", "a"), 0);
  assert.equal(compareUtf8("ab", "a"), 1);
  assert.equal(compareSortKey(1700000000000001n, 1700000000000000n), 1);
});
