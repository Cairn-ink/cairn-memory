import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  captureSnapshot, extractedItems, extractionLimit, extractionOutputTokens, retainedSourceView,
} from '../src/capture/capture-input.mjs';
import { qualificationInput, qualificationSources } from '../src/capture/claim-qualification-input.mjs';
import {
  compileQualificationCandidates, createQualificationCandidateSnapshot,
} from '../src/capture/qualification-candidates.mjs';
import { extractedWindowItems, sourceWindowCatalog } from '../src/capture/source-windows.mjs';
import { denseArray, object, receiptEventTime } from '../src/capture/validate.mjs';
import { CoreError } from '../src/errors.mjs';

const text = 'cedar grows';
const qualificationMode = 'qualification-v1';
const sourceMode = 'indexed-evidence-v1';
const outputShape = 'invalid_extraction_output_shape';
const message = () => ({ id: 'message', role: 'user', content: text });
const receipt = () => ({ client: 'client', sessionId: 'session', eventId: 'message', role: 'user', excerpt: text });
const snapshot = () => ({ client: 'client', sessionId: 'session', messages: [message()] });
const captureInput = () => ({ ...snapshot(), eventId: 'event',
  namespace: { ownerId: 'owner', scope: 'personal', projectId: 'project' } });
const extraction = () => ({ items: [{ content: text, kind: 'fact', confidence: 0.25, sourceIndices: [0] }] });
const candidateItems = () => [{ content: text, kind: 'fact', receipts: [receipt()] }];
const slot = subject => ({ subject, property: null, scope: null, applies: null });
const claim = () => ({ version: 1, slot: slot('cedar'), value: null, attribution: 'unknown', commitment: 'unknown',
  anchors: [{ receiptIndex: 0, start: 0, end: 5, text: 'cedar', fields: ['subject'] }] });

function selections() {
  const field = (value, evidenceIndices = []) => ({ value, evidenceIndices });
  return { qualifications: [{ itemIndex: 0, subject: field('cedar', [0]), property: field(null),
    scope: field(null), applies: field(null), value: field(null),
    attribution: field('unknown'), commitment: field('unknown') }] };
}

const digest = payload => createHash('sha256').update(payload, 'utf8').digest('hex');
const capture = (input, hash = async payload => digest(payload)) =>
  captureSnapshot(input, qualificationMode, sourceMode, true, undefined, hash);

function changing(target, field, first, later) {
  let reads = 0;
  Object.defineProperty(target, field, { enumerable: true, get: () => ++reads === 1 ? first : later });
  return () => assert.equal(reads, 1, field + ' getter reads');
}

const foreign = new Error('synthetic foreign getter failure');
const coreError = code => error => error instanceof CoreError && error.code === code && error.message === code;

test('captureSnapshot hashes the same content and causal values that it returns', async () => {
  const input = captureInput();
  const contentReads = changing(input.messages[0], 'content', ' first ', '\uD800');
  const causalReads = changing(input, 'causal', { streamId: 'A', sequence: 1 }, { streamId: 'B', sequence: 2 });
  const namespaceReads = changing(input.namespace, 'ownerId', 'owner', 'other');
  let hashed;
  const saved = await capture(input, async payload => {
    hashed = payload;
    input.messages = [{ ...message(), content: 'after hashing started' }];
    return digest(payload);
  });

  assert.equal(saved.messages[0].content, 'first');
  assert.deepEqual(saved.causal, { streamId: 'A', sequence: 1 });
  assert.equal(saved.namespace.ownerId, 'owner');
  assert.equal(hashed, JSON.stringify([
    'cairn.capture.indexed-evidence.v1', ['owner', 'personal', 'project'], 'client', 'event', 'session',
    [['message', 'user', saved.messages[0].content]], [saved.causal.streamId, saved.causal.sequence],
    qualificationMode, sourceMode, 'nonoverlap-800-v1',
  ]));
  assert.equal(saved.payloadDigest, digest(hashed));
  contentReads();
  causalReads();
  namespaceReads();
});

