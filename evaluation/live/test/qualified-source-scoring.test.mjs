import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot, retainedSourceView } from '../../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, authorizeCaseDeadlineCapability,
  createCaseDeadlineExperimentRequestGuard, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../../longmemeval/prepare.mjs';
import { qualifiedSourcePairProtocol, runQualifiedSourcePair } from '../../longmemeval/public-comparison.mjs';
import { aggregateQualifiedSourceScores,
  scoreQualifiedSourcePair } from '../../longmemeval/qualified-source-scoring.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const names = ['qualified-prefix', 'indexed-windows'];
const sourceId = 'source-scoring-actual-guard';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'qualified-source-scoring-tests', scope: 'project', projectId: questionId };
const settings = {
  history: { question_id: questionId, sessions: [{ session_index: 0,
    session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday', turns: [
      { turn_id: stableTurnIdV2(sourceId, 0, 0), role: 'user', content: 'The day was Friday.' },
      { turn_id: stableTurnIdV2(sourceId, 0, 1), role: 'assistant', content: 'Understood.' },
    ] }] },
  question: { question_id: questionId, text: 'Which day?', date: 'Saturday' },
  namespace, answerModel: 'synthetic-answer',
  limits: { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 200, recallLimit: 6 },
  armOrder: names,
};
const evaluator = { question_id: questionId, source_question_id: sourceId,
  question_type: 'single-session-user', reference_answer: 'Friday',
  answer_session_ids: [opaqueSessionId(sourceId, 0)], turn_labels: [] };
const core = (name) => ({
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture: (input) => ({ ok: true, value: { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' },
    ...(name === names[0]
      ? { retainedSourceWindow: retainedSourceView(captureSnapshot(input, 'source-bound-v2'))
        .retainedSourceWindow }
      : { sourceWindowCatalog: sourceWindowCatalog(captureSnapshot(input, 'source-bound-v2',
        'indexed-windows-v1')).coverage.sourceWindowCatalog }),
  } }),
  recall: () => ({ ok: true, value: { memories: [], namespaces: [
    { namespace, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } }),
  get: () => assert.fail('empty recall must not fetch'),
});

test('P5 existing scoped guard settles a synthetic timed-out judge before the next slot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cairn-qualified-scoring-guard-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 5_000_000, requestCap: 10 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy,
    fetchImpl: () => assert.fail('initialization must not call transport') }).close();
  const stages = structuredClone(benchmarkStagePolicy());
  stages.judge.timeoutMs = 30;
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
    authorizationId: 'synthetic-qualified-scoring', stages });
  const protocol = qualifiedSourcePairProtocol(settings);
  const schedule = ['generation', 'scoring'].flatMap((phase) => protocol.armOrder.map((name) => ({
    phase, caseId: protocol.arms.find((arm) => arm.name === name).scopeId })));
  const caseDeadlineCapability = authorizeCaseDeadlineCapability({ ledger, policy,
    benchmarkExtension, authorizationId: 'synthetic-scoring-scope',
    executionId: 'synthetic-scoring-once', checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, schedule });
  let forwards = 0;
  const guard = createCaseDeadlineExperimentRequestGuard({ ledger, policy,
    benchmarkExtension, caseDeadlineCapability, fetchImpl: (_url, options) => {
      if (++forwards === 1) return new Promise(() => {});
      return Response.json({ id: 'synthetic', object: 'chat.completion',
        model: JSON.parse(options.body).model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'yes' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    } });
  try {
    const port = { withCaseScope: guard.withCaseScope, isHalted: guard.isHalted };
    const run = await runQualifiedSourcePair({ ...settings,
      cores: { qualifiedPrefix: core(names[0]), indexedWindows: core(names[1]) },
      countTokens: () => 1, answer: async () => ({ text: 'Friday' }), execution: port });
    assert.equal(run.executionStatus, 'completed');
    const result = await scoreQualifiedSourcePair({ run, expectedProtocol: protocol,
      evaluator, execution: port, judgeTimeoutMs: 1000,
      judge: async ({ request, signal }) => {
        const response = await guard.judgeFetch(stages.judge.endpoint, {
          method: 'POST', redirect: 'error', signal,
          headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
          body: JSON.stringify({ ...request, store: false, stream: false }) });
        const value = await response.json();
        return { text: value.choices[0].message.content };
      } });
    assert.equal(result.executionStatus, 'completed');
    assert.equal(result.arms[0].judgment.reason, 'case_timeout');
    assert.equal(result.arms[0].judgment.attempted, true);
    assert.equal(result.arms[1].judgment.correct, true);
    assert.equal(guard.isHalted(), false);
    assert.equal(forwards, 2);
    assert.deepEqual(guard.attempts().map((row) => row.outcome), ['unknown', 'succeeded']);
    assert.equal(guard.getState().attempts.some((row) => row.outcome === null), false);
    assert.equal(aggregateQualifiedSourceScores({ roster: [{ protocol,
      sourceQuestionId: evaluator.source_question_id, questionType: 'single-session-user' }],
    records: [result] }).common.commonN, 0);
  } finally { guard.close(); }
});
