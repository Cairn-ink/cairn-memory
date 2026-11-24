import assert from "node:assert/strict";
import test from "node:test";
import {
  RELATION_CASES, TOPIC_CARD_CASES, TOPIC_CASES, TOPIC_FOR_MEMORIES_CASES, TOPICS_FOR_CARDS_CASES, runCase,
} from "@cairn-ink/conformance";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { PLACEMENT_RELATION_TABLES } from "../src/schema/placement-relations.mjs";
import { scratch, seedFact } from "./storage-fixtures.mjs";

const factory = owner => ({
  name: "sqlite",
  async open({ capabilities }) {
    const { path, remove } = scratch();
    let storage;
    try {
      storage = await openStorage(path);
      const adapter = createSqliteAdapter(storage, {
        capabilities: { ...capabilities, placement: true, supersession: true, conflictEdges: true },
      });
      return {
        adapter,
        embeddingDimensions: null,
        sessionRefs: "hashed",
        harness: {
          hashSessionKey: (client, sessionId) => adapter.hashSessionKey({ owner: owner(), namespace: null }, client, sessionId),
          seedFact(factOwner, fact) {
            assert.equal(factOwner, fact.owner);
            return seedFact(adapter, fact);
          },
          dump() {
            return adapter.uow.run("fixture", { readOnly: true }, tx => storage.port(tx, tx.owner, {}, db =>
              [...PLACEMENT_RELATION_TABLES, "cairn_index_revisions"].map(table => db.prepare(`SELECT * FROM ${table}`).all())));
          },
        },
        async close() {
          try { await adapter.close(); }
          finally { remove(); }
        },
      };
    } catch (error) {
      try { await storage?.close(); }
      finally { remove(); }
      throw error;
    }
  },
});

for (const testCase of [
  ...TOPIC_CASES, ...TOPIC_FOR_MEMORIES_CASES, ...RELATION_CASES, ...TOPIC_CARD_CASES, ...TOPICS_FOR_CARDS_CASES,
]) {
  test(`sqlite ${testCase.id} ${testCase.title}`, async t => {
    let owner;
    const reason = await runCase(factory(() => owner), {
      ...testCase,
      run(context) {
        owner = context.owner;
        return testCase.run(context);
      },
    });
    if (reason === null) return;
    assert.ok(testCase.needs.some(flag => reason === `needs ${flag}`), `Unexpected skip: ${reason}`);
    t.skip(reason);
  });
}
