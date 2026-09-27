import assert from 'node:assert/strict';
import test from 'node:test';

import { emitDiagnostic } from '../../../core/model-diagnostics.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { createMixedModelDiagnosticObserver,
  summarizeMixedIngestionStop } from '../mixed-ingestion-diagnostics.mjs';

const secret = 'SYNTHETIC_PRIVATE_SOURCE_PROVIDER_BODY';
const plan = { batches: Array.from({ length: 6 }, (_, batchIndex) => ({ batchIndex })) };
const rows = [
  { status: 'completed' }, { status: 'duplicate' },
  { status: 'failed', error: { code: secret, retryable: true, message: secret } },
  { status: 'partial', result: { classification: { error: { code: 'classification_failed',
    retryable: false, message: secret } } } },
  { status: 'unknown', error: { code: 'malformed_capture_response', retryable: false } },
  { status: 'not_run' },
];

test('O2 fixed status counts and first stopping outcome exclude private fields', () => {
  const projection = summarizeMixedIngestionStop({ plan, outcomes: rows }, plan);
  assert.equal(projection.kind, 'capture_outcome');
  assert.deepEqual(projection.counts, { completed: 1, duplicate: 1, failed: 1,
    partial: 1, unknown: 1, not_run: 1 });
  assert.deepEqual(projection.firstStop, { batchIndex: 1, status: 'duplicate' });
  assert.equal(JSON.stringify(projection).includes(secret), false);
  for (const [index, expected] of [
    [2, { errorStage: 'capture', errorCode: 'capture_failed', retryable: false }],
    [3, { errorStage: 'classification', errorCode: 'classification_failed', retryable: false }],
    [4, { errorStage: 'capture', errorCode: 'malformed_capture_response', retryable: false }],
  ]) {
    const prior = Array.from({ length: index }, () => ({ status: 'completed' }));
    const current = summarizeMixedIngestionStop({ plan, outcomes: [
      ...prior, rows[index], ...Array.from({ length: 5 - index }, () => ({ status: 'not_run' }))] }, plan);
    assert.deepEqual(current.firstStop, { batchIndex: index, status: rows[index].status, ...expected });
  }
  const staleAdmission = summarizeMixedIngestionStop({ plan, outcomes: [
    { status: 'failed', error: { code: 'stale_admission', retryable: false } },
    ...Array.from({ length: 5 }, () => ({ status: 'not_run' }))] }, plan);
  assert.deepEqual(staleAdmission.firstStop, { batchIndex: 0, status: 'failed',
    errorStage: 'capture', errorCode: 'stale_admission', retryable: false });
});

test('O2 plan mismatch is distinct from a stopped capture', () => {
  assert.deepEqual(summarizeMixedIngestionStop({ plan: { batches: [] }, outcomes: rows }, plan),
    { kind: 'plan_mismatch' });
  assert.deepEqual(summarizeMixedIngestionStop({ plan, outcomes: rows.slice(1) }, plan),
    { kind: 'plan_mismatch' });
  assert.deepEqual(summarizeMixedIngestionStop({ plan, outcomes: [
    ...rows.slice(0, 5), { status: secret }] }, plan), { kind: 'plan_mismatch' });
});

test('O2 bounded finite diagnostics omit overflow and never project raw errors', () => {
  const observer = createMixedModelDiagnosticObserver();
  for (let index = 0; index < 70; index++) {
    emitDiagnostic({ onDiagnostic: observer.onDiagnostic }, 'extract', 'core_validation',
      'invalid_extraction_source_range');
  }
  emitDiagnostic({ onDiagnostic: observer.onDiagnostic }, secret, 'adapter', secret);
  const snapshot = observer.snapshot();
  assert.equal(snapshot.retainedEventCount, 64);
  assert.equal(snapshot.omittedEventCount, 6);
  assert.equal(snapshot.events.length, 64);
  assert.deepEqual(snapshot.events[0], { version: 1, stage: 'extract',
    layer: 'core_validation', reason: 'invalid_extraction_source_range' });
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  snapshot.events[0].reason = secret;
  assert.equal(observer.snapshot().events[0].reason, 'invalid_extraction_source_range');
});

test('O2 throwing observers do not change the core model-call failure', async () => {
  for (const onDiagnostic of [() => {}, () => { throw new Error(secret); }]) {
    let calls = 0;
    const model = { contextWindow: 8192, countTokens: () => 1,
      extract: () => { calls++; throw new Error(secret); }, onDiagnostic };
    await assert.rejects(callModel(model, 'extract', 'synthetic system', {},
      { failureCode: 'extraction_failed' }), { code: 'extraction_failed' });
    assert.equal(calls, 1);
  }
});
