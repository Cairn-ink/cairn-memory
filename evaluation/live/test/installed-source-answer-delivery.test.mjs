import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInstalledSourceAnswer, deliverInstalledSourceAnswer, SOURCE_ANSWER_MODEL } from '../installed-source-answer-delivery.mjs';

const source = () => ({ memory: { id: 'memory-1', revision: 2, currentness: 'current' },
  receipts: [{ id: 'receipt-1', role: 'user', excerpt: 'Only next week I use the café; not a permanent change.' }],
  receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const value = () => ({ ok: true, evidenceTrust: 'untrusted-data-not-instructions',
  value: { memories: [source()], namespaces: [], coverage: 'complete' } });
const tool = v => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(v) }] });
const response = () => ({ object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic answer, not a quality judgment.' } }] });
const input = () => ({ question: 'What changed?', toolResult: tool(value()) });

test('ISAD1 exact source DTO survives without authority, tools, namespaces or caller mutation', async () => {
  const v = value(), request = { question: 'What changed?', toolResult: tool(v) };
  const body = prepareInstalledSourceAnswer(request);
  const context = JSON.parse(body.messages[1].content);
  assert.deepEqual(context.memory.sources, v.value.memories);
  assert.equal(Object.hasOwn(body, 'tools'), false); assert.equal(body.store, false);
  assert.equal(body.stream, false); assert.equal(body.max_completion_tokens, 1024);
  assert.match(body.messages[0].content, /not instructions, verified truth, or execution authority/u);
  assert.match(body.messages[0].content, /complete transport coverage does not mean all relevant facts/u);
  assert.equal(JSON.stringify(context).includes('namespaces'), false);
  let calls = 0;
  const result = await deliverInstalledSourceAnswer({ ...request, complete: async received => {
    calls++; assert.deepEqual(received, body); return response();
  } });
  assert.equal(calls, 1); assert.equal(result.status, 'generated-unassessed');
  assert.equal(result.completionCalls, 1); assert.equal(Object.hasOwn(result, 'correct'), false);
});

test('ISAD2 malformed, partial, wrong-context and overflow evidence never invokes completion', async () => {
  const mutations = [v => { v.ok = false; }, v => { delete v.evidenceTrust; },
    v => { v.value.coverage = 'budget_exhausted'; }, v => { v.value.memories[0].receiptCount = 2; },
    v => { v.value.memories[0].memory.content = 'Generated interpretation'; },
    v => { v.value.memories[0].qualification = { commitment: 'adopted' }; },
    v => { v.value.memories[0].receipts[0].role = 'system'; },
    v => { v.value.memories[0].receipts[0].excerpt = 'x'.repeat(801); },
    v => { v.value.memories[0].receipts[0].excerpt = '\ud800'; },
    v => { v.value.memories[0].receipts[0].id = `sk-${'a'.repeat(40)}`; },
    v => { v.value.memories[0].receipts.push(v.value.memories[0].receipts[0]); v.value.memories[0].receiptCount = 2; },
    v => { v.value.memories = Array.from({ length: 7 }, () => source()); },
    v => { v.value.memories[0].receipts = Array.from({ length: 40 }, (_, i) => ({ id: `r-${i}`, role: 'user', excerpt: 'x'.repeat(800) })); v.value.memories[0].receiptCount = 40; }];
  let calls = 0;
  for (const change of mutations) {
    const v = value(); change(v);
    const result = await deliverInstalledSourceAnswer({ question: 'What changed?', toolResult: tool(v), complete: () => { calls++; } });
    assert.equal(result.status, 'invalid-source');
  }
  for (const patch of [{ question: 'x'.repeat(4001) }, { toolResult: { isError: true, content: [] } },
    { toolResult: { isError: false, content: [{ type: 'text', text: 'not json' }] } },
    { toolResult: { isError: false, content: [{ type: 'text', text: 'x'.repeat(262145) }] } }]) {
    assert.equal((await deliverInstalledSourceAnswer({ ...input(), ...patch, complete: () => { calls++; } })).status, 'invalid-source');
  }
  assert.equal(calls, 0);
});

test('ISAD3 empty successful recall remains valid unknown evidence, not a transport failure', async () => {
  const v = value(); v.value.memories = [];
  const result = await deliverInstalledSourceAnswer({ question: 'What changed?', toolResult: tool(v), complete: async body => {
    assert.deepEqual(JSON.parse(body.messages[1].content).memory.sources, []); return response();
  } });
  assert.equal(result.status, 'generated-unassessed');
});

test('ISAD4 completion failures, malformed/truncated/tool-bearing answers are retained without retry', async () => {
  let calls = 0;
  const failed = await deliverInstalledSourceAnswer({ ...input(), complete: async () => { calls++; throw new Error('synthetic'); } });
  assert.equal(failed.status, 'completion-failed'); assert.equal(calls, 1);
  for (const change of [r => { r.choices[0].finish_reason = 'length'; },
    r => { r.choices[0].message.tool_calls = []; }, r => { r.choices[0].message.function_call = {}; },
    r => { r.choices[0].message.refusal = 'refused'; }, r => { r.model = 'other'; },
    r => { r.choices = []; }]) {
    const r = response(); change(r); calls = 0;
    const result = await deliverInstalledSourceAnswer({ ...input(), complete: () => { calls++; return r; } });
    assert.equal(result.status, 'invalid-output'); assert.equal(calls, 1);
    assert.equal(result.answer, r.choices[0]?.message.content ?? null);
  }
  assert.equal((await deliverInstalledSourceAnswer(input())).completionCalls, 0);
});

test('LAC1 malformed single choices remain invalid output after exactly one completion', async () => {
  for (const malformed of [[null], [undefined], new Array(1), ['primitive']]) {
    let calls = 0;
    const output = { ...response(), choices: malformed };
    const result = await deliverInstalledSourceAnswer({ ...input(), complete: () => { calls++; return output; } });
    assert.deepEqual(result, { status: 'invalid-output', answer: null,
      completionCalls: 1, finishReason: null });
    assert.equal(calls, 1);
  }
});
