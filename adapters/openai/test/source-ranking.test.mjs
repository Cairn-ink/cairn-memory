import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'idf-fake-http', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const response = (model, output) => Response.json({ object: 'response', model, status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });

test('R4 strict real adapter uses o200k and existing select/rank calls for opt-in source ranking', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-idf-http-' });
  const calls = [];
  let invalid = false;
  const model = createOpenAIModel({ apiKey: 'synthetic-idf-key', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content[0].text);
    const method = body.text.format.name.slice('cairn_'.length);
    calls.push({ url, options, body, input, method });
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-idf-key');
    assert.equal(options.redirect, 'error');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.truncation, 'disabled');
    assert.equal(JSON.stringify(input).includes('bounded-idf-v1'), false);
    assert.equal(/maskBytes|eligibleMemories|receiptReads|queryTokenCount/.test(JSON.stringify(input)), false);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    let output;
    if (method === 'extract') output = { items: input.messages.map(message => ({
      content: message.content.startsWith('cobaltmarker') ? 'Compressed source interpretation' : message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    else if (method === 'classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    else if (method === 'select') output = { refs: input.maps.flatMap(map => map.items.slice(0, 12).map(item => ({
      namespaceIndex: map.namespaceIndex, ...(item.type === 'unfiled' ? item.ref
        : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))).slice(0, input.maxRefs) };
    else if (method === 'rank') output = { refs: input.candidates.filter(item => item.receipts.some(receipt =>
      receipt.excerpt.includes('cobaltmarker'))).slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex,
      memoryId: item.memory.id, revision: item.memory.revision })) };
    else assert.fail(`unexpected model stage ${method}`);
    return response(body.model, invalid && method === 'select' ? { refs: [{ namespaceIndex: 0,
      memoryId: 'invented-memory', revision: 1 }] } : output);
  } });
  const path = join(workspace.path, 'memory.sqlite');
  let core = openMemoryCore({ path, model }); workspace.defer(() => core.close());
  const source = 'cobaltmarker exact synthetic source';
  const captured = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'idf', eventId: 'capture',
    messages: ['generic amber copper quartz zero', 'generic amber copper quartz one', source]
      .map((content, index) => ({ id: `source-${index}`, role: 'user', content })) }));
  assert.equal(captured.classification.status, 'applied');
  const target = captured.admission.memories.find(memory =>
    ok(core.get({ namespace, memoryId: memory.id })).memory.content === 'Compressed source interpretation');
  assert.ok(target);
  const detail = ok(core.get({ namespace, memoryId: target.id }));
  // In this small matched-wire control, df(rare)=1 and df(generic)=2 for N=3.
  // Four generic weights would legitimately outweigh the one rare weight.
  assert.ok(Math.log1p(2.5 / 1.5) > Math.log1p(1.5 / 2.5));
  const request = { readSet: [namespace], query: 'generic cobaltmarker', contextMode: 'source-evidence' };
  calls.length = 0;
  const old = ok(await core.recall(request));
  const baseline = calls.filter(call => call.url.endsWith('/responses'));
  assert.deepEqual(baseline.map(call => call.method), ['select', 'rank']);
  core.close(); core = openMemoryCore({ path, model, sourceRankingPolicy: 'bounded-idf-v1' });
  calls.length = 0;
  const ranked = ok(await core.recall(request));
  const generations = calls.filter(call => call.url.endsWith('/responses'));
  assert.deepEqual(generations.map(call => call.method), ['select', 'rank']);
  assert.equal(generations[0].input.maps[0].items[0].ref.memoryId, target.id);
  assert.equal(generations[0].input.maps[0].items[0].label, source);
  assert.deepEqual(ranked.memories, old.memories);
  assert.deepEqual(ranked.memories[0].receipts, detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  for (let index = 0; index < generations.length; index += 1) {
    assert.equal(generations[index].body.max_output_tokens, baseline[index].body.max_output_tokens);
    assert.equal(generations[index].input.maxRefs, baseline[index].input.maxRefs);
    const generation = generations[index];
    const count = calls.find(call => call.method === generation.method && call.url.endsWith('/input_tokens'));
    const { max_output_tokens, store, stream, ...generationBody } = generation.body;
    assert.deepEqual(generationBody, count.body);
    assert.equal(store, false); assert.equal(stream, false);
    assert.equal(max_output_tokens, 1024);
  }
  invalid = true; calls.length = 0;
  const rejected = await core.recall(request);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'invalid_model_output');
  assert.deepEqual(calls.filter(call => call.url.endsWith('/responses')).map(call => call.method), ['select']);
});
