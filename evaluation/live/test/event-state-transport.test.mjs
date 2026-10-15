import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot,
  reopenEmbeddingExperimentBudget } from '../../experiment-budget/index.mjs';
import { createEventStateTransport, runEventStateBaseline, EVENT_STATE_LIVE_LIMITS } from '../../architecture/event-state-transport.mjs';
import { runEventStateOpportunity } from '../../architecture/event-state-opportunity.mjs';
import { eventStateScriptedModel } from '../../architecture/testing/event-state-scripted-model.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../../live/installed-source-answer-delivery.mjs';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';

const ids = ['es-7c2a', 'es-19df', 'es-a603', 'es-5be8', 'es-d094', 'es-e731'];
const prompt = name => readFileSync(new URL(`../../../core/prompts/${name}.md`, import.meta.url), 'utf8');
const request = () => ({ system: prompt('extract-retained-sources'), input: { messages: [
  { index: 0, role: 'user', content: 'Synthetic event date 2026-08-12. The applicable price is 840 credits.' },
] }, maxOutputTokens: 1024, signal: new AbortController().signal });

function fixture(t, changes = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-event-live-test-' });
  const configuration = { directory: join(workspace.path, 'budget'), runId: randomUUID(),
    limitMicroUsd: 400000000, requestCap: 100000, ...changes };
  createExperimentBudget(configuration).close();
  const before = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration,
    expectedCheckpoint: { requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd },
    expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const records = [], physical = [];
  const options = { configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
    historySha256: snapshot.historySha256, apiKey: 'synthetic-secret-key',
    fetchImpl: provider(physical), onRecord: record => { records.push(structuredClone(record)); } };
  return { workspace, options, records, physical, configuration };
}

