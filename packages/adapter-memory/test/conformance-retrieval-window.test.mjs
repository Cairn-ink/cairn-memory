import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { RETRIEVAL_WINDOW_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities: {
      semanticRetrieval: capabilities.semanticRetrieval ?? false,
      rawArchive: capabilities.rawArchive ?? false,
    } });
    return {
      adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "plain",
      async close() {},
    };
  },
};

for (const candidate of RETRIEVAL_WINDOW_CASES) {
  test(`${candidate.id} ${candidate.title}`, async t => {
    const skip = await runCase(factory, candidate);
    if (skip !== null) t.skip(skip);
  });
}
