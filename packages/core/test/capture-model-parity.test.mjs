import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { qualifyExtractedItems } from '../src/capture/automatic-qualification.mjs';
import { createCaptureDeadline } from '../src/capture/deadline.mjs';
import { callModel } from '../src/capture/model-call.mjs';
import { qualifyCandidateItems } from '../src/capture/qualification-candidates.mjs';
import { buildModelRequest } from '../src/capture/wire.mjs';
import { CoreError } from '../src/errors.mjs';

const { cases, extractionAllowance, clockFaults } =
  JSON.parse(readFileSync(new URL('./fixtures/capture/engine-model-goldens.json', import.meta.url), 'utf8'));
assert.equal(cases.length, 60);
const catalogMode = 'adaptive-text-catalog-v1';

function outputFor(method, script, logical) {
  if (script.output === 'bigint') return { value: 1n };
  if (script.output === 'undefined') return;
  if (script.output === 'oversize') return { value: '🙂'.repeat(20_001) };
  if (method !== 'qualifyCandidates') return structuredClone(logical);
  return { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(logical.qualifications.map(entry => {
    const { itemIndex, ...fields } = entry;
    const used = [...new Set(Object.values(fields).flatMap(field => field.evidenceIndices))];
    const pool = used.length ? used : [0];
    const slots = Object.entries(fields).map(([key, { value, evidenceIndices }]) =>
      [key, { value, evidenceSlots: evidenceIndices.map(id => pool.indexOf(id)) }]);
    return ['item_' + itemIndex, { itemIndex, pool, ...Object.fromEntries(slots) }];
  })) };
}

function scriptedModel(golden, trace, state, calls) {
  const { method, script } = golden;
  const model = { model: 'synthetic', contextWindow: script.contextWindow ?? 8192 };
  if (script.counter !== 'missing') model.countTokens = text => {
    calls.sizing.push(createHash('sha256').update(text).digest('hex'));
    const envelope = JSON.parse(text);
    const isInput = Object.hasOwn(envelope, 'system');
    trace.push(isInput ? 'input count' : 'output count');
    if (isInput && script.expireAt === 'input count') state.expired = true;
    if (script.counter === (isInput ? 'input throw' : 'output throw')) throw new Error('synthetic');
    if (!isInput) return script.outputCount ?? 1;
    const { system, input, maxOutputTokens } = envelope;
    assert.equal(text, JSON.stringify({ system, input, maxOutputTokens }));
    assert.equal(maxOutputTokens, 1024);
    const entries = input.items ?? [];
    const length = input.texts?.join('').length ?? entries.reduce((total, entry) =>
      total + (entry.sources ?? entry.candidates).reduce((sum, source) =>
        sum + (source.excerpt ?? source.text).length, 0), 0);
    if (entries.length > (script.itemLimit ?? Infinity) || length > (script.textLimit ?? Infinity) ||
        entries.some(entry => entry.content === script.excluded)) return 6001;
    return script.inputCount ?? 1;
  };
  if (script.fit) model.fits = (stage, request) => {
    trace.push('fits');
    calls.fitChecks.push({ stage, schemaName: request.schemaName, hasSchema: Boolean(request.schema) });
    const { input } = request;
    const catalog = input.inputMode === 'text-catalog-v1';
    switch (script.fit) {
      case 'true': return true;
      case 'false': return false;
      case 'throw': throw new Error('synthetic');
      case 'catalog': return catalog;
      case 'singleton': return input.items.length === 1;
      case 'singleton catalog': return catalog && input.items.length === 1;
      default: assert.fail('Unknown fit script');
    }
  };
  if (script.provider !== 'missing') model.call = async (stage, request, options) => {
    trace.push('call');
    const index = calls.requests.length;
    calls.requests.push({ stage, request });
    calls.options.push(options);
    if (script.expireAt === 'provider') state.expired = true;
    if (script.provider && (!script.failAtCall || script.failAtCall === calls.requests.length)) {
      switch (script.provider) {
        case 'throw': throw new Error('synthetic');
        case 'abort': throw new DOMException('synthetic', 'AbortError');
        case 'untrusted validation': throw { code: 'invalid_model_output' };
        default: throw new CoreError(script.provider);
      }
    }
    return outputFor(method, script, golden.outputs[index]);
  };
  return model;
}