function provider(physical, faults = {}) {
  const scripted = eventStateScriptedModel({ noEdges: faults.noEdges });
  return async (url, options) => {
    const body = JSON.parse(options.body);
    physical.push({ url, body });
    if (faults.http) return faults.http(url, body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: faults.count ?? 120 });
    if (url.endsWith('/chat/completions')) {
      if (faults.answerFailure) return Response.json({ error: { message: 'synthetic failure' },
        model: DEFAULT_MODEL, usage: { prompt_tokens: 120, completion_tokens: 0, total_tokens: 120 } }, { status: 500 });
      return Response.json({ object: 'chat.completion', model: DEFAULT_MODEL,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'First synthetic answer; semantics unassessed.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 } });
    }
    const method = body.text.format.name.slice('cairn_'.length);
    const input = JSON.parse(body.input[0].content[0].text);
    let output = scripted[method]({ input });
    if (method === 'qualifyCandidates') {
      output = qualificationPoolWire(input, output);
      if (faults.qualification) output.qualifications.item_0.pool = [99999];
    }
    if (method === 'relate' && faults.relation) output = { edges: [
      { from: 0, to: 0, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 },
    ] };
    return Response.json({ object: 'response', model: DEFAULT_MODEL, status: 'completed',
      error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant',
        status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
  };
}

test('E-live real adapter six-case capture/cold/answer path preserves full evidence at physical HTTP', async t => {
  const f = fixture(t), paths = [];
  const report = await runEventStateBaseline({ ...f.options, createWorkspace: () => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-event-case-test-' });
    paths.push(workspace.path); return workspace;
  } });
  assert.equal(report.summary.denominator, 6);
  assert.deepEqual(report.summary.cases.map(item => item.id), ids);
  assert.ok(report.traces.every(trace => trace.failures.length === 0), JSON.stringify(report.summary));
  assert.ok(report.traces.every(trace => trace.cold.length > 0 && trace.cold.every(item => item.rationale.ok)));
  const answers = f.physical.filter(call => call.url.endsWith('/chat/completions'));
  assert.equal(answers.length, 6);
  for (const [index, answer] of answers.entries()) {
    assert.deepEqual(answer.body.messages, report.traces[index].delivery.request.messages);
    assert.equal(answer.body.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
    assert.deepEqual(JSON.parse(answer.body.messages[1].content).evidence, report.traces[index].recall.value.memories);
    assert.equal(answer.body.max_tokens, 512);
    assert.ok(!JSON.stringify(answer).includes('FOREIGN_CANARY_QUARTZ'));
  }
  const qualification = f.physical.filter(call => call.body.text?.format.name === 'cairn_qualifyCandidates');
  const relations = f.physical.filter(call => call.body.text?.format.name === 'cairn_relate');
  assert.ok(qualification.length > 0 && relations.length > 0);
  assert.ok(qualification.every(call => call.body.text.format.schema.properties.wireVersion));
  for (const [index, call] of f.physical.entries()) if (call.url.endsWith('/responses')) {
    const { max_output_tokens, store, stream, ...count } = call.body;
    assert.deepEqual(f.physical[index - 1].body, count);
    assert.ok(f.physical[index - 1].url.endsWith('/input_tokens'));
    assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
  }
  const completions = f.records.filter(record => record.kind === 'case-complete');
  assert.deepEqual(completions.map(record => record.caseId), ids);
  for (let index = 1; index < 6; index++) assert.ok(f.records.indexOf(completions[index - 1])
    < f.records.findIndex(record => record.kind === 'case-start' && record.caseId === ids[index]));
  assert.equal(report.resources.physicalRequests, f.physical.length);
  assert.equal(report.resources.reservedMicroUsd, f.physical.length * 5000);
  assert.ok(report.resources.physicalRequests <= EVENT_STATE_LIVE_LIMITS.physicalRequests);
  const after = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(after.requestCount, f.physical.length);
  assert.ok(after.attempts.every(attempt => attempt.outcome === 'succeeded'));
  assert.equal(f.records.filter(record => record.kind === 'http-intent').length, f.physical.length);
  assert.equal(f.records.filter(record => record.kind === 'http-final').length, f.physical.length);
  for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
});

test('E-live stale checkpoint/history, pending, affordability and missing acknowledgement deny HTTP', async t => {
  for (const change of [options => ({ ...options, checkpoint: { requestCount: 1, reservedMicroUsd: 0 } }),
    options => ({ ...options, historySha256: '0'.repeat(64) }),
    options => ({ ...options, onRecord: () => { throw new Error('disk failed'); } }),
    options => ({ ...options, onRecord: async () => {} })]) {
    const f = fixture(t);
    assert.throws(() => createEventStateTransport(change(f.options)));
    assert.equal(f.physical.length, 0);
  }
  for (const change of [{ requestCap: 1967 }, { limitMicroUsd: 39999999 }, { limitMicroUsd: 400000001 }]) {
    const f = fixture(t, change);
    assert.throws(() => createEventStateTransport(f.options)); assert.equal(f.physical.length, 0);
  }
  const f = fixture(t), ledger = reopenEmbeddingExperimentBudget(f.configuration);
  ledger.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 5000 });
  ledger.close();
  assert.throws(() => createEventStateTransport(f.options));
  assert.equal(f.physical.length, 0);
});

test('E-live intent/final persistence failures stop additional HTTP and preserve reservation', async t => {
  for (const kind of ['http-intent', 'http-final']) {
    const f = fixture(t);
    const transport = createEventStateTransport({ ...f.options, onRecord: record => {
      if (record.kind === kind) throw new Error('disk failed');
    } });
    const model = transport.createModel({ caseId: ids[0], phase: 'target' });
    await assert.rejects(model.extract(request()));
    const sent = f.physical.length;
    await assert.rejects(model.extract(request()));
    assert.equal(f.physical.length, sent);
    assert.equal(sent, kind === 'http-intent' ? 0 : 1);
    assert.equal(transport.state().reservedMicroUsd, 5000);
    assert.equal(transport.resources().fatal, 'event_state_persistence_failed');
    transport.close();
  }
});

test('E-live frozen historical unknowns remain fully reserved; a new unknown halts further HTTP', async t => {
  const f = fixture(t), ledger = reopenEmbeddingExperimentBudget(f.configuration), attemptId = randomUUID();
  ledger.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 5000 });
  ledger.recordOutcome({ attemptId, outcome: 'unknown' }); ledger.close();
  const initial = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  const transport = createEventStateTransport({ ...f.options,
    checkpoint: { requestCount: initial.requestCount, reservedMicroUsd: initial.reservedMicroUsd },
    historySha256: initial.historySha256 });
  await transport.createModel({ caseId: ids[0], phase: 'target' }).extract(request());
  const after = transport.state();
  assert.deepEqual(after.attempts[0], initial.attempts[0]);
  assert.equal(after.reservedMicroUsd, initial.reservedMicroUsd + 10000);
  assert.equal(f.physical.length, 2); transport.close();

  const g = fixture(t);
  const failed = createEventStateTransport({ ...g.options, fetchImpl: async () => { g.physical.push({}); throw new Error('network'); } });
  const model = failed.createModel({ caseId: ids[0], phase: 'target' });
  await assert.rejects(model.extract(request()));
  await assert.rejects(model.extract(request()));
  assert.equal(g.physical.length, 1);
  assert.equal(failed.state().attempts[0].outcome, 'unknown');
  assert.equal(failed.state().reservedMicroUsd, 5000); failed.close();
});

