import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { callModel } from '../model-call.mjs';
import { MemoryStoreError } from '../validation.mjs';

const invoke = (callback, options) => callModel({ contextWindow: 8192,
  countTokens: () => 1, select: callback }, 'select', 'Synthetic', {}, options);

test('trusted adapter budget/output errors retain only the narrow existing codes', async () => {
  for (const code of ['context_budget_exceeded', 'token_count_unavailable', 'invalid_model_output']) {
    await assert.rejects(invoke(() => { throw new MemoryStoreError(code); }),
      (error) => error instanceof MemoryStoreError && error.code === code);
    await assert.rejects(invoke(() => { throw { code, message: 'secret provider body' }; }),
      (error) => error.code === 'recall_failed' && !error.message.includes('secret'));
  }
  for (const code of ['revision_conflict', 'storage_busy', 'not_found']) {
    await assert.rejects(invoke(() => { throw new MemoryStoreError(code); },
      { failureCode: 'extraction_failed' }), (error) => error.code === 'extraction_failed');
  }
});

test('adapter cancellation retains the existing explicit cancellation envelope', async () => {
  await assert.rejects(invoke(() => { throw new DOMException('Synthetic', 'AbortError'); }),
    (error) => error.code === 'model_cancelled');
});

test('one core deadline aborts a pending two-phase adapter without extending phase two', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  let phases = 0;
  const pending = invoke(async (request) => {
    signal = request.signal;
    phases++;
    await setImmediate();
    phases++;
    return new Promise(() => {});
  });
  const rejected = assert.rejects(pending, (error) => error.code === 'model_timeout');
  await setImmediate();
  await setImmediate();
  assert.equal(phases, 2);
  t.mock.timers.tick(29999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(signal.aborted, true);
});