test('captureSnapshot maps a foreign hash rejection to invalid input', async () => {
  await assert.rejects(() => capture(captureInput(), async () => { throw foreign; }), coreError('invalid_input'));
});

test('retainedSourceView calculates truncation from its detached message', () => {
  const input = snapshot();
  const reads = changing(input.messages[0], 'content', text, 'changed');
  const result = retainedSourceView(input);
  assert.deepEqual(result.messages, [message()]);
  assert.deepEqual(result.retainedSourceWindow.truncatedMessageIndices, []);
  reads();
});

test('extractedItems validates and returns the first confidence and source view', () => {
  const model = extraction();
  const confidenceReads = changing(model.items[0], 'confidence', 0.25, 2);
  const itemsReads = changing(model, 'items', model.items, []);
  const source = snapshot();
  const messagesReads = changing(source, 'messages', source.messages, []);
  const reasons = [];

  assert.deepEqual(extractedItems(model, source, undefined, reason => reasons.push(reason)),
    [{ content: text, kind: 'fact', confidence: 0.25, receipts: [receipt()] }]);
  assert.deepEqual(reasons, []);
  confidenceReads();
  itemsReads();
  messagesReads();
});

test('extractedItems detaches retained messages and receipt overrides together', () => {
  const retained = [{ ...message(), client: 'unused' }];
  const excerptReads = changing(retained[0], 'content', text, 'changed');
  const clientReads = changing(retained[0], 'client', 'override', 'changed');
  const result = extractedItems(extraction(), snapshot(), retained, undefined, retained);
  assert.deepEqual(result[0].receipts, [{ ...receipt(), client: 'override' }]);
  excerptReads();
  clientReads();
});

test('sourceWindowCatalog splits one snapshot of its messages and their identity', () => {
  const source = snapshot();
  source.messages[0].content = 'x'.repeat(800) + text;
  const idReads = changing(source.messages[0], 'id', 'message', 'changed');
  const messagesReads = changing(source, 'messages', source.messages, []);
  const result = sourceWindowCatalog(source);

  assert.deepEqual(result.messages.map(({ id, content }) => [id, content]),
    [['message', 'x'.repeat(800)], ['message', text]]);
  assert.equal(result.coverage.sourceWindowCatalog.messageCount, 1);
  idReads();
  messagesReads();
});

test('sourceWindowCatalog maps a bad detached shape and preserves the engine text error', () => {
  assert.throws(() => sourceWindowCatalog({ messages: null }), coreError('invalid_input'));
  assert.throws(() => sourceWindowCatalog({ messages: [{ ...message(), content: 'a\0b' }] }), coreError('invalid_text'));
});

test('extractedWindowItems uses one set of indices for receipts and causal remapping', () => {
  const source = { ...snapshot(), causal: { streamId: 'A', sequence: 1 } };
  source.messages[0].content = 'x'.repeat(800) + text;
  const catalog = { ...sourceWindowCatalog(source) };
  const catalogReads = changing(catalog, 'input', catalog.input, null);
  const causalReads = changing(source, 'causal', source.causal, undefined);
  const model = extraction();
  const indexReads = changing(model.items[0], 'sourceIndices', [1], [99]);
  const result = extractedWindowItems(model, source, catalog);

  assert.deepEqual(result[0].receipts, [receipt()]);
  assert.deepEqual(result[0].sourceIndices, [0]);
  catalogReads();
  causalReads();
  indexReads();
});

test('qualificationSources validates the first receipt time and excerpt', () => {
  const source = receipt();
  const timeReads = changing(source, 'occurredAt', '2026-01-02T03:04:05.000Z', 'invalid');
  const excerptReads = changing(source, 'excerpt', text, '\uD800');
  assert.equal(qualificationSources(text, [source]), undefined);
  timeReads();
  excerptReads();
});

