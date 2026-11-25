import assert from "node:assert/strict";
import test from "node:test";
import * as kit from "@cairn-ink/conformance";
import { rawWriter } from "../src/raw-rows.mjs";
import { fixture, seedFact, testAccess } from "./storage-fixtures.mjs";

const rawCapabilities = new Set(["rawArchive", "spanLineage"]);
// Capture routing requires a DocumentCardStore.
const excluded = new Set(["K-LEG-PASS-7-router"]);
const rawCases = Object.values(kit).filter(Array.isArray).flat()
  .filter(({ id, needs, followUp }) => !excluded.has(id) && (needs.some(flag => rawCapabilities.has(flag)) ||
    followUp?.needs.some(flag => rawCapabilities.has(flag))));
const windowCases = kit.RETRIEVAL_WINDOW_CASES.filter(({ requests }) => requests?.rawArchive);

function factory(contextScope) {
  return {
    name: "sqlite raw",
    async open() {
      const opened = await fixture();
      const { adapter } = opened;
      return {
        adapter, close: opened.close, embeddingDimensions: 4, sessionRefs: "hashed",
        harness: {
          // The kit hash callback omits namespace. Its case creates the target
          // scope before requesting a hash, which binds the fixture to that scope.
          hashSessionKey: (client, sessionId) => adapter.hashSessionKey(contextScope(), client, sessionId),
          seedClientlessRaw: (scope, sessionId, message) => testAccess(opened, scope, { write: true },
            db => rawWriter(db, scope, { client: "", sessionId })(message)),
          seedFact(owner, fact) {
            assert.equal(owner, fact.owner);
            return seedFact(adapter, fact);
          },
          dump: () => testAccess(opened, { owner: "fixture", namespace: null }, {}, db => {
            const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all();
            return tables.map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all().map(row => {
              if (name !== "cairn_raw_messages") return row;
              // Report the stored message in its original string representation.
              return { ...row, message_key: JSON.parse(row.message_key), content: JSON.parse(row.content) };
            }));
          }),
          counters: adapter.counters,
        },
      };
    },
  };
}

for (const kitCase of new Set([...rawCases, ...windowCases])) {
  test(`${kitCase.id} ${kitCase.title}`, async t => {
    let scope;
    const reason = await kit.runCase(factory(() => scope), {
      ...kitCase,
      run(context) {
        scope = context.scope(null);
        return kitCase.run({
          ...context,
          scope(namespace) {
            scope = context.scope(namespace);
            return scope;
          },
        });
      },
    });
    if (reason === null) return;
    assert.ok(kitCase.needs.some(flag => reason === `needs ${flag}`), `Unexpected skip: ${reason}`);
    t.skip(reason);
  });
}
