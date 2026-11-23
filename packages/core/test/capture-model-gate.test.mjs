import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callModel } from '../src/capture/model-call.mjs';
import { qualifyCandidateItems } from '../src/capture/qualification-candidates.mjs';
import { CoreError } from '../src/errors.mjs';

const owner = 'synthetic-owner';
const request = { system: 'Extract synthetic facts.', input: { messages: [{ index: 0, role: 'user', content: 'Cedar tea.' }] },
  maxOutputTokens: 1024 };

function fixture(closedPhase) {
  let calls = 0;
  let inspected = 0;
  const trace = [];
  const gate = { async assertOpen(givenOwner, phase) {
    assert.equal(givenOwner, owner);
    trace.push(phase);
    if (phase === closedPhase) throw new CoreError('capture_evidence_closed');
  } };
  const model = {
    contextWindow: 8192,
    countTokens: () => { trace.push('count'); return 1; },
    async call() {
      calls++;
      trace.push('call');
      return { get items() { inspected++; return []; } };
    },
  };
  return { model, gate, trace, outbound: () => calls, inspections: () => inspected };
}

test('gate fences request sizing, dispatch and output use in order', async () => {
  const { model, gate, trace, outbound, inspections } = fixture();
  const output = await callModel(model, 'extract', request, { owner, gate,
    validateFresh: () => trace.push('fresh'), beforeDispatch: () => trace.push('before dispatch') });
  assert.deepEqual(output, { items: [] });
  assert.equal(outbound(), 1);
  assert.equal(inspections(), 1);
  assert.deepEqual(trace, ['pre-send', 'fresh', 'count', 'fresh', 'before dispatch', 'dispatch', 'call',
    'post-send', 'fresh', 'count', 'fresh']);
});

for (const [pauseFrom, expected, calls] of [
  ['pre-send', ['pre-send:open', 'paused', 'dispatch:closed'], 0],
  ['dispatch', ['pre-send:open', 'dispatch:open', 'call:open', 'paused', 'post-send:closed'], 1],
]) {
  test('a two-microtask pause queued at ' + pauseFrom + ' cannot slip between dispatch and call', async () => {
    const trace = [];
    let open = true;
    let outbound = 0;
    let inspections = 0;
    const observe = phase => trace.push(phase + (open ? ':open' : ':closed'));
    const gate = { async assertOpen(givenOwner, phase) {
      assert.equal(givenOwner, owner);
      observe(phase);
      if (!open) throw new CoreError('capture_evidence_closed');
      if (phase === pauseFrom) queueMicrotask(() => queueMicrotask(() => {
        open = false;
        trace.push('paused');
      }));
    } };
    const model = { contextWindow: 8192, countTokens: () => 1, async call() {
      outbound++;
      observe('call');
      return { get items() { inspections++; return []; } };
    } };
    await assert.rejects(callModel(model, 'extract', request, { owner, gate }), {
      code: 'capture_evidence_closed',
    });
    assert.deepEqual(trace, expected);
    assert.equal(outbound, calls);
    assert.equal(inspections, 0);
  });
}

for (const [phase, expected, calls] of [
  ['pre-send', ['pre-send'], 0],
  ['dispatch', ['pre-send', 'count', 'dispatch'], 0],
  ['post-send', ['pre-send', 'count', 'dispatch', 'call', 'post-send'], 1],
]) {
  test('gate closes at ' + phase + ' with its own error and no further outbound call', async () => {
    const { model, gate, trace, outbound, inspections } = fixture(phase);
    await assert.rejects(callModel(model, 'extract', request, { owner, gate }), {
      name: 'CoreError', code: 'capture_evidence_closed',
    });
    assert.deepEqual(trace, expected);
    assert.equal(outbound(), calls);
    assert.equal(inspections(), 0);
  });
}

test('pre-send rejection stops an invalid wire request before its build diagnostic', async () => {
  const { model, gate, outbound } = fixture('pre-send');
  const events = [];
  await assert.rejects(callModel(model, 'extract', { ...request, input: {} }, {
    owner, gate, onDiagnostic: event => events.push(event),
  }), { code: 'capture_evidence_closed' });
  assert.deepEqual(events, []);
  assert.equal(outbound(), 0);
});

test('post-send closure discards the first candidate response and stops later groups', async () => {
  const { model, gate, trace, outbound, inspections } = fixture('post-send');
  model.fits = (_stage, request) => request.input.items.length === 1;
  const source = { client: 'synthetic', sessionId: 'source', eventId: 'event', role: 'user', excerpt: 'Cedar tea.' };
  const items = ['One.', 'Two.'].map(content => ({ content, kind: 'fact', receipts: [source] }));
  await assert.rejects(qualifyCandidateItems(model, items, undefined, undefined, {}, { owner, gate }), {
    code: 'capture_evidence_closed',
  });
  assert.deepEqual(trace.filter(step => step !== 'count'), ['pre-send', 'dispatch', 'call', 'post-send']);
  assert.equal(outbound(), 1);
  assert.equal(inspections(), 0);
});

test('post-send gate also fences a rejected provider call', async () => {
  const { model, gate, trace } = fixture('post-send');
  model.call = async () => { trace.push('call'); throw new Error('synthetic'); };
  await assert.rejects(callModel(model, 'extract', request, { owner, gate }), { code: 'capture_evidence_closed' });
  assert.deepEqual(trace, ['pre-send', 'count', 'dispatch', 'call', 'post-send']);
});

test('a deadline that expires during the dispatch gate stops the send with zero provider calls', async () => {
  let now = 0;
  let outbound = 0;
  const diagnostics = [];
  const { createCaptureDeadline } = await import('../src/capture/deadline.mjs');
  const deadline = createCaptureDeadline(10, { monotonicMs: () => now });
  const gate = { async assertOpen(givenOwner, phase) {
    assert.equal(givenOwner, owner);
    if (phase === 'dispatch') now = 10;
  } };
  const model = { contextWindow: 8192, countTokens: () => 1, async call() { outbound++; return { items: [] }; } };
  await assert.rejects(callModel(model, 'extract', request, { owner, gate, deadline,
    onDiagnostic: event => diagnostics.push(event) }), { code: 'model_timeout' });
  assert.equal(outbound, 0);
});
