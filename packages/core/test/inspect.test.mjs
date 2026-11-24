import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { receiptExcerpt } from "../src/index.mjs";
import { createMemoryService } from "../src/service/index.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0fixture-project" };
const key = new TextEncoder().encode("synthetic signing fixture");
const storeId = "fixture-store";
const hmac = (key, bytes) => createHmac("sha256", key).update(bytes).digest();

function setup({ cursorKey = key, id = storeId } = {}) {
  const tx = { owner: scope.owner };
  const metadata = ["\uE000", "\u{10000}"].map(id => ({
    id, scope, kind: "fact", origin: "explicit", confidence: 1, revision: 3, state: "active",
    filing: { status: "unfiled" }, receiptCount: 1, createdAtMs: 1, updatedAtMs: 2, updatedAtUs: 2456n,
  }));
  let runs = 0;
  const storage = {
    capabilities: { inspect: true },
    uow: { async run(owner, options, fn) {
      assert.equal(owner, scope.owner);
      assert.deepEqual(options, { readOnly: true });
      runs++;
      return fn(tx);
    } },
    inspect: {
      async identity(actual) {
        assert.equal(actual, tx);
        return { storeId: id, cursorKey };
      },
      async list(actual, _, { after, expectedEpoch, states, limit }) {
        assert.equal(actual, tx);
        assert.deepEqual(states, ["active", "historical"]);
        if (after) {
          assert.deepEqual(after, { updatedAtUs: metadata[0].updatedAtUs, id: metadata[0].id });
          assert.equal(expectedEpoch, 9);
        }
        return { epoch: 9, rows: metadata.slice(after ? 1 : 0).slice(0, limit + 1) };
      },
      async item(actual, _, memoryId, options) {
        assert.equal(actual, tx);
        const { updatedAtUs, ...memory } = metadata[0];
        assert.equal(memoryId, memory.id);
        return {
          epoch: 9, nextAnchor: options.after ? null : { row: 42 },
          item: { memory: { ...memory, text: "Stored visible text" }, receipts: [],
            placements: [], conflicts: [], qualification: { version: 1 } },
        };
      },
    },
  };
  const clock = { async hmacHex(key, bytes) { return hmac(key, bytes).toString("hex"); } };
  return { inspect: createMemoryService({ profile: "keyless-local", storage, clock }).inspect,
    runs: () => runs };
}

function signed(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + hmac(key, body).toString("base64url");
}

test("inspect validates combinations and bounds before opening a transaction", async () => {
  const { inspect, runs } = setup();
  for (const input of [
    null, { unknown: 1 }, { memoryId: "row", states: ["active"] }, { memoryId: "row", cursor: "synthetic" },
    { includeQualification: false }, { receiptLimit: 1 }, { receiptCursor: "synthetic" }, { memoryId: "" },
    { memoryId: "row", includeQualification: 1 }, { limit: 0 }, { limit: 51 }, { limit: 1.5 },
    { memoryId: "row", receiptLimit: 0 }, { memoryId: "row", receiptLimit: 51 },
    { states: [] }, { states: ["active", "active"] }, { states: ["deleted"] }, { states: Array(1) },
  ]) await assert.rejects(inspect(scope, input), { code: "invalid_input", retryable: false });
  for (const cursor of ["", "x".repeat(8193), null, 0]) {
    await assert.rejects(inspect(scope, { cursor }), { code: "invalid_cursor", retryable: false });
  }
  assert.equal(runs(), 0);
  assert.equal((await inspect(scope, {})).exhausted, true);
  assert.equal((await inspect(scope, { limit: 50 })).exhausted, true);
});

test("inspect emits the legacy signed list payload and rejects tamper and wrong bindings", async () => {
  const { inspect } = setup();
  const first = await inspect(scope, { limit: 1, states: ["historical", "active"] });
  const payload = {
    v: 1, s: storeId,
    n: hmac(key, JSON.stringify({ ownerId: scope.owner, scope: "project", projectId: "fixture-project" })).toString("base64url"),
    o: "list", f: "filed,unfiled", l: 1, e: 9, a: { updatedAt: "1970-01-01T00:00:00.002456Z", id: "\uE000" },
  };
  assert.ok(first.nextCursor === signed(payload), "Cursor must match the independently signed legacy payload");
  const [body, signature] = first.nextCursor.split(".");
  const altered = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  for (const cursor of [
    body + "." + altered, body + "." + signature + "=", body + ".." + signature,
    signed({ ...payload, e: 0 }), signed({ ...payload, a: { ...payload.a, extra: true } }),
    signed({ ...payload, a: { ...payload.a, updatedAt: "1970-02-31T00:00:00.000Z" } }),
    signed({ ...payload, o: "get" }), signed({ ...payload, states: "historical" }), signed({ ...payload, s: "other-store" }),
  ]) await assert.rejects(inspect(scope, { limit: 1, cursor }), { code: "invalid_cursor" });
  await assert.rejects(inspect(scope, { limit: 2, cursor: first.nextCursor }), { code: "invalid_cursor" });
  await assert.rejects(inspect({ ...scope, namespace: null }, { limit: 1, cursor: first.nextCursor }), { code: "invalid_cursor" });
  await assert.rejects(setup({ cursorKey: new Uint8Array(32) }).inspect(scope, { limit: 1, cursor: first.nextCursor }),
    { code: "invalid_cursor" });
  const second = await inspect(scope, { limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.memories.map(row => row.id), ["\u{10000}"]);
});

test("receipt cursor binds memory and size while qualification can change", async () => {
  const handle = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const { inspect } = setup({ cursorKey: handle });
  const memoryId = "\uE000";
  const first = await inspect(scope, { memoryId, includeQualification: false });
  const expected = {
    v: 1, s: storeId,
    n: hmac(key, JSON.stringify({ ownerId: scope.owner, scope: "project", projectId: "fixture-project" })).toString("base64url"),
    o: "get", m: memoryId, l: 20, e: 9, a: { row: 42 },
  };
  assert.ok(first.nextReceiptCursor === signed(expected), "Item cursor must use the stored receipt position");
  assert.equal(Object.hasOwn(first, "qualification"), false);
  const second = await inspect(scope, { memoryId, receiptCursor: first.nextReceiptCursor, includeQualification: true });
  assert.deepEqual(second.qualification, { version: 1 });
  assert.equal(second.exhausted, true);
  for (const receiptCursor of [signed({ ...expected, a: { row: 0 } }), signed({ ...expected, a: { row: 42, id: memoryId } })]) {
    await assert.rejects(inspect(scope, { memoryId, receiptCursor }), { code: "invalid_cursor" });
  }
  await assert.rejects(inspect(scope, { memoryId: "other-memory", receiptCursor: first.nextReceiptCursor }), { code: "invalid_cursor" });
  await assert.rejects(inspect(scope, { memoryId, receiptLimit: 1, receiptCursor: first.nextReceiptCursor }), { code: "invalid_cursor" });
});

test("receiptExcerpt performs legacy normalization and respects UTF-16 boundaries", () => {
  const syntheticCredential = "sk-" + "f".repeat(20);
  assert.equal(receiptExcerpt("  Ａ first\t" + syntheticCredential + "\n source  "), "A first [REDACTED] source");
  assert.equal(receiptExcerpt("x".repeat(799) + "🌱").length, 799);
  assert.equal(receiptExcerpt("x".repeat(798) + "🌱" + "extra"), "x".repeat(798) + "🌱");
  assert.equal(receiptExcerpt("x".repeat(801)).length, 800);
});
