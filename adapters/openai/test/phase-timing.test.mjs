import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createOpenAIModel } from '../index.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const request = () => ({ system: 'Synthetic instructions',
  input: { messages: [{ index: 0, role: 'user', content: 'Synthetic source' }] },
  maxOutputTokens: 1024, signal: new AbortController().signal });
const generation = () => ({ object: 'response', model: 'gpt-4.1-mini-2025-04-14',
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: '{"items":[]}' }] }],
  usage: { input_tokens: 100, output_tokens: 4, total_tokens: 104 } });
const countResponse = () => Response.json({ object: 'response.input_tokens', input_tokens: 100 });
const generationResponse = () => Response.json(generation());
function captureResponse(url, options) {
  if (url.endsWith('/input_tokens')) return countResponse();
  const body = JSON.parse(options.body);
  const input = JSON.parse(body.input[0].content[0].text);
  const output = body.text.format.name === 'cairn_extract'
    ? { items: [{ content: 'Synthetic source', kind: 'fact', confidence: 0.8,
      sourceIndices: [0] }] }
    : { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
  return Response.json({ ...generation(), model: body.model,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
}
const stages = new Set(['extract', 'classify', 'select', 'selectChecklist', 'rank',
  'reconcile', 'qualify', 'qualifyCandidates', 'interpretEpisode', 'relate', 'reviewBasis']);
const phases = new Set(['prepare', 'count_transport', 'count_body', 'count_validation',
  'generation_transport', 'generation_body', 'output_validation']);
const outcomes = new Set(['completed', 'failed', 'aborted']);
const expectedPhases = [...phases];
const captureInput = (eventId = 'event-one') => ({
  namespace: { ownerId: 'phase-timing-test', scope: 'personal', projectId: null },
  client: 'synthetic', sessionId: 'session', eventId,
  messages: [{ id: 'message-one', role: 'user', content: 'Synthetic source' }],
});
const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.value; };
function eventShape(events) {
  assert.ok(events.length <= 7);
  assert.equal(new Set(events.map(event => event.phase)).size, events.length);
  for (const event of events) {
    assert.deepEqual(Object.keys(event), ['version', 'stage', 'phase', 'outcome', 'elapsedMs']);
    assert.equal(event.version, 1);
    assert.ok(stages.has(event.stage));
    assert.ok(phases.has(event.phase));
    assert.ok(outcomes.has(event.outcome));
    assert.ok(Number.isFinite(event.elapsedMs) && event.elapsedMs >= 0 &&
      event.elapsedMs <= 2_147_483_647);
    assert.equal(Object.isFrozen(event), true);
    assert.doesNotMatch(JSON.stringify(event), /Synthetic source|synthetic-key|provider-secret/u);
  }
}
function fakeModel(fetchImpl, onPhaseTiming, onDiagnostic) {
  return createOpenAIModel({ apiKey: 'synthetic-key', fetchImpl,
    ...(onPhaseTiming === undefined ? {} : { onPhaseTiming }),
    ...(onDiagnostic === undefined ? {} : { onDiagnostic }) });
}
function invokeCore(model) {
  return callModel(model, 'extract', 'Synthetic instructions', request().input,
    { failureCode: 'extraction_failed' });
}
const waitFor = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('W01 red: opt-in phase timing observes one real two-request adapter invocation', async () => {
  const events = [];
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', onPhaseTiming: event => events.push(event),
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options.body });
      return new Response(JSON.stringify(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 100 } : generation()));
    } });
  assert.deepEqual(await model.extract(request()), { items: [] });
  assert.equal(calls.length, 2);
  assert.deepEqual(events.map(event => event.phase), expectedPhases);
  assert.ok(events.every(event => event.outcome === 'completed' && event.stage === 'extract'));
  eventShape(events);
});

