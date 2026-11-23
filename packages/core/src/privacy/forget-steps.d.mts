import type { Capability } from "../capabilities.mjs";

export declare const FORGET_STEPS: readonly [
  "resolve", "lineage.resolve", "suppression.write", "session.fence", "raw.purge", "receipts.suppress",
  "dependents.invalidate", "edits.unlink", "tombstone", "receipts.delete", "epoch.advance",
];
export type ForgetStep = typeof FORGET_STEPS[number];
export declare const FORGET_STEP_CAPABILITIES: Readonly<
  Partial<Record<ForgetStep, readonly Capability[]>>
  & { "dependents.invalidate": readonly ["cards", "placement", "conflictEdges", "stagedEvidence", "documentCards", "quantityLedger"] }
>;
