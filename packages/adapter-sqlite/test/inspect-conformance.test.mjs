import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { INSPECT_CASES } from "@cairn-ink/conformance/inspect";
import { scopeKey } from "../src/storage-values.mjs";
import { fixture, seedFact, setWriteTime, testAccess } from "./storage-fixtures.mjs";

const factory = {
  name: "sqlite inspect",
  async open() {
    const opened = await fixture();
    return {
      adapter: opened.adapter, close: opened.close, sessionRefs: "hashed",
      embeddingDimensions: null, nativeErrorMap: {}, busyNativeCodes: [],
      harness: {
        seedFact(owner, fact) {
          assert.equal(fact.owner, owner);
          return seedFact(opened.adapter, fact);
        },
        setWriteTime: (scope, id, time) => setWriteTime(opened, scope, id, time),
        markInspectHistorical(scope, id) {
          return testAccess(opened, scope, { write: true }, db => {
            const updated = db.prepare("UPDATE cairn_memories SET historical = 1, revision = revision + 1 WHERE owner_id = ? AND namespace_key = ? AND id = ?")
              .run(...scopeKey(scope), id);
            assert.equal(updated.changes, 1);
          });
        },
        seedInspectEvidence(scope, id, { procedural, qualification }) {
          return testAccess(opened, scope, { write: true }, db => {
            db.prepare(`INSERT INTO cairn_inspect_evidence (owner_id, namespace_key, memory_id, filing, procedural, qualification)
              VALUES (?, ?, ?, 'unfiled', ?, ?) ON CONFLICT (owner_id, namespace_key, memory_id)
              DO UPDATE SET procedural = excluded.procedural, qualification = excluded.qualification`)
              .run(...scopeKey(scope), id, procedural ? JSON.stringify(procedural) : null,
                qualification ? JSON.stringify(qualification) : null);
          });
        },
      },
    };
  },
};

for (const inspectCase of INSPECT_CASES) {
  test(`${inspectCase.id} ${inspectCase.title}`, async () => {
    assert.equal(await runCase(factory, inspectCase), null);
  });
}
