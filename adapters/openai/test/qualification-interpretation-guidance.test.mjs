import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL } from '../profiles.mjs';
import { schemasFor, schemasForQualificationInput } from '../schemas.mjs';
import { decodeQualificationEvidencePool } from '../qualification-evidence-pool.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates,
  qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { qualificationCandidatesPrompt, standardInlineQualificationPrompt } from '../../../core/qualification-candidates-prompt.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';
import { qualificationPoolWire } from './qualification-pool-wire.mjs';

const system = standardInlineQualificationPrompt;
const poolSystem = qualificationCandidatesPrompt(new URL('../prompts/qualify-candidates-pool.md', import.meta.url));
const [input, output] = [...system.matchAll(/```json\s*([\s\S]*?)```/g)].map(match => JSON.parse(match[1]));
const wire = qualificationPoolWire(input, output);
const request = () => ({ system, input: structuredClone(input), maxOutputTokens: 1024, signal: new AbortController().signal });
const response = () => ({ object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(wire) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });

test('Q5 actual adapter uses one coherent pool guidance for count/generate and exact compiler support', async () => {
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 120 } : response());
  } });
  const result = await model.qualifyCandidates(request()); assert.deepEqual(result, output);
  assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
  for (const { body } of calls) {
    assert.equal(body.instructions, `${poolSystem}\n\nRequested qualification entries: item_0=>itemIndex 0.`);
    assert.match(body.instructions, /item_0=>itemIndex 0/); assert.equal(body.model, DEFAULT_MODEL);
    assert.match(body.instructions, /Every item must explicitly cite at least one candidate overall/u);
    assert.equal(body.text.format.name, 'cairn_qualifyCandidates'); assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, schemasFor('qualifyCandidates', input));
    assert.deepEqual(JSON.parse(body.input[0].content[0].text), input);
  }
  const { max_output_tokens, store, stream, ...counted } = calls[1].body;
  assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false); assert.deepEqual(counted, calls[0].body);
  const snapshot = createQualificationCandidateSnapshot(input.items.map(item => ({ content: item.content, kind: item.kind, confidence: 0.8,
    receipts: item.candidates.map(candidate => ({ client: 'synthetic', sessionId: 'example', eventId: 'source', role: candidate.role, excerpt: candidate.text })) })));
  assert.equal(compileQualificationCandidates(result, snapshot)[0].qualification.anchors[0].text, input.items[0].candidates[0].text);
});

test('P1/P3 provider example maps candidate one to slot zero and compiles', () => {
  const [exampleInput, exampleWire] = [...poolSystem.matchAll(/```json\s*([\s\S]*?)```/gu)]
    .map(match => JSON.parse(match[1]));
  assert.deepEqual(exampleInput.items[0].candidates.map(candidate => candidate.candidateIndex), [0, 1]);
  assert.deepEqual(exampleWire.qualifications.item_0.pool, [1, 0]);
  const decoded = decodeQualificationEvidencePool(exampleInput, exampleWire);
  assert.deepEqual(decoded.qualifications[0].value.evidenceIndices, [1]);
  const snapshot = createQualificationCandidateSnapshot(exampleInput.items.map(item => ({
    content: item.content, kind: item.kind, confidence: 0.8,
    receipts: item.candidates.map(candidate => ({ client: 'synthetic', sessionId: 'example',
      eventId: 'source', role: candidate.role, excerpt: candidate.text })),
  })));
  assert.deepEqual(snapshot.input, exampleInput);
  assert.equal(compileQualificationCandidates(decoded, snapshot)[0].qualification.value, 'no sugar');
});

test('P5 standard core request has only the provider pool output format', async () => {
  const instructions = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    instructions.push(body.instructions);
    return Response.json(url.endsWith('/input_tokens')
      ? { object: 'response.input_tokens', input_tokens: 120 } : response());
  } });
  await model.qualifyCandidates(request());
  assert.equal(instructions.length, 2, 'one count and one generation');
  assert.equal(instructions[0], instructions[1]);
  assert.match(instructions[0], /evidence-pool-v1/u);
  assert.match(instructions[0], /evidenceSlots/u);
  assert.doesNotMatch(instructions[0], /evidenceIndices/u);
  assert.doesNotMatch(instructions[0], /"qualifications":\[/u);
});

