import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PROCEDURAL_TAG_CASES, RECEIPT_ID_CASES, runCase } from "@cairn-ink/conformance";

function factory(proceduralTags) {
  return {
    name: "memory",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities: { ...capabilities, proceduralTags } });
      return {
        adapter, harness: adapter.harness, sessionRefs: "plain",
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

for (const testCase of [...PROCEDURAL_TAG_CASES, ...RECEIPT_ID_CASES]) {
  const enabled = !testCase.needsOff?.includes("proceduralTags");
  test(`${testCase.id} ${testCase.title}`, async t => {
    const reason = await runCase(factory(enabled), testCase);
    assert.equal(reason, testCase.pending ?? null);
    if (reason !== null) t.skip(reason);
  });
}
