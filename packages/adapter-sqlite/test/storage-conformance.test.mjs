import assert from "node:assert/strict";
import test from "node:test";
import { CASES, PRIVACY_CASES, PRIVACY_MATCH_CASES, runCase } from "@cairn-ink/conformance";
import { SQLITE_ERROR_MAP } from "../src/index.mjs";
import { readReceipts } from "../src/memory-rows.mjs";
import { fixture, seedFact, setWriteTime, testAccess } from "./storage-fixtures.mjs";

const excluded = new Map([
  ["K-UOW-2", "the installation file has one writer across owners"],
  ["K-UOW-3", "the installation file has one writer across owners"],
  ["K-HIDE-1", "requires the retrieval fence and hydration ports"],
  ["K-HIDE-2", "requires the retrieval fence and hydration ports"],
  ["K-HIDE-3", "requires the lexical and recent ports"],
  ["K-HIDE-4", "requires the retrieval fence and hydration ports"],
  ["K-HASH-1", "requires the retrieval fence and hydration ports"],
]);

function fixtureFactory(owner) {
  return {
    name: "sqlite",
    async open() {
      const opened = await fixture();
      const { adapter, port } = opened;
      // A receipt assertion view for the memory touch case. The production API
      // does not register a hydrate port. Visibility comes from memories.get.
      const hydrate = {
        async hydrate(tx, { owner, namespaces }, refs) {
          assert.equal(refs.length, 1);
          const [ref] = refs;
          assert.equal(ref.type, "memory");
          assert.deepEqual(namespaces, [ref.namespace]);
          const scope = { owner, namespace: ref.namespace };
          const memory = await adapter.memories.get(tx, scope, ref.id);
          if (!memory) return [];
          const receipts = await port(tx, owner, {}, db => readReceipts(db, scope, ref.id));
          return [{ ref, memory, receipts }];
        },
      };

      return {
        adapter: { ...adapter, hydrate },
        embeddingDimensions: 4,
        sessionRefs: "hashed",
        nativeErrorMap: SQLITE_ERROR_MAP,
        busyNativeCodes: ["SQLITE_BUSY", "SQLITE_LOCKED"],
        close: opened.close,
        harness: {
          hashSessionKey: (client, sessionId) => {
            return adapter.hashSessionKey({ owner: owner(), namespace: null }, client, sessionId);
          },
          async dump() {
            return testAccess(opened, { owner: "fixture", namespace: null }, {}, db =>
              ["cairn_memories", "cairn_receipts", "cairn_suppression_facts", "cairn_suppression_epochs",
                "cairn_legacy_denials", "cairn_pause"].map(table => db.prepare(`SELECT * FROM ${table}`).all()));
          },
          seedFact: (owner, fact) => {
            assert.equal(owner, fact.owner);
            return seedFact(adapter, fact);
          },
          setWriteTime: (scope, id, time) => setWriteTime(opened, scope, id, time),
          async counters() { return {}; },
        },
      };
    },
  };
}

// The kit assigns an owner after opening. Pass it to the scoped hash fixture
// when the untouched case starts, and keep each case on its own file.
function register(kitCase, title) {
  test(title, { skip: excluded.get(kitCase.id) }, async t => {
    let owner;
    const reason = await runCase(fixtureFactory(() => owner), {
      ...kitCase,
      async run(context) {
        owner = context.owner;
        return kitCase.run(context);
      },
    });
    if (reason !== null) {
      assert.ok(kitCase.pending || kitCase.needs.length, `Unexpected skip: ${reason}`);
      t.skip(reason);
    }
  });
}

for (const { followUp, ...kitCase } of [
  ...CASES.filter(({ id }) => /^K-(MEM-|CAP-[01]$|UOW-|ERR-)/u.test(id)),
  ...PRIVACY_CASES,
  ...PRIVACY_MATCH_CASES,
]) {
  register(kitCase, `${kitCase.id} ${kitCase.title}`);
  if (followUp && !excluded.has(kitCase.id)) {
    register({ id: kitCase.id, ...followUp }, `${kitCase.id} optional capability follow-up`);
  }
}
