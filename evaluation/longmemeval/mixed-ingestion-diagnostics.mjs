import { isDeepStrictEqual } from 'node:util';

import { projectIngestionFailure } from './ingestion.mjs';

const STATUSES = ['completed', 'duplicate', 'failed', 'partial', 'unknown', 'not_run'];
const RETAINED_DIAGNOSTICS = 64;

// Only core/model-diagnostics emits to this private observer. That emitter
// validates its finite stage/layer/reason vocabulary before invoking us.
export function createMixedModelDiagnosticObserver() {
  const events = [];
  let omittedEventCount = 0;
  return {
    onDiagnostic(event) {
      if (events.length < RETAINED_DIAGNOSTICS) {
        events.push({ version: event.version, stage: event.stage,
          layer: event.layer, reason: event.reason });
      } else omittedEventCount++;
    },
    snapshot() {
      return { events: events.map(event => ({ ...event })),
        retainedEventCount: events.length, omittedEventCount };
    },
  };
}

export function summarizeMixedIngestionStop(ingested, expectedPlan) {
  if (!isDeepStrictEqual(ingested.plan, expectedPlan)
    || ingested.outcomes.length !== expectedPlan.batches.length) {
    return { kind: 'plan_mismatch' };
  }
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  let firstStop = null;
  for (const [index, outcome] of ingested.outcomes.entries()) {
    if (!Object.hasOwn(counts, outcome.status)) return { kind: 'plan_mismatch' };
    counts[outcome.status]++;
    if (firstStop === null && outcome.status !== 'completed') {
      const projected = projectIngestionFailure(outcome);
      firstStop = { batchIndex: index, status: outcome.status,
        ...(projected ? { errorStage: projected.errorStage,
          errorCode: projected.error.code, retryable: projected.error.retryable } : {}) };
    }
  }
  return { kind: 'capture_outcome', counts, firstStop };
}
