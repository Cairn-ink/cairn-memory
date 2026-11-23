import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CAPTURE_CASES, runCase } from "@cairn-ink/conformance";

const factory = {
  name: "memory capture",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities, now: () => 0 });
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

for (const testCase of CAPTURE_CASES) {
  test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
    const reason = await runCase(factory, testCase);
    if (reason !== null) t.skip(reason);
  });
}
