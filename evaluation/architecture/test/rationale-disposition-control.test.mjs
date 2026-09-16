import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRationaleDispositionControl } from '../rationale-disposition-control.mjs';
import { proposeRationale } from '../../../core/rationale.mjs';

const originalSystem = readFileSync(new URL('../../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
const controlGuidance = readFileSync(new URL('../prompts/rationale-disposition-control.md', import.meta.url), 'utf8');
const sources = () => [
  { receipts: [{ role: 'user', excerpt: 'Team chose A because it was cheaper.' }] },
  { receipts: [{ role: 'user', excerpt: 'Later A price rose.' }] },
];
const oldEdges = () => [{ index: 0, from: 0, to: 0, relation: 'supports-decision',
  fromReceipt: 0, toReceipt: 0, interpretationStatus: 'unverified' }];
const oldRequest = () => ({ system: originalSystem,
  input: { memories: sources().map((source, index) => ({ index,
    receipts: source.receipts.map((receipt, receiptIndex) => ({ index: receiptIndex, ...receipt })) })) },
  maxOutputTokens: 1024 });
const edge = { from: 0, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 };

test('DC1–4 core source-only proposal sends exact expanded matched input and counts it', async () => {
  const setup = oldEdges(), counted = [], sent = [];
  const model = { contextWindow: 8192,
    countTokens: text => { counted.push(text); return 100; },
    relate: request => { sent.push(request); return { edges: [edge] }; } };
  const control = createRationaleDispositionControl(model, setup);
  assert.deepEqual(Object.keys(control).sort(), ['contextWindow', 'countTokens', 'relate']);
  const result = await proposeRationale(control, sources(), () => {});
  assert.deepEqual(result, [edge]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].system, `${originalSystem}\n${controlGuidance}`);
  assert.deepEqual(sent[0].input, { ...oldRequest().input, oldEdges: setup });
  assert.equal(JSON.stringify(sent[0].input).includes('ownerId'), false);
  assert.equal(JSON.stringify(sent[0].input).includes('memoryId'), false);
  assert.deepEqual(JSON.parse(counted[0]), { system: sent[0].system, input: sent[0].input,
    maxOutputTokens: 1024 });
  assert.equal(counted.length, 2);
  assert.equal(Object.isFrozen(sent[0].input), true);
  assert.equal(Object.isFrozen(sent[0]), true);
  assert.equal(Object.isFrozen(sent[0].input.oldEdges[0]), true);
  assert.equal(Object.isFrozen(sent[0].input.memories[0].receipts[0]), true);
  assert.equal(sent[0].signal instanceof AbortSignal, true);
});

test('DC3 bound callbacks and cloned setup resist mutation during expanded count', async () => {
  const setup = oldEdges(), source = sources();
  let captured;
  const model = { contextWindow: 8192,
    countTokens(text) {
      if (text.includes('oldEdges')) {
        setup[0].relation = 'challenges-premise';
        source[0].receipts[0].excerpt = 'Changed by counter';
        this.relate = () => assert.fail('replacement provider must not be called');
        this.countTokens = () => assert.fail('replacement counter must not be called');
      }
      return 100;
    },
    relate(request) { captured = request; return { edges: [] }; } };
  const control = createRationaleDispositionControl(model, setup);
  assert.deepEqual(await proposeRationale(control, source, () => {}), []);
  assert.equal(captured.input.oldEdges[0].relation, 'supports-decision');
  assert.equal(captured.input.memories[0].receipts[0].excerpt, 'Team chose A because it was cheaper.');
});

test('DC3 freshness callback mutation cannot change the counted provider request', async () => {
  const source = sources();
  let counted, sent, checks = 0;
  const model = { contextWindow: 8192,
    countTokens: text => { if (text.includes('oldEdges')) counted = JSON.parse(text); return 100; },
    relate: request => { sent = request; return { edges: [] }; } };
  const control = createRationaleDispositionControl(model, oldEdges());
  assert.deepEqual(await proposeRationale(control, source, () => {
    if (++checks === 1) source[0].receipts[0].excerpt = 'Mutated after count.';
  }), []);
  assert.deepEqual({ system: sent.system, input: sent.input, maxOutputTokens: sent.maxOutputTokens }, counted);
  assert.equal(sent.input.memories[0].receipts[0].excerpt,
    'Team chose A because it was cheaper.');
});

test('DC3 malformed setup, custom/getter/sparse inputs and unsupported focus reject before provider', async () => {
  let calls = 0, counts = 0;
  const model = { contextWindow: 8192, countTokens: () => { counts++; return 100; },
    relate: () => { calls++; return { edges: [] }; } };
  for (const mutate of [
    x => { x[0].interpretationStatus = 'verified'; },
    x => { x[0].privateId = 'secret'; },
    x => { x[0].fromReceipt = -1; },
    x => { x[0].index = 1; },
    x => { x[0] = { ...x[0], relation: 'retired' }; },
    x => { x.length = 2; },
    x => { Object.setPrototypeOf(x, Object.create(Array.prototype)); },
    x => { Object.defineProperty(x[0], 'to', { get: () => 0 }); },
  ]) {
    const setup = oldEdges(); mutate(setup);
    assert.throws(() => createRationaleDispositionControl(model, setup),
      /invalid_disposition_control_request/);
  }
  const malformed = oldEdges(); malformed[0].privateId = 'secret';
  assert.throws(() => createRationaleDispositionControl({ get relate() {
    assert.fail('model getter must not observe malformed setup');
  } }, malformed), /invalid_disposition_control_request/);
  for (const mutate of [
    x => { x.input.metadata = 'private'; },
    x => { x.input.memories[0].focus = { content: 'Wrong source', interpretationStatus: 'unverified' }; },
    x => { x.input.memories[0].receipts[0].client = 'private'; },
    x => { x.input.memories[0].receipts[0].index = 1; },
    x => { x.input.memories.length = 3; },
    x => { x.system = 'Other task'; },
  ]) {
    const request = oldRequest(); mutate(request);
    const control = createRationaleDispositionControl(model, oldEdges());
    assert.throws(() => control.countTokens(JSON.stringify(request)),
      /invalid_disposition_control_request/);
  }
  assert.equal(calls, 0); assert.equal(counts, 0);
  for (const mutate of [
    x => { Object.setPrototypeOf(x.input.memories, Object.create(Array.prototype)); },
    x => { Object.defineProperty(x.input.memories[0].receipts[0], 'role', { get: () => 'user' }); },
    x => { x.input.memories[0].receipts.length = 2; },
  ]) {
    const control = createRationaleDispositionControl(model, oldEdges());
    control.countTokens(JSON.stringify(oldRequest()));
    const request = { ...oldRequest(), signal: new AbortController().signal };
    mutate(request);
    await assert.rejects(control.relate(request), /invalid_disposition_control_request/);
  }
  assert.equal(calls, 0); assert.equal(counts, 3);
  // The old tuple must correlate with the source snapshot, not just be shaped.
  const control = createRationaleDispositionControl(model, [{ ...oldEdges()[0], fromReceipt: 1 }]);
  assert.throws(() => control.countTokens(JSON.stringify(oldRequest())),
    /invalid_disposition_control_request/);
  assert.equal(calls, 0); assert.equal(counts, 3);
});

test('DC3/4 expanded input limit, one-shot send, cancellation and provider failures are bounded', async () => {
  let calls = 0;
  const model = { contextWindow: 8192,
    countTokens: text => text.includes('oldEdges') ? 6001 : 1,
    relate: () => { calls++; return { edges: [] }; } };
  const over = createRationaleDispositionControl(model, oldEdges());
  await assert.rejects(proposeRationale(over, sources(), () => {}), { code: 'context_budget_exceeded' });
  assert.equal(calls, 0);
  await assert.rejects(over.relate({ ...oldRequest(), signal: new AbortController().signal }),
    /invalid_disposition_control_request/);
  model.countTokens = () => 1;
  const abort = createRationaleDispositionControl(model, oldEdges());
  abort.countTokens(JSON.stringify(oldRequest()));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(abort.relate({ ...oldRequest(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const once = createRationaleDispositionControl(model, oldEdges());
  once.countTokens(JSON.stringify(oldRequest()));
  const signal = new AbortController().signal;
  assert.deepEqual(await once.relate({ ...oldRequest(), signal }), { edges: [] });
  await assert.rejects(once.relate({ ...oldRequest(), signal }), /invalid_disposition_control_request/);
  assert.equal(calls, 1);
  model.relate = () => { throw new Error('synthetic provider failure'); };
  const failed = createRationaleDispositionControl(model, oldEdges());
  await assert.rejects(proposeRationale(failed, sources(), () => {}), { code: 'rationale_failed' });
  assert.equal(calls, 1);
  const controller2 = new AbortController();
  model.relate = () => { controller2.abort(); return { edges: [] }; };
  const after = createRationaleDispositionControl(model, oldEdges());
  after.countTokens(JSON.stringify(oldRequest()));
  await assert.rejects(after.relate({ ...oldRequest(), signal: controller2.signal }), { name: 'AbortError' });
});

test('DC4 raw malformed and empty provider outputs are neither repaired nor translated by facade', async () => {
  for (const raw of [{ edges: [] }, { edges: [{ extra: true }] }, { other: true }, null]) {
    const model = { contextWindow: 8192, countTokens: () => 1, relate: () => raw };
    const control = createRationaleDispositionControl(model, oldEdges());
    control.countTokens(JSON.stringify(oldRequest()));
    assert.deepEqual(await control.relate({ ...oldRequest(), signal: new AbortController().signal }), raw);
  }
});
