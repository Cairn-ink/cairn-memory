import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openMemoryCore } from '../../../core/index.mjs';
import { createOpenAIModel } from '../index.mjs';

test('actual core and adapter retain unverified focus in identical count/generate framing', async t => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 400 } : {
      object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"edges":[]}' }] }],
      usage: { input_tokens: 400, output_tokens: 10, total_tokens: 410 },
    });
  } });
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-adapter-focus-')), 'memory.sqlite'), model });
  t.after(() => core.close());
  const namespace = { ownerId: 'private-owner', scope: 'personal', projectId: null };
  const admitted = core.admit({ namespace, memory: { content: '我還沒有選擇工作。', kind: 'context' },
    receipts: [{ client: 'private-client', sessionId: 'private-session', eventId: 'private-event', role: 'user',
      excerpt: '朋友選擇管理職,我還沒有選擇工作。' }] });
  assert.equal(admitted.ok, true);
  const { id: memoryId, revision } = admitted.value.memory;
  const result = await core.reviewRationale({ namespace, refs: [{ memoryId, revision }], inputMode: 'claim-focus-v1' });
  assert.equal(result.ok, true); assert.equal(result.value.proposed, 0); assert.equal(calls.length, 2);
  const { max_output_tokens, store, stream, ...counted } = calls[1];
  assert.deepEqual(counted, calls[0]); assert.equal(max_output_tokens, 1024); assert.equal(store, false);
  const input = JSON.parse(calls[1].input[0].content[0].text);
  assert.deepEqual(input.memories[0].focus, { content: '我還沒有選擇工作。', interpretationStatus: 'unverified' });
  assert.equal(calls[1].text.format.name, 'cairn_relate');
  for (const hidden of ['private-owner', 'private-client', 'private-session', 'private-event', memoryId]) {
    assert.equal(JSON.stringify(calls).includes(hidden), false);
  }
});
