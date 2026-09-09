import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createLiveSession, MODEL_ID } from '../session.mjs';
import { startExperimentProxy } from '../proxy.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';

const ledgerFor = (requestCap = 4) => {
  const parent = mkdtempSync(join(tmpdir(), 'cairn-live-session-test-'));
  const ledger = { directory: join(parent, 'budget'), runId: randomUUID(),
    limitMicroUsd: 20_000_000, requestCap };
  createExperimentBudget(ledger).close();
  return ledger;
};
const completion = (content) => Response.json({ object: 'chat.completion', model: MODEL_ID,
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } });

test('answer and judge share persistent guard; exhausted reopened session sends nothing', async () => {
  const ledger = ledgerFor(2);
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push(JSON.parse(options.body));
    return completion(requests.length === 1 ? 'Tuesday' : '{"verdict":"correct"}');
  };
  const session = createLiveSession({ ledger, apiKey: 'synthetic', fetchImpl });
  assert.equal((await session.answer({ model: MODEL_ID, request: { instruction: 'answer', question: 'when', evidence: [] },
    maxOutputTokens: 128, signal: new AbortController().signal })).text, 'Tuesday');
  assert.deepEqual(await session.judge({ model: MODEL_ID,
    input: { question: 'when', generatedAnswer: 'Tuesday', reference: 'Tuesday' },
    signal: new AbortController().signal }), { verdict: 'correct' });
  assert.equal(session.getState().requestCount, 2);
  assert.equal(session.getState().reservedMicroUsd, 100_000);
  assert.equal(JSON.stringify(requests[0]).includes('reference'), false);
  session.close();
  const reopened = createLiveSession({ ledger, apiKey: 'synthetic', fetchImpl });
  await assert.rejects(reopened.complete({ messages: [{ role: 'user', content: 'again' }] }));
  assert.equal(requests.length, 2);
  reopened.close();
});

test('malformed completion remains charged; oversized output is rejected before transport', async () => {
  let calls = 0;
  const session = createLiveSession({ ledger: ledgerFor(), apiKey: 'synthetic', fetchImpl: async () => {
    calls++; return completion(null);
  } });
  await assert.rejects(session.complete({ messages: [{ role: 'user', content: 'hi' }] }), /invalid_completion/);
  assert.equal(session.getState().attempts[0].actualMicroUsd, 56);
  await assert.rejects(session.complete({ messages: [{ role: 'user', content: 'hi' }], maxOutputTokens: 2000 }));
  assert.equal(calls, 1);
  session.close();
});

test('actual core adapter through loopback and host share ledger without giving children provider key', async () => {
  const ledger = ledgerFor(5);
  let calls = 0;
  const session = createLiveSession({ ledger, apiKey: 'synthetic-provider-key', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-provider-key');
    const payload = JSON.parse(options.body);
    if (url.endsWith('/chat/completions')) return completion('READY');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 200 });
    const input = JSON.parse(payload.input[0].content[0].text);
    const output = payload.text.format.name === 'cairn_extract'
      ? { items: [{ content: 'The synthetic launch is amber.', kind: 'fact', confidence: 0.9, sourceIndices: [0] }] }
      : { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
        newL1: { title: 'Launch', parentL2Ids: [] } })) };
    return Response.json({ object: 'response', model: MODEL_ID, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 } });
  } });
  const proxy = await startExperimentProxy({ session });
  const childModel = createOpenAIModel({ apiKey: proxy.token, fetchImpl: (url, options) => {
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${proxy.token}`);
    return fetch(proxy.url + new URL(url).pathname, options);
  } });
  const core = openMemoryCore({ path: join(ledger.directory, 'synthetic-memory.sqlite'), model: childModel });
  try {
    const result = await core.capture({ namespace: { ownerId: 'test', scope: 'personal', projectId: null },
      client: 'test', sessionId: 'test', eventId: 'capture',
      messages: [{ id: 'source', role: 'user', content: 'The synthetic launch is amber.' }] });
    assert.equal(result.ok, true);
    assert.equal(result.value.classification.status, 'applied');
    const response = await fetch(`${proxy.url}/v1/chat/completions`, { method: 'POST',
      headers: { authorization: `Bearer ${proxy.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL_ID, messages: [{ role: 'user', content: 'hello' }],
        max_completion_tokens: 128, stream: false, store: false, n: 1 }) });
    assert.equal(response.status, 200);
    assert.equal(calls, 5);
    assert.deepEqual(session.getState().attempts.map(item => item.channel),
      ['cairn-count', 'cairn-generation', 'cairn-count', 'cairn-generation', 'host-completion']);
  } finally { core.close(); await proxy.close(); session.close(); }
});
