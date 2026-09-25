import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { captureSnapshot, retainedSourceView } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, authorizeQualifiedSourcePairCapability,
  createExperimentRequestGuard, createQualifiedSourcePairExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../../longmemeval/prepare.mjs';
import { qualifiedSourcePairProtocol, runQualifiedSourcePair } from '../../longmemeval/public-comparison.mjs';
import { scoreQualifiedSourcePair } from '../../longmemeval/qualified-source-scoring.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const names = ['qualified-prefix', 'indexed-windows'];
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 15_000,
  recallLimit: 6 };

function ledgerFixture(t, root, { judgeTimeoutMs = 5_000 } = {}) {
  const first = { directory: join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('no provider') }).close();
  const stages = benchmarkStagePolicy();
  stages.answer.timeoutMs = 5_000;
  stages.judge.timeoutMs = judgeTimeoutMs;
  assert.ok(stages.answer.timeoutMs < limits.answerTimeoutMs);
  assert.ok(stages.judge.timeoutMs < 15_000);
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'original', stages });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 40,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 40 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'budget-parent',
    newLimitMicroUsd: 100_000_000, newRequestCap: 100,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger = { ...second, limitMicroUsd: 100_000_000, requestCap: 100 };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { ledger, policy, parent };
}

function emptySourceCore(name, namespace) {
  const metadata = (input) => name === 'qualified-prefix'
    ? { retainedSourceWindow: retainedSourceView(captureSnapshot(input, 'source-bound-v2'))
      .retainedSourceWindow }
    : { sourceWindowCatalog: sourceWindowCatalog(captureSnapshot(input, 'source-bound-v2',
      'indexed-windows-v1')).coverage.sourceWindowCatalog };
  return { list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
    capture: (input) => ({ ok: true, value: { duplicate: false,
      admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'skipped', reason: 'empty' }, ...metadata(input) } }),
    recall: () => ({ ok: true, value: { memories: [], namespaces: [
      { namespace, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } }),
    get: () => { throw new Error('no memory'); } };
}

function caseData(sourceId, armOrder) {
  const questionId = opaqueQuestionId(sourceId);
  const history = { question_id: questionId, sessions: [{ session_index: 0,
    session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday', turns: [
      { turn_id: stableTurnIdV2(sourceId, 0, 0), role: 'user',
        content: 'x'.repeat(800) + ' Friday is the day.' },
      { turn_id: stableTurnIdV2(sourceId, 0, 1), role: 'assistant', content: 'Understood.' },
    ] }] };
  const question = { question_id: questionId, text: 'Which day?', date: 'Saturday' };
  const namespace = { ownerId: 'guarded-pair-synthetic', scope: 'project', projectId: questionId };
  return { history, question, namespace, answerModel: 'gpt-4.1-mini-2025-04-14',
    limits, armOrder };
}

