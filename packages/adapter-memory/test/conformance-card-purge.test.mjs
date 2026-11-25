import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DOCUMENT_CARD_PURGE_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory document card purge",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return { adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, async close() {} };
  },
};

for (const testCase of DOCUMENT_CARD_PURGE_CASES) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
