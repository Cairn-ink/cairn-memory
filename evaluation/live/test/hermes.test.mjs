import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectHermesStage, runHermesValueExperiment, MODEL } from '../hermes.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createLiveSession } from '../session.mjs';
import { startExperimentProxy } from '../proxy.mjs';

const required = ['CAIRN_HERMES_CHECKOUT', 'CAIRN_HERMES_PYTHON', 'CAIRN_NODE', 'CAIRN_EXECUTABLE',
  'CAIRN_ARTIFACT', 'CAIRN_ARTIFACT_SHA256'];
const missing = required.filter((key) => !process.env[key]);

const nativeEvent = (name, arguments_, value) => ({ name, arguments: arguments_,
  result: { ok: true, evidenceTrust: 'untrusted-data-not-instructions', value } });

test('stage inspector fails closed on unsupported lifecycle evidence', () => {
  const state = { memoryId: 'memory-1', revision: 1 };
  const base = { ok: true, completed: true, finalResponse: 'The day is unknown.', toolEvents: [] };
  const active = (content = 'The fictional Lantern project runs its release review on Tuesday.') => ({
    list: { ok: true, value: { memories: [{ id: 'memory-1', revision: 1 }] } },
    target: { ok: true, value: { memory: { id: 'memory-1', revision: 1, content },
      receipts: [{ id: 'receipt-1', excerpt: content }] } },
  });
  assert.equal(inspectHermesStage('A', { ...base, toolEvents: [nativeEvent('cairn_remember_memory',
    { content: 'The fictional Lantern project runs its release review on Tuesday.' },
    { memory: { id: 'different', revision: 1 } })] }, active(), { memoryId: null, revision: null }).passedAutomated, false);
  assert.equal(inspectHermesStage('B', { ...base, finalResponse: 'Tuesday.', toolEvents: [nativeEvent(
    'cairn_recall_memory', {}, { memories: [{ memory: { id: 'memory-1', revision: 1,
      content: 'The fictional Lantern project runs its release review on Tuesday.' },
    receipts: [{ id: 'bad', excerpt: 'unsupported' }] }] })] }, active(), { ...state }).passedAutomated, false);
  assert.equal(inspectHermesStage('C', { ...base, toolEvents: [
    nativeEvent('cairn_inspect_memory', { memoryId: 'memory-1' }, { memory: { id: 'memory-1', revision: 1 } }),
    nativeEvent('cairn_correct_memory', { memoryId: 'memory-1', expectedRevision: 99 },
      { memory: { id: 'memory-1', revision: 2, content: 'Friday' } }),
  ] }, active('Friday'), { ...state }).passedAutomated, false);
  assert.equal(inspectHermesStage('E', { ...base, toolEvents: [
    nativeEvent('cairn_inspect_memory', { memoryId: 'memory-1' }, { memory: { id: 'memory-1', revision: 1 } }),
    nativeEvent('cairn_forget_memory', { memoryId: 'different', expectedRevision: 1 }, { indexRevision: 2 }),
  ] }, { list: { ok: true, value: { memories: [] } }, target: { ok: false,
    error: { code: 'memory_not_found' } } }, { ...state }).passedAutomated, false);
  const forgotten = { list: { ok: true, value: { memories: [] } },
    target: { ok: false, error: { code: 'memory_not_found' } } };
  assert.equal(inspectHermesStage('F', base, forgotten, { ...state }).passedAutomated, false);
  assert.equal(inspectHermesStage('F', { ...base, completed: false,
    toolEvents: [nativeEvent('cairn_recall_memory', {}, { memories: [] })] }, forgotten,
  { ...state }).passedAutomated, false);
  assert.equal(inspectHermesStage('F', { ...base, toolEvents: [nativeEvent('cairn_recall_memory', {},
    { memories: [] })] }, active(), { ...state }).passedAutomated, false);
});

function response(message, finishReason = 'stop') {
  return { id: 'chatcmpl_offline', object: 'chat.completion', created: 1, model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 } };
}

function call(name, arguments_) {
  return response({ content: null, tool_calls: [{ id: `call_${name}`, type: 'function',
    function: { name, arguments: JSON.stringify(arguments_) } }] }, 'tool_calls');
}

function toolResult(messages, name) {
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant'
    && message.tool_calls?.some((entry) => entry.function.name === name));
  if (!assistant) return null;
  const id = assistant.tool_calls.find((entry) => entry.function.name === name).id;
  const row = messages.find((message) => message.role === 'tool' && message.tool_call_id === id);
  return row ? JSON.parse(row.content) : null;
}

function inputRef(input) {
  for (const map of input.maps || []) {
    for (const item of map.items || []) {
      if (item.type === 'unfiled' && item.ref?.memoryId) {
        return { namespaceIndex: map.namespaceIndex, memoryId: item.ref.memoryId, revision: item.ref.revision };
      }
      if (item.type === 'ref' && item.ref?.childType === 'memory') {
        return { namespaceIndex: map.namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision };
      }
    }
  }
  const candidate = input.candidates?.[0];
  return candidate?.memory?.id ? { namespaceIndex: candidate.namespaceIndex,
    memoryId: candidate.memory.id, revision: candidate.memory.revision } : null;
}