function sourceOutput(body) {
  const method = body.text.format.name.replace(/^cairn_/u, '');
  const input = JSON.parse(body.input[0].content[0].text);
  const empty = { value: null, evidenceIndices: [] };
  const unknown = { value: 'unknown', evidenceIndices: [] };
  if (method === 'extract') return { items: [{ content: 'GENERATED_SUMMARY_POISON',
    kind: 'context', confidence: 0.9,
    sourceIndices: input.inputMode === 'indexed-windows-v1' ? [0, 1, 2] : [0, 1] }] };
  if (method === 'qualifyCandidates') return { qualifications: Object.fromEntries(
    input.items.map((entry) => [`item_${entry.itemIndex}`, { itemIndex: entry.itemIndex,
      subject: empty, property: empty, scope: empty, applies: empty,
      value: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
      attribution: unknown, commitment: unknown }])) };
  if (method === 'classify') return { items: input.memories.map((memory) => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Synthetic schedule', parentL2Ids: [] } })) };
  if (method === 'select') return { refs: input.maps.flatMap((page) => page.items.map((item) =>
    item.type === 'unfiled' ? { namespaceIndex: page.namespaceIndex, ...item.ref }
      : item.type === 'ref' && item.ref.childType === 'memory'
        ? { namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId,
          revision: item.ref.childRevision } : null).filter(Boolean)) };
  if (method === 'rank') return { refs: input.candidates.slice(0, input.limit).map((entry) => ({
    namespaceIndex: entry.namespaceIndex, memoryId: entry.memory.id,
    revision: entry.memory.revision })) };
  assert.fail(`unexpected Cairn method ${method}`);
}

function fakeResponse(url, options, observed) {
  const body = JSON.parse(options.body);
  observed.push({ url, body });
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url.endsWith('/responses')) return Response.json({ id: 'resp_synthetic', object: 'response',
    model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(sourceOutput(body)), annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  return Response.json({ id: 'chat_synthetic', object: 'chat.completion', model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: body.model.includes('4o') ? 'yes' : 'Friday' },
      finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } });
}

test('G4 two real source-pair cases use one guarded generation-then-scoring schedule', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-pair-live-'));
  const { ledger, policy, parent } = ledgerFixture(t, root);
  const cases = [caseData('guarded-pair-one', names),
    caseData('guarded-pair-two', [...names].reverse())];
  const protocols = cases.map((data) => qualifiedSourcePairProtocol(data));
  const roster = protocols.map((protocol, index) => ({ questionId: protocol.questionId,
    protocolDigest: protocol.digest, armOrder: [...cases[index].armOrder],
    arms: protocol.arms.map(({ name, scopeId }) => ({ name, scopeId })) }));
  const capability = authorizeQualifiedSourcePairCapability({ ledger, policy,
    benchmarkExtension: parent, authorizationId: 'source-pair', executionId: 'two-cases',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster });
  const observed = [];
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger, policy,
    benchmarkExtension: parent, qualifiedSourcePairCapability: capability,
    fetchImpl: (url, options) => fakeResponse(url, options, observed) });
  t.after(() => guard.close());
  const scopeErrors = [];
  const execution = { withCaseScope: async (identity, operation) => {
    try { return await guard.withCaseScope(identity, operation); }
    catch (error) { scopeErrors.push({ code: error.code, message: error.message }); throw error; }
  }, isHalted: guard.isHalted };
  const model = createOpenAIModel({ apiKey: 'synthetic-only',
    fetchImpl: (url, options) => guard.cairnFetch(url, options) });
  const cores = cases.map((data, caseIndex) => {
    const pair = {};
    for (const [name, key, sourcePolicy] of [[names[0], 'qualifiedPrefix', undefined],
      [names[1], 'indexedWindows', 'indexed-windows-v1']]) {
      const core = openMemoryCore({ path: join(root, `case-${caseIndex}-${name}.sqlite`),
        model, captureQualification: 'source-bound-v2',
        ...(sourcePolicy ? { captureSourcePolicy: sourcePolicy } : {}) });
      t.after(() => core.close());
      pair[key] = core;
    }
    return pair;
  });
  const runs = [];
  for (let index = 0; index < cases.length; index += 1) {
    runs.push(await runQualifiedSourcePair({ ...cases[index], cores: cores[index],
      answer: async ({ request, signal }) => {
        const response = await guard.answerFetch(benchmarkStagePolicy().answer.endpoint,
          { method: 'POST', redirect: 'error', signal,
            headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, store: false, stream: false }) });
        return { text: (await response.json()).choices[0].message.content };
      }, countTokens: model.countTokens.bind(model), execution }));
  }
  assert.deepEqual(runs.map((run) => run.executionStatus), ['completed', 'completed'],
    JSON.stringify({ scopeErrors, statuses: runs.map((run) => [run.haltReason, run.attemptedOrder]),
      attemptCount: guard.attempts().length,
      observedMethods: observed.map((entry) => entry.body.text?.format?.name ?? entry.body.model) }));
  assert.deepEqual(runs.flatMap((run) => run.arms.map((arm) => arm.status)),
    ['completed', 'completed', 'completed', 'completed']);
  const scored = [];
  for (let index = 0; index < cases.length; index += 1) {
    const data = cases[index];
    scored.push(await scoreQualifiedSourcePair({ run: runs[index], expectedProtocol: protocols[index],
      evaluator: { question_id: data.question.question_id,
        source_question_id: ['guarded-pair-one', 'guarded-pair-two'][index],
        question_type: 'single-session-user',
        reference_answer: 'Friday', answer_session_ids: [data.history.sessions[0].session_id],
        turn_labels: [] }, judgeTimeoutMs: 15_000, execution,
      judge: async ({ request, signal }) => {
        const response = await guard.judgeFetch(benchmarkStagePolicy().judge.endpoint,
          { method: 'POST', redirect: 'error', signal,
            headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, store: false, stream: false }) });
        return { text: (await response.json()).choices[0].message.content };
      } }));
  }
  assert.deepEqual(scored.map((result) => result.executionStatus), ['completed', 'completed']);
  assert.deepEqual(scored.flatMap((result) => result.arms.map((arm) => arm.judgment.correct)),
    [true, true, true, true]);
  assert.equal(guard.getState().requestCount, observed.length);
  assert.equal(guard.attempts().length, observed.length);
  assert.equal(guard.getState().reservedMicroUsd,
    guard.attempts().reduce((sum, attempt) => sum + attempt.reservedMicroUsd, 0));
  assert.equal(guard.getState().attempts.every((attempt) => attempt.outcome === 'succeeded'), true);
  const chats = observed.filter((entry) => entry.url.endsWith('/chat/completions'));
  assert.deepEqual(chats.map((entry) => entry.body.model), [
    benchmarkStagePolicy().answer.model, benchmarkStagePolicy().answer.model,
    benchmarkStagePolicy().answer.model, benchmarkStagePolicy().answer.model,
    benchmarkStagePolicy().judge.model, benchmarkStagePolicy().judge.model,
    benchmarkStagePolicy().judge.model, benchmarkStagePolicy().judge.model]);
  assert.deepEqual(guard.attempts().filter((attempt) => ['answer', 'judge'].includes(attempt.stage))
    .map((attempt) => attempt.stage), ['answer', 'answer', 'answer', 'answer',
      'judge', 'judge', 'judge', 'judge']);
  const evidence = chats.slice(0, 4).map((entry) => JSON.parse(entry.body.messages[1].content).evidence);
  for (const index of [0, 3]) {
    assert.ok(evidence[index][0].receipts.some((receipt) => receipt.role === 'user'
      && receipt.excerpt === 'x'.repeat(800)));
    assert.ok(!JSON.stringify(evidence[index]).includes('Friday is the day'));
  }
  for (const index of [1, 2]) {
    assert.ok(evidence[index][0].receipts.some((receipt) => receipt.role === 'user'
      && receipt.excerpt.includes('Friday is the day')));
  }
  assert.ok(evidence.every((items) => items[0].receipts.some((receipt) => receipt.role === 'assistant')));
  assert.ok(!JSON.stringify(chats).includes('GENERATED_SUMMARY_POISON'));
  assert.equal(guard.isHalted(), false);
});

