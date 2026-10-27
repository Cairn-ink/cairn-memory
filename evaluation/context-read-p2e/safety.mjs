import { isDeepStrictEqual } from 'node:util';

export const SAFETY_CELLS = [
  ...['forget', 'correct', 'supersede', 'item-purge'].flatMap(mutation => ['preparation', 'embedding', 'final-refetch'].flatMap(boundary => ['fresh', 'restarted'].flatMap(reader => ['memory','card'].flatMap(type => ['current','history'].map(intent => `${mutation}/${boundary}/${reader}/${type}/${intent}`))))),
  'scope/cross-owner', 'scope/cross-namespace', 'semantic-false/candidates', 'semantic-false/assembly', 'owner-purge/all-catalogs',
];
export const pendingSafety = () => Object.fromEntries(SAFETY_CELLS.map(id => [id, { status: 'not_run', violations: null }]));

// Only these pre-existing nondeterministic fields may be normalized. Opaque
// snapshots/refs, trace contents, bodies, counts and accounting are compared.
export function lexicalEnvelope(value, path = []) {
  if (Array.isArray(value)) return value.map((v, i) => lexicalEnvelope(v, [...path, i]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) =>
    [k, (['elapsedMs', 'durationMs'].includes(k) || path.at(-1) === 'timings' && ['maintenanceMs','lexicalMs','semanticPreflightMs','embeddingMs','fusionMs','assemblyMs'].includes(k))
      && typeof v === 'number' && Number.isFinite(v) && v >= 0 ? '<clock>' : lexicalEnvelope(v, [...path, k])]));
  return value;
}
export function checkSafety(observations) {
  const result = pendingSafety();
  for (const id of SAFETY_CELLS) {
    const o = observations[id];
    if (!o) continue;
    let violations = 0, valid = true;
    if (id.startsWith('semantic-false/')) {
      valid = o.lexical !== undefined && o.explicitFalse !== undefined && o.semanticCalls !== undefined;
      violations = Number(!isDeepStrictEqual(lexicalEnvelope(o.lexical), lexicalEnvelope(o.explicitFalse))) + Number(o.semanticCalls !== 0);
    } else if (id === 'owner-purge/all-catalogs') {
      valid = o.completed === true && Array.isArray(o.catalogBefore) && o.catalogBefore.length > 0 && Array.isArray(o.catalogAfter)
        && isDeepStrictEqual(o.catalogBefore, o.catalogAfter) && Array.isArray(o.rowsAfter) && Array.isArray(o.otherOwnerBefore) && o.otherOwnerBefore.length > 0 && Array.isArray(o.otherOwnerAfter)
        && o.independentInventory === true && o.noPendingWriters === true && o.ownerId === 'synthetic-owner'
        && Array.isArray(o.rowsBefore) && o.rowsBefore.some(r => r.ownerId === o.ownerId)
        && isDeepStrictEqual(o.inventoryCoverage, ['all-identities','both-intents','all-types','staging','obsolete'])
        && o.lexicalBefore !== undefined && o.lexicalAfter !== undefined;
      violations = (o.rowsAfter ?? []).filter(row => row.ownerId === o.ownerId).length
        + Number(!isDeepStrictEqual(o.otherOwnerBefore, o.otherOwnerAfter))
        + Number(!isDeepStrictEqual(lexicalEnvelope(o.lexicalBefore), lexicalEnvelope(o.lexicalAfter)));
    } else {
      valid = Array.isArray(o.returns) && o.returns.length >= 4 && Array.isArray(o.forbidden) && o.forbidden.length > 0
        && o.canonicalSnapshot !== undefined && o.mutationAcknowledged === true
        && ['candidates', 'assembly', 'evidence', 'private-metadata'].every(surface => o.returns.some(r => r.surface === surface));
      const expectedForbidden = id.startsWith('scope/') ? [id === 'scope/cross-owner' ? 'foreign-owner@1' : 'foreign-project@2:1'] : [id.includes('/card/') ? 'safety-card-target@2:1' : 'safety-target@1'];
      valid &&= isDeepStrictEqual(o.forbidden, expectedForbidden) && o.qualifiedHistoryControl === 'history-eligible@1';
      const forbidden = new Set(o.forbidden);
      for (const returned of o.returns ?? []) {
        if (!Array.isArray(returned.identities) || !Array.isArray(returned.scopeCanaries)) { valid = false; continue; }
        if (returned.envelope?.ok !== true && !(returned.surface === 'evidence' && ['evidence_unavailable','revision_conflict','snapshot_stale'].includes(returned.envelope?.error?.code))) valid = false;
        violations += returned.identities.filter(key => forbidden.has(key)).length + returned.scopeCanaries.length;
      }
      if (id.startsWith('scope/')) {
        valid &&= o.withCanary !== undefined && o.withoutCanary !== undefined;
        violations += Number(!isDeepStrictEqual(lexicalEnvelope(o.withCanary), lexicalEnvelope(o.withoutCanary)));
      }
    }
    result[id] = { status: !valid ? 'incomplete' : violations ? 'failed' : 'passed', violations, evidence: o };
  }
  return result;
}
