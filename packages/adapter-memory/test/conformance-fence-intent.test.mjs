import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilities } from "@cairn-ink/core";
import { FENCE_INTENT_CASES, runCase } from "@cairn-ink/conformance";
import { createMemoryStore } from "../src/memory-store.mjs";
import { createRetrievalPorts } from "../src/retrieval.mjs";
import { createUnitOfWork } from "../src/unit-of-work.mjs";

const factory = {
  name: "memory",
  async open() {
    const flags = capabilities({ supersession: true });
    const nativeErrorMap = {};
    const { uow, port, appendFact, dump, setWriteTime } = createUnitOfWork(nativeErrorMap);
    const { memories, counters } = createMemoryStore(port, flags, () => crypto.randomUUID());
    const { fence } = createRetrievalPorts(port, flags);
    return {
      adapter: {
        capabilities: flags, uow, memories, fence,
        // Seed the historical state through the fixture's supersession port.
        supersession: {
          async markHistorical(tx, scope, id) {
            port(tx, scope, true, state => {
              state.rows.get(scope.namespace).get(id).row.historical = true;
            });
          },
        },
      },
      harness: { seedFact: appendFact, async dump() { return dump(); }, setWriteTime, async counters() { return counters(); } },
      nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "plain",
      async close() {},
    };
  },
};

for (const candidate of FENCE_INTENT_CASES) {
  test(`${candidate.id} ${candidate.title}`, async () => {
    assert.equal(await runCase(factory, candidate), null);
  });
}
