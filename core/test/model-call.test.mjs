import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { callModel, isCoreModelDeadlineSignal } from '../model-call.mjs';
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
  for (const code of ['revision_conflict', 'storage_busy', 'not_found', 'capture_evidence_closed']) {
    await assert.rejects(invoke(() => { throw new MemoryStoreError(code); },
      { failureCode: 'extraction_failed' }), (error) => error.code === 'extraction_failed');
  }
});

test('trusted invocation freshness failure keeps its code; forged model error does not', async () => {
  let checks = 0; let modelCalls = 0;
  const closed = new MemoryStoreError('capture_evidence_closed');
  await assert.rejects(invoke(() => { modelCalls++; return {}; }, { validateFresh() {
    if (++checks === 2) throw closed;
  } }), error => error === closed);
  assert.equal(checks, 2); assert.equal(modelCalls, 0);
  await assert.rejects(invoke(() => { throw new MemoryStoreError('capture_evidence_closed'); },
    { validateFresh: () => {} }), { code: 'recall_failed' });
});

test('deadline expiry after invocation freshness still wins before model dispatch', async () => {
  let expired = false; let checks = 0; let modelCalls = 0;
  const deadline = { expired: () => expired, remainingMs: () => 10_000 };
  await assert.rejects(invoke(() => { modelCalls++; return {}; }, { deadline, validateFresh() {
    if (++checks === 2) { expired = true; throw new MemoryStoreError('capture_evidence_closed'); }
  } }), { code: 'model_timeout' });
  assert.equal(modelCalls, 0);
});

test('adapter cancellation retains the existing explicit cancellation envelope', async () => {
  await assert.rejects(invoke(() => { throw new DOMException('Synthetic', 'AbortError'); }),
    (error) => error.code === 'model_cancelled');
});

test('finite timeout diagnostics require trusted invocation expiry, including before model dispatch', async () => {
  const events = [];
  let counts = 0; let calls = 0;
  const model = { contextWindow: 8192,
    countTokens: () => { counts++; return 1; },
    select: () => { calls++; return { refs: [] }; },
    onDiagnostic: event => events.push(event) };
  await assert.rejects(callModel(model, 'select', 'Synthetic', {},
    { deadline: { expired: () => true } }), { code: 'model_timeout' });
  assert.equal(counts, 0);
  assert.equal(calls, 0);
  assert.deepEqual(events.map(event => event.reason), ['capture_deadline']);

  events.length = 0;
  let expired = false;
  model.countTokens = () => { counts++; expired = true; return 1; };
  await assert.rejects(callModel(model, 'select', 'Synthetic', {},
    { deadline: { expired: () => expired } }), { code: 'model_timeout' });
  assert.equal(calls, 0);
  assert.deepEqual(events.map(event => event.reason), ['capture_deadline']);

  events.length = 0;
  model.countTokens = () => 1;
  model.select = () => { calls++; throw new MemoryStoreError('model_timeout'); };
  await assert.rejects(callModel(model, 'select', 'Synthetic', {},
    { deadline: { expired: () => false, remainingMs: () => 100 } }), { code: 'model_timeout' });
  assert.equal(calls, 1);
  assert.deepEqual(events.map(event => event.reason), ['model_timeout']);
});

test('per-call timer keeps its origin if the invocation expires during abort delivery', async () => {
  const events = [];
  let expired = false;
  let signal;
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: request => {
      signal = request.signal;
      return new Promise((_, reject) => signal.addEventListener('abort', () => {
        expired = true;
        reject(new DOMException('Synthetic', 'AbortError'));
      }, { once: true }));
    }, onDiagnostic: event => events.push(event) };
  await assert.rejects(callModel(model, 'select', 'Synthetic', {},
    { deadline: { expired: () => expired, remainingMs: () => 20 } }), { code: 'model_timeout' });
  assert.equal(expired, true);
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  assert.deepEqual(events.map(event => event.reason), ['model_timeout']);
});

test('delayed per-call timer remains per-call after longer invocation expires', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  let expired = false;
  let signal;
  let remainingCalls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: request => { signal = request.signal; return new Promise(() => {}); },
    onDiagnostic: event => events.push(event) };
  const pending = callModel(model, 'select', 'Synthetic', {}, { deadline: {
    expired: () => expired,
    remainingMs: () => { remainingCalls++; return 30_000; },
  } });
  const rejected = assert.rejects(pending, { code: 'model_timeout' });
  await setImmediate();
  assert.equal(remainingCalls, 1, 'the existing per-call ceiling was scheduled');
  assert.equal(signal.aborted, false);
  // Simulate an event loop blocked beyond the longer invocation deadline:
  // expiry becomes visible before the already-scheduled per-call callback runs.
  expired = true;
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  assert.deepEqual(events.map(event => event.reason), ['model_timeout']);
});

test('invocation-limited timer firing before trusted expiry remains unclassified', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  let signal;
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: request => { signal = request.signal; return new Promise(() => {}); },
    onDiagnostic: event => events.push(event) };
  const pending = callModel(model, 'select', 'Synthetic', {}, { deadline: {
    expired: () => false,
    remainingMs: () => 500,
  } });
  const rejected = assert.rejects(pending, { code: 'model_timeout' });
  await setImmediate();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(500);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  assert.deepEqual(events.map(event => event.reason), ['model_timeout']);
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
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
});