test('qualificationInput validates and keeps the first slot and bound excerpt', () => {
  const input = claim();
  const source = receipt();
  const slotReads = changing(input, 'slot', slot('cedar'), slot('pine'));
  const excerptReads = changing(source, 'excerpt', text, 'pine');
  assert.deepEqual(qualificationInput(input, [source]), claim());
  slotReads();
  excerptReads();
});

test('qualificationInput maps a throwing fields getter on an invalid anchor', () => {
  const input = claim();
  const anchor = input.anchors[0];
  anchor.receiptIndex = -1;
  let reads = 0;
  Object.defineProperty(anchor, 'fields', { enumerable: true, get() { reads++; throw foreign; } });
  assert.throws(() => qualificationInput(input, [receipt()]), coreError('invalid_input'));
  assert.equal(reads, 1);
});

test('createQualificationCandidateSnapshot copies an item and receipt before validation', () => {
  const items = candidateItems();
  const contentReads = changing(items[0], 'content', text, 'changed');
  const excerptReads = changing(items[0].receipts[0], 'excerpt', text, 'changed');
  const result = createQualificationCandidateSnapshot(items);

  assert.deepEqual(result.items, candidateItems());
  assert.equal(result.input.items[0].content, text);
  assert.deepEqual(result.input.items[0].candidates, [{ candidateIndex: 0, role: 'user', text }]);
  contentReads();
  excerptReads();
});

test('compileQualificationCandidates validates and uses the first evidence indices', () => {
  const output = selections();
  const reads = changing(output.qualifications[0].subject, 'evidenceIndices', [0], [99]);
  const source = createQualificationCandidateSnapshot(candidateItems());
  const [result] = compileQualificationCandidates(output, source);

  const expected = claim();
  expected.anchors[0] = { ...expected.anchors[0], end: text.length, text };
  assert.deepEqual(result.qualification, expected);
  assert.equal(result.receipts, source.items[0].receipts);
  reads();
});

test('compileQualificationCandidates detaches a caller-supplied source mapping', () => {
  const source = structuredClone(createQualificationCandidateSnapshot(candidateItems()));
  const candidate = source.candidates[0][0];
  const reads = changing(candidate, 'text', text, 'changed');
  const [result] = compileQualificationCandidates(selections(), source);

  assert.equal(result.qualification.anchors[0].text, text);
  assert.notEqual(result.receipts, source.items[0].receipts);
  reads();
});

test('extraction sizing helpers snapshot role and window grouping', () => {
  for (const [run, expected] of [[extractionLimit, 6], [extractionOutputTokens, Math.ceil(1024 * 6 / 5)]]) {
    const messages = Array.from({ length: 6 }, (_, messageIndex) => ({ ...message(), messageIndex }));
    const roleReads = changing(messages[0], 'role', 'user', 'assistant');
    const groupReads = changing(messages[1], 'messageIndex', 1, 2);
    assert.equal(run(messages), expected);
    roleReads();
    groupReads();
  }
});

test('shape validators return detached data and snapshot receipt time arguments', () => {
  const record = { content: text };
  const reads = changing(record, 'content', text, 'changed');
  const records = [record];
  const validated = denseArray(records, 1, 1);
  assert.notEqual(validated, records);
  assert.notEqual(validated[0], record);
  assert.deepEqual(object(validated[0], ['content']), { content: text });
  reads();

  const clock = ['2026-01-02T03:00:00.000Z'];
  const clockReads = changing(clock, 0, clock[0], 'invalid');
  assert.equal(receiptEventTime('2026-01-02T03:05:00.000Z', clock), '2026-01-02T03:05:00.000Z');
  clockReads();
});

