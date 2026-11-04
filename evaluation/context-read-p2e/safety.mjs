import { safetyFixtures } from './inventory.mjs';
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
        && o.lexicalBefore?.ok === true && o.lexicalAfter?.ok === true
        && Array.isArray(o.lexicalAfterInspection?.identities) && Array.isArray(o.lexicalAfterInspection?.scopeCanaries)
        && isDeepStrictEqual(o.lexicalAfterInspection.envelope, o.lexicalAfter);
      violations = (o.rowsAfter ?? []).filter(row => row.ownerId === o.ownerId).length
        + Number(!isDeepStrictEqual(o.otherOwnerBefore, o.otherOwnerAfter))
        + Number(!isDeepStrictEqual(lexicalEnvelope(o.lexicalBefore), lexicalEnvelope(o.lexicalAfter)))
        + (o.lexicalAfterInspection?.scopeCanaries?.length ?? 0);
    } else {
      valid = Array.isArray(o.returns) && o.returns.length >= 4 && Array.isArray(o.forbidden) && o.forbidden.length > 0
        && ['candidates', 'assembly', 'evidence', 'private-metadata'].every(surface => o.returns.some(r => r.surface === surface));
      const expectedForbidden = id.startsWith('scope/') ? [id === 'scope/cross-owner' ? 'foreign-owner@1' : 'foreign-project@2:1'] : [id.includes('/card/') ? 'safety-card-target@2:1' : 'safety-target@1'];
      valid &&= isDeepStrictEqual(o.forbidden, expectedForbidden);
      const forbidden = new Set(o.forbidden);
      for (const returned of o.returns ?? []) {
        if (!Array.isArray(returned.identities) || !Array.isArray(returned.scopeCanaries)) { valid = false; continue; }
        if (returned.envelope?.ok !== true && !(returned.surface === 'evidence' && ['evidence_unavailable','revision_conflict','snapshot_stale'].includes(returned.envelope?.error?.code))) valid = false;
        violations += returned.identities.filter(key => forbidden.has(key)).length + returned.scopeCanaries.length;
      }
      if (id.startsWith('scope/')) {
        const pairs = ['candidates', 'assembly', 'evidence', 'private-metadata'].flatMap(surface =>
          ['capabilities', 'result'].map(kind => `${surface}/${kind}`)).sort();
        const reads = pairs.flatMap(pair => ['withCanary', 'withoutCanary'].map(side => `${pair}/${side}`)).sort();
        valid &&= Array.isArray(o.scopeComparisons) && isDeepStrictEqual(o.scopeComparisons.map(c => `${c.surface}/${c.kind}`).sort(), pairs)
          && isDeepStrictEqual(o.returns.map(r => `${r.surface}/${r.kind}/${r.side}`).sort(), reads);
        for (const comparison of o.scopeComparisons ?? []) {
          for (const side of ['withCanary', 'withoutCanary']) {
            const observed = (o.returns ?? []).filter(r => r.surface === comparison.surface && r.kind === comparison.kind && r.side === side);
            valid &&= comparison[side]?.ok === true && observed.length === 1 && isDeepStrictEqual(comparison[side], observed[0].envelope);
          }
          violations += Number(!isDeepStrictEqual(lexicalEnvelope(comparison.withCanary), lexicalEnvelope(comparison.withoutCanary)));
        }
      } else {
        // Score the complete post-mutation read ledger, not only the four
        // boundary results. Frozen roles also prevent omission of a control or
        // the extra semantic candidate read at the evidence boundary.
        const expectedReads = ['candidates', 'assembly', 'evidence', 'private-metadata'].flatMap(surface =>
          ['boundary', 'history-candidates', 'history-evidence', ...(surface === 'evidence' ? ['semantic-execution'] : [])].flatMap(role => ['capabilities', 'result'].map(kind => `${surface}/${role}/${kind}`))).sort();
        valid &&= Array.isArray(o.postMutationReads) && isDeepStrictEqual(o.postMutationReads.map(r => `${r.surface}/${r.role}/${r.kind}`).sort(), expectedReads);
        for (const returned of o.postMutationReads ?? []) {
          if (!Array.isArray(returned.identities) || !Array.isArray(returned.scopeCanaries) || !returned.envelope) { valid = false; continue; }
          violations += returned.identities.filter(key => forbidden.has(key)).length + returned.scopeCanaries.length;
          if (returned.envelope.ok !== true && !(returned.kind === 'result' && returned.surface === 'evidence' && returned.role === 'boundary'
            && ['evidence_unavailable','revision_conflict','snapshot_stale'].includes(returned.envelope.error?.code))) valid = false;
          const parent = returned.role.startsWith('history-') ? o.historyControls?.find(r => r.surface === returned.surface) : o.returns?.find(r => r.surface === returned.surface);
          const original = returned.role === 'history-evidence' ? parent?.evidence?.envelope
            : returned.role === 'semantic-execution' ? parent?.semanticExecution : parent?.envelope;
          if (returned.kind === 'result') valid &&= isDeepStrictEqual(returned.envelope, original);
        }
        valid &&= Array.isArray(o.canonicalSnapshot) && o.canonicalSnapshot.length === 4 && o.canonicalSnapshot.every(s => s != null) && o.mutationAcknowledged === true;
        for (const surface of ['candidates', 'assembly', 'evidence', 'private-metadata']) {
          const initial = (o.initial ?? []).filter(r => r.surface === surface);
          const history = (o.historyControls ?? []).filter(r => r.surface === surface);
          const boundary = (o.returns ?? []).filter(r => r.surface === surface);
          valid &&= initial.length === 1 && history.length === 1 && boundary.length === 1;
          if (initial.length !== 1 || history.length !== 1 || boundary.length !== 1) continue;
          valid &&= semanticExecuted(initial[0].envelope) && initial[0].semanticCalls > 0
            && initial[0].identities?.some(key => forbidden.has(key))
            && initial[0].evidence?.identities?.includes(expectedForbidden[0]) && verifiedTargetEvidence(initial[0].evidence?.envelope, expectedForbidden[0], initial[0].envelope)
            && boundary[0].semanticCalls > 0 && semanticExecuted(boundary[0].semanticExecution)
            && history[0].envelope?.ok === true && history[0].identities?.includes('history-eligible@1')
            && history[0].evidence?.identities?.includes('history-eligible@1') && verifiedTargetEvidence(history[0].evidence?.envelope, 'history-eligible@1', history[0].envelope);
        }
      }
    }
    result[id] = { status: !valid ? 'incomplete' : violations ? 'failed' : 'passed', violations, evidence: o };
  }
  return result;
}

function semanticExecuted(envelope) {
  const trace = envelope?.value?.trace ?? envelope?.value?.diagnostics?.candidates?.trace;
  return envelope?.ok === true && trace?.effective === 'hybrid' && trace.semantic?.coverage === 'complete'
    && trace.semantic.queryEmbeddingAttempts === 1 && trace.semantic.degradedReason === null;
}
function verifiedTargetEvidence(envelope, key, candidates) {
  const target = safetyFixtures().canaries.find(c => `${c.id}@${c.revision}${c.type === 'card' ? `:${c.bodyRevision}` : ''}` === key);
  return envelope?.ok === true && envelope.value?.items?.some(item => {
    const ref = item.ref;
    return target && item.type === target.type && ref?.type === target.type
      && candidates?.value?.items?.some(candidate => isDeepStrictEqual(candidate.ref, ref)) && ref.revision === target.revision
      && (target.type !== 'card' || ref.bodyRevision === target.bodyRevision)
      && isDeepStrictEqual(ref.namespace, target.namespace)
      && (item.type === 'memory' ? item.content === target.text : item.title === target.title && item.body === target.body);
  });
}
