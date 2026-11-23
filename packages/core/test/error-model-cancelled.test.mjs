import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoreError, ERROR_CODES } from '../src/errors.mjs';

test('model_cancelled is a non-retryable unavailable code (Phase 0 addendum 2)', () => {
  assert.equal(ERROR_CODES.model_cancelled, 'unavailable');
  const error = new CoreError('model_cancelled');
  assert.equal(error.code, 'model_cancelled');
  assert.equal(error.message, 'model_cancelled');
  assert.notEqual(ERROR_CODES.model_cancelled, 'retryable');
  assert.equal(ERROR_CODES.model_timeout, 'unavailable');
});