async function fakeProvider() {
  const token = 'synthetic-provider-key';
  const state = { calls: 0, memoryId: null, revision: null };
  const allowed = new Set(['max_completion_tokens', 'messages', 'model', 'n', 'store', 'stream', 'tool_choice', 'tools']);
  const server = createServer(async (request, reply) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    try {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      state.calls += 1;
      let output;
      if (request.url === '/v1/responses/input_tokens') {
        output = { object: 'response.input_tokens', input_tokens: 100 };
      } else if (request.url === '/v1/responses') {
        const input = JSON.parse(body.input[0].content[0].text);
        const ref = inputRef(input);
        const value = body.text.format.name === 'cairn_select' || body.text.format.name === 'cairn_rank'
          ? { refs: ref ? [ref] : [] } : { items: [] };
        output = { id: 'resp_offline', object: 'response', model: MODEL, status: 'completed', error: null,
          incomplete_details: null, output: [{ id: 'msg_offline', type: 'message', role: 'assistant',
            status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }],
          usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } };
      } else {
        assert.equal(request.url, '/v1/chat/completions');
        assert.deepEqual(Object.keys(body).filter((key) => !allowed.has(key)), []);
        assert.equal(body.model, MODEL);
        assert.equal(body.max_completion_tokens, 1024);
        assert.equal(body.store, false);
        assert.equal(body.stream, false);
        assert.equal(body.n, 1);
        const prompt = body.messages.findLast((message) => message.role === 'user')?.content || '';
        const remember = toolResult(body.messages, 'cairn_remember_memory');
        const inspect = toolResult(body.messages, 'cairn_inspect_memory');
        const correct = toolResult(body.messages, 'cairn_correct_memory');
        const forget = toolResult(body.messages, 'cairn_forget_memory');
        const recall = toolResult(body.messages, 'cairn_recall_memory');
        if (remember) {
          state.memoryId = remember.value.memory.id; state.revision = remember.value.memory.revision;
          output = response({ content: 'The decision was saved.' });
        } else if (correct) {
          state.revision = correct.value.memory.revision;
          output = response({ content: 'The decision was corrected to Friday.' });
        } else if (forget) {
          output = response({ content: 'The decision was forgotten.' });
        } else if (recall) {
          const content = recall.value.memories?.[0]?.memory?.content;
          output = response({ content: content?.includes('Friday') ? 'The release review is Friday.'
            : content?.includes('Tuesday') ? 'The release review is Tuesday.' : 'The release-review day is unknown.' });
        } else if (prompt.includes('remember this explicit decision')) {
          output = call('cairn_remember_memory', { content: 'The fictional Lantern project runs its release review on Tuesday.', kind: 'decision' });
        } else if (prompt.includes('correct the Lantern')) {
          output = inspect ? call('cairn_correct_memory', { memoryId: state.memoryId,
            expectedRevision: inspect.value.memory.revision,
            content: 'The fictional Lantern project runs its release review on Friday.', kind: 'decision' })
            : call('cairn_inspect_memory', { memoryId: state.memoryId });
        } else if (prompt.includes('forget the Lantern')) {
          output = inspect ? call('cairn_forget_memory', { memoryId: state.memoryId,
            expectedRevision: inspect.value.memory.revision }) : call('cairn_inspect_memory', { memoryId: state.memoryId });
        } else if (body.tools?.length) {
          output = call('cairn_recall_memory', { query: prompt, limit: 6 });
        } else {
          output = response({ content: 'Without memory access, the release-review day is unknown.' });
        }
      }
      reply.writeHead(200, { 'content-type': 'application/json' });
      reply.end(JSON.stringify(output));
    } catch {
      reply.writeHead(400, { 'content-type': 'application/json' });
      reply.end('{"error":"offline_proxy_rejected_request"}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, token, state,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }) };
}

test('actual pinned Hermes loop traverses the real proxy and persistent request guard', { skip: missing.length
  ? `set ${missing.join(', ')} for the opt-in pinned-host gate` : false, timeout: 180_000 }, async () => {
  const provider = await fakeProvider();
  const ledger = { directory: path.join(mkdtempSync(path.join(tmpdir(), 'cairn-hermes-live-ledger-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 20_000_000, requestCap: 4000 };
  createExperimentBudget(ledger).close();
  const session = createLiveSession({ ledger, apiKey: provider.token,
    fetchImpl: (url, options) => fetch(`${provider.url}${new URL(url).pathname}`, options) });
  const output = mkdtempSync(path.join(tmpdir(), 'cairn-hermes-live-offline-'));
  try {
    const report = await runHermesValueExperiment({ session,
      hermesCheckout: process.env.CAIRN_HERMES_CHECKOUT,
      hermesPython: process.env.CAIRN_HERMES_PYTHON,
      nodePath: process.env.CAIRN_NODE,
      cairnExecutable: process.env.CAIRN_EXECUTABLE,
      cairnArtifact: process.env.CAIRN_ARTIFACT,
      cairnArtifactSha256: process.env.CAIRN_ARTIFACT_SHA256,
      privateDirectory: output,
      startProxy: startExperimentProxy,
    });
    assert.equal(report.kind, 'real-hermes-native-memory');
    assert.deepEqual(report.stages.map((stage) => stage.status), Array(7).fill('completed'));
    // 15 host completions plus five Cairn count/generation pairs. The final
    // forgotten-store recall still performs one selection over its navigation map.
    assert.equal(report.budgetAfter.requestCount, 25);
    assert.equal(provider.state.calls, 25);
  } finally {
    session.close();
    await provider.close();
  }
});
