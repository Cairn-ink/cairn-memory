import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_CASES, runCase } from "@cairn-ink/conformance";

test("K-FACT-2 rejects a fact conflict error that lacks an own code", async () => {
  const testCase = PRIVACY_CASES.find(({ id }) => id === "K-FACT-2");
  assert.ok(testCase);
  const factory = {
    name: "memory error shape mutant",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities });
      const { uow, harness, nativeErrorMap } = adapter;
      return {
        adapter: {
          ...adapter,
          uow: {
            async run(owner, options, fn) {
              try {
                return await uow.run(owner, options, fn);
              } catch (error) {
                if (error.code === "fact_conflict") throw new Error("fact_conflict");
                throw error;
              }
            },
          },
        },
        harness,
        nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      };
    },
  };

  await assert.rejects(runCase(factory, testCase), { message: "Expected CoreError fact_conflict" });
});
