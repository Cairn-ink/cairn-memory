import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { callBuiltModel, callModel } from '../src/capture/model-call.mjs';
import { buildModelRequest, decodeModelOutput } from '../src/capture/wire.mjs';
import { CoreError } from '../src/errors.mjs';

const owner = 'synthetic-owner';
const method = 'classify';

function classifyRequest() {
  const schema = { type: 'object', properties: { topic: { type: 'string' } } };
  return {
    stage: 'classify',
    request: {
      system: 'Classify synthetic text.', input: { text: 'Cedar tea.' },
      schema, schemaName: 'cairn_classify', maxOutputTokens: 1024,
    },
    validationSchema: schema,
    sizingText: 'Synthetic sizing text.',
    decode: raw => raw.topic,
  };
}

function scriptedPort(respond = () => ({ topic: 'tea' }), count = () => 1) {
  const requests = [];
  const sizes = [];
  const model = {
    model: 'synthetic',
    contextWindow: 8192,
    countTokens(text) {
      sizes.push(text);
      return count(text, sizes.length);
    },
    async call(stage, request, { signal, onDiagnostic }) {
      requests.push({ stage, request, abortable: signal instanceof AbortSignal, hasObserver: typeof onDiagnostic === 'function' });
      return respond(signal);
    },
  };
  return { model, requests, sizes };
}

function reports() {
  const events = [];
  return { events, onDiagnostic: event => events.push(event) };
}

function errorCode(code) {
  return error => error instanceof CoreError && error.code === code;
}

function diagnostic(reason, layer = 'core_call', stage = method) {
  return { version: 1, stage, layer, reason };
}

for (const [closedAt, expectedTrace] of [
  [undefined, ['pre-send', 'dispatch', 'call', 'post-send', 'decode']],
  ['pre-send', ['pre-send']],
  ['dispatch', ['pre-send', 'dispatch']],
  ['post-send', ['pre-send', 'dispatch', 'call', 'post-send']],
]) {
  test('prebuilt gate ' + (closedAt ? 'closes at ' + closedAt : 'runs in order'), async () => {
    const trace = [];
    const built = classifyRequest();
    const { decode } = built;
    built.decode = raw => { trace.push('decode'); return decode(raw); };
    const { model, requests } = scriptedPort(() => { trace.push('call'); return { topic: 'tea' }; });
    const gate = { async assertOpen(givenOwner, phase) {
      assert.equal(givenOwner, owner);
      trace.push(phase);
      if (phase === closedAt) throw new CoreError('capture_evidence_closed');
    } };
    const pending = callBuiltModel(model, method, built, { owner, gate });
    if (closedAt) await assert.rejects(pending, errorCode('capture_evidence_closed'));
    else assert.equal(await pending, 'tea');
    assert.deepEqual(trace, expectedTrace);
    assert.equal(requests.length, Number(expectedTrace.includes('call')));
  });
}

test('prebuilt data is snapshotted once before the gate and sizing uses sizingText', async () => {
  const built = classifyRequest();
  const expected = structuredClone(built.request);
  const sizingText = built.sizingText;
  const { model, requests, sizes } = scriptedPort();
  const { request } = built;
  let reads = 0;
  Object.defineProperty(built, 'request', { get() { reads++; return request; } });
  const gate = { async assertOpen(_owner, phase) {
    if (phase !== 'pre-send') return;
    request.input.text = 'Changed.';
    request.schema.properties.topic.type = 'number';
    request.schemaName = 'changed';
    built.sizingText = 'Changed.';
    built.stage = 'reconcile';
    built.decode = () => 'changed';
  } };
  assert.equal(await callBuiltModel(model, method, built, { owner, gate }), 'tea');
  assert.equal(reads, 1);
  assert.deepEqual(sizes, [sizingText, '{"topic":"tea"}']);
  assert.deepEqual(requests, [{ stage: 'classify', request: expected, abortable: true, hasObserver: false }]);
});

test('non-positive remaining budget refuses a prebuilt request before dispatch', async () => {
  for (const remaining of [0, -1]) {
    const { model, requests } = scriptedPort();
    const { events, onDiagnostic } = reports();
    const deadline = { expired: () => false, remainingMs: () => remaining };
    await assert.rejects(callBuiltModel(model, method, classifyRequest(), { deadline, onDiagnostic }),
      errorCode('model_timeout'));
    assert.equal(requests.length, 0);
    assert.deepEqual(events, [diagnostic('model_timeout')]);
  }
});

test('decoder failures use invalid_model_output and diagnostics use the method', async () => {
  const { model, requests } = scriptedPort();
  const { events, onDiagnostic } = reports();
  const built = { ...classifyRequest(), stage: 'reconcile', decode(_raw, report) {
    report('reconcile', 'adapter', 'output_shape');
    throw new Error('synthetic decoding failure');
  } };
  await assert.rejects(callBuiltModel(model, method, built, { onDiagnostic }), errorCode('invalid_model_output'));
  assert.equal(requests[0].stage, 'reconcile');
  assert.deepEqual(events, [diagnostic('output_shape', 'adapter'), diagnostic('adapter_output_invalid')]);
});

