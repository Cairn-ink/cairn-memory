import { createHash } from 'node:crypto';

import { mem0WireProfile } from '../experiment-budget/mem0-wire.mjs';
import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { experimentPolicy } from '../live/session.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { NATIVE_PROFILE, projectMixedResources } from '../longmemeval/mixed-resource.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Preflight returns metadata only and never imports the evaluator or reads a ledger. */
export function inspectClassificationFollowupSources() {
  if (sourceCases.length !== 2 || JSON.stringify(armOrders)
    !== JSON.stringify([['cairn', 'mem0'], ['mem0', 'cairn']])) {
    throw new Error('invalid_classification_followup_fixture');
  }
  const cases = sourceCases.map(row => {
    const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
    const lengths = row.history.sessions.flatMap(session => session.turns.map(turn => turn.content.length));
    const perSessionBatches = row.history.sessions.map((_, index) => plan.cairnPlan.batches
      .filter(batch => batch.source.sessionIndex === index).length);
    if (plan.counts.originalSessions !== 16 || plan.counts.eligibleSessions !== 16
      || plan.counts.originalTurns !== 512 || plan.counts.renderedTurns !== 512
      || plan.counts.windows !== 512 || plan.counts.batches !== 32
      || perSessionBatches.some(count => count !== 2)
      || plan.cairnPlan.captureSourcePolicy !== 'indexed-evidence-v1'
      || plan.cairnPlan.qualificationStatus !== 'not-requested'
      || !plan.cairnPlan.executable || lengths.some(length => length < 1 || length > 4_000)) {
      throw new Error('invalid_classification_followup_fixture');
    }
    return { counts: { ...plan.counts }, perSessionBatches,
      contentUtf16: lengths.reduce((sum, length) => sum + length, 0),
      minimumTurnUtf16: Math.min(...lengths), maximumTurnUtf16: Math.max(...lengths),
      originalHistoryDigest: plan.originalHistoryDigest, caseDigest: plan.caseDigest };
  });
  const sourceJson = JSON.stringify(sourceCases);
  return freeze({ sourceJsonSha256: hash(sourceJson), sourceJsonBytes: Buffer.byteLength(sourceJson),
    armOrdersSha256: hash(JSON.stringify(armOrders)), cases });
}

/** Pure arithmetic proposal. The caller supplies a fresh schema-2 context; this function opens no ledger. */
export function projectClassificationFollowupBudget(runContext) {
  const keys = ['schemaVersion', 'originalLimitMicroUsd', 'remainingMicroUsd',
    'protectedMicroUsd', 'requestCount', 'requestCap'];
  if (!runContext || Object.getPrototypeOf(runContext) !== Object.prototype
    || Object.keys(runContext).sort().join(',') !== keys.sort().join(',')
    || runContext.schemaVersion !== 2
    || runContext.originalLimitMicroUsd !== 200_000_000
    || runContext.protectedMicroUsd < 30_000_000
    || ![runContext.remainingMicroUsd, runContext.protectedMicroUsd,
      runContext.requestCount, runContext.requestCap].every(value =>
      Number.isSafeInteger(value) && value >= 0)
    || runContext.remainingMicroUsd > runContext.originalLimitMicroUsd
    || runContext.protectedMicroUsd > runContext.remainingMicroUsd
    || runContext.requestCount > runContext.requestCap) {
    throw new Error('invalid_classification_followup_run_context');
  }
  const projection = projectMixedResources({ batchCounts: [32, 32],
    policy: experimentPolicy(), stages: benchmarkStagePolicy(),
    wireProfile: mem0WireProfile(), nativeProfile: NATIVE_PROFILE,
    remainingMicroUsd: runContext.remainingMicroUsd,
    protectedMicroUsd: runContext.protectedMicroUsd,
    comparisonProfile: 'indexed-evidence-v1' });
  const joint = projection.conditionalCeilings.joint;
  const proposedRequestCap = runContext.requestCount + joint.requests;
  if (!projection.budget.upperBoundFits || joint.reservedMicroUsd > 4_000_000
    || !Number.isSafeInteger(proposedRequestCap)) {
    throw new Error('classification_followup_budget_does_not_fit');
  }
  return freeze({ version: 'm1e-classification-followup-budget-proposal-v1',
    schemaVersion: 2, originalLimitMicroUsd: runContext.originalLimitMicroUsd,
    remainingMicroUsd: runContext.remainingMicroUsd,
    protectedMicroUsd: runContext.protectedMicroUsd,
    currentRequestCount: runContext.requestCount, currentRequestCap: runContext.requestCap,
    proposedRequestCap: Math.max(runContext.requestCap, proposedRequestCap),
    maximumNewRequests: joint.requests, maximumNewReservedMicroUsd: joint.reservedMicroUsd,
    projectedRemainingAfterMaximumMicroUsd: runContext.remainingMicroUsd - joint.reservedMicroUsd,
    grantsBudget: false });
}