function runGolden(golden, model, deadline, report, validateFresh, options) {
  const { operation, method, request, items } = golden;
  if (operation === 'call') return callModel(model, method, request,
    { ...options, failureCode: 'extraction_failed', deadline, validateFresh });
  if (operation === 'automatic') return qualifyExtractedItems(model, items, deadline, report, validateFresh, options);
  return qualifyCandidateItems(model, items, deadline, validateFresh, report, options);
}

for (const golden of cases) {
  test(golden.operation + ' / ' + golden.name, async () => {
    const { method, items, script } = golden;
    const trace = [], diagnostics = [], report = {};
    const calls = { requests: [], options: [], fitChecks: [], sizing: [] };
    const state = { expired: script.expireAt === 'entry' };
    const readClock = phase => {
      if (script.expireWithFresh) trace.push('deadline ' + phase);
      return state.expired;
    };
    const deadline = { expired: () => readClock('expired'), remainingMs: () => { readClock('remaining'); return 30_000; },
      check() { if (state.expired) throw new CoreError('model_timeout'); } };
    const model = scriptedModel(golden, trace, state, calls);
    let freshCalls = 0;
    const validateFresh = () => {
      trace.push('fresh');
      if (++freshCalls === script.freshFailsAt) {
        if (script.expireWithFresh) state.expired = true;
        throw new CoreError('capture_evidence_closed');
      }
    };
    const beforeDispatch = () => {
      trace.push('before dispatch');
      if (script.dispatchFails) throw new CoreError('capture_evidence_closed');
    };
    const onDiagnostic = event => {
      diagnostics.push(event);
    };
    const options = { onDiagnostic, qualificationInputMode: catalogMode,
      beforeDispatch: golden.operation === 'call' ? beforeDispatch : undefined };
    const run = () => runGolden(golden, model, deadline, report, validateFresh, options);

    let expectedDiagnostics = golden.diagnostics;
    let expectedTrace = golden.trace;
    let expectedReport = golden.report;
    if (script.fit === 'throw') {
      // Core treats a throwing fits as a refusal at every planning size.
      assert.deepEqual(golden.expected, { errorCode: 'token_count_unavailable' });
      assert.deepEqual(golden.diagnostics, [
        { stage: 'qualifyCandidates', layer: 'core_call', reason: 'token_count_unavailable' },
      ]);
      const unqualified = structuredClone(items);
      for (const item of unqualified) delete item.proceduralProposal;
      assert.deepEqual(await run(), unqualified);
      expectedDiagnostics = [{ stage: 'qualifyCandidates', layer: 'core_call', reason: 'context_budget_exceeded' }];
      expectedTrace = Array.from({ length: 5 }, () => ['input count', 'fits']).flat();
      expectedReport = { itemsShortened: 0, itemsUnqualified: 1 };
    } else if (script.provider === 'abort') {
      // The Phase 0 error enum is awaiting model_cancelled.
      assert.deepEqual(golden.expected, { errorCode: 'model_cancelled' });
      await assert.rejects(run, { name: 'CoreError', code: 'internal_error' });
    } else if (golden.expected.errorCode) {
      await assert.rejects(run, { name: 'CoreError', code: golden.expected.errorCode });
    } else {
      assert.deepEqual(await run(), golden.expected.result);
    }

    assert.equal(calls.requests.length, golden.callCount);
    const expectedRequests = golden.requests.map(portRequest => {
      const mode = portRequest.input.inputMode ? { qualificationInputMode: catalogMode } : undefined;
      const built = buildModelRequest(method, portRequest, mode);
      return { stage: built.stage, request: built.request };
    });
    assert.deepEqual(calls.requests, expectedRequests);
    for (const callOptions of calls.options) {
      assert.ok(callOptions.signal instanceof AbortSignal);
      assert.equal(typeof callOptions.onDiagnostic, 'function');
      assert.equal(Object.hasOwn(callOptions, 'deadlineAtMs'), false);
    }
    assert.deepEqual(diagnostics, expectedDiagnostics.map(event => ({ version: 1, ...event })));
    assert.deepEqual(report, expectedReport);
    assert.deepEqual(trace, expectedTrace);
    if (script.fit === 'throw') assert.deepEqual(calls.sizing.slice(0, 1), golden.sizing);
    else assert.deepEqual(calls.sizing, golden.sizing);
    assert.deepEqual(calls.fitChecks, trace.filter(step => step === 'fits').map(() => ({
      stage: 'qualify', schemaName: 'cairn_qualifyCandidates', hasSchema: true,
    })));
    if (golden.operation === 'automatic' && script.fit === 'false') {
      assert.equal(calls.fitChecks.length, 0);
      assert.equal(calls.requests.length, 1);
      assert.deepEqual(calls.requests.map(({ request: { system, input, maxOutputTokens } }) =>
        ({ system, input, maxOutputTokens })), golden.requests);
      assert.deepEqual(report, { itemsShortened: 0, itemsUnqualified: 0 });
    }
  });
}

