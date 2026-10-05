import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMixedRecallErrorCode } from '../mixed-generation.mjs';
import { createMixedModelDiagnosticObserver } from '../mixed-ingestion-diagnostics.mjs';
import { emitDiagnostic } from '../../../core/model-diagnostics.mjs';

test('RFD2 trusted recall projection copies only finite own data codes', () => {
  const codes = ['invalid_input', 'invalid_read_set', 'model_not_configured',
    'model_timeout', 'model_cancelled', 'context_budget_exceeded',
    'token_count_unavailable', 'invalid_model_output', 'recall_failed',
    'revision_conflict', 'context_item_too_large', 'storage_busy', 'storage_error'];
  for (const code of codes) assert.equal(projectMixedRecallErrorCode({ code }), code);
  let touches = 0;
  const error = { code: 'invalid_model_output',
    message: 'RFD_PRIVATE_SENTINEL'.repeat(100_000),
    get source() { touches++; throw Error('must not inspect source'); },
    toJSON() { touches++; throw Error('must not serialize error'); } };
  assert.equal(projectMixedRecallErrorCode(error), 'invalid_model_output');
  assert.equal(touches, 0);
});

test('RFD2 unknown, accessor, inherited and non-enum codes remain unavailable', () => {
  let touches = 0;
  const accessor = { get code() { touches++; return 'invalid_model_output'; } };
  const nonEnum = Object.defineProperty({}, 'code', { value: 'invalid_model_output' });
  const inherited = Object.create({ code: 'invalid_model_output' });
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw Error('RFD_PRIVATE_SENTINEL'); } });
  for (const error of [null, undefined, 'invalid_model_output', {}, accessor, nonEnum,
    inherited, proxy, { code: 'RFD_PRIVATE_SENTINEL' }, { code: 'model_timeout extra' },
    { code: new String('invalid_model_output') }, { code: { toString() { touches++; return 'invalid_model_output'; } } }]) {
    assert.equal(projectMixedRecallErrorCode(error), null);
  }
  assert.equal(touches, 0);
});

test('RFD2 recall cause adds one finite scalar without expanding diagnostic retention', () => {
  const observer = createMixedModelDiagnosticObserver();
  for (let index = 0; index < 70; index++) emitDiagnostic({ onDiagnostic: observer.onDiagnostic },
    'rank', 'core_validation', 'non_visible_ref');
  const snapshot = { ...observer.snapshot(),
    recallErrorCode: projectMixedRecallErrorCode({ code: 'invalid_model_output',
      message: 'RFD_PRIVATE_SENTINEL' }) };
  assert.equal(snapshot.events.length, 64);
  assert.equal(snapshot.retainedEventCount, 64);
  assert.equal(snapshot.omittedEventCount, 6);
  assert.equal(snapshot.recallErrorCode, 'invalid_model_output');
  assert.equal(JSON.stringify(snapshot).includes('RFD_PRIVATE_SENTINEL'), false);
  assert.deepEqual(Object.keys(snapshot),
    ['events', 'retainedEventCount', 'omittedEventCount', 'recallErrorCode']);
});