test('E-live malformed qualification/relation and empty graphs retain all six first outcomes without retry', async t => {
  for (const fault of ['qualification', 'relation', 'noEdges', 'answerFailure']) {
    const f = fixture(t);
    const report = await runEventStateBaseline({ ...f.options, fetchImpl: provider(f.physical, { [fault]: true }) });
    assert.equal(report.summary.cases.length, 6);
    if (fault === 'qualification') {
      assert.ok(report.traces.every(trace => trace.answer === null));
      assert.ok(ids.every(caseId => f.records.some(record => record.kind === 'model-diagnostic'
        && record.caseId === caseId && record.diagnostic.layer === 'adapter')));
    } else if (fault === 'relation') {
      assert.ok(report.traces.every(trace => trace.diagnostics.some(event => event.reason === 'invalid_rationale')));
      assert.ok(report.traces.every(trace => trace.failures.includes('capture-stage')));
    } else if (fault === 'noEdges') {
      assert.ok(report.traces.every(trace => trace.calls.filter(call => call.method === 'relate')
        .every(call => call.output.edges.length === 0)));
      assert.ok(report.traces[0].cold.every(item => item.rationale.value.edges.length === 0));
    } else {
      assert.ok(report.traces.every(trace => trace.answer.status === 'failed'));
      assert.equal(f.physical.filter(call => call.url.endsWith('/chat/completions')).length, 6);
    }
    for (const trace of report.traces) assert.ok(trace.delivery.calls === undefined || trace.delivery.calls === 1);
  }
});

test('E-live closed methods/phases, overflow, foreign leakage and ambiguous usage halt without fallback', async t => {
  for (const patch of [value => ({ ...value, system: 'different prompt' }),
    value => ({ ...value, input: { messages: [{ index: 0, role: 'user', content: 'FOREIGN_CANARY_QUARTZ' }] } }),
    value => ({ ...value, maxOutputTokens: 512 })]) {
    const f = fixture(t), transport = createEventStateTransport(f.options);
    const model = transport.createModel({ caseId: ids[0], phase: 'target' });
    await assert.rejects(model.extract(patch(request())));
    assert.equal(f.physical.length, 0); assert.ok(transport.resources().fatal); transport.close();
  }
  const f = fixture(t), transport = createEventStateTransport({ ...f.options,
    fetchImpl: provider(f.physical, { count: 7025 }) });
  const model = transport.createModel({ caseId: ids[0], phase: 'target' });
  await assert.rejects(model.extract(request()));
  await assert.rejects(model.extract(request()));
  assert.equal(f.physical.length, 1); transport.close();
});

test('E-live dropped rationale and local overflow send zero answer/oversized HTTP; terminal reports retain six', async t => {
  const f = fixture(t), transport = createEventStateTransport(f.options);
  const report = await runEventStateOpportunity({ createModel: transport.createModel,
    answer: (request, metadata) => {
      const input = JSON.parse(request.messages[1].content);
      input.evidence = input.evidence.map(({ rationale, ...rest }) => rest);
      request.messages[1].content = JSON.stringify(input);
      return transport.answer(request, metadata);
    }, onRecord: record => {
      if (record.kind === 'case-complete') transport.completeCase(record.caseId);
    } });
  assert.equal(report.summary.denominator, 6);
  assert.equal(f.physical.filter(call => call.url.endsWith('/chat/completions')).length, 0);
  assert.ok(report.traces[0].failures.includes('answer-failed'));
  transport.close();
  const g = fixture(t), overflow = createEventStateTransport(g.options);
  const model = overflow.createModel({ caseId: ids[0], phase: 'target' });
  const oversized = request(); oversized.input.messages[0].content = 'long input '.repeat(10000);
  await assert.rejects(model.extract(oversized));
  assert.equal(g.physical.length, 0); overflow.close();
  const h = fixture(t);
  let caught;
  try { await runEventStateBaseline({ ...h.options, fetchImpl: async () => { throw new Error('network'); } }); }
  catch (error) { caught = error; }
  assert.equal(caught.report.summary.denominator, 6);
  assert.equal(caught.report.traces.length, 6);
  assert.equal(caught.resources.physicalRequests, 1);
});

