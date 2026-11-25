import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase } from "@cairn-ink/conformance";
import { DOCUMENT_CARD_CORRECT_CASES } from "@cairn-ink/conformance/document-card-correct";

const factory = {
  name: "memory document card correction",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of DOCUMENT_CARD_CORRECT_CASES) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
