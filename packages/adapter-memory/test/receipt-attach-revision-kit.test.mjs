import assert from "node:assert/strict";
import { test } from "node:test";
import { CASES, runCase } from "@cairn-ink/conformance";
import * as kit from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const all = Object.values(kit).filter(Array.isArray).flat();
const find = (/** @type {string} */ id) => {
  const testCase = all.find((entry) => entry.id === id);
  assert.ok(testCase, id);
  return testCase;
};
const touchCase = CASES.find(({ id }) => id === "K-MEM-4");
const rationaleCase = find("T-RAT-receipt-add");
const historicalCase = find("K-REL-10");

/**
 * A memory store that reports addendum 18's receipt-attach behaviour through its results. The reference adapter's own
 * implementation lands with the core change; this wrapper stands in for a store that has it.
 * @param {{ advances?: boolean, flag?: boolean, receiptIds?: (count: number) => unknown }} options
 */
function attachFactory({ advances = true, flag = true, receiptIds = (count) => Array.from({ length: count }, (_, i) => `r${i}`) } = {}) {
  const base = rawFactory();
  return {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { adapter } = opened;
      const { touchDuplicate } = adapter.memories;
      const memories = {
        ...adapter.memories,
        async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
          const before = await adapter.hydrate.hydrate(tx, { owner: scope.owner, namespaces: [scope.namespace] },
            [{ type: "memory", namespace: scope.namespace, id }], "read").catch(() => []);
          const known = new Set((before[0]?.receipts ?? []).map((r) => `${r.client}\u0000${r.sessionId}\u0000${r.messageId}`));
          const result = await touchDuplicate.call(adapter.memories, tx, scope, id, receipts, merge, nowMs);
          const added = receipts.some((r) => !known.has(`${r.client}\u0000${r.sessionId}\u0000${r.messageId}`));
          const bumped = advances && added && result.outcome === "touched"
            ? { outcome: "changed", revision: result.revision + 1 } : result;
          return { ...bumped, receiptIds: receiptIds(receipts.length) };
        },
      };
      return {
        ...opened,
        adapter: { ...adapter, memories, capabilities: { ...adapter.capabilities, receiptAttachAdvancesRevision: flag } },
      };
    },
  };
}

test("K-MEM-4 accepts a store that advances the revision for a newly attached receipt under the flag", async () => {
  assert.ok(touchCase);
  assert.equal(await runCase(attachFactory(), touchCase), null);
});

test("K-MEM-4 keeps the touched expectation when the flag is off, even with receiptIds", async () => {
  assert.ok(touchCase);
  assert.equal(await runCase(attachFactory({ advances: false, flag: false }), touchCase), null);
});

test("K-MEM-4 rejects a store that claims the flag but leaves the revision unchanged", async () => {
  assert.ok(touchCase);
  await assert.rejects(runCase(attachFactory({ advances: false }), touchCase),
    /A newly attached receipt should advance the revision once/);
});

test("K-MEM-4 rejects receiptIds that do not list one ID per attached receipt", async () => {
  assert.ok(touchCase);
  await assert.rejects(runCase(attachFactory({ receiptIds: () => [] }), touchCase),
    /receiptIds must list one stored ID per attached receipt/);
});

test("T-RAT-receipt-add expects one revision advance under the flag and none without it", async () => {
  const on = await runCase(attachFactory(), rationaleCase);
  const off = await runCase(attachFactory({ advances: false, flag: false }), rationaleCase);
  assert.deepEqual([on, off], [null, null]);
  await assert.rejects(runCase(attachFactory({ advances: false }), rationaleCase), /A new receipt advances the revision once/);
});

test("K-REL-10 tolerates an empty receiptIds on a direct touch without receipts", async () => {
  assert.equal(await runCase(attachFactory({ advances: false, flag: false }), historicalCase), null);
});
