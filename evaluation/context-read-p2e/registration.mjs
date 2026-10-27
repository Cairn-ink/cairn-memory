import { readFileSync } from 'node:fs';
import { hash, json } from './fixtures.mjs';

export const PROTOCOL = Object.freeze({
  id: 'P2e-product-retrieval-v1', revision: 1, profile: 'context-read-product-v1.1', extension: 'context-read-product-p2e-v1',
  scorer: 'p2e-binary-typed-identity-v1', tokenizer: 'hr1-t1-v1', representation: 'representation-v2', fusion: 'rrf-k10', limit: 12,
  metrics: { primary: 'equal query mean within each disjoint primary cell; equal mean of 48 cells', recall5: 'hits@5 / all eligible relevant typed identities',
    recall12: 'hits@12 / all eligible relevant typed identities', ndcg12: 'binary sum(rel/log2(rank+1)), normalized by ideal top12',
    challenge: 'equal mean of per-query means over applicable complete cells; cross-language aggregate equal weights per direction' },
  bootstrap: { version: 'xorshift32-sha256-percentile-linear-v1', seed: 'p2e-e10-sealed-2026-10-28', resamples: 10000, endpoints: [.025, .975],
    unit: 'paired query; reused query IDs averaged across cells before aggregate resampling', stream: 'sha256(seed + slash + stratum ID + slash + metric); cross aggregate stratified by direction', retainDraws: true },
  decision: { macroRecallGain: .02, crossDirectionAndAggregateGain: .05, paraphraseGain: .05, minimumRegressionTolerance: .01,
    uncertainty: 'max(abs(delta-L),abs(U-delta))', reject: 'delta < -max(uncertainty,0.01)', exactIdentifierMinimumDelta: 0,
    macroNdcgMinimumDelta: 0, safetyTolerance: 0, externalRequired: ['E.8', 'E.9 including staging added p95 <=150ms'] },
  order: 'A,B at even global query ordinal; B,A at odd ordinal', noRetries: true, noTimingQualification: true,
  lexicalNormalization: ['elapsedMs','durationMs','trace.timings:maintenanceMs,lexicalMs,semanticPreflightMs,embeddingMs,fusionMs,assemblyMs'],
});
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const digest = value => hash(JSON.stringify(canonical(value)));
export function sealRegistration(registration) {
  const { seal: ignored, ...body } = structuredClone(registration);
  if (json(body.protocol) !== json(PROTOCOL) || !body.files || !Object.keys(body.files).length) throw Error('invalid_registration');
  return { ...body, seal: { algorithm: 'sha256-canonical-json-v1', digest: digest(body) } };
}
export function verifyRegistration(registration, read = name => readFileSync(new URL(`../../${name}`, import.meta.url))) {
  const { seal, ...body } = registration;
  if (!seal || seal.algorithm !== 'sha256-canonical-json-v1' || seal.digest !== digest(body)) throw Error('registration_not_sealed_or_changed');
  if (json(body.protocol) !== json(PROTOCOL)) throw Error('protocol_mismatch');
  for (const [name, expected] of Object.entries(body.files)) {
    if (!/^(?:evaluation\/context-read-p2e\/|tools\/testing\/p2e-)[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..') || hash(read(name)) !== expected) throw Error('registered_input_mismatch');
  }
  return registration;
}
export function requireHostedRegistration(registration, { engineCommit, providerIdentity, bindingHash, authorization } = {}) {
  if (!registration.engineCommit || !registration.providerIdentity || !registration.bindingHash || !registration.authorization) throw Error('unresolved_hosted_registration');
  if (registration.engineCommit !== engineCommit || digest(registration.providerIdentity) !== digest(providerIdentity)
    || registration.bindingHash !== bindingHash || digest(registration.authorization) !== digest(authorization)) throw Error('hosted_provenance_mismatch');
}
