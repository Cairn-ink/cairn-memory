import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('retained qualification pilot failure aggregate preserves the frozen denominator and unknown costs', () => {
  const bytes = readFileSync(new URL('../qualification-pilot-fixture.json', import.meta.url));
  const fixture = JSON.parse(bytes);
  const result = JSON.parse(readFileSync(new URL('../../../evaluations/results/qualification-pilot-v1.json', import.meta.url)));
  assert.equal(result.fixtureSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(result.cases.map(item => item.id), fixture.cases.map(item => item.id));
  assert.equal(result.caseCount, 6);
  assert.equal(result.completedCases, 0);
  assert.equal(result.failedCases, result.caseCount);
  assert.equal(result.plannedEvents, 12);
  assert.equal(result.failedInitialEvents + result.notRunDependentEvents, result.plannedEvents);
  assert.ok(result.cases.every(item => item.initial === 'invalid_model_output' && item.later === 'not_run'));
  assert.equal(result.accounting.httpRequests, 24);
  assert.equal(result.accounting.reservedMicroUsd, 24 * 5000);
  assert.equal(result.accounting.providerKnownUsageMicroUsd, 4334);
  assert.equal(result.accounting.unknownCostCountRequests, 12);
  assert.equal(result.accounting.unsettledRequests, 0);
  assert.equal(result.review.semanticAccuracy, 'not_established');
  assert.equal(result.review.currentnessAccuracy, 'not_evaluated');
  assert.equal(result.review.releaseQualification, 'not_passed');
});
