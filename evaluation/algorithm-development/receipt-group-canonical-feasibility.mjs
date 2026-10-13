import { canonicalReceiptGroupFeasibility } from './receipt-group-feasibility-internal.mjs';

// Explicit separately versioned cohort; callers cannot select another profile.
export async function prepareCanonicalReceiptGroupFeasibility(options) {
  return canonicalReceiptGroupFeasibility.prepareReceiptGroupFeasibility(options);
}
export function createCanonicalReceiptGroupFeasibilityManifest(observation) {
  return canonicalReceiptGroupFeasibility.createReceiptGroupFeasibilityManifest(observation);
}
export async function runCanonicalReceiptGroupFeasibility(options) {
  return canonicalReceiptGroupFeasibility.runReceiptGroupFeasibility(options);
}
