// Equivalence control only: the pre-batch per-candidate path shares live S1.
// Safety expectations belong exclusively to candidate-oracle.mjs.
import { contentReadSafety } from '../content-safety.mjs';
export function candidateAllowedReference(db, identity, ref, p) {
  return contentReadSafety(db,{identity,namespace:ref.namespace,ref,intent:p.intent}).allowed;
}