test('W01 explicit undefined matches omission without installing a timing callback', async () => {
  async function run(explicitUndefined, failOutput) {
    const calls = [], diagnostics = [];
    const options = {
      apiKey: 'synthetic',
      fetchImpl: async (url, requestOptions) => {
        calls.push({ url, body: requestOptions.body });
        if (url.endsWith('/input_tokens')) return countResponse();
        return failOutput ? Response.json({ ...generation(), status: 'failed' }) : generationResponse();
      },
      onDiagnostic: event => diagnostics.push(event),
    };
    if (explicitUndefined) options.onPhaseTiming = undefined;
    assert.equal(Object.hasOwn(options, 'onPhaseTiming'), explicitUndefined);
    const model = createOpenAIModel(options);
    let result;
    try { result = { status: 'fulfilled', value: await model.extract(request()) }; }
    catch (error) {
      result = { status: 'rejected', error: { name: error.name, message: error.message, code: error.code } };
    }
    return { result, calls, diagnostics };
  }

  for (const failOutput of [false, true]) {
    const omitted = await run(false, failOutput);
    const explicitUndefined = await run(true, failOutput);
    assert.deepEqual(explicitUndefined, omitted);
    assert.equal(omitted.calls.length, 2);
    assert.deepEqual(omitted.calls.map(({ url }) => url.endsWith('/input_tokens') ? 'count' : 'generation'),
      ['count', 'generation']);
    if (failOutput) {
      assert.equal(omitted.result.status, 'rejected');
      assert.equal(omitted.result.error.code, 'invalid_model_output');
      assert.deepEqual(omitted.diagnostics, [{ version: 1, stage: 'extract', layer: 'adapter',
        reason: 'response_envelope' }]);
    } else {
      assert.deepEqual(omitted.result, { status: 'fulfilled', value: { items: [] } });
      assert.deepEqual(omitted.diagnostics, []);
    }
  }
});

test('W01/W02 invalid option, disabled and hostile observers preserve exact wires and errors', async () => {
  for (const onPhaseTiming of [null, false, 0, 'callback', [], {}]) {
    assert.throws(() => fakeModel(() => assert.fail('no HTTP'), onPhaseTiming),
      /invalid_openai_configuration/u);
  }
  const variants = [undefined, () => {}, () => { throw Error('provider-secret'); },
    async () => { throw Error('provider-secret'); },
    () => Object.defineProperty({}, 'then', { get() { throw Error('provider-secret'); } })];
  let baseline;
  for (const onPhaseTiming of variants) {
    const wires = [], diagnostics = [], events = [];
    const req = request();
    const callback = onPhaseTiming === undefined ? undefined : event => {
      events.push(event);
      req.input.messages[0].content = 'Mutated after serialization';
      return onPhaseTiming(event);
    };
    const model = fakeModel(async (url, options) => {
      wires.push({ url, body: options.body, signal: options.signal });
      return url.endsWith('/input_tokens') ? countResponse() : generationResponse();
    }, callback, event => diagnostics.push(event));
    assert.deepEqual(await model.extract(req), { items: [] });
    assert.equal(wires.length, 2);
    assert.equal(wires[0].signal, req.signal);
    assert.equal(wires[1].signal, req.signal);
    const comparable = wires.map(({ url, body }) => ({ url, body }));
    baseline ??= comparable;
    assert.deepEqual(comparable, baseline);
    assert.doesNotMatch(JSON.stringify(comparable), /Mutated after serialization/u);
    assert.deepEqual(diagnostics, []);
    if (callback) { assert.deepEqual(events.map(event => event.phase), expectedPhases); eventShape(events); }
    await setImmediate();
  }
  for (const onPhaseTiming of variants) {
    let calls = 0;
    const events = [];
    const model = fakeModel(async () => { calls++; return countResponse(); },
      onPhaseTiming === undefined ? undefined : event => { events.push(event); return onPhaseTiming(event); });
    await assert.rejects(model.extract({ ...request(), system: ' x'.repeat(7000) }),
      { code: 'context_budget_exceeded' });
    assert.equal(calls, 0);
    if (onPhaseTiming !== undefined) { assert.deepEqual(events.map(e => e.phase), ['prepare']); eventShape(events); }
  }
});

test('W02 server-count and output failures retain their envelopes under observer failures', async () => {
  for (const mode of ['count_bounds', 'output_invalid']) {
    let baseline;
    for (const onPhaseTiming of [undefined, () => {}, () => { throw Error('provider-secret'); },
      async () => { throw Error('provider-secret'); }]) {
      const wires = [], diagnostics = [];
      const model = fakeModel((url, options) => {
        wires.push([url, options.body]);
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens',
          input_tokens: mode === 'count_bounds' ? 7025 : 100 });
        return Response.json({ ...generation(), status: 'failed' });
      }, onPhaseTiming, event => diagnostics.push(event));
      let actual;
      await assert.rejects(model.extract(request()), error => {
        actual = { name: error.name, message: error.message, code: error.code };
        return true;
      });
      const result = { actual, wires, diagnostics };
      baseline ??= result;
      assert.deepEqual(result, baseline);
      assert.equal(wires.length, mode === 'count_bounds' ? 1 : 2);
      await setImmediate();
    }
  }
});

