import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createOpenAIModel, countOpenAITokens } from '../index.mjs';
import { schemasFor, schemasForQualificationInput } from '../schemas.mjs';
import { createQualificationCandidateSnapshot, qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const repeatedText = Array.from({ length: 13 }, (_, n) => createHash('sha256').update(`same-${n}`).digest('hex')).join('').slice(0, 800);
const item = (i, text = repeatedText) => ({ content: `Synthetic claim ${i}`, kind: 'fact', confidence: 0.8,
  receipts: Array.from({ length: 4 }, (_, r) => ({ client: 'synthetic', sessionId: 'session',
    eventId: `event-${i}-${r}`, role: r % 2 ? 'assistant' : 'user', excerpt: text })) });
const items = () => Array.from({ length: 5 }, (_, i) => item(i));
const request = (input) => ({ system: 'Synthetic qualification system', input, maxOutputTokens: 1024,
  signal: new AbortController().signal });
const wire = (input, cite = true) => ({ wireVersion: 'evidence-pool-v1',
  qualifications: Object.fromEntries(input.items.map((entry) => [`item_${entry.itemIndex}`, {
    itemIndex: entry.itemIndex, pool: [entry.candidates[0].candidateIndex],
    ...Object.fromEntries(fields.map((field) => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
      evidenceSlots: field === 'subject' && cite ? [0] : [] }])) }])) });
function envelope(model, output) {
  return { object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}
function fakeHTTP(result, calls) {
  return async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    return Response.json(url.endsWith('/input_tokens')
      ? { object: 'response.input_tokens', input_tokens: 120 } : envelope(body.model, result));
  };
}

test('explicit opt-in schema leaves default guard-facing schema closed', () => {
  const inline = createQualificationCandidateSnapshot([item(0)]).input;
  const { catalog } = createQualificationTextCatalog(inline);
  assert.throws(() => schemasFor('qualifyCandidates', catalog));
  assert.deepEqual(schemasForQualificationInput(inline), schemasFor('qualifyCandidates', inline));
  assert.deepEqual(schemasForQualificationInput(catalog).properties.wireVersion.enum, ['evidence-pool-v1']);
  const malformed = structuredClone(catalog); malformed.texts.push('unused');
  assert.throws(() => schemasForQualificationInput(malformed));
  assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'catalog' }),
    /invalid_openai_configuration/);
});

test('synchronous local fits serialize both modes without transport or diagnostics', () => {
  const calls = []; const events = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    onDiagnostic: (entry) => events.push(entry), fetchImpl: () => { calls.push(1); assert.fail('No fit transport'); } });
  const inline = createQualificationCandidateSnapshot([item(0, 'short source')]).input;
  const catalog = createQualificationTextCatalog(inline).catalog;
  for (const input of [inline, catalog]) {
    assert.equal(model.fitsQualificationRequest({ system: 'Synthetic system', input, maxOutputTokens: 1024 }), true);
  }
  assert.deepEqual(calls, []); assert.deepEqual(events, []);
});

test('catalog wire retains nontrivial original item and candidate IDs', async () => {
  const inline = { items: [{ itemIndex: 7, content: 'Synthetic context', kind: 'context',
    candidates: [{ candidateIndex: 31, role: 'assistant', text: 'shared excerpt' },
      { candidateIndex: 53, role: 'user', text: 'shared excerpt' }] }] };
  const catalog = createQualificationTextCatalog(inline).catalog;
  assert.deepEqual(catalog.items[0].candidates.map((candidate) => candidate.candidateIndex), [31, 53]);
  assert.deepEqual(catalog.items[0].candidates.map((candidate) => candidate.textIndex), [0, 0]);
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic',
    qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: fakeHTTP(wire(inline), calls) });
  const output = await model.qualifyCandidates(request(catalog));
  assert.equal(output.qualifications[0].itemIndex, 7);
  assert.deepEqual(output.qualifications[0].subject.evidenceIndices, [31]);
  assert.equal(calls.length, 2);
});

test('repeated 5x4x800 SHA source refuses inline but selects catalog with one count and one generation', async () => {
  const snapshot = createQualificationCandidateSnapshot(items());
  const { catalog } = createQualificationTextCatalog(snapshot.input);
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fakeHTTP(wire(snapshot.input), calls) });
  const fitInput = (input) => ({ system: 'Synthetic qualification system', input, maxOutputTokens: 1024 });
  assert.equal(model.fitsQualificationRequest(fitInput(snapshot.input)), false);
  assert.equal(model.fitsQualificationRequest(fitInput(catalog)), true);
  const localFits = [];
  const instrumented = Object.freeze({ ...model, fitsQualificationRequest(value) {
    localFits.push(value.input.inputMode ?? 'inline');
    return model.fitsQualificationRequest(value);
  } });
  const output = await qualifyCandidateItems(instrumented, items());
  assert.deepEqual(localFits, ['text-catalog-v1']);
  assert.equal(output.length, 5);
  assert.equal(calls.length, 2);
  const sent = JSON.parse(calls[0].body.input[0].content[0].text);
  assert.deepEqual(sent, catalog);
  assert.equal(calls[0].body.instructions.includes('resolve textIndex through texts'), true);
  assert.equal(calls[0].body.instructions.includes('untrusted data'), true);
  assert.equal(countOpenAITokens(JSON.stringify(calls[0].body)), 4757);
  assert.equal(countOpenAITokens(JSON.stringify({ system: calls[0].body.instructions,
    input: sent, maxOutputTokens: 1024 })), 2935);
  const { max_output_tokens: max, store, stream, ...generationBase } = calls[1].body;
  assert.equal(max, 1024); assert.equal(store, false); assert.equal(stream, false);
  assert.deepEqual(generationBase, calls[0].body);
  for (let i = 0; i < 5; i++) {
    assert.equal(output[i].qualification.anchors.length, 1);
    assert.equal(output[i].qualification.anchors[0].text, snapshot.candidates[i][0].text);
    assert.equal(output[i].receipts[0].eventId, `event-${i}-0`);
  }
});

