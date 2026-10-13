import { originalReceiptGroupFeasibility } from './receipt-group-feasibility-internal.mjs';

// Historical profile remains fixed. Refactoring changes dependency identity;
// it does not grant authority to reuse any closed capability or run.
export async function prepareReceiptGroupFeasibility(options) {
  return originalReceiptGroupFeasibility.prepareReceiptGroupFeasibility(options);
}
export function createReceiptGroupFeasibilityManifest(observation) {
  return originalReceiptGroupFeasibility.createReceiptGroupFeasibilityManifest(observation);
}
export async function runReceiptGroupFeasibility(options) {
  return originalReceiptGroupFeasibility.runReceiptGroupFeasibility(options);
}
