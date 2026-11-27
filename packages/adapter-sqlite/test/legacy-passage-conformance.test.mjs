import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_PASSAGE_CASES, runCase } from "@cairn-ink/conformance";
import { SQLITE_ERROR_MAP } from "../src/index.mjs";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { scratch, seedFact } from "./storage-fixtures.mjs";

const notApplicable = {};
const factory = {
  name: "sqlite",
  async open({ capabilities }) {
    const { path, remove } = scratch();
    try {
      const adapter = createSqliteAdapter(await openStorage(path), { capabilities });
      return {
        adapter, nativeErrorMap: SQLITE_ERROR_MAP, sessionRefs: "hashed", embeddingDimensions: 4,
        busyNativeCodes: ["SQLITE_BUSY", "SQLITE_LOCKED"],
        harness: { seedFact: (owner, fact) => {
          assert.equal(fact.owner, owner);
          return seedFact(adapter, fact);
        } },
        async close() {
          try { await adapter.close(); } finally { remove(); }
        },
      };
    } catch (error) {
      remove();
      throw error;
    }
  },
};

for (const testCase of LEGACY_PASSAGE_CASES) {
  if (Object.hasOwn(notApplicable, testCase.id)) continue;
  test(`SQLite ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}
