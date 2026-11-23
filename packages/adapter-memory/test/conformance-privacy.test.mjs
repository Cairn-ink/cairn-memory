import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_CASES, runCase } from "@cairn-ink/conformance";

for (const sessionRefs of ["plain", "hashed"]) {
  const factory = {
    name: `memory privacy (${sessionRefs})`,
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, sessionRefs });
      return {
        adapter,
        sessionRefs,
        harness: adapter.harness,
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      };
    },
  };

  for (const testCase of PRIVACY_CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
      const reason = await runCase(factory, testCase);
      if (reason !== null) t.skip(reason);
    });
  }
}
