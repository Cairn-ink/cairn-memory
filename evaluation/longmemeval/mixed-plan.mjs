// Private production pre-capture check, also exercised directly by denial tests.
import { isDeepStrictEqual } from 'node:util';

import { planIndexedWindowLongMemEvalCase } from './ingestion.mjs';
import { fail } from './mixed-validation.mjs';

export function verifyMixedCapturePlan({ history, namespace, expectedPlan }) {
  const planned = planIndexedWindowLongMemEvalCase({ history, namespace });
  if (!isDeepStrictEqual(planned, expectedPlan)) fail('planner_mismatch');
  return planned;
}