test('E-live auth, redirects, body/credential/usage bounds and pending ledger drift stop subsequent HTTP', async t => {
  for (const response of [() => Response.json({}, { status: 401 }),
    () => Response.json({}, { status: 302 }),
    () => new Response('x'.repeat(65537)),
    () => Response.json({ object: 'response.input_tokens', input_tokens: 120, echo: 'synthetic-secret-key' }),
    () => Response.json({ object: 'response.input_tokens', input_tokens: -1 })]) {
    const f = fixture(t);
    const transport = createEventStateTransport({ ...f.options, fetchImpl: async () => {
      f.physical.push({}); return response();
    } });
    const model = transport.createModel({ caseId: ids[0], phase: 'target' });
    await assert.rejects(model.extract(request()));
    await assert.rejects(model.extract(request()));
    assert.equal(f.physical.length, 1); assert.ok(transport.resources().fatal); transport.close();
  }
  const f = fixture(t), transport = createEventStateTransport(f.options);
  const model = transport.createModel({ caseId: ids[0], phase: 'target' });
  const ledger = reopenEmbeddingExperimentBudget(f.configuration);
  ledger.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 5000 });
  ledger.close();
  await assert.rejects(model.extract(request()));
  assert.equal(f.physical.length, 0); transport.close();
});

test('E-live bounded clock and aborted requests cannot exceed physical/case/run ceilings', async t => {
  assert.equal(EVENT_STATE_LIVE_LIMITS.physicalRequests, 6 * 32 * 2 + 6);
  assert.equal(EVENT_STATE_LIVE_LIMITS.reservedMicroUsd, 390 * 5000);
  const original = Object.getOwnPropertyDescriptor(performance, 'now');
  let elapsed = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => elapsed });
  try {
    for (const scope of ['case', 'run']) {
      elapsed = 0;
      const f = fixture(t), transport = createEventStateTransport(f.options);
      let model = transport.createModel({ caseId: ids[0], phase: 'target' });
      if (scope === 'run') {
        transport.completeCase(ids[0]); elapsed = 7200001;
        model = transport.createModel({ caseId: ids[1], phase: 'target' });
      } else elapsed = 1200001;
      await assert.rejects(model.extract(request()));
      assert.equal(f.physical.length, 0); transport.close();
    }
    elapsed = 0;
    const f = fixture(t);
    const transport = createEventStateTransport({ ...f.options, onRecord: record => {
      if (record.kind === 'http-intent') elapsed = 200001;
    } });
    await assert.rejects(transport.createModel({ caseId: ids[0], phase: 'target' }).extract(request()));
    assert.equal(f.physical.length, 0, 'expired synchronous persistence cannot dispatch HTTP');
    assert.equal(transport.resources().fatal, 'event_state_deadline'); transport.close();
  } finally {
    if (original) Object.defineProperty(performance, 'now', original);
    else delete performance.now;
  }
  const f = fixture(t), transport = createEventStateTransport(f.options);
  const model = transport.createModel({ caseId: ids[0], phase: 'target' });
  const aborted = request(); const controller = new AbortController(); controller.abort(); aborted.signal = controller.signal;
  await assert.rejects(model.extract(aborted));
  assert.equal(f.physical.length, 0); transport.close();

  const g = fixture(t), delays = [], originalTimer = globalThis.setTimeout;
  const timeout = createEventStateTransport({ ...g.options, fetchImpl: () => new Promise(() => {}) });
  try {
    globalThis.setTimeout = (callback, delay, ...args) => {
      delays.push(delay); return originalTimer(callback, 0, ...args);
    };
    await assert.rejects(timeout.createModel({ caseId: ids[0], phase: 'target' }).extract(request()));
    assert.ok(delays[0] > 0 && delays[0] <= 200000);
    assert.equal(timeout.resources().physicalRequests, 1);
    assert.equal(timeout.resources().fatal, 'event_state_deadline');
  } finally { globalThis.setTimeout = originalTimer; timeout.close(); }
});

test('E-live shorter core deadline leaves no overlapping paid request or unclosed transport', async t => {
  const f = fixture(t), originalTimer = globalThis.setTimeout;
  let caught;
  try {
    globalThis.setTimeout = (callback, delay, ...args) => originalTimer(callback, delay === 30000 ? 0 : delay, ...args);
    await runEventStateBaseline({ ...f.options, fetchImpl: async () => {
      f.physical.push({}); return new Promise(() => {});
    } });
  } catch (error) { caught = error; }
  finally { globalThis.setTimeout = originalTimer; }
  assert.equal(caught.report.summary.denominator, 6);
  assert.equal(caught.report.traces.length, 6);
  assert.equal(f.physical.length, 1);
  assert.equal(caught.resources.physicalRequests, 1);
  const after = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(after.requestCount, 1);
  assert.equal(after.attempts[0].outcome, 'unknown');
});