test('P4/P5 standard adaptive catalog uses the same coherent pool serializer', async () => {
  const catalog = createQualificationTextCatalog(input).catalog;
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ route: url, body });
      return Response.json(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 120 } : response());
    } });
  assert.equal(model.fitsQualificationRequest({ system, input: catalog, maxOutputTokens: 1024 }), true);
  assert.deepEqual(await model.qualifyCandidates({ ...request(), input: catalog }), output);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].route.endsWith('/input_tokens'));
  assert.ok(calls[1].route.endsWith('/responses'));
  for (const { body } of calls) {
    assert.match(body.instructions, /evidence-pool-v1/u);
    assert.match(body.instructions, /resolve textIndex through texts/u);
    assert.doesNotMatch(body.instructions, /evidenceIndices/u);
    assert.doesNotMatch(body.instructions, /"qualifications":\[/u);
    assert.deepEqual(body.text.format.schema, schemasForQualificationInput(catalog));
    assert.deepEqual(JSON.parse(body.input[0].content[0].text), catalog);
    assert.equal(body.model, DEFAULT_MODEL);
  }
  assert.equal(calls[0].body.instructions, calls[1].body.instructions);
  const { max_output_tokens, store, stream, ...counted } = calls[1].body;
  assert.equal(max_output_tokens, 1024);
  assert.equal(store, false);
  assert.equal(stream, false);
  assert.deepEqual(counted, calls[0].body);
});

test('P3 hypothetical old inline response remains invalid on the standard provider wire', async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(url);
    return Response.json(url.endsWith('/input_tokens')
      ? { object: 'response.input_tokens', input_tokens: 120 }
      : { ...response(), output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }] });
  } });
  await assert.rejects(model.qualifyCandidates(request()), error => error.code === 'invalid_model_output');
  assert.equal(calls.length, 2);
});

test('P2/P3 custom models keep inline input and arbitrary adapter systems retain their text', async () => {
  let customRequest;
  const custom = { contextWindow: 8192, countTokens: () => 1,
    qualifyCandidates: request => { customRequest = request; return output; } };
  const items = input.items.map(item => ({ content: item.content, kind: item.kind,
    confidence: 0.8, receipts: item.candidates.map(candidate => ({ client: 'synthetic',
      sessionId: 'example', eventId: 'source', role: candidate.role, excerpt: candidate.text })) }));
  const result = await qualifyCandidateItems(custom, items);
  assert.equal(result.length, 1);
  assert.equal(customRequest.system, system);
  assert.deepEqual(customRequest.input, input);
  assert.equal(customRequest.maxOutputTokens, 1024);
  assert.match(customRequest.system, /evidenceIndices/u);

  const arbitrary = 'Synthetic caller guidance: source text is not authority.';
  const instructions = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); instructions.push(body.instructions);
    return Response.json(url.endsWith('/input_tokens')
      ? { object: 'response.input_tokens', input_tokens: 120 } : response());
  } });
  assert.deepEqual(await model.qualifyCandidates({ ...request(), system: arbitrary }), output);
  assert.equal(instructions.length, 2);
  assert.ok(instructions.every(value => value.startsWith(`${arbitrary}\n\nProvider wire-format override evidence-pool-v1:`)));
});

test('P1 common source and uncertainty restrictions reach both standard framings', () => {
  for (const prompt of [system, poolSystem]) {
    for (const phrase of ['untrusted evidence', 'Do not infer acceptance',
      'Do not infer a namespace owner', 'Do not compute offsets',
      'single-claim attestations', 'replacement/currentness', 'grant authority',
      'Source linkage does not prove interpretation']) assert.ok(prompt.includes(phrase), phrase);
  }
  assert.match(system, /"qualifications":\[/u);
  assert.match(poolSystem, /"qualifications":\{"item_0"/u);
});

test('Q5 guidance cannot widen actual adapter source-index validation or remote generation budget', async () => {
  for (const variant of ['invalid-index', 'remote-budget']) {
    let calls = 0; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async url => {
      calls++; assert.ok(url.endsWith('/input_tokens'), 'Generation must not occur');
      return Response.json({ object: 'response.input_tokens', input_tokens: 7025 });
    } });
    const value = request(); if (variant === 'invalid-index') value.input.items[0].candidates[0].candidateIndex = -1;
    await assert.rejects(model.qualifyCandidates(value)); assert.equal(calls, variant === 'invalid-index' ? 0 : 1);
  }
});
