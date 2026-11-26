import assert from "node:assert/strict";
import { test } from "node:test";
import { factBlocksIncoming, factHidesRow, placeholderReceipt, prepareRowMatcher, prepareRowMatchFact } from "@cairn-ink/core";

const scope = { owner: "owner", namespace: null };
const client = "client";
const windowFact = {
  ...scope, kind: "window", origin: "forget", actionId: "window", client,
  window: { startMs: 10, endMs: 20 }, unknownTime: true,
};
const windows = [
  ["all-client", { fact: { ...windowFact, client: null } }],
  ["client-specific", { fact: windowFact }],
];
const rows = [
  ["Raw", { type: "raw", sessionKeyHash: "a".repeat(64), messageKey: "message", startUtf16: 0, endUtf16: 4 }],
  ["untyped", { memoryId: "memory" }],
  ["Memory", { type: "memory", memoryId: "memory" }],
];

for (const [label, stored] of windows) {
  const prepared = prepareRowMatchFact(stored);
  for (const [name, row] of rows) {
    test(`${label} window matches ${name} row times`, () => {
      for (const [source, expected] of [
        [{ client, occurredAtMs: null }, name !== "Memory"],
        [{ client, occurredAtMs: 15 }, true],
        ...(name === "Memory" ? [[{ occurredAtMs: null }, false]] : []),
      ]) {
        const candidate = { ...row, scope, source };
        assert.equal(factHidesRow(stored, candidate), expected, JSON.stringify(source));
        assert.equal(prepareRowMatcher(candidate)(prepared), expected, JSON.stringify(source));
      }
    });
  }

  for (const mode of ["capture", "explicitSave"]) {
    test(`${label} window matches incoming times in ${mode} mode`, () => {
      const incoming = { scope, session: { client, sessionId: "session" }, passages: [] };
      assert.equal(factBlocksIncoming(stored, { ...incoming, occurredAtMs: null }, { mode }), mode === "capture");
      assert.equal(factBlocksIncoming(stored, { ...incoming, occurredAtMs: 15 }, { mode }), true);
    });
  }
}

const receipt = { sessionId: "explicit-tool", occurredAtMs: null };

test("a placeholder receipt requires its own marker and null event time on a plain object", () => {
  assert.equal(placeholderReceipt(receipt), true);
  assert.equal(placeholderReceipt(Object.assign(Object.create(null), receipt)), true);
  for (const [name, input] of [
    ["finite time", { ...receipt, occurredAtMs: 0 }],
    ["other session", { ...receipt, sessionId: "session" }],
    ["missing time", { sessionId: receipt.sessionId }],
    ["missing session", { occurredAtMs: null }],
    ["inherited time", Object.assign(Object.create({ occurredAtMs: null }), { sessionId: receipt.sessionId })],
    ["inherited session", Object.assign(Object.create({ sessionId: receipt.sessionId }), { occurredAtMs: null })],
    ["array", Object.assign([], receipt)],
    ["non-object", receipt.sessionId],
    ["null", null],
  ]) {
    assert.equal(placeholderReceipt(input), false, name);
  }
});

test("the placeholder receipt check never invokes field getters", () => {
  for (const key of Object.keys(receipt)) {
    let reads = 0;
    const input = Object.defineProperty({ ...receipt }, key, { get() { reads++; return receipt[key]; } });
    assert.equal(placeholderReceipt(input), false);
    assert.equal(reads, 0);
  }
});

test("the placeholder receipt check reads own descriptors once and rejects a throwing Proxy", () => {
  const reads = [];
  const input = new Proxy(receipt, {
    getOwnPropertyDescriptor(target, key) {
      reads.push(key);
      if (key === "sessionId") throw new Error("unavailable receipt evidence");
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.equal(placeholderReceipt(input), false);
  assert.deepEqual(reads, ["occurredAtMs", "sessionId"]);
});
