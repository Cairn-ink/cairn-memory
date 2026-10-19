import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createOpenAIModel } from '../index.mjs';

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const personal = { ownerId: 'h4-fake-http', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'project' };
const reference = ({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision });

test('H4 actual fake HTTP ordinary capture, cold reopen and strict selectGroups retain both origins and exact sources', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-h4-http-' });
  const calls = []; let disabled = false;
  const model = createOpenAIModel({ apiKey: 'synthetic-offline-h4', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body), input = JSON.parse(body.input[0].content[0].text);
    const method = body.text.format.name.slice('cairn_'.length);
    calls.push({ url, method, body, input });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    let output;
    if (method === 'extract') output = { items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    else if (method === 'classify') output = { items: input.memories.map(memory => {
      const [domain, topic] = memory.content.split('|');
      return { memoryId: memory.id, parentIds: [], newL1: { title: topic, parentL2Ids: [],
        ...(domain === 'S' ? {} : { newL2Title: domain }) } };
    }) };
    else if (method === 'selectGroups') output = { refs: disabled ? [] : input.maps
      .flatMap(map => map.groups.slice(0, input.maxRefs === 2 ? 1 : 2)).slice(0, input.maxRefs).map(reference) };
    else if (method === 'select') output = { refs: [] };
    else if (method === 'rank') output = { refs: input.candidates.slice(0, input.limit).map(item => ({
      namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
    else assert.fail(method);
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
  } });
  const path = join(workspace.path, 'memory.sqlite');
  let core = openMemoryCore({ path, model }); workspace.defer(() => core.close());
  const sources = [];
  for (const namespace of [personal, project]) {
    const captured = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session', eventId: namespace.scope,
      messages: [{ id: 'standalone', role: 'user', content: 'S|Alpha|retained ordinary standalone source.' },
        { id: 'connected', role: 'user', content: 'Work|Beta|retained ordinary connected source.' }] }));
    assert.equal(captured.classification.status, 'applied');
    for (const memory of captured.admission.memories) sources.push(ok(core.get({ namespace, memoryId: memory.id })));
  }
  core.close(); core = openMemoryCore({ path, model });
  const request = { readSet: [personal, project], query: 'retained ordinary source', contextMode: 'source-evidence',
    selectionMode: 'moc-hierarchy-v2' };
  calls.length = 0;
  const result = ok(await core.recall(request));
  const generations = calls.filter(call => call.url.endsWith('/responses'));
  assert.deepEqual(generations.map(call => call.method), ['selectGroups', 'selectGroups', 'select', 'rank']);
  assert.equal(result.memories.length, 4); assert.equal(result.selection.resources.modelCalls, 4);
  assert.deepEqual(new Set(result.selection.candidates.flatMap(ref => ref.paths.map(path => path.origin))),
    new Set(['standalone', 'connected']));
  for (const item of result.memories) {
    const source = sources.find(source => source.memory.id === item.memory.id);
    assert.deepEqual(item.receipts, source.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  }
  for (const generated of generations.filter(call => call.method === 'selectGroups')) {
    const counted = calls.find(call => call.url.endsWith('/input_tokens') && JSON.stringify(call.input) === JSON.stringify(generated.input));
    assert.ok(counted); assert.equal(generated.body.text.format.strict, true);
    assert.deepEqual(Object.keys(generated.input).sort(), ['maps', 'maxRefs', 'maxRefsPerNamespace', 'query']);
    for (const map of generated.input.maps) for (const group of map.groups) {
      assert.deepEqual(Object.keys(group).sort(), ['mocId', 'namespaceIndex', 'revision', 'title']);
    }
    const { max_output_tokens, store, stream, ...wire } = generated.body;
    assert.deepEqual(wire, counted.body); assert.equal(max_output_tokens, 1024);
  }
  disabled = true; calls.length = 0;
  const control = ok(await core.recall(request));
  assert.deepEqual(control.memories, []); assert.equal(control.selection.resources.fetchCalls, 0);
  assert.equal(calls.some(call => call.method === 'rank'), false);
});
