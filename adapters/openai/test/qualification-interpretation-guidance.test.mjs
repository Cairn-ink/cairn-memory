import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL } from '../profiles.mjs';
import { schemasFor } from '../schemas.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../../../core/qualification-candidates.mjs';

const system = readFileSync(new URL('../../../core/prompts/qualify-candidates.md', import.meta.url), 'utf8');
const [input, output] = [...system.matchAll(/```json\s*([\s\S]*?)```/g)].map(match => JSON.parse(match[1]));
const request = () => ({ system, input: structuredClone(input), maxOutputTokens: 1024, signal: new AbortController().signal });
const response = () => ({ object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });

test('Q5 actual adapter frames new prompt unchanged across counting/generation with baseline method/schema and exact compiler support', async () => {
  const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 120 } : response());
  } });
  const result = await model.qualifyCandidates(request()); assert.deepEqual(result, output);
  assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
  for (const { body } of calls) {
    assert.equal(body.instructions, system); assert.equal(body.model, DEFAULT_MODEL);
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
