import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { runCase } from "@cairn-ink/conformance";
import { INSPECT_CASES } from "@cairn-ink/conformance/inspect";

const factory = {
  name: "memory inspect",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, harness: adapter.harness, sessionRefs: "plain",
      nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const inspectCase of INSPECT_CASES) {
  test(`${inspectCase.id} ${inspectCase.title}`, async () => {
    assert.equal(await runCase(factory, inspectCase), null);
  });
}
