import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';
import { createOpenAIModel } from '../adapters/openai/index.mjs';

// Real tokenizer/adapter, exclusively scripted HTTP. No environment key or network.
const json = (body) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' } });
const calls = [];
let counted;
const model = createOpenAIModel({ apiKey: 'synthetic-not-a-real-key',
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ url, method: payload.text.format.name });
    const input = JSON.parse(payload.input[0].content[0].text);
    if (url.endsWith('/responses/input_tokens')) {
      // Synthetic server framing is NOT evidence of actual provider token counts.
      counted = model.countTokens(JSON.stringify({ system: payload.instructions,
        input, maxOutputTokens: 1024 })) + 64;
      return json({ object: 'response.input_tokens', input_tokens: counted });
    }
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const method = payload.text.format.name;
    let output;
    if (method === 'cairn_extract') output = { items: [{ content: 'Use diagrams in reviews.',
      kind: 'instruction', confidence: 0.9, sourceIndices: [0] }] };
    else if (method === 'cairn_classify') output = { items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Review preferences', parentL2Ids: [] } })) };
    else if (method === 'cairn_select') output = { refs: input.maps.flatMap(({ namespaceIndex, items }) =>
      items.flatMap((item) => item.type === 'unfiled' ? [{ namespaceIndex, ...item.ref }] :
        item.type === 'ref' && item.ref.childType === 'memory' ? [{ namespaceIndex,
          memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])).slice(0, 1) };
    else {
      assert.equal(method, 'cairn_rank');
      output = { refs: input.candidates.slice(0, 1).map(({ namespaceIndex, memory }) => ({
        namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
    }
    const text = JSON.stringify(output);
    const outputTokens = model.countTokens(text);
    return json({ id: 'resp_synthetic', object: 'response', model: payload.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: counted, output_tokens: outputTokens, total_tokens: counted + outputTokens } });
  } });

const namespace = { ownerId: 'synthetic-openai', scope: 'personal', projectId: null };
const path = join(mkdtempSync(join(tmpdir(), 'cairn-openai-offline-')), 'memory.sqlite');
const core = openMemoryCore({ path, model });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
try {
  const captured = ok(await core.capture({ namespace, client: 'demo', eventId: 'event', sessionId: 'session',
    messages: [{ id: 'source', role: 'user', content: 'Please use diagrams in reviews.' }] }));
  assert.equal(captured.classification.status, 'applied');
  const memoryId = captured.admission.memories[0].id;
  const recalled = ok(await core.recall({ readSet: [namespace], query: 'How should reviews work?' }));
  assert.equal(recalled.memories[0].memory.id, memoryId);
  assert.equal(recalled.memories[0].receipts[0].eventId, 'source');
  const changed = ok(core.correct({ namespace, memoryId,
    expectedRevision: recalled.memories[0].memory.revision, content: 'Use concise text in reviews.',
    kind: 'instruction', receipt: { client: 'demo', sessionId: 'session', eventId: 'correction',
      role: 'user', excerpt: 'Use concise text instead.' } }));
  const current = ok(await core.recall({ readSet: [namespace], query: 'How should reviews work?' }));
  assert.equal(current.memories[0].memory.content, changed.memory.content);
  assert.equal(current.memories[0].receipts[0].eventId, 'correction');
  ok(core.forget({ namespace, memoryId, expectedRevision: changed.memory.revision }));
  assert.equal(core.get({ namespace, memoryId }).error.code, 'memory_not_found');
  assert.deepEqual(ok(core.list({ namespace })).memories, []);
  assert.equal(calls.length, 12);
  console.log('PASS: real tokenizer + offline adapter → capture → classify → recall → correct → forget');
  console.log(`Synthetic database retained at ${path}`);
  console.log('HTTP/model responses are scripted. No real provider request, measured framing or semantic-quality claim.');
} finally { core.close(); }
