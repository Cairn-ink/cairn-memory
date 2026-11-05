// Frozen pre-batch lexical candidate predicate. Keep this independent of the
// batch implementation: the canonical S1 decision is the reference oracle.
import { contentReadSafety } from '../content-safety.mjs';
import { contextCardEligible } from '../context-read-sidecar.mjs';
export function candidateAllowedReference(db, identity, features, ref, p) {
  return ref.type === 'card' ? contextCardEligible(db,identity,features,ref.namespace,
    {id:ref.cardId,revision:ref.revision,body_revision:ref.bodyRevision},p.intent,{readSet:p.readSet}) :
    contentReadSafety(db,{identity,namespace:ref.namespace,ref,intent:p.intent}).allowed;
}