test('W03 count transport abort is observed even when fake HTTP ignores the signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = waitFor();
  let finishFetch;
  const events = [];
  const model = fakeModel(() => { entered.resolve(); return new Promise(resolve => { finishFetch = resolve; }); },
    event => events.push(event));
  const pending = invokeCore(model);
  const rejected = assert.rejects(pending, { code: 'model_timeout' });
  await entered.promise;
  t.mock.timers.tick(30_000);
  await rejected;
  assert.deepEqual(events.map(e => [e.phase, e.outcome]),
    [['prepare', 'completed'], ['count_transport', 'aborted']]);
  finishFetch(countResponse());
  await setImmediate();
  assert.equal(events.length, 2, 'late completion cannot add a second observation');
  eventShape(events);
});

test('W03 slow count uses the same core deadline during generation transport', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const countEntered = waitFor(), generationEntered = waitFor();
  let finishCount;
  let calls = 0;
  const events = [];
  const model = fakeModel(() => {
    calls++;
    if (calls === 1) { countEntered.resolve(); return new Promise(resolve => { finishCount = resolve; }); }
    generationEntered.resolve();
    return new Promise(() => {});
  }, event => events.push(event));
  const pending = invokeCore(model);
  const rejected = assert.rejects(pending, { code: 'model_timeout' });
  await countEntered.promise;
  t.mock.timers.tick(28_000);
  finishCount(countResponse());
  await generationEntered.promise;
  t.mock.timers.tick(2_000);
  await rejected;
  assert.equal(calls, 2);
  assert.deepEqual(events.map(e => [e.phase, e.outcome]), [
    ['prepare', 'completed'], ['count_transport', 'completed'], ['count_body', 'completed'],
    ['count_validation', 'completed'], ['generation_transport', 'aborted']]);
  eventShape(events);
});

for (const route of ['count', 'generation']) test(`W03 ${route} body stall reports its open phase`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = waitFor();
  const events = [];
  const body = () => new Response(new ReadableStream({ start() { entered.resolve(); } }));
  const model = fakeModel(url => route === 'count' || !url.endsWith('/input_tokens')
    ? body() : countResponse(), event => events.push(event));
  const pending = invokeCore(model);
  const rejected = assert.rejects(pending, { code: 'model_timeout' });
  await entered.promise;
  await setImmediate();
  t.mock.timers.tick(30_000);
  await rejected;
  assert.equal(events.at(-1).phase, `${route}_body`);
  assert.equal(events.at(-1).outcome, 'aborted');
  eventShape(events);
});

test('W03 invalid generation output fails only output validation and preserves diagnostic v1', async () => {
  const events = [], diagnostics = [];
  const model = fakeModel(url => url.endsWith('/input_tokens') ? countResponse()
    : Response.json({ ...generation(), status: 'failed' }),
  event => events.push(event), event => diagnostics.push(event));
  await assert.rejects(model.extract(request()), { code: 'invalid_model_output' });
  assert.deepEqual(events.map(e => e.phase), expectedPhases);
  assert.equal(events.at(-1).outcome, 'failed');
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'extract', layer: 'adapter',
    reason: 'response_envelope' }]);
  eventShape(events);
});

test('W03 a bare transport AbortError is failed timing without a fired signal', async () => {
  const events = [], diagnostics = [];
  const req = request();
  const model = fakeModel(() => { throw new DOMException('synthetic', 'AbortError'); },
    event => events.push(event), event => diagnostics.push(event));
  await assert.rejects(model.extract(req), { name: 'AbortError' });
  assert.equal(req.signal.aborted, false);
  assert.deepEqual(events.map(event => [event.phase, event.outcome]),
    [['prepare', 'completed'], ['count_transport', 'failed']]);
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'extract', layer: 'adapter',
    reason: 'model_cancelled' }]);
  eventShape(events);
});

test('W04 extraction timeout leaves no new committed memory after a cold reopen', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workspace = createTestWorkspace(t, { prefix: 'cairn-phase-extract-timeout-' });
  const path = join(workspace.path, 'memory.sqlite');
  const entered = waitFor(), events = [];
  let core = openMemoryCore({ path, model: fakeModel((_url, options) => {
    entered.resolve();
    return new Promise((_, reject) => options.signal.addEventListener('abort',
      () => reject(new DOMException('synthetic cancellation', 'AbortError')), { once: true }));
  }, event => events.push(event)) });
  workspace.defer(() => core.close());
  const pending = core.capture(captureInput());
  await entered.promise;
  t.mock.timers.tick(30_000);
  assert.deepEqual(await pending, { ok: false, error: { code: 'model_timeout', retryable: false } });
  assert.equal(events.at(-1).phase, 'count_transport');
  assert.equal(events.at(-1).outcome, 'aborted');
  core.close();
  core = openMemoryCore({ path });
  assert.equal(ok(core.list({ namespace: captureInput().namespace, limit: 100 })).memories.length, 0);
  eventShape(events);
});

