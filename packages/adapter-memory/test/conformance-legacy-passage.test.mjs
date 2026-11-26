import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { LEGACY_PASSAGE_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities: { ...capabilities, vectorSuppression: true } });
    return { adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      sessionRefs: "plain", busyNativeCodes: [], embeddingDimensions: 4, async close() {} };
  },
};

for (const testCase of LEGACY_PASSAGE_CASES) {
  test(`memory ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
