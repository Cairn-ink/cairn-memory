import assert from "node:assert/strict";
import test from "node:test";
import { ADMISSION_CASES, CAPTURE_CASES, SOURCE_FILTER_CASES, runCase } from "@cairn-ink/conformance";
import { SQLITE_ERROR_MAP } from "../src/index.mjs";
import { captureFixture } from "./capture-fixtures.mjs";
import { seedFact, testAccess } from "./storage-fixtures.mjs";

// These cases encode cross-namespace identity. The scoped contract is exercised
// directly by the capture storage tests.
const crossNamespace = new Set(["K-CLM-1", "K-ADM-4", "K-ADM-10", "K-ADM-12", "K-ADM-14"]);

function factory() {
  let owner;
  return {
    name: "sqlite capture",
    setOwner(value) { owner = value; },
    async open() {
      const opened = await captureFixture();
      const { adapter, port } = opened;
      return {
        adapter: { ...adapter, snapshot: {
          // Fixture projection of the durable owner revision. The capture kit
          // compares token equality and does not consume the retrieval format.
          stateToken(tx, scope) {
            return port(tx, scope.owner, {}, db =>
              String(db.prepare("SELECT revision FROM cairn_index_revisions WHERE owner_id = ?")
                .get(scope.owner)?.revision ?? 0));
          },
        } },
        embeddingDimensions: 4,
        sessionRefs: "hashed",
        nativeErrorMap: SQLITE_ERROR_MAP,
        busyNativeCodes: ["SQLITE_BUSY", "SQLITE_LOCKED"],
        close: opened.close,
        harness: {
          advanceClock: opened.advanceClock,
          hashSessionKey: (client, sessionId) => adapter.hashSessionKey({ owner, namespace: null }, client, sessionId),
          dump: () => testAccess(opened, { owner: "fixture", namespace: null }, {}, db =>
            db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all()
              .map(({ name }) => db.prepare(`SELECT * FROM "${name}"`).all().map(row => ({ ...row })))),
          seedFact: (owner, fact) => {
            assert.equal(owner, fact.owner);
            return seedFact(adapter, fact);
          },
        },
      };
    },
  };
}

function register(kitCase, name, skip) {
  test(name, { skip }, async t => {
    const fixture = factory();
    const reason = await runCase(fixture, {
      ...kitCase,
      run(context) {
        fixture.setOwner(context.owner);
        return kitCase.run(context);
      },
    });
    if (reason !== null) {
      assert.ok(kitCase.needs.length || kitCase.pending, `Unexpected skip: ${reason}`);
      t.skip(reason);
    }
  });
}

for (const { followUp, ...kitCase } of [...CAPTURE_CASES, ...ADMISSION_CASES, ...SOURCE_FILTER_CASES]) {
  register(kitCase, `${kitCase.id} ${kitCase.title}`,
    crossNamespace.has(kitCase.id) ? "this case expects shared claims across namespaces" : false);
  if (followUp) register(followUp, `${kitCase.id} follow-up`, false);
}
