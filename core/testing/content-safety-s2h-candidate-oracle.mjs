// Expected by construction, for the synthetic Memory fixtures in the batch test.
// No production dependencies, stored-row matcher, serving memo or eligibility helper.
// Spec paths below are relative to docs/plans/; line numbers name frozen rules.
// b3s-safety-layout.md:339-342: applicable facts deny in the canonical snapshot,
// including pending or failed cleanup; the remaining citations define matches.
const choices = {
  ancestry: ['none','in-scope','foreign-owner','foreign-namespace','mixed','foreign-scope','null-project'],
  state: ['live','forgotten','conversation','overlap','disjoint','whole-message'],
  precision: ['exact','whole-message'],
  fact: ['zero','forgotten','receipt','correction','owner','namespace','disjoint','version'],
  variant: ['target','neighbour','second','foreign','wrong-revision','missing','correction'],
  intent: ['current','history'],
  eligibility: ['current','superseded','awaiting','deleted'],
};
export function expectedCandidateDecision(labels) {
  for (const [key, values] of Object.entries(choices)) {
    if (!values.includes(labels[key])) throw new Error('Unspecified oracle dimension: '+key+'='+labels[key]);
  }
  const {ancestry,state,fact,variant,eligibility,intent} = labels;
  // incremental-catchup.md:237-245: existence and exact revision on both intents.
  if (variant === 'missing' || variant === 'wrong-revision') return false;
  // incremental-catchup.md:237-258: existence/deletion applies to both intents;
  // supersession alone excludes current, retaining intact history (:251-258).
  // context-read-product.md:2086: awaiting excludes current, permits history.
  // Eligibility labels describe the subject only; other admitted refs stay current.
  if (['target','correction'].includes(variant) && (eligibility === 'deleted' ||
      intent === 'current' && ['superseded','awaiting'].includes(eligibility))) return false;
  // Caller authorization is separate from candidate namespace (:237,264-272).
  // b3s-safety-layout.md:415-417: every identity within an owner/namespace fact.
  if (fact === 'owner' && variant !== 'foreign') return false;
  if (fact === 'namespace' && ['target','neighbour','correction'].includes(variant)) return false;
  if (!['target','correction'].includes(variant)) return true;
  // b3s-safety-layout.md:368,379-382: forget denies; retired correction does
  // not authorize old text; the explicitly labelled new corrected revision does.
  if (fact === 'forgotten' || fact === 'correction' && variant === 'target') return false;
  // b3s-safety-layout.md:411-417: exact version matches this target revision;
  // disjoint Memory keys never match. Receipt facts do not suppress body-only
  // candidates: receipts are children, not implicit ancestors (:475-477).
  if (fact === 'version') return false;
  // incremental-catchup.md:237-242: foreign or unresolved origin refuses even
  // for history. b3s-safety-layout.md:1087-1089: empty facts cannot bypass this.
  if (!['none','in-scope'].includes(ancestry)) return false;
  if (ancestry === 'none') return true;
  if (state === 'forgotten') return false; // dangling origin, same rule
  // b3s-safety-layout.md:374-375,411-417: whole conversation or overlapping
  // same-message span denies; disjoint spans do not. Both fixture precisions
  // carry the same explicit start/end. 'whole-message' state overlaps that span.
  if (['conversation','overlap','whole-message'].includes(state)) return false;
  return true;
}
