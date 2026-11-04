/**
 * classifyCardBodySafetyV1(observation) -> { status, reasons } (internal API).
 * Pure, materialized data only; no SQLite, filesystem, clock, logging or callbacks.
 *
 * Observation v1:
 * { version: 1,
 *   body: { identity: Identity, titleUtf8: hex, bodyUtf8: hex },
 *   edges: [{ identity: Identity, evidence: { origin: canonical table, digest: hex },
 *             state: { exists: boolean, ...canonical current state } }],
 *   suppressionFacts: [{ target: Identity, reason: frozen reason,
 *                        evidence: { origin: canonical table, digest: hex } }],
 *   coverage: null }
 * Identity = { storeId, ownerId, scope, projectId, kind, key, incarnation, version }.
 * projectId is SQL '' for personal scope. Identity strings compare exactly.
 * Edges include every positive/plausible contributor AND its recovered ancestors;
 * facts target these identities (or the body itself). The canonical observation
 * adapter owns evidence examination, keyed-ref checks and tombstone derivation.
 * Incomplete enumeration/evidence is a RUN refusal, never an observation flag.
 *
 * S2c seam: coverage is reserved for a validated exact-byte provenance header,
 * its sealed source set and authorization. S3 has no S2c verifier or installed
 * provider, so no supplied object/boolean can activate that seam. S2c must add
 * structural/commitment/coverage validation here before producing `complete`;
 * there is deliberately no trustedProof / userAuthored / complete input flag.
 * Legacy operations have neither payload nor a continuity seal. Empty bindings
 * and authoredInput cannot establish authorship or closed contributor coverage.
 */
const reasons = new Set(['user_forget', 'correction_supersession', 'purge', 'privacy_erase', 'account_erasure']);
const keys = ['storeId', 'ownerId', 'scope', 'projectId', 'kind', 'key', 'incarnation', 'version'];
const sameIdentity = (a, b) => a && b && keys.every(key => a[key] === b[key]);

export function classifyCardBodySafetyV1(observation) {
  const targets = [observation.body.identity, ...observation.edges.map(edge => edge.identity)];
  const matched = observation.suppressionFacts.filter(fact => reasons.has(fact.reason) &&
    fact.evidence?.origin && fact.evidence?.digest && targets.some(target => sameIdentity(target, fact.target)));
  if (matched.length) return { status: 'known-suppressed', reasons: [...new Set(matched.map(fact => fact.reason))].sort() };
  return { status: 'unknown', reasons: [observation.edges.some(edge => !edge.state.exists)
    ? 'source_missing' : 'closed_history_unproven'] };
}
