import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('authority-v2 requires a current sourced read before correction or forgetting, not one tool name', () => {
  const initial = { memoryId: 'memory-1', revision: 1, receiptId: 'receipt-1' };
  const before = { memory: { id: 'memory-1', revision: 1, content: 'Tuesday' },
    receipts: [{ id: 'receipt-1', excerpt: 'Tuesday' }] };
  const after = { memory: { id: 'memory-1', revision: 2, content: 'Friday' },
    receipts: [{ id: 'receipt-2', excerpt: 'Friday' }] };
  const corrected = nativeEvent('cairn_correct_memory', { memoryId: 'memory-1', expectedRevision: 1 },
    { memory: after.memory });
  const forgotten = nativeEvent('cairn_forget_memory', { memoryId: 'memory-1', expectedRevision: 1 },
    { indexRevision: 2 });
  const correctedStore = { list: { ok: true, value: { memories: [after.memory] } },
    target: { ok: true, value: after } };
  const forgottenStore = { list: { ok: true, value: { memories: [] } },
    target: { ok: false, error: { code: 'memory_not_found' } } };
  const stage = events => ({ ok: true, completed: true, toolEvents: events, finalResponse: 'Done.' });
  for (const readName of ['cairn_inspect_memory', 'cairn_recall_memory']) {
    const read = value => nativeEvent(readName, {}, readName === 'cairn_inspect_memory'
      ? value : { memories: [value] });
    const state = { ...initial };
    const accepted = inspectHermesStage('C', stage([read(before), corrected]), correctedStore, state);
    assert.equal(accepted.passedAutomated, true);
    assert.equal(accepted.observedVia, readName);
    assert.deepEqual(state, { memoryId: 'memory-1', revision: 2, receiptId: 'receipt-2' });
    assert.equal(inspectHermesStage('E', stage([read(before), forgotten]), forgottenStore,
      { ...initial }).passedAutomated, true);
    for (const invalidRead of [
      { ...before, memory: { ...before.memory, revision: 0 } },
      { ...before, memory: { ...before.memory, id: 'other' } },
      { ...before, receipts: [{ id: 'wrong', excerpt: 'Tuesday' }] },
      { ...before, receipts: [{ id: 'receipt-1', excerpt: 'unsupported' }] },
    ]) {
      assert.equal(inspectHermesStage('C', stage([read(invalidRead), corrected]), correctedStore,
        { ...initial }).passedAutomated, false);
      assert.equal(inspectHermesStage('E', stage([read(invalidRead), forgotten]), forgottenStore,
        { ...initial }).passedAutomated, false);
    }
    assert.equal(inspectHermesStage('C', stage([corrected, read(before)]), correctedStore,
      { ...initial }).passedAutomated, false);
    assert.equal(inspectHermesStage('E', stage([forgotten, read(before)]), forgottenStore,
      { ...initial }).passedAutomated, false);
  }
});

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

async function fakeProvider({ invalidStage = null } = {}) {
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
        const value = body.text.format.name === `cairn_${invalidStage}`
          ? { refs: 'PRIVATE_INVALID_MODEL_OUTPUT' }
          : body.text.format.name === 'cairn_select' || body.text.format.name === 'cairn_rank'
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
          const content = recall.value?.memories?.[0]?.memory?.content;
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

for (const collectDiagnostics of [false, true]) test(`actual pinned Hermes lifecycle, diagnostics=${collectDiagnostics}`, { skip: missing.length
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
      collectDiagnostics,
    });
    assert.equal(report.kind, 'real-hermes-native-memory');
    assert.deepEqual(report.stages.map((stage) => stage.status), Array(7).fill('completed'));
    // 15 host completions plus five Cairn count/generation pairs. The final
    // forgotten-store recall still performs one selection over its navigation map.
    assert.equal(report.budgetAfter.requestCount, 25);
    assert.equal(provider.state.calls, 25);
    assert.equal(Object.hasOwn(report.frozen, 'diagnostics'), collectDiagnostics);
    for (const stage of report.stages) {
      assert.equal(Object.hasOwn(stage, 'diagnostics'), collectDiagnostics);
      if (collectDiagnostics) {
        assert.deepEqual(stage.diagnostics.events, []);
        assert.equal(stage.diagnostics.collection.corrupted, false);
        assert.equal(stage.diagnostics.collection.deliveryGuaranteed, false);
      }
    }
    if (collectDiagnostics) {
      const expected = JSON.parse(readFileSync(new URL('../../../packaging/artifact-files.json', import.meta.url), 'utf8'));
      assert.deepEqual(Object.keys(report.frozen.diagnostics.runtimeSourceSha256), expected);
      assert.match(report.frozen.diagnostics.collectorSha256, /^[a-f0-9]{64}$/u);
    }
  } finally {
    session.close();
    await provider.close();
  }
});

test('diagnostic opt-in rejects non-booleans before any experiment setup', async () => {
  for (const collectDiagnostics of [null, 1, 'true', {}]) {
    await assert.rejects(runHermesValueExperiment({ collectDiagnostics }), /invalid_collect_diagnostics/u);
  }
});

