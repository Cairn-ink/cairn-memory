import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { experimentPolicy } from '../live/session.mjs';
import { mem0WireProfile } from '../experiment-budget/mem0-wire.mjs';
import { mixedSourcePolicy, suppliedHistoryPolicy } from './mixed-source.mjs';
import { OFFICIAL_JUDGE_MODEL, OFFICIAL_QUESTION_TYPES, OFFICIAL_UPSTREAM_COMMIT } from './official-scoring.mjs';
import { fail, freeze, hash } from './mixed-validation.mjs';

export const MIXED_GENERATION_VERSION = 'cairn-lme-mixed-generation-v1';
export const MIXED_SCORING_VERSION = 'cairn-lme-mixed-scoring-v1';
const legacy = freeze({ preparation: 'cairn-lme-mixed-preparation-v1',
  indexedPreparation: 'cairn-lme-mixed-indexed-evidence-preparation-v1',
  generation: MIXED_GENERATION_VERSION, scoring: MIXED_SCORING_VERSION,
  sourcePolicyDigest: mixedSourcePolicy().digest,
  contextDomain: 'cairn.lme.mixed.context.v1', scorerDomain: 'cairn.lme.mixed.scorer.v1',
  caseDomain: 'cairn.lme.mixed.case-protocol.v1', generationDomain: 'cairn.lme.mixed.generation-report.v1' });
const supplied = freeze({ preparation: 'cairn-lme-supplied-history-mixed-preparation-v1',
  indexedPreparation: 'cairn-lme-supplied-history-mixed-indexed-evidence-preparation-v1',
  generation: 'cairn-lme-supplied-history-mixed-generation-v1',
  scoring: 'cairn-lme-supplied-history-mixed-scoring-v1',
  sourcePolicyDigest: suppliedHistoryPolicy().digest,
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

export function sourceProtocolIdentity(family, { nativeConfigurationSha256, comparisonProfile }) {
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
    experimentPolicy: experimentPolicy(), stages: benchmarkStagePolicy(), wireProfile: mem0WireProfile() };
  if (evidenceOnly) {
    context.version = 'mixed-indexed-evidence-context-v1';
    context.comparisonProfile = comparisonProfile;
    context.cairnQualification = 'not-requested';
    context.captureSourcePolicy = 'indexed-evidence-v1';
    delete context.qualificationDispatchPolicy;
  }
  const scorer = { version: 'mixed-scorer-v1', upstreamCommit: OFFICIAL_UPSTREAM_COMMIT,
    judgeModel: OFFICIAL_JUDGE_MODEL, questionTypes: OFFICIAL_QUESTION_TYPES,
    judgePolicy: benchmarkStagePolicy().judge, aggregation: 'fixed-N-paired-3x3-v1' };
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
  return { sourceProtocolSha256: family.sourcePolicyDigest,
    contextProtocolSha256: hash(family.contextDomain, context),
    scorerProtocolSha256: hash(family.scorerDomain, scorer) };
}