test('extraction keeps signed zero and rejects holes, extra array keys and NaN', () => {
  const output = extraction();
  output.items[0].confidence = -0;
  assert.ok(Object.is(extractedItems(output, snapshot())[0].confidence, -0));
  output.items[0].confidence = NaN;
  const reasons = [];
  const run = () => extractedItems(output, snapshot(), undefined, reason => reasons.push(reason));
  assert.throws(run, coreError('invalid_model_output'));
  output.items = Array(1);
  assert.throws(run, coreError('invalid_model_output'));
  output.items = extraction().items;
  output.items.extra = undefined;
  assert.throws(run, coreError('invalid_model_output'));
  assert.deepEqual(reasons, ['invalid_extraction_value', outputShape, outputShape]);
});

const boundaries = [
  ['captureSnapshot', captureInput, input => capture(input), 'invalid_input'],
  ['retainedSourceView', snapshot, retainedSourceView, 'invalid_input'],
  ['extractedItems', extraction, (output, observe) => extractedItems(output, snapshot(), undefined, observe),
    'invalid_model_output', outputShape],
  ['sourceWindowCatalog', snapshot, sourceWindowCatalog, 'invalid_input'],
  ['extractedWindowItems', extraction,
    (output, observe) => extractedWindowItems(output, snapshot(), sourceWindowCatalog(snapshot()), observe),
    'invalid_model_output', outputShape],
  ['qualificationSources', () => [receipt()], receipts => qualificationSources(text, receipts), 'invalid_input'],
  ['qualificationInput', claim, input => qualificationInput(input, [receipt()]), 'invalid_input'],
  ['createQualificationCandidateSnapshot', candidateItems, createQualificationCandidateSnapshot, 'invalid_model_output'],
  ['compileQualificationCandidates', selections,
    output => compileQualificationCandidates(output, createQualificationCandidateSnapshot(candidateItems())),
    'invalid_model_output'],
  ['extractionLimit', () => [message()], extractionLimit, 'invalid_input'],
  ['extractionOutputTokens', () => [message()], extractionOutputTokens, 'invalid_input'],
  ['object', () => ({}), value => object(value, []), 'invalid_input'],
  ['denseArray', () => [], value => denseArray(value, 0, 1), 'invalid_input'],
  ['receiptEventTime', () => ({}), value => receiptEventTime(value), 'invalid_input'],
];

for (const [name, input, run, code, reason] of boundaries) {
  test(name + ' maps a throwing getter to its boundary code', async () => {
    const data = input();
    let reads = 0;
    Object.defineProperty(data, 'failure', { enumerable: true, get() { reads++; throw foreign; } });
    const reasons = [];
    await assert.rejects(async () => run(data, value => reasons.push(value)), coreError(code));
    assert.equal(reads, 1);
    assert.deepEqual(reasons, reason ? [reason] : []);
  });

  for (const [label, make] of [
    ['Proxy', value => new Proxy(value, {})],
    ['function', () => () => {}],
    ['symbol', () => Symbol('value')],
  ]) {
    test(name + ' refuses a non-cloneable ' + label, async () => {
      const reasons = [];
      await assert.rejects(async () => run(make(input()), value => reasons.push(value)), coreError(code));
      assert.deepEqual(reasons, reason ? [reason] : []);
    });
  }
}

test('model output boundaries map failures from ancillary input before default sizing or validation', () => {
  const proxy = new Proxy(snapshot(), {});
  const catalog = new Proxy(sourceWindowCatalog(snapshot()), {});
  const candidateSnapshot = new Proxy(createQualificationCandidateSnapshot(candidateItems()), {});
  const reasons = [];
  const observe = reason => reasons.push(reason);

  assert.throws(() => extractedItems(extraction(), proxy, undefined, observe), coreError('invalid_model_output'));
  assert.throws(() => extractedWindowItems(extraction(), snapshot(), catalog, observe), coreError('invalid_model_output'));
  assert.throws(() => compileQualificationCandidates(selections(), candidateSnapshot), coreError('invalid_model_output'));
  assert.deepEqual(reasons, [outputShape, outputShape]);
});
