import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CASES, PRIVACY_MATCH_CASES, SOURCE_FILTER_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError, factBlocksIncoming, factIncarnationBody } from "@cairn-ink/core";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const hashSessionKey = (client, id) => sha256(JSON.stringify([client, id]));

function factory({ sessionRefs = "plain", hasher = true, wrap = (adapter) => adapter } = {}) {
  return {
    name: "memory",
    async open({ capabilities }) {
      const adapter = createMemoryAdapter({ capabilities, sessionRefs, hashSessionKey });
      return {
        adapter: wrap(adapter), sessionRefs, nativeErrorMap: adapter.nativeErrorMap,
        harness: { ...adapter.harness, hashSessionKey: hasher ? hashSessionKey : undefined },
        busyNativeCodes: [], embeddingDimensions: null, async close() {},
      };
    },
  };
}

const memoryCase = CASES.find(({ id }) => id === "K-MEM-13");
test("K-MEM-13 runs with the hashed-only session fixture", async () => {
  assert.equal(await runCase(factory({ sessionRefs: "hashed" }), memoryCase), null);
});

test("K-MEM-13 records a skip when the hashed fixture has no hasher", async () => {
  assert.equal(await runCase(factory({ sessionRefs: "hashed", hasher: false }), memoryCase),
    "hashed session fixtures require harness.hashSessionKey");
});

function definiteMatchesOnly(adapter) {
  return {
    ...adapter,
    suppressions: {
      ...adapter.suppressions,
      async snapshot(tx, scope, candidates) {
        const snapshot = await adapter.suppressions.snapshot(tx, scope, candidates);
        const { passages } = candidates;
        if (passages === undefined) return snapshot;
        return { ...snapshot, passages: snapshot.passages.filter((stored) =>
          factBlocksIncoming(stored, { scope, passages }, { mode: "capture" }) === true) };
      },
    },
  };
}

test("K-SNAP-F1 rejects a snapshot that keeps only definite passage matches", async () => {
  const testCase = PRIVACY_MATCH_CASES.find(({ id }) => id === "K-SNAP-F1");
  assert.equal(await runCase(factory(), testCase), null);
  await assert.rejects(runCase(factory({ wrap: definiteMatchesOnly }), testCase), /retain an ineligible passage fact/);
});

function requiresCanonicalIncarnation(adapter) {
  return {
    ...adapter,
    suppressions: {
      ...adapter.suppressions,
      async writeFact(tx, fact, incarnation) {
        if (incarnation !== sha256(factIncarnationBody(fact))) throw new CoreError("invalid_input");
        return adapter.suppressions.writeFact(tx, fact, incarnation);
      },
    },
  };
}

for (const sessionRefs of ["plain", "hashed"]) {
  test(`K-SRC-3 runs against a canonical incarnation check with ${sessionRefs} session references`, async () => {
    const testCase = SOURCE_FILTER_CASES.find(({ id }) => id === "K-SRC-3");
    assert.equal(await runCase(factory({ sessionRefs, wrap: requiresCanonicalIncarnation }), testCase), null);
  });
}
