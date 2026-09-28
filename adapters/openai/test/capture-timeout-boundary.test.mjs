import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { join } from 'node:path';
import { createOpenAIModel } from '../index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { callModel, isCoreModelDeadlineSignal } from '../../../core/model-call.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const source = 'Synthetic timeout boundary statement.';
const namespace = { ownerId: 'synthetic-timeout', scope: 'personal', projectId: null };
const input = eventId => ({ namespace, client: 'synthetic-test', eventId,
  sessionId: 'synthetic-session', messages: [{ id: 'synthetic-message', role: 'user', content: source }] });
const extractRequest = signal => ({ system: 'Synthetic instructions',
  input: { messages: [{ index: 0, role: 'user', content: source }] }, maxOutputTokens: 1024, signal });
const countRows = (db, table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const json = value => new Response(JSON.stringify(value));
const envelope = value => ({ object: 'response', model: 'gpt-4.1-mini-2025-04-14',
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });

function hangingAdapter() {
  const diagnostics = [];
  const signals = [];
  let generations = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-key',
    onDiagnostic: event => diagnostics.push(event),
    fetchImpl: (url, options) => {
      if (String(url).endsWith('/input_tokens')) return Promise.resolve(new Response(JSON.stringify({
        object: 'response.input_tokens', input_tokens: 100 })));
      generations++;
      signals.push(options.signal);
      return new Promise((_, reject) => {
        if (options.signal.aborted) reject(new DOMException('Synthetic cancellation', 'AbortError'));
        else options.signal.addEventListener('abort', () => reject(new DOMException('Synthetic cancellation', 'AbortError')),
          { once: true });
      });
    } });
  return { model, diagnostics, signals, generations: () => generations };
}

test('synthetic real adapter separates per-call timeout, caller abort, and invocation deadline', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'capture-timeout-boundary-' });
  const perCall = hangingAdapter();
  // A small trusted deadline.remainingMs drives the real per-call timer. Its
  // expired() remains false, so the invocation deadline cannot explain this timeout.
  await assert.rejects(callModel(perCall.model, 'extract', 'Synthetic instructions',
    extractRequest(new AbortController().signal).input,
    { failureCode: 'extraction_failed', deadline: { expired: () => false, remainingMs: () => 60 } }),
  error => error.code === 'model_timeout');
  assert.equal(perCall.generations(), 1);
  assert.equal(perCall.signals[0].aborted, true);
  assert.equal(isCoreModelDeadlineSignal(perCall.signals[0]), true);
  assert.deepEqual(perCall.diagnostics.filter(event => event.layer === 'core_call').map(event => event.reason),
    ['model_timeout']);

  const caller = hangingAdapter();
  const callerController = new AbortController();
  const callerPending = caller.model.extract(extractRequest(callerController.signal));
  while (caller.generations() === 0) await setImmediate();
  callerController.abort('model_timeout'); // Forged reason must grant no core provenance.
  await assert.rejects(callerPending, error => error.name === 'AbortError');
  assert.equal(isCoreModelDeadlineSignal(callerController.signal), false);
  assert.deepEqual(caller.diagnostics.map(event => event.reason), ['model_cancelled']);

  const capture = hangingAdapter();
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model: capture.model, captureDeadlineMs: 500 });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  assert.deepEqual(await core.capture(input('invocation-expiry')),
    { ok: false, error: { code: 'model_timeout', retryable: false } });
  assert.equal(capture.generations(), 1);
  assert.equal(capture.signals[0].aborted, true);
  assert.equal(isCoreModelDeadlineSignal(capture.signals[0]), true);
  assert.equal(countRows(db, 'memories'), 0);
  assert.equal(countRows(db, 'receipts'), 0);
  assert.equal(countRows(db, 'capture_initial_classification'), 0);
  assert.deepEqual(capture.diagnostics.filter(event => event.layer === 'core_call').map(event => event.reason),
    ['capture_deadline']);
  assert.equal(JSON.stringify(capture.diagnostics).includes(source), false);
  assert.equal(JSON.stringify(capture.diagnostics).includes('synthetic-offline-key'), false);
});

test('fast real capture completes once and duplicate capture sends no more requests', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'capture-timeout-fast-' });
  const calls = [];
  const diagnostics = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-key',
    onDiagnostic: event => diagnostics.push(event),
    fetchImpl: async (url, options) => {
      calls.push(String(url).endsWith('/input_tokens') ? 'count' : 'generate');
      if (String(url).endsWith('/input_tokens')) return json({ object: 'response.input_tokens', input_tokens: 100 });
      const body = JSON.parse(options.body);
      if (body.text.format.name === 'cairn_extract') return json(envelope({ items: [{
        content: source, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }));
      assert.equal(body.text.format.name, 'cairn_classify');
      const request = JSON.parse(body.input[0].content[0].text);
      return json(envelope({ items: request.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }));
    } });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
    captureDeadlineMs: 1000 });
  workspace.defer(() => core.close());
  const captured = await core.capture(input('fast'));
  assert.equal(captured.ok, true, JSON.stringify(captured));
  assert.equal(captured.value.classification.status, 'applied');
  assert.deepEqual(calls, ['count', 'generate', 'count', 'generate']);
  assert.deepEqual(diagnostics, []);
  const duplicate = await core.capture(input('fast'));
  assert.equal(duplicate.ok, true, JSON.stringify(duplicate));
  assert.equal(duplicate.value.duplicate, true);
  assert.equal(calls.length, 4);
});

test('post-admission classifier timeout retains one receipt and failed journal', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'capture-timeout-post-' });
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-key', fetchImpl: (url, options) => {
    if (String(url).endsWith('/input_tokens')) {
      calls.push('count');
      return Promise.resolve(json({ object: 'response.input_tokens', input_tokens: 100 }));
    }
    const body = JSON.parse(options.body);
    calls.push(body.text.format.name);
    if (body.text.format.name === 'cairn_extract') return Promise.resolve(json(envelope({ items: [{
      content: source, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] })));
    assert.equal(body.text.format.name, 'cairn_classify');
    return new Promise((_, reject) => options.signal.addEventListener('abort',
      () => reject(new DOMException('Synthetic cancellation', 'AbortError')), { once: true }));
  } });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model, captureDeadlineMs: 500 });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  const result = await core.capture(input('post-admission'));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.admission.memories.length, 1);
  assert.equal(result.value.classification.status, 'failed');
  assert.equal(result.value.classification.error.code, 'model_timeout');
  assert.deepEqual(calls, ['count', 'cairn_extract', 'count', 'cairn_classify']);
  assert.equal(countRows(db, 'memories'), 1);
  assert.equal(countRows(db, 'receipts'), 1);
  assert.equal(db.prepare('SELECT status FROM capture_initial_classification').get().status, 'failed');
  const duplicate = await core.capture(input('post-admission'));
  assert.equal(duplicate.ok, true, JSON.stringify(duplicate));
  assert.equal(duplicate.value.duplicate, true);
  assert.equal(calls.length, 4);
  assert.equal(countRows(db, 'receipts'), 1);
});
