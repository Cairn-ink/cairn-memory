import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase } from "@cairn-ink/conformance";
import { DOCUMENT_CARD_VISIBILITY_INPUT_CASES } from "@cairn-ink/conformance/document-card-visibility-input";

function factory(visibilityInputs = true) {
  return {
    name: "card visibility inputs",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      if (!visibilityInputs) delete adapter.documentCards.visibilityInputs;
      return {
        adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

for (const testCase of DOCUMENT_CARD_VISIBILITY_INPUT_CASES) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory(), testCase), null);
    assert.equal(await runCase(factory(false), testCase), "needs documentCards.visibilityInputs");
  });
}