for (const { name, operation, faults } of clockFaults) {
  test(operation + ' / clock faults at every deadline read in ' + name, async () => {
    const golden = cases.find(entry => entry.name === name && entry.operation === operation);
    let reads;
    function run(faultAt, diagnostics) {
      reads = -1; // The timestamp used to create the deadline precedes the entry.
      const deadline = createCaptureDeadline(30_000, { monotonicMs() {
        if (++reads === faultAt) throw new Error('synthetic clock fault');
        return 0;
      } });
      const calls = { requests: [], options: [], fitChecks: [], sizing: [] };
      const model = scriptedModel(golden, [], {}, calls);
      return runGolden(golden, model, deadline, {}, undefined, {
        onDiagnostic: event => diagnostics.push(event), qualificationInputMode: catalogMode,
      });
    }
    assert.deepEqual(await run(-1, []), golden.expected.result);
    assert.equal(reads, faults.length);
    for (const [index, { errorCode, foreignClockFault, diagnostics }] of faults.entries()) {
      const actualDiagnostics = [];
      const code = foreignClockFault ? 'internal_error' : errorCode;
      await assert.rejects(run(index + 1, actualDiagnostics),
        error => error instanceof CoreError && error.code === code && error.message === code, 'deadline read ' + (index + 1));
      assert.deepEqual(actualDiagnostics, diagnostics.map(event => ({ version: 1, ...event })), 'deadline read ' + (index + 1));
    }
  });
}

for (const [operation, invalidCode] of [
  ['call', 'invalid_input'], ['automatic', 'invalid_input'], ['candidates', 'invalid_model_output'],
]) {
  test(operation + ' / malformed request and unavailable counter produce CoreError', async () => {
    const golden = cases.find(entry => entry.operation === operation);
    let outbound = 0;
    const model = { contextWindow: 8192, countTokens() { throw new Error('synthetic counter fault'); },
      async call() { outbound++; } };
    for (const invalid of [null, undefined]) {
      await assert.rejects(runGolden({ ...golden, request: invalid, items: invalid }, model),
        error => error instanceof CoreError && error.code === invalidCode);
    }
    await assert.rejects(runGolden(golden, model),
      error => error instanceof CoreError && error.code === 'token_count_unavailable');
    assert.equal(outbound, 0);
  });
}