test('fitting inline remains inline; default model denies named mode before HTTP', async () => {
  const inline = createQualificationCandidateSnapshot([item(0, 'short source')]).input;
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fakeHTTP(wire(inline), calls) });
  await qualifyCandidateItems(model, [item(0, 'short source')]);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[0].body.input[0].content[0].text), inline);
  assert.equal(Object.hasOwn(JSON.parse(calls[0].body.input[0].content[0].text), 'inputMode'), false);
  const denied = [];
  const defaultModel = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fakeHTTP(wire(inline), denied) });
  await assert.rejects(defaultModel.qualifyCandidates(request(createQualificationTextCatalog(inline).catalog)));
  assert.equal(denied.length, 0);
});

test('all-unique oversized sources refuse locally before HTTP; zero field citations reject after generation', async () => {
  const unique = Array.from({ length: 5 }, (_, i) => ({ ...item(i),
    receipts: Array.from({ length: 4 }, (_, r) => ({ client: 'synthetic', sessionId: 'session',
      eventId: `unique-${i}-${r}`, role: r % 2 ? 'assistant' : 'user',
      excerpt: Array.from({ length: 13 }, (_, n) => createHash('sha256').update(`unique-${i}-${r}-${n}`).digest('hex')).join('').slice(0, 800) })) }));
  const uniqueSnapshot = createQualificationCandidateSnapshot(unique);
  const candidateTexts = uniqueSnapshot.input.items.flatMap((entry) => entry.candidates.map((candidate) => candidate.text));
  assert.equal(candidateTexts.length, 80);
  assert.equal(new Set(candidateTexts).size, 80);
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fakeHTTP(wire(uniqueSnapshot.input), calls) });
  await assert.rejects(qualifyCandidateItems(model, unique), error => error.code === 'context_budget_exceeded');
  assert.equal(calls.length, 0);
  const small = [item(0, 'short source')]; const smallInput = createQualificationCandidateSnapshot(small).input;
  const invalidCalls = [];
  const invalidModel = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fakeHTTP(wire(smallInput, false), invalidCalls) });
  await assert.rejects(qualifyCandidateItems(invalidModel, small), error => error.code === 'invalid_model_output');
  assert.equal(invalidCalls.length, 2);
});

test('strict catalog invalidity, abort, provider count and output failures cannot dispatch a retry', async () => {
  const inline = createQualificationCandidateSnapshot([item(0, 'short source')]).input;
  const catalog = createQualificationTextCatalog(inline).catalog;
  for (const mutate of [(value) => { value.texts.push('unused'); },
    (value) => { value.items[0].candidates[0].textIndex = 99; },
    (value) => { value.items[0].candidates[0].extra = true; },
    (value) => { value.items[0].candidates = Array(1); }]) {
    const malformed = structuredClone(catalog); mutate(malformed);
    const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic',
      qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: fakeHTTP(wire(inline), calls) });
    await assert.rejects(model.qualifyCandidates(request(malformed)));
    assert.equal(calls.length, 0);
  }
  const abortCalls = []; const controller = new AbortController(); controller.abort();
  const aborted = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: fakeHTTP(wire(inline), abortCalls) });
  await assert.rejects(aborted.qualifyCandidates({ ...request(catalog), signal: controller.signal }));
  assert.equal(abortCalls.length, 0);
  const countCalls = []; const counted = createOpenAIModel({ apiKey: 'synthetic',
    qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: async (url, options) => {
      countCalls.push(JSON.parse(options.body));
      return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
    } });
  await assert.rejects(counted.qualifyCandidates(request(catalog)));
  assert.equal(countCalls.length, 1);
  const outputCalls = []; const badOutput = createOpenAIModel({ apiKey: 'synthetic',
    qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: fakeHTTP({ ...wire(inline), extra: true }, outputCalls) });
  await assert.rejects(badOutput.qualifyCandidates(request(catalog)), error => error.code === 'invalid_model_output');
  assert.equal(outputCalls.length, 2);
});

test('count callback mutation cannot rewrite catalog source identity or cross-item citations', async () => {
  const inline = createQualificationCandidateSnapshot([item(0, 'first source'), item(1, 'second source')]).input;
  const expected = wire(inline);
  const source = structuredClone(createQualificationTextCatalog(inline).catalog);
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      if (url.endsWith('/input_tokens')) {
        source.texts[0] = 'forged replacement';
        source.items[0].candidates[0].candidateIndex = 999;
        return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      }
      return Response.json(envelope(body.model, expected));
    } });
  const decoded = await model.qualifyCandidates(request(source));
  assert.equal(decoded.qualifications[0].subject.evidenceIndices[0], inline.items[0].candidates[0].candidateIndex);
  assert.equal(JSON.parse(calls[0].input[0].content[0].text).texts[0], 'first source');
  assert.equal(JSON.parse(calls[1].input[0].content[0].text).texts[0], 'first source');
  const foreign = wire(inline); foreign.qualifications.item_0.pool = [inline.items[1].candidates[0].candidateIndex];
  const deniedCalls = []; const denied = createOpenAIModel({ apiKey: 'synthetic',
    qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: fakeHTTP(foreign, deniedCalls) });
  await assert.rejects(denied.qualifyCandidates(request(createQualificationTextCatalog(inline).catalog)),
    error => error.code === 'invalid_model_output');
  assert.equal(deniedCalls.length, 2);
});
