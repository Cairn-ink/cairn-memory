import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPABILITIES, FORGET_STEPS, FORGET_STEP_CAPABILITIES } from "../src/index.mjs";

test("forget resolves lineage before destructive steps and advances the epoch last", () => {
  assert.deepEqual(FORGET_STEPS, [
    "resolve", "lineage.resolve", "suppression.write", "session.fence", "raw.purge", "receipts.suppress",
    "dependents.invalidate", "edits.unlink", "tombstone", "receipts.delete", "epoch.advance",
  ]);
  assert.ok(Object.isFrozen(FORGET_STEPS));
});

test("forget gates use the registered capabilities for each optional effect", () => {
  assert.deepEqual(FORGET_STEP_CAPABILITIES, {
    "lineage.resolve": ["spanLineage"],
    "session.fence": ["rawArchive"],
    "raw.purge": ["rawArchive"],
    "receipts.suppress": ["spanLineage"],
    "dependents.invalidate": ["cards", "placement", "conflictEdges", "stagedEvidence", "documentCards"],
  });
  assert.ok(Object.isFrozen(FORGET_STEP_CAPABILITIES));
  for (const [step, gates] of Object.entries(FORGET_STEP_CAPABILITIES)) {
    assert.ok(FORGET_STEPS.includes(step));
    assert.ok(Object.isFrozen(gates));
    for (const gate of gates) assert.ok(CAPABILITIES.includes(gate));
  }
});
