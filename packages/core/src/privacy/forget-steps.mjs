export const FORGET_STEPS = Object.freeze([
  "resolve",
  "lineage.resolve",
  "suppression.write",
  "session.fence",
  "raw.purge",
  "receipts.suppress",
  "dependents.invalidate",
  "edits.unlink",
  "tombstone",
  "receipts.delete",
  "epoch.advance",
]);

/**
 * Unlisted steps are unconditional. Each dependent facility gates its own invalidation.
 * @type {Readonly<Partial<Record<import("./forget-steps.mjs").ForgetStep, readonly import("../capabilities.mjs").Capability[]>>>}
 */
export const FORGET_STEP_CAPABILITIES = Object.freeze({
  "lineage.resolve": Object.freeze(/** @type {const} */ (["spanLineage"])),
  "session.fence": Object.freeze(/** @type {const} */ (["rawArchive"])),
  "raw.purge": Object.freeze(/** @type {const} */ (["rawArchive"])),
  "receipts.suppress": Object.freeze(/** @type {const} */ (["spanLineage"])),
  "dependents.invalidate": Object.freeze(/** @type {const} */ (["cards", "placement", "conflictEdges", "stagedEvidence", "documentCards"])),
});