const hostOptions = () => ({ hermesCheckout: process.env.CAIRN_HERMES_CHECKOUT,
  hermesPython: process.env.CAIRN_HERMES_PYTHON, nodePath: process.env.CAIRN_NODE,
  cairnExecutable: process.env.CAIRN_EXECUTABLE, cairnArtifact: process.env.CAIRN_ARTIFACT,
  cairnArtifactSha256: process.env.CAIRN_ARTIFACT_SHA256 });

for (const invalidStage of ['select', 'rank']) test(`actual installed ${invalidStage} failure is diagnosed and halts lifecycle`, {
  skip: missing.length ? `set ${missing.join(', ')} for the opt-in pinned-host gate` : false,
  timeout: 180_000,
}, async () => {
  const provider = await fakeProvider({ invalidStage });
  const ledger = { directory: path.join(mkdtempSync(path.join(tmpdir(), 'cairn-diagnostic-ledger-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 20_000_000, requestCap: 4000 };
  createExperimentBudget(ledger).close();
  const session = createLiveSession({ ledger, apiKey: provider.token,
    fetchImpl: (url, options) => fetch(`${provider.url}${new URL(url).pathname}`, options) });
  try {
    const report = await runHermesValueExperiment({ ...hostOptions(), session,
      privateDirectory: mkdtempSync(path.join(tmpdir(), 'cairn-hermes-diagnostic-failure-')),
      collectDiagnostics: true, startProxy: startExperimentProxy });
    assert.deepEqual(report.stages.map(stage => stage.status),
      ['completed', 'failed', 'not_run', 'not_run', 'not_run', 'not_run', 'completed']);
    const failed = report.stages[1];
    assert.equal(failed.verdict.passedAutomated, false);
    assert.ok(failed.diagnostics.events.some(event => event.stage === invalidStage
      && event.layer === 'core_validation' && event.reason === 'malformed_refs'));
    assert.equal(failed.diagnostics.collection.corrupted, false);
    const diagnostics = JSON.stringify(report.stages.map(stage => stage.diagnostics));
    assert.equal(diagnostics.includes('PRIVATE_INVALID_MODEL_OUTPUT'), false);
    assert.equal(diagnostics.includes(provider.token), false);
    assert.deepEqual(report.stages[0].diagnostics.events, []);
    assert.deepEqual(report.stages.at(-1).diagnostics.events, []);
    assert.ok(report.stages.slice(2, 6).every(stage => !Object.hasOwn(stage, 'diagnostics')));
  } finally { session.close(); await provider.close(); }
});

for (const relative of ['core/model-diagnostics.mjs', 'evaluation/live/diagnostics.mjs']) test(`installed ${relative} mismatch fails before traffic`, {
  skip: missing.length ? `set ${missing.join(', ')} for the opt-in pinned-host gate` : false,
}, async () => {
  const original = path.dirname(path.dirname(realpathSync(process.env.CAIRN_EXECUTABLE)));
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'cairn-source-mismatch-')), 'package');
  cpSync(original, copy, { recursive: true });
  writeFileSync(path.join(copy, relative), '// mismatched synthetic installation\n');
  let started = false;
  await assert.rejects(runHermesValueExperiment({ ...hostOptions(),
    cairnExecutable: path.join(copy, path.relative(original, realpathSync(process.env.CAIRN_EXECUTABLE))),
    session: { getState() { throw Error('must not reach budget'); } }, collectDiagnostics: true,
    privateDirectory: mkdtempSync(path.join(tmpdir(), 'cairn-source-mismatch-report-')),
    startProxy() { started = true; throw Error('must not start traffic'); },
  }), /cairn_install_source_mismatch/u);
  assert.equal(started, false);
});

test('launcher rejects invalid diagnostic directory configs without protocol output', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-launcher-invalid-'));
  const packageRoot = path.join(root, 'package');
  mkdirSync(path.join(packageRoot, 'evaluation/live'), { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'cairn-memory-local-preview' }));
  writeFileSync(path.join(packageRoot, 'evaluation/live/diagnostics.mjs'),
    'process.stderr.write("configuration_accepted\\n"); process.exit(0);\n');
  const unsafe = mkdtempSync(path.join(tmpdir(), 'cairn-diagnostic-unsafe-'));
  chmodSync(unsafe, 0o755);
  const linked = path.join(root, 'linked');
  symlinkSync(mkdtempSync(path.join(tmpdir(), 'cairn-diagnostic-target-')), linked);
  const valid = mkdtempSync(path.join(tmpdir(), 'cairn-diagnostic-valid-'));
  for (const [index, diagnosticDirectory] of [42, linked, unsafe, valid].entries()) {
    const config = path.join(root, `config-${index}.json`);
    writeFileSync(config, JSON.stringify({ version: 1,
      packageRoot,
      proxyUrl: 'http://127.0.0.1:1', diagnosticDirectory }), { mode: 0o600 });
    const result = spawnSync(process.execPath,
      [new URL('../cairn-launcher.mjs', import.meta.url).pathname,
        '--db', path.join(root, 'unused.sqlite'), '--owner', 'synthetic'],
      { encoding: 'utf8', timeout: 5000,
        env: { PATH: process.env.PATH, CAIRN_LIVE_CONFIG: config } });
    assert.equal(result.status, diagnosticDirectory === valid ? 0 : 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, diagnosticDirectory === valid
      ? 'configuration_accepted\n' : 'cairn_live_launcher_failed\n');
  }
});
