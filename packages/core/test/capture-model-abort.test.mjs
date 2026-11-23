import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaptureDeadline } from '../src/capture/deadline.mjs';
import { callModel } from '../src/capture/model-call.mjs';

const request = { system: 'Extract synthetic facts.', input: { messages: [{ index: 0, role: 'user', content: 'Cedar tea.' }] },
  maxOutputTokens: 1024 };

test('non-positive remaining budget refuses before model.call', async () => {
  for (const remaining of [0, -1]) {
    let calls = 0;
    const model = { contextWindow: 8192, countTokens: () => 1, async call() { calls++; } };
    const deadline = { expired: () => false, remainingMs: () => remaining };
    const events = [];
    await assert.rejects(callModel(model, 'extract', request, { deadline, onDiagnostic: event => events.push(event) }),
      { code: 'model_timeout' });
    assert.equal(calls, 0);
    assert.deepEqual(events, [{ version: 1, stage: 'extract', layer: 'core_call', reason: 'model_timeout' }]);
  }
});

test('deadline aborts the signal seen by an in-flight provider that never settles', async () => {
  let time = 100;
  let signal;
  let aborts = 0;
  const deadline = createCaptureDeadline(5, { monotonicMs: () => time });
  const model = {
    contextWindow: 8192,
    countTokens: () => 1,
    call(_stage, _request, options) {
      signal = options.signal;
      signal.addEventListener('abort', () => { aborts++; time += 5; }, { once: true });
      return new Promise(() => {});
    },
  };

  // Keep the event loop alive for the unref'd abort timer and bound a failed run.
  let watchdog;
  const failIfStalled = new Promise((_, reject) => {
    watchdog = setTimeout(() => reject(new Error('provider signal did not abort')), 50);
  });
  const events = [];
  try {
    await assert.rejects(Promise.race([callModel(model, 'extract', request, {
      deadline, onDiagnostic: event => events.push(event),
    }), failIfStalled]), { code: 'model_timeout' });
  } finally { clearTimeout(watchdog); }
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.name, 'TimeoutError');
  assert.equal(aborts, 1);
  assert.deepEqual(events, [{ version: 1, stage: 'extract', layer: 'core_call', reason: 'model_timeout' }]);
});

test('caller cancellation reaches the in-flight provider and reports the pending cancellation code', async () => {
  const caller = new AbortController();
  const deadline = createCaptureDeadline(40, { monotonicMs: () => 100 });
  const reason = new DOMException('synthetic', 'AbortError');
  let sent;
  const dispatched = new Promise(resolve => { sent = resolve; });
  let rejectProvider;
  const provider = new Promise((_, reject) => { rejectProvider = reject; });
  const model = { contextWindow: 8192, countTokens: () => 1,
    call(_stage, _request, { signal }) { sent(signal); return provider; } };
  const events = [];
  const result = callModel(model, 'extract', request, {
    deadline, signal: caller.signal, onDiagnostic: event => events.push(event),
  });
  const rejection = assert.rejects(result, { name: 'CoreError', code: 'model_cancelled' });
  const signal = await Promise.race([dispatched, result]);
  assert.equal(signal.aborted, false);
  caller.abort(reason);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason, reason);
  await rejection;
  rejectProvider(reason);
  assert.deepEqual(events, [{ version: 1, stage: 'extract', layer: 'core_call', reason: 'model_cancelled' }]);
});

test('an already cancelled caller makes no outbound call', async () => {
  let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { calls++; } };
  const caller = new AbortController();
  caller.abort();
  await assert.rejects(callModel(model, 'extract', request, { signal: caller.signal }), { code: 'model_cancelled' });
  assert.equal(calls, 0);
});
