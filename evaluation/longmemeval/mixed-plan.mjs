// Private production pre-capture check, also exercised directly by denial tests.
import { isDeepStrictEqual } from 'node:util';

import { planIndexedWindowLongMemEvalCase, planIndexedEvidenceLongMemEvalCase } from './ingestion.mjs';
import { fail } from './mixed-validation.mjs';

export function verifyMixedCapturePlan({ history, namespace, expectedPlan, comparisonProfile }) {
  if (comparisonProfile !== undefined && comparisonProfile !== 'indexed-evidence-v1') fail('planner_mismatch');
  const planned = (comparisonProfile === 'indexed-evidence-v1'
    ? planIndexedEvidenceLongMemEvalCase : planIndexedWindowLongMemEvalCase)({ history, namespace });
  if (!isDeepStrictEqual(planned, expectedPlan)) fail('planner_mismatch');
  return planned;
}
