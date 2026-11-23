import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { PRIVACY_MATCH_CASES, runCase } from "@cairn-ink/conformance";

function hashSessionKey(client, sessionId) {
  return createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");
}

function memoryFactory(sessionRefs) {
  return {
    name: `memory privacy matching (${sessionRefs})`,
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, sessionRefs, hashSessionKey });
      return {
        adapter,
        sessionRefs,
        harness: { ...adapter.harness, hashSessionKey },
        nativeErrorMap: adapter.nativeErrorMap,
        busyNativeCodes: [],
        embeddingDimensions: null,
        async close() {},
      };
    },
  };
}

for (const sessionRefs of ["plain", "hashed"]) {
  const factory = memoryFactory(sessionRefs);
  for (const testCase of PRIVACY_MATCH_CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
      const reason = await runCase(factory, testCase);
      if (reason !== null) t.skip(reason);
    });
  }
}

test("vector follow-ups report a missing capability", async () => {
  const factory = memoryFactory("plain");
  for (const flag of ["vectorSuppression", "semanticRetrieval"]) {
    const limited = { ...factory, open: ({ capabilities }) =>
      factory.open({ capabilities: { ...capabilities, [flag]: false } }) };
    for (const id of ["K-HIDE-2", "K-WRITE-1"]) {
      const testCase = PRIVACY_MATCH_CASES.find((candidate) => candidate.id === id);
      assert.equal(await runCase(limited, testCase), `needs ${flag}`);
    }
  }
});

test("the hashed profile requires the factory hasher", async () => {
  const factory = memoryFactory("hashed");
  const withoutHasher = {
    ...factory,
    async open(options) {
      const opened = await factory.open(options);
      return { ...opened, harness: { ...opened.harness, hashSessionKey: undefined } };
    },
  };
  const testCase = PRIVACY_MATCH_CASES.find(({ id }) => id === "K-HASH-1");
  await assert.rejects(runCase(withoutHasher, testCase), /Hashed profile requires harness.hashSessionKey/);
});