test('prebuilt outputs allow exactly 40,000 UTF-16 units and at most 1024 tokens', async () => {
  const atLimit = '🙂'.repeat(19_999);
  assert.equal(JSON.stringify(atLimit).length, 40_000);
  for (const [output, tokens, expectedPass, expectedDecodes, expectedCounts] of [
    [atLimit, 1024, true, 1, 2],
    [atLimit + 'a', 1, false, 0, 1],
    // The raw-output token bound runs before decode, so an over-budget response is never decoded.
    ['tea', 1025, false, 0, 2],
  ]) {
    const { model, sizes } = scriptedPort(() => output, (_text, read) => read === 1 ? 1 : tokens);
    const { events, onDiagnostic } = reports();
    let decodes = 0;
    const built = { ...classifyRequest(), decode(raw) { decodes++; return raw; } };
    const pending = callBuiltModel(model, method, built, { onDiagnostic });
    if (expectedPass) assert.equal(await pending, output);
    else await assert.rejects(pending, errorCode('invalid_model_output'));
    assert.equal(decodes, expectedDecodes);
    assert.equal(sizes.length, expectedCounts);
    assert.deepEqual(events, expectedPass ? [] : [diagnostic('output_bounds')]);
  }
});

test('a caller abort reaches the prebuilt provider and maps to model_cancelled', { timeout: 1000 }, async () => {
  const caller = new AbortController();
  const reason = new Error('synthetic cancellation');
  let providerSignal;
  const { model, requests } = scriptedPort(signal => {
    providerSignal = signal;
    queueMicrotask(() => caller.abort(reason));
    return new Promise(() => {});
  });
  const { events, onDiagnostic } = reports();
  await assert.rejects(callBuiltModel(model, method, classifyRequest(), { signal: caller.signal, onDiagnostic }),
    errorCode('model_cancelled'));
  assert.equal(requests.length, 1);
  assert.equal(providerSignal.aborted, true);
  assert.equal(providerSignal.reason, reason);
  assert.deepEqual(events, [diagnostic('model_cancelled')]);
});

test('prebuilt calls convert foreign throws at the clock, gate, and port to CoreError', async () => {
  const throwForeign = () => { throw new Error('synthetic'); };
  const { model, requests } = scriptedPort(throwForeign);
  const { events, onDiagnostic } = reports();
  const failureCode = 'extraction_failed';
  await assert.rejects(callBuiltModel(model, method, classifyRequest(), {
    deadline: { expired: throwForeign }, onDiagnostic,
  }), errorCode('internal_error'));
  await assert.rejects(callBuiltModel(model, method, classifyRequest(), {
    gate: { assertOpen: throwForeign }, owner, failureCode, onDiagnostic,
  }), errorCode(failureCode));
  assert.equal(requests.length, 0);
  assert.deepEqual(events, []);
  await assert.rejects(callBuiltModel(model, method, classifyRequest(), { failureCode, onDiagnostic }),
    errorCode(failureCode));
  assert.equal(requests.length, 1);
  assert.deepEqual(events, [diagnostic('provider_failure')]);
});

test('invalid prebuilt data fails before the first gate, counter, or provider call', async () => {
  const valid = classifyRequest();
  const { model, requests, sizes } = scriptedPort();
  let gateCalls = 0;
  const gate = { async assertOpen() { gateCalls++; } };
  for (const built of [
    null, undefined, {}, { ...valid, decode: null }, { ...valid, stage: 'unknown' },
    { ...valid, sizingText: 42 }, { ...valid, request: { ...valid.request, input: () => {} } },
    { ...valid, request: { ...valid.request, schemaName: 42 } },
    { ...valid, request: { ...valid.request, maxOutputTokens: 0 } },
    { ...valid, validationSchema: { uncloneable: Symbol('synthetic') } },
    { ...valid, get decode() { throw new Error('synthetic'); } },
  ]) {
    await assert.rejects(callBuiltModel(model, method, built, { owner, gate }), errorCode('invalid_input'));
  }
  assert.equal(gateCalls, 0);
  assert.equal(sizes.length, 0);
  assert.equal(requests.length, 0);
});

const { cases } = JSON.parse(readFileSync(new URL('./fixtures/capture/engine-wire-goldens.json', import.meta.url), 'utf8'));

for (const captureMethod of ['extract', 'qualify', 'qualifyCandidates']) {
  test(captureMethod + ' prebuilt and capture calls send the same requests and produce the same outcomes', async () => {
    const goldens = cases.filter(entry => entry.method === captureMethod && entry.expected.result);
    assert.ok(goldens.length > 0);
    for (const { request, qualificationInputMode, output, expected } of goldens) {
      const built = buildModelRequest(captureMethod, request, { qualificationInputMode });
      const decode = (raw, report) => decodeModelOutput(captureMethod, built, raw, report);
      for (const [respond, code, coreReason] of [
        [() => output, undefined, undefined],
        [() => null, 'invalid_model_output', 'adapter_output_invalid'],
        [() => { throw new Error('synthetic provider failure'); },
          captureMethod === 'extract' ? 'extraction_failed' : 'qualification_failed', 'provider_failure'],
      ]) {
        const observations = [];
        for (const run of [
          (model, options) => callModel(model, captureMethod, request, options),
          (model, options) => callBuiltModel(model, captureMethod, { ...built, decode }, options),
        ]) {
          const { model, requests } = scriptedPort(respond);
          const { events, onDiagnostic } = reports();
          const pending = run(model, { qualificationInputMode, onDiagnostic });
          let outcome;
          if (code) {
            await assert.rejects(pending, error => {
              outcome = { code: error.code, message: error.message };
              return errorCode(code)(error);
            });
            assert.deepEqual(events.at(-1), diagnostic(coreReason, 'core_call', captureMethod));
          } else {
            outcome = await pending;
            assert.deepEqual(outcome, expected.result);
            assert.deepEqual(events, []);
          }
          assert.deepEqual(requests, [{
            stage: built.stage, request: built.request, abortable: true, hasObserver: true,
          }]);
          observations.push({ requests, outcome, events });
        }
        assert.deepEqual(observations[0], observations[1]);
      }
    }
  });
}