test('adapter and core diagnostics share a hook that isolates sync throws and rejected promises', async () => {
  const { request } = cases[0];
  const adapterEvent = { version: 1, stage: 'extract', layer: 'adapter', reason: 'output_shape' };
  for (const observer of [() => { throw new Error('synthetic'); }, async () => { throw new Error('synthetic'); }]) {
    const events = [];
    const onDiagnostic = event => { events.push(event); return observer(); };
    const model = {
      contextWindow: 8192,
      countTokens: () => 1,
      async call(_stage, _request, options) {
        await options.onDiagnostic(adapterEvent);
        throw new CoreError('invalid_model_output');
      },
    };
    await assert.rejects(callModel(model, 'extract', request, { onDiagnostic }), { code: 'invalid_model_output' });
    assert.deepEqual(events, [adapterEvent,
      { version: 1, stage: 'extract', layer: 'core_call', reason: 'adapter_output_invalid' }]);
  }
});

test('wire decoding rejects malformed candidate output before stage compilation', async () => {
  const { items } = cases.find(entry => entry.operation === 'candidates');
  const events = [];
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { return { qualifications: [] }; } };
  await assert.rejects(qualifyCandidateItems(model, items, undefined, undefined, {}, {
    onDiagnostic: event => events.push(event),
  }), { code: 'invalid_model_output' });
  assert.deepEqual(events, [
    { version: 1, stage: 'qualifyCandidates', layer: 'adapter', reason: 'qualification_wire_shape' },
    { version: 1, stage: 'qualifyCandidates', layer: 'core_call', reason: 'adapter_output_invalid' },
  ]);
});

test('qualification entry snapshots all batches before the first provider call', async () => {
  for (const operation of ['automatic', 'candidates']) {
    const golden = cases.find(entry => entry.operation === operation && entry.name === 'partial counters survive a second-batch failure');
    const items = structuredClone(golden.items);
    const content = items[5].content;
    let reads = 0;
    Object.defineProperty(items[5], 'content', { configurable: true, enumerable: true, get() { reads++; return content; } });
    let calls = 0;
    const model = {
      contextWindow: 8192,
      countTokens: () => 1,
      async call(_stage, request) {
        if (++calls === 1) {
          Object.defineProperty(items[5], 'content', { value: 'changed', enumerable: true });
          return outputFor(golden.method, {}, golden.outputs[0]);
        }
        assert.equal(request.input.items[0].content, content);
        throw new CoreError('capture_evidence_closed');
      },
    };
    const run = operation === 'automatic' ? qualifyExtractedItems : qualifyCandidateItems;
    await assert.rejects(run(model, items), { code: 'qualification_failed' });
    assert.equal(reads, 1);
    assert.equal(calls, 2);
  }
});

test('1,229-token extraction matches the recorded engine wire and keeps the engine output cap', async () => {
  const { system, input, maxOutputTokens } = extractionAllowance;
  assert.equal(maxOutputTokens, 1229);
  const args = structuredClone({ system, input, maxOutputTokens });
  const texts = [];
  const sent = [];
  const model = {
    contextWindow: 8192,
    countTokens(text) { texts.push(text); return texts.length === 1 ? 1 : 1025; },
    async call(stage, built) {
      sent.push({ stage, request: built });
      args.input.messages[0].content = 'Changed after dispatch.';
      return { items: [] };
    },
  };
  await assert.rejects(callModel(model, 'extract', args), { code: 'invalid_model_output' });
  assert.equal(sent[0]?.request.schemaName, extractionAllowance.schemaName);
  assert.deepEqual(sent, [{ stage: 'extract', request: extractionAllowance }]);
  assert.deepEqual(texts, [JSON.stringify({ system, input, maxOutputTokens }), '{"items":[]}']);
});

test('freshness rechecks an invalidation queued by the input counter before dispatch', async () => {
  const { request } = cases[0];
  let fresh = true;
  let outbound = 0;
  let dispatches = 0;
  const model = {
    contextWindow: 8192,
    countTokens() { queueMicrotask(() => { fresh = false; }); return 1; },
    async call() { outbound++; return { items: [] }; },
  };
  await assert.rejects(callModel(model, 'extract', request, {
    validateFresh() { if (!fresh) throw new CoreError('capture_evidence_closed'); },
    beforeDispatch() { dispatches++; },
  }), { code: 'capture_evidence_closed' });
  assert.equal(outbound, 0);
  assert.equal(dispatches, 0);
});
