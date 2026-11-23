import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RELATION_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  async open({ capabilities }) {
    const ids = ["id-\u{10000}", "id-\uE000", "id-\u{10001}", "id-\uE001"];
    let index = 0;
    const adapter = createMemoryAdapter({ capabilities, newId: () => {
      const current = index++;
      return ids[current] ?? `id-${current}`;
    } });
    return {
      adapter,
      sessionRefs: "plain",
      harness: adapter.harness,
      nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [],
      embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of RELATION_CASES) {
  test(`memory ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("the relation flags expose each store and its batched read independently", () => {
  for (const [flag, field] of [["supersession", "supersession"], ["conflictEdges", "conflicts"]]) {
    const adapter = createMemoryAdapter({ capabilities: { [flag]: true } });
    assert.equal(typeof adapter[field]?.readMany, "function");
    const other = field === "supersession" ? "conflicts" : "supersession";
    assert.equal(adapter[other], undefined);
  }
});

test("memory-store exports the writeTime helper used by topics", async () => {
  const { writeTime } = await import("../src/memory-store.mjs");
  assert.equal(typeof writeTime, "function");
  assert.deepEqual(writeTime(7), { updatedAtMs: 7, updatedAtUs: 7000n });
});
