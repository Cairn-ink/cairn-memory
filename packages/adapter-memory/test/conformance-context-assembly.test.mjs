import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { CONTEXT_ASSEMBLY_CASES } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../src/index.mjs";

const factory = {
  name: "memory-context-assembly",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "plain", async close() {},
    };
  },
};

for (const candidate of CONTEXT_ASSEMBLY_CASES) {
  test(`${candidate.id} ${candidate.title}`, async () => {
    assert.equal(await runCase(factory, candidate), null);
  });
}
