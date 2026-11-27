import assert from "node:assert/strict";
import { test } from "node:test";
import { factBlocksIncoming, factHidesRow, prepareRowMatcher, prepareRowMatchFact } from "../src/privacy/fact-match.mjs";

const scope = { owner: "fixture-owner", namespace: null };
const window = { ...scope, kind: "window", actionId: "fixture-action", origin: "forget",
  client: null, window: { startMs: 10, endMs: 20 } };
const anchored = { ...window, anchor: "pm30min" };
const unknown = { ...anchored, unknownTime: true, origin: "correct" };
const row = { scope, source: { client: "fixture-client", occurredAtMs: 15 } };
const memory = { ...row, type: "memory", memoryId: "fixture-memory", revision: 2 };
const raw = { ...row, type: "raw", sessionKeyHash: "b".repeat(64), messageKey: "fixture-message",
  startUtf16: 0, endUtf16: 10 };
const at = (candidate, occurredAtMs) => ({ ...candidate, source: { ...candidate.source, occurredAtMs } });
const store = fact => ({ fact, factId: "fixture-fact", incarnation: "a".repeat(64), epoch: 1n, createdAtMs: 0 });

for (const [name, fact, candidate, expected] of [
  ["an explicit window leaves a replacement inside it visible", anchored, memory, false],
  ["an explicit window leaves a neighboring memory inside it visible", unknown, { ...memory, revision: 1 }, false],
  ["an explicit window leaves a memory with null time visible", unknown, at(memory, null), false],
  ["an explicit window leaves a memory without time evidence visible", anchored, at(memory, undefined), false],
  ["an explicit window still withholds Raw inside it", anchored, raw, true],
  ["an explicit unknown-time window still withholds Raw with null time", unknown, at(raw, null), true],
  ["an explicit window still withholds untyped rows inside it", anchored, row, true],
  ["a legacy window still withholds memories inside it", window, memory, true],
  ["a legacy window still withholds Raw inside it", window, raw, true],
  ["a legacy window still withholds untyped rows inside it", window, row, true],
]) {
  test(name, () => {
    const stored = store(fact);
    assert.equal(factHidesRow(stored, candidate), expected, "direct matching");
    assert.equal(prepareRowMatcher(candidate)(prepareRowMatchFact(stored)), expected, "prepared matching");
  });
}

test("an explicit window still blocks capture admission", () => {
  const policy = { mode: "capture" };
  assert.equal(factBlocksIncoming(store(anchored), { scope, passages: [], occurredAtMs: 15 }, policy), true);
  assert.equal(factBlocksIncoming(store(unknown), { scope, passages: [], occurredAtMs: null }, policy), true);
});
