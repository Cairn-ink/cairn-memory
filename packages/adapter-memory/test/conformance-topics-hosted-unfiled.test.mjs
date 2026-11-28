import assert from "node:assert/strict";
import test from "node:test";
import { TOPIC_HOSTED_UNFILED_CASES, runCase } from "@cairn-ink/conformance";
import { createMemoryAdapter } from "../src/index.mjs";

const factory = {
  name: "memory",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return { adapter, harness: adapter.harness, sessionRefs: "plain", embeddingDimensions: null,
      nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], async close() {} };
  },
};

for (const testCase of TOPIC_HOSTED_UNFILED_CASES) {
  test(`memory ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
