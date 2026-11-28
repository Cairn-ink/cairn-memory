import assert from "node:assert/strict";
import test from "node:test";
import { TOPIC_HOSTED_UNFILED_CASES, runCase } from "@cairn-ink/conformance";
import { openSqliteAdapter } from "../src/index.mjs";
import { scratch, seedFact } from "./storage-fixtures.mjs";

for (const testCase of TOPIC_HOSTED_UNFILED_CASES) {
  test(`sqlite ${testCase.id} ${testCase.title}`, async () => {
    let owner;
    const factory = {
      name: "sqlite",
      async open({ capabilities }) {
        const { path, remove } = scratch();
        try {
          const adapter = await openSqliteAdapter(path, { capabilities });
          return { adapter, sessionRefs: "hashed", embeddingDimensions: null,
            harness: {
              hashSessionKey: (client, sessionId) => adapter.hashSessionKey({ owner, namespace: null }, client, sessionId),
              seedFact(factOwner, fact) {
                assert.equal(factOwner, fact.owner);
                return seedFact(adapter, fact);
              },
            },
            async close() {
              try { await adapter.close(); }
              finally { remove(); }
            },
          };
        } catch (error) {
          remove();
          throw error;
        }
      },
    };
    assert.equal(await runCase(factory, {
      ...testCase,
      run(ctx) {
        owner = ctx.owner;
        return testCase.run(ctx);
      },
    }), null);
  });
}