test('G4 actual N/P scheduling distinguishes isolated judge deadline from global 429', async (t) => {
  for (const mode of ['deadline', 'http-429']) {
    await t.test(mode, async (nested) => {
      const root = mkdtempSync(join(tmpdir(), 'cairn-pair-scoring-failure-'));
      const { ledger, policy, parent } = ledgerFixture(nested, root,
        { judgeTimeoutMs: mode === 'deadline' ? 30 : 5_000 });
      const data = caseData(`guarded-pair-${mode}`, names);
      const protocol = qualifiedSourcePairProtocol(data);
      const roster = [{ questionId: protocol.questionId, protocolDigest: protocol.digest,
        armOrder: [...names], arms: protocol.arms.map(({ name, scopeId }) => ({ name, scopeId })) }];
      const capability = authorizeQualifiedSourcePairCapability({ ledger, policy,
        benchmarkExtension: parent, authorizationId: 'source-pair', executionId: 'failure-case',
        checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster });
      let judges = 0;
      const observed = [];
      const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger, policy,
        benchmarkExtension: parent, qualifiedSourcePairCapability: capability,
        fetchImpl: (url, options) => {
          const body = JSON.parse(options.body);
          if (url.endsWith('/chat/completions') && body.model === benchmarkStagePolicy().judge.model) {
            judges += 1;
            if (judges === 1 && mode === 'deadline') return new Promise(() => {});
            if (judges === 1 && mode === 'http-429') return new Response('rate limited', { status: 429 });
          }
          return fakeResponse(url, options, observed);
        } });
      nested.after(() => guard.close());
      const execution = { withCaseScope: guard.withCaseScope, isHalted: guard.isHalted };
      const fetchStage = async (stage, request, signal) => {
        const response = await guard[`${stage}Fetch`](benchmarkStagePolicy()[stage].endpoint,
          { method: 'POST', redirect: 'error', signal,
            headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...request, store: false, stream: false }) });
        return { text: (await response.json()).choices[0].message.content };
      };
      const run = await runQualifiedSourcePair({ ...data,
        cores: { qualifiedPrefix: emptySourceCore(names[0], data.namespace),
          indexedWindows: emptySourceCore(names[1], data.namespace) },
        answer: ({ request, signal }) => fetchStage('answer', request, signal),
        countTokens: () => 1, execution });
      assert.equal(run.executionStatus, 'completed', JSON.stringify(run));
      const result = await scoreQualifiedSourcePair({ run, expectedProtocol: protocol,
        evaluator: { question_id: data.question.question_id,
          source_question_id: `guarded-pair-${mode}`, question_type: 'single-session-user',
          reference_answer: 'Friday', answer_session_ids: [data.history.sessions[0].session_id],
          turn_labels: [] }, judgeTimeoutMs: 15_000, execution,
        judge: ({ request, signal }) => fetchStage('judge', request, signal) });
      if (mode === 'deadline') {
        assert.equal(result.executionStatus, 'completed');
        assert.equal(judges, 2);
        assert.equal(guard.isHalted(), false);
        assert.deepEqual([result.arms[0].judgment.attempted,
          result.arms[0].judgment.correct, result.arms[0].judgment.reason],
        [true, null, 'case_timeout']);
        assert.equal(result.arms[1].judgment.correct, true);
        const unknown = guard.getState().attempts.filter((attempt) => attempt.outcome === 'unknown');
        assert.equal(unknown.length, 1);
        assert.equal(unknown[0].actualMicroUsd, null);
        assert.equal(unknown[0].reservedMicroUsd, benchmarkStagePolicy().judge.reservedMicroUsd);
      } else {
        assert.equal(result.executionStatus, 'halted');
        assert.equal(judges, 1);
        assert.equal(guard.isHalted(), true);
        assert.deepEqual([result.arms[0].judgment.attempted,
          result.arms[0].judgment.correct], [true, null]);
        assert.deepEqual([result.arms[1].judgment.attempted,
          result.arms[1].judgment.correct], [false, null]);
        assert.equal(guard.getState().attempts.filter((attempt) => attempt.outcome === 'failed').length, 1);
      }
      assert.equal(guard.getState().requestCount, guard.attempts().length);
      assert.equal(guard.getState().reservedMicroUsd,
        guard.attempts().reduce((sum, attempt) => sum + attempt.reservedMicroUsd, 0));
    });
  }
});
