import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createEventStateOverlayTransport, runEventStateOverlayProbe, EVENT_STATE_LIVE_LIMITS } from '../../architecture/event-state-transport.mjs';
import { runEventStateOverlayOpportunity } from '../../architecture/event-state-opportunity.mjs';
import { OVERLAY_IDS, overlayArmOrder, assertOverlayProjection } from '../../architecture/event-state-overlay.mjs';
import { overlayScriptedModel } from '../../architecture/testing/event-state-overlay-scripted-model.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

// Synthetic ledger/HTTP only. The normal adapter serializes and decodes every call.
function fixture(t, fault = {}) {
  const owned = createTestWorkspace(t, { prefix: 'cairn-overlay-http-' });
  const configuration = { directory: join(owned.path, 'budget'), runId: randomUUID(), limitMicroUsd: 400000000, requestCap: 100000 };
  createExperimentBudget(configuration).close();
  const before = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration,
    expectedCheckpoint: { requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(configuration), physical = [], records = [], paths = [];
  const scripted = overlayScriptedModel();
  let answers = 0;
  const options = { configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: snapshot.historySha256,
    apiKey: 'synthetic-overlay-key', onRecord: record => { records.push(structuredClone(record));
      if (record.kind === fault.persistence) throw new Error('synthetic persistence'); },
    fetchImpl: async (url, request) => {
      const body = JSON.parse(request.body); physical.push({ url, body });
      if (fault.network) throw new Error('synthetic network');
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      if (url.endsWith('/chat/completions')) {
        answers++;
        if (fault.answer === answers) return Response.json({ model: DEFAULT_MODEL, error: { message: 'ordinary failure' },
          usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 } }, { status: 500 });
        if (fault.auth === answers) return Response.json({}, { status: 401 });
        return Response.json({ object: 'chat.completion', model: DEFAULT_MODEL,
          choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Independent response ${answers}; semantics unassessed.` } }],
          usage: { prompt_tokens: 100, completion_tokens: 12, total_tokens: 112 } });
      }
      const method = body.text.format.name.slice('cairn_'.length), input = JSON.parse(body.input[0].content[0].text);
      let output = scripted[method]({ input });
      if (method === 'qualifyCandidates') output = qualificationPoolWire(input, output);
      return Response.json({ object: 'response', model: DEFAULT_MODEL, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
    },
    createWorkspace: () => { const workspace = createTestWorkspace(t, { prefix: 'cairn-overlay-case-' }); paths.push(workspace.path); return workspace; },
  };
  return { options, configuration, physical, records, paths };
}
const answerCalls = f => f.physical.filter(call => call.url.endsWith('/chat/completions'));
async function cleaned(f) { for (const path of f.paths) await assert.rejects(access(path), { code: 'ENOENT' }); }
function makeTransport(f) {
  const { createWorkspace, ...options } = f.options;
  return createEventStateOverlayTransport(options);
}
function helperOptions(f, transport) {
  return { createWorkspace: f.options.createWorkspace, createModel: transport.createModel, answer: transport.answer,
    prepareAnswers: transport.prepareAnswers, assertHealthy: transport.assertHealthy,
    onRecord: record => { f.records.push(record);
      if (record.kind === 'case-complete' && !record.trace.failures.includes('not-run-after-fatal')) transport.completeCase(record.caseId); },
  };
}

test('overlay real adapter shares capture/cold/read and sends exactly twelve source-identical paid wires', async t => {
  const f = fixture(t), report = await runEventStateOverlayProbe(f.options);
  assert.equal(report.summary.denominator, 6); assert.equal(report.summary.semanticAccuracy, 'not-measured');
  assert.ok(report.traces.every(trace => !trace.failures.length), JSON.stringify(report.summary));
  const answers = answerCalls(f);
  assert.equal(answers.length, 12);
  const finals = f.records.filter(record => record.kind === 'http-final' && record.method === 'answer');
  assert.deepEqual(finals.map(record => `${record.caseId}/${record.arm}`), OVERLAY_IDS.flatMap(id => overlayArmOrder(id).map(arm => `${id}/${arm}`)));
  for (const [index, trace] of report.traces.entries()) {
    assert.equal(trace.captures.length, 2); assert.ok(trace.cold.length > 0);
    for (const inspected of trace.inspections) assert.deepEqual(trace.cold.find(item => item.detail.value.memory.id === inspected.value.memory.id).detail, inspected);
    const calls = answers.slice(index * 2, index * 2 + 2);
    const requests = Object.fromEntries(trace.order.map((arm, ordinal) => [arm, { messages: calls[ordinal].body.messages }]));
    assertOverlayProjection(requests.A, requests.B);
    assert.deepEqual(JSON.parse(requests.A.messages[1].content).evidence, trace.recall.value.memories);
    for (const [ordinal, arm] of trace.order.entries()) {
      assert.deepEqual(calls[ordinal].body.messages, trace.arms[arm].delivery.request.messages);
      assert.equal(calls[ordinal].body.messages.length, 2);
      assert.equal(calls[ordinal].body.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
      assert.equal(calls[ordinal].body.model, DEFAULT_MODEL); assert.equal(calls[ordinal].body.n, 1);
      assert.equal(calls[ordinal].body.max_tokens, 512); assert.equal(calls[ordinal].body.store, false);
      assert.ok(!JSON.stringify(calls[ordinal]).includes('Independent response'));
    }
    const bound = f.records.findIndex(record => record.kind === 'answer-pair-bound' && record.caseId === trace.id);
    assert.ok(bound >= 0 && bound < f.records.findIndex(record => record.kind === 'http-intent' && record.method === 'answer' && record.caseId === trace.id));
    const target = JSON.stringify({ calls: trace.calls.filter(call => call.phase !== 'foreign-setup'), cold: trace.cold, recall: trace.recall, arms: trace.arms });
    assert.ok(!target.includes('FOREIGN_CANARY_QUARTZ'));
  }
  const callbacks = report.traces.reduce((sum, trace) => sum + trace.calls.length, 0);
  assert.equal(f.physical.length, callbacks * 2 + 12, 'one count and generation per shared callback, one request per first answer');
  t.diagnostic(`shared callbacks=${callbacks}; physical requests=${f.physical.length}; first answers=12; reserved microUSD=${f.physical.length * 5000}`);
  assert.equal(report.resources.physicalRequests, f.physical.length);
  assert.equal(report.resources.reservedMicroUsd, f.physical.length * 5000);
  assert.ok(f.physical.length <= 390); assert.equal(EVENT_STATE_LIVE_LIMITS.reservedMicroUsd, 1950000);
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  assert.equal(state.requestCount, f.physical.length); assert.equal(state.reservedMicroUsd, f.physical.length * 5000);
  assert.ok(state.attempts.every(attempt => attempt.outcome === 'succeeded'));
  assert.equal(f.records.filter(record => record.kind === 'http-intent').length, f.physical.length);
  assert.equal(f.records.filter(record => record.kind === 'http-final').length, f.physical.length);
  await cleaned(f);
});

test('linked receipt loss is rejected before either answer HTTP and retains all twelve slots', async t => {
  const f = fixture(t), transport = makeTransport(f);
  let caught, red = false;
  try {
    await runEventStateOverlayOpportunity({ ...helperOptions(f, transport), prepareAnswers: (requests, metadata) => {
      const payload = JSON.parse(requests.B.messages[1].content);
      const linked = payload.evidence.find(item => item.rationale.sources.some(source => source.memory.id !== item.memory.id));
      assert.ok(linked, 'red control must lose an actually linked receipt, not merely a root');
      const source = linked.rationale.sources.find(source => source.memory.id !== linked.memory.id);
      assert.equal(typeof source.memory.id, 'string');
      assert.notEqual(source.memory.id, linked.memory.id, 'prove actual source DTO identity is non-root before removal');
      assert.ok(source.receipts.length > 0, 'the real linked source must have a receipt to lose');
      source.receipts.pop();
      requests.B.messages[1].content = JSON.stringify(payload); red = true;
      transport.prepareAnswers(requests, metadata);
    } });
  } catch (error) { caught = error; }
  finally { transport.close(); }
  assert.ok(red); assert.equal(caught.message, 'event_state_projection_denied');
  assert.equal(answerCalls(f).length, 0); assert.equal(caught.report.traces.length, 6);
  assert.ok(caught.report.traces.every(trace => ['A', 'B'].every(arm => trace.arms[arm].answer.status === 'unavailable')));
  assert.ok(caught.report.traces.slice(1).every(trace => trace.failures.includes('not-run-after-fatal')));
  await cleaned(f);
});

test('ordinary first-arm failure keeps its mate and later pairs; auth/accounting/persistence failure halts', async t => {
  const f = fixture(t, { answer: 1 }), report = await runEventStateOverlayProbe(f.options);
  assert.equal(answerCalls(f).length, 12);
  assert.equal(report.traces[0].arms.A.answer.status, 'failed');
  assert.equal(report.traces[0].arms.B.answer.status, 'generated-unassessed');
  assert.ok(report.traces.slice(1).every(trace => trace.order.every(arm => trace.arms[arm].answer.status === 'generated-unassessed')));
  await cleaned(f);
  for (const fault of [{ auth: 1 }, { auth: 2 }, { network: true }, { persistence: 'answer-pair-bound' }, { persistence: 'http-final' }]) {
    const g = fixture(t, fault); let caught;
    try { await runEventStateOverlayProbe(g.options); } catch (error) { caught = error; }
    assert.ok(caught, JSON.stringify(fault)); assert.equal(caught.report.traces.length, 6);
    assert.ok(caught.report.traces.every(trace => trace.arms.A && trace.arms.B));
    assert.ok(caught.report.traces.slice(1).every(trace => trace.failures.includes('not-run-after-fatal')));
    assert.equal(answerCalls(g).length, fault.auth ?? 0);
    if (fault.auth === 2) {
      assert.equal(caught.report.traces[0].arms.A.answer.status, 'generated-unassessed');
      assert.equal(caught.report.traces[0].arms.B.answer.status, 'failed');
    }
    assert.ok(caught.resources.fatal); await cleaned(g);
  }
});

test('bound requests reject downstream mutation, repeated first answers, foreign canary and wrong arm order', async t => {
  for (const fault of ['mutate', 'repeat', 'foreign', 'order']) {
    const f = fixture(t), transport = makeTransport(f); let caught;
    try { await runEventStateOverlayOpportunity({ ...helperOptions(f, transport), answer: async (request, metadata) => {
      if (fault === 'mutate') request.messages[1].content += ' ';
      if (fault === 'foreign') request.messages[1].content += 'FOREIGN_CANARY_QUARTZ';
      if (fault === 'order') metadata.arm = metadata.arm === 'A' ? 'B' : 'A';
      const output = await transport.answer(request, metadata);
      if (fault === 'repeat') return transport.answer(request, metadata);
      return output;
    } }); } catch (error) { caught = error; }
    finally { transport.close(); }
    assert.equal(caught.message, 'event_state_answer_denied');
    assert.equal(answerCalls(f).length, fault === 'repeat' ? 1 : 0);
    assert.equal(caught.report.traces.length, 6); await cleaned(f);
  }
  const f = fixture(t), transport = makeTransport(f);
  const model = transport.createModel({ caseId: OVERLAY_IDS[0], phase: 'target' });
  await assert.rejects(model.extract({ system: readFileSync(new URL('../../../core/prompts/extract-retained-sources.md', import.meta.url), 'utf8'),
    input: { messages: [{ index: 0, role: 'user', content: 'FOREIGN_CANARY_QUARTZ' }] }, maxOutputTokens: 1024, signal: new AbortController().signal }));
  assert.equal(f.physical.length, 0); transport.close();
});
