import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RELATION_HINT_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory",
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

for (const testCase of RELATION_HINT_CASES) {
  test(`memory ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