test('W04 successful capture keeps exact source receipt and duplicate result after restart', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-phase-capture-success-' });
  const path = join(workspace.path, 'memory.sqlite');
  let calls = 0;
  const events = [];
  let core = openMemoryCore({ path, model: fakeModel((url, options) => {
    calls++;
    return captureResponse(url, options);
  }, event => events.push(event)) });
  workspace.defer(() => core.close());
  const captured = ok(await core.capture(captureInput()));
  assert.equal(captured.admission.memories.length, 1);
  assert.equal(captured.classification.status, 'applied');
  assert.equal(calls, 4);
  const id = captured.admission.memories[0].id;
  const receipt = ok(core.get({ namespace: captureInput().namespace, memoryId: id })).receipts[0];
  assert.deepEqual([receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt],
    ['synthetic', 'session', 'message-one', 'user', 'Synthetic source']);
  assert.equal(ok(await core.capture(captureInput())).duplicate, true);
  assert.equal(calls, 4);
  core.close();
  core = openMemoryCore({ path, model: fakeModel(() => assert.fail('cold duplicate cannot call provider')) });
  const cold = ok(core.get({ namespace: captureInput().namespace, memoryId: id }));
  assert.deepEqual([cold.receipts[0].client, cold.receipts[0].sessionId,
    cold.receipts[0].eventId, cold.receipts[0].role, cold.receipts[0].excerpt],
  ['synthetic', 'session', 'message-one', 'user', 'Synthetic source']);
  assert.equal(ok(await core.capture(captureInput())).duplicate, true);
  assert.equal(events.length, 14);
  eventShape(events.slice(0, 7));
  eventShape(events.slice(7));
});

test('W04 classification timeout retains admitted memory as explicit partial progress', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const workspace = createTestWorkspace(t, { prefix: 'cairn-phase-classify-timeout-' });
  const path = join(workspace.path, 'memory.sqlite');
  const entered = waitFor(), events = [];
  let core = openMemoryCore({ path, model: fakeModel((url, options) => {
    const body = JSON.parse(options.body);
    if (!url.endsWith('/input_tokens') && body.text.format.name === 'cairn_classify') {
      entered.resolve();
      return new Promise((_, reject) => options.signal.addEventListener('abort',
        () => reject(new DOMException('synthetic cancellation', 'AbortError')), { once: true }));
    }
    return captureResponse(url, options);
  }, event => events.push(event)) });
  workspace.defer(() => core.close());
  const pending = core.capture(captureInput('classify-timeout'));
  await entered.promise;
  t.mock.timers.tick(30_000);
  const captured = ok(await pending);
  assert.equal(captured.admission.memories.length, 1);
  assert.deepEqual(captured.classification, { status: 'failed',
    error: { code: 'model_timeout', retryable: false } });
  const id = captured.admission.memories[0].id;
  core.close();
  core = openMemoryCore({ path });
  const cold = ok(core.get({ namespace: captureInput().namespace, memoryId: id }));
  assert.equal(cold.memory.filing.status, 'unfiled');
  const inspected = ok(core.inspectAdmission({ namespace: captureInput().namespace,
    client: 'synthetic', eventId: 'classify-timeout', includeInitialClassification: true }));
  assert.equal(inspected.status, 'completed');
  assert.equal(inspected.initialClassification.status, 'failed');
  assert.equal(inspected.members[0].memoryId, id);
  assert.equal(inspected.members[0].filing.status, 'unfiled');
  assert.deepEqual([cold.receipts[0].client, cold.receipts[0].sessionId,
    cold.receipts[0].eventId, cold.receipts[0].role, cold.receipts[0].excerpt],
  ['synthetic', 'session', 'message-one', 'user', 'Synthetic source']);
  assert.equal(events.at(-1).stage, 'classify');
  assert.equal(events.at(-1).phase, 'generation_transport');
  assert.equal(events.at(-1).outcome, 'aborted');
  eventShape(events.slice(0, 7));
  eventShape(events.slice(7));
});

test('W05 owned workspace closes and removes a real failed adapter capture', async t => {
  const outer = createTestWorkspace(t, { prefix: 'cairn-phase-cleanup-' });
  const child = createTestWorkspace(null, { prefix: 'failure-', parent: outer.path });
  const core = openMemoryCore({ path: join(child.path, 'memory.sqlite'), model: fakeModel(
    () => new Response('provider-secret', { status: 503 })) });
  child.defer(() => core.close());
  try {
    assert.deepEqual(await core.capture(captureInput()),
      { ok: false, error: { code: 'extraction_failed', retryable: false } });
  }
  finally { await child.cleanup(); }
  assert.equal(existsSync(child.path), false);
});
