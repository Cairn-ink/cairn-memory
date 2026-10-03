import { BENCHMARK_STAGE_POLICY, EXPERIMENT_POLICY, MEM0_WIRE_PROFILE,
  MIXED_SOURCE_POLICY, OFFICIAL_PROTOCOL, SUPPLIED_HISTORY_POLICY } from './mixed-protocol-data.mjs';
import { canonical, fail, freeze, hash } from './mixed-validation.mjs';

export const MIXED_GENERATION_VERSION = 'cairn-lme-mixed-generation-v1';
export const MIXED_SCORING_VERSION = 'cairn-lme-mixed-scoring-v1';
const legacy = freeze({ preparation: 'cairn-lme-mixed-preparation-v1',
  indexedPreparation: 'cairn-lme-mixed-indexed-evidence-preparation-v1',
  generation: MIXED_GENERATION_VERSION, scoring: MIXED_SCORING_VERSION,
  sourcePolicyDigest: MIXED_SOURCE_POLICY.digest,
  contextDomain: 'cairn.lme.mixed.context.v1', scorerDomain: 'cairn.lme.mixed.scorer.v1',
  caseDomain: 'cairn.lme.mixed.case-protocol.v1', generationDomain: 'cairn.lme.mixed.generation-report.v1' });
const supplied = freeze({ preparation: 'cairn-lme-supplied-history-mixed-preparation-v1',
  indexedPreparation: 'cairn-lme-supplied-history-mixed-indexed-evidence-preparation-v1',
  generation: 'cairn-lme-supplied-history-mixed-generation-v1',
  scoring: 'cairn-lme-supplied-history-mixed-scoring-v1',
  sourcePolicyDigest: SUPPLIED_HISTORY_POLICY.digest,
  contextDomain: 'cairn.lme.supplied-history-mixed.context.v1',
  scorerDomain: 'cairn.lme.supplied-history-mixed.scorer.v1',
  caseDomain: 'cairn.lme.supplied-history-mixed.case-protocol.v1',
  generationDomain: 'cairn.lme.supplied-history-mixed.generation-report.v1' });

// Two closed families, selected only at trusted preparation or from a validated report.
export function sourceHistoryFamily(policy) {
  if (policy === undefined) return legacy;
  if (policy === 'supplied-history-v1') return supplied;
  fail('invalid_mixed_preparation');
}
export function generationReportFamily(version) {
  if (version === legacy.generation) return legacy;
  if (version === supplied.generation) return supplied;
  fail('invalid_mixed_report');
}

// Ordered documents are an internal protocol/drift boundary, not execution policy.
export function sourceProtocolDocuments(family, { nativeConfigurationSha256, comparisonProfile }) {
  if (family !== legacy && family !== supplied) fail('invalid_mixed_report');
  if (typeof nativeConfigurationSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(nativeConfigurationSha256)) fail('invalid_mixed_report');
  if (comparisonProfile !== undefined && comparisonProfile !== 'indexed-evidence-v1')
    fail('invalid_mixed_report');
  const evidenceOnly = comparisonProfile === 'indexed-evidence-v1';
  const context = { version: 'mixed-context-v2', sourcePolicyDigest: family.sourcePolicyDigest,
    nativeProfile: 'mem0-2.2.0-infer-add-no-nlp-v1',
    nativeConfigurationSha256,
    nativeTopK: 6, nativeThreshold: 0, nativeChildTimeoutMs: 3_600_000,
    cairnQualification: 'source-bound-v2',
    qualificationDispatchPolicy: 'whole-then-singleton-preflight-v1',
    captureSourcePolicy: 'indexed-windows-v1',
    sourceCandidatePolicy: 'bounded-keyset-v1', recallLimit: 6,
    recallContextMode: 'source-evidence', recallSelectionMode: 'bounded-source-scan',
    experimentPolicy: EXPERIMENT_POLICY, stages: BENCHMARK_STAGE_POLICY, wireProfile: MEM0_WIRE_PROFILE };
  if (evidenceOnly) {
    context.version = 'mixed-indexed-evidence-context-v1';
    context.comparisonProfile = comparisonProfile;
    context.cairnQualification = 'not-requested';
    context.captureSourcePolicy = 'indexed-evidence-v1';
    delete context.qualificationDispatchPolicy;
  }
  const scorer = { version: 'mixed-scorer-v1', upstreamCommit: OFFICIAL_PROTOCOL.upstreamCommit,
    judgeModel: OFFICIAL_PROTOCOL.judgeModel, questionTypes: OFFICIAL_PROTOCOL.questionTypes,
    judgePolicy: BENCHMARK_STAGE_POLICY.judge, aggregation: 'fixed-N-paired-3x3-v1' };
  if (family === supplied) {
    context.version = evidenceOnly ? 'supplied-history-mixed-indexed-evidence-context-v1'
      : 'supplied-history-mixed-context-v1';
    context.sourceHistoryPolicy = 'supplied-history-v1';
    context.preparationVersion = evidenceOnly ? family.indexedPreparation : family.preparation;
    context.generationVersion = family.generation;
    scorer.version = 'supplied-history-mixed-scorer-v1';
    scorer.generationVersion = family.generation;
    scorer.scoringVersion = family.scoring;
  }
  return { context, scorer };
}

export function sourceProtocolIdentity(family, options) {
  const { context, scorer } = sourceProtocolDocuments(family, options);
  return { sourceProtocolSha256: family.sourcePolicyDigest,
    contextProtocolSha256: hash(family.contextDomain, context),
    scorerProtocolSha256: hash(family.scorerDomain, scorer) };
}

// The manifest, not an independently supplied phase version, binds exactly one
// closed family. Opaque artifact/adapter/answer inputs remain declared hashes.
export function manifestSourceFamily(manifest) {
  const family = manifest?.sourceProtocolSha256 === legacy.sourcePolicyDigest ? legacy
    : manifest?.sourceProtocolSha256 === supplied.sourcePolicyDigest ? supplied : null;
  if (!family) fail('invalid_mixed_report');
  const cairn = manifest.cairn, evidence = Object.hasOwn(cairn ?? {}, 'comparisonProfile');
  if (!cairn || cairn.qualificationInputProfile !== (evidence ? 'not-requested' : 'adaptive-text-catalog-v1')
    || cairn.captureSourcePolicy !== (evidence ? 'indexed-evidence-v1' : 'indexed-windows-v1')
    || evidence && cairn.comparisonProfile !== 'indexed-evidence-v1') fail('invalid_mixed_report');
  const identity = sourceProtocolIdentity(family, {
    nativeConfigurationSha256: manifest.mem0?.configurationSha256,
    comparisonProfile: evidence ? cairn.comparisonProfile : undefined });
  if (Object.entries(identity).some(([key, value]) => manifest[key] !== value)
    || canonical(manifest.mem0?.wireProfile) !== canonical(MEM0_WIRE_PROFILE)) fail('invalid_mixed_report');
  return family;
}
