import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryCore } from '../../../core/contract.mjs';
import {
  LongMemEvalComparisonError,
  runLongMemEvalComparison,
} from '../comparison.mjs';
import { INGESTION_CLIENT } from '../ingestion.mjs';
import { opaqueQuestionId, stableTurnId } from '../prepare.mjs';

const sourceQuestionId = 'comparison-synthetic-case';
const questionId = opaqueQuestionId(sourceQuestionId);
const namespace = { ownerId: 'comparison-tests', scope: 'project', projectId: questionId };
const makeHistory = () => ({ question_id: questionId, sessions: [
  { session_index: 0, session_id: 'session-a', date: 'Tuesday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 0, 'session-a', 0), role: 'user',
      content: 'The launch color is amber.' },
    { turn_id: stableTurnId(sourceQuestionId, 0, 'session-a', 1), role: 'assistant',
      content: 'I recorded amber.' },
  ] },
  { session_index: 1, session_id: 'session-b', date: 'Friday', turns: [
    { turn_id: stableTurnId(sourceQuestionId, 1, 'session-b', 0), role: 'user',
      content: 'The unrelated mascot is a cairn.' },
  ] },
] });
const question = { question_id: questionId, text: 'What is the launch color?', date: 'Saturday' };
const limits = { evidenceTokens: 20_000, requestTokens: 30_000, outputTokens: 100,
  answerTimeoutMs: 100, recallLimit: 6, lexicalLimit: 20 };
const countTokens = (text) => text.length;
const completedCapture = { ok: true, value: { duplicate: false,
  admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
  classification: { status: 'skipped', reason: 'empty' } } };

const fakeCore = ({ capture = async () => completedCapture, recall } = {}) => ({
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture,
  recall: recall ?? (async () => ({ ok: true, value: { memories: [], namespaces: [
    { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true },
  ], coverage: 'complete' } })),
});

const options = (overrides = {}) => ({ history: makeHistory(), question: { ...question },
  namespace: { ...namespace }, core: fakeCore(),
  answer: async ({ request }) => ({ text: request.evidence.some((item) => item.text.includes('amber'))
    ? 'amber' : 'I do not know' }),
  countTokens, answerModel: 'scripted-answer-v1', limits: { ...limits }, ...overrides });

const selectAll = ({ input }) => ({ refs: input.maps.flatMap((page) => page.items
  .map((item) => item.type === 'unfiled' ? item.ref
    : item.type === 'ref' && item.ref.childType === 'memory'
      ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
  .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref }))) });
const rankAll = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((item) => ({
  namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision,
})) });

test('C01-C04/C07: actual public core maps exact receipts and keeps all arms answer-blind', async (t) => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-comparison-test-')), 'memory.sqlite');
  const model = {
    contextWindow: 8192,
    countTokens: () => 1,
    extract: async ({ input }) => ({ items: input.messages.some((message) => message.content.includes('amber'))
      ? [{ content: 'The launch color is amber.', kind: 'fact', confidence: 0.9,
        sourceIndices: [input.messages.findIndex((message) => message.content.includes('amber'))] }]
      : [] }),
    classify: async ({ input }) => ({ items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Launch', parentL2Ids: [] },
    })) }),
    select: selectAll,
    rank: rankAll,
  };
  const core = openMemoryCore({ path: databasePath, model });
  t.after(() => core.close());
  const calls = [];
  const run = await runLongMemEvalComparison(options({ core,
    answer: async (request) => {
      calls.push(structuredClone({ model: request.model, request: request.request,
        maxOutputTokens: request.maxOutputTokens }));
      return { text: request.request.evidence.some((item) => item.text.includes('amber'))
        ? 'amber' : 'I do not know',
      usage: { inputTokens: null, outputTokens: null, costMicroUsd: null } };
    },
  }));
  assert.deepEqual(run.arms.map((arm) => arm.name), ['cairn', 'lexical', 'no-memory']);
  assert.ok(run.arms.every((arm) => arm.status === 'completed'));
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((call) => JSON.stringify({ ...call, request: {
    ...call.request, evidence: [] } }))).size, 1);
  assert.deepEqual(run.arms.find((arm) => arm.name === 'no-memory').packing.selectedEvidence, []);
  const cairnEvidence = run.arms.find((arm) => arm.name === 'cairn').packing.selectedEvidence;
  assert.equal(cairnEvidence[0].source.sessionId, 'session-a');
  assert.equal(cairnEvidence[0].role, 'user');
  assert.equal(cairnEvidence[0].date, 'Tuesday');
  assert.match(cairnEvidence[0].text, /Memory: The launch color is amber/u);
  assert.ok(!JSON.stringify(calls).includes(sourceQuestionId));
  assert.ok(!JSON.stringify(calls).includes('reference_answer'));
});

test('C02/C03: lexical ties follow source order and evidence is omitted whole', async () => {
  const history = makeHistory();
  history.sessions[0].turns[0].content = 'launch alpha';
  history.sessions[0].turns[1].content = 'launch beta';
  const seen = [];
  const run = await runLongMemEvalComparison(options({ history,
    question: { ...question, text: 'launch' },
    limits: { ...limits, evidenceTokens: 230 },
    answer: async ({ request }) => { seen.push(request); return { text: 'x' }; },
  }));
  const lexical = run.arms.find((arm) => arm.name === 'lexical');
  assert.equal(lexical.packing.selectedEvidence[0].text, 'launch alpha');
  assert.ok(lexical.packing.omitted.length >= 1);
  assert.ok(!lexical.packing.selectedEvidence.some((item) => item.text !== 'launch alpha'));
  assert.equal(seen.find((request) => request.evidence.length > 0).evidence[0].text, 'launch alpha');
});

test('C01/C07: poison and namespace mismatches fail before any core or answer call', async () => {
  for (const mutate of [
    (input) => { input.history.answer = 'leak'; },
    (input) => { input.question.reference_answer = 'leak'; },
    (input) => { input.namespace.projectId = 'another-case'; },
    (input) => { input.limits.outputTokens = 0; },
  ]) {
    let calls = 0;
    const input = options({ core: { list: () => { calls += 1; }, capture: () => { calls += 1; },
      recall: () => { calls += 1; } }, answer: () => { calls += 1; } });
    mutate(input);
    await assert.rejects(runLongMemEvalComparison(input), LongMemEvalComparisonError);
    assert.equal(calls, 0);
  }
  let budgetCalls = 0;
  await assert.rejects(runLongMemEvalComparison(options({
    limits: { ...limits, requestTokens: 1 },
    core: { list: () => { budgetCalls += 1; }, capture: () => { budgetCalls += 1; },
      recall: () => { budgetCalls += 1; } },
    answer: () => { budgetCalls += 1; },
  })), { code: 'question_or_framing_too_large' });
  assert.equal(budgetCalls, 0);
});

test('C01/C07: caller mutation after the first await cannot rewrite later arms', async () => {
  let release;
  let started;
  const waiting = new Promise((resolve) => { release = resolve; });
  const begun = new Promise((resolve) => { started = resolve; });
  let captured = 0;
  let recalled = 0;
  const originalCore = fakeCore({ capture: async () => { captured += 1; return completedCapture; },
    recall: async () => { recalled += 1; return { ok: true, value: { memories: [], namespaces: [
      { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true },
    ], coverage: 'complete' } }; } });
  const input = options({ core: originalCore, answer: async ({ request }) => {
    started(); await waiting; return { text: request.question.text };
  } });
  const pending = runLongMemEvalComparison(input);
  await begun;
  input.question.text = 'mutated question';
  input.answerModel = 'mutated model';
  input.answer = async () => ({ text: 'mutated callback' });
  input.history.sessions[0].session_id = 'mutated-session';
  input.core.capture = async () => { throw new Error('mutated capture'); };
  input.core.recall = async () => { throw new Error('mutated recall'); };
  release();
  const run = await pending;
  assert.equal(run.answerModel, 'scripted-answer-v1');
  assert.equal(run.sourceCatalog[0].sessionId, 'session-a');
  assert.ok(captured > 0);
  assert.equal(recalled, 1);
  assert.ok(run.arms.filter((arm) => arm.status === 'completed')
    .every((arm) => arm.answer.text === question.text));
});

test('C02/C06/C07: Cairn ingestion and recall failures remain while baselines complete', async () => {
  const captureFailure = await runLongMemEvalComparison(options({ core: fakeCore({
    capture: async () => ({ ok: false, error: { code: 'extraction_failed', retryable: false } }),
  }) }));
  assert.equal(captureFailure.arms[0].failedStage, 'ingestion');
  assert.equal(captureFailure.arms[0].retrieval.ingestion.outcomes[0].status, 'failed');
  assert.ok(captureFailure.arms.slice(1).every((arm) => arm.status === 'completed'));

  const recallFailure = await runLongMemEvalComparison(options({ core: fakeCore({
    recall: async () => ({ ok: false, error: { code: 'model_timeout', retryable: false } }),
  }) }));
  assert.equal(recallFailure.arms[0].failedStage, 'recall');
  assert.equal(recallFailure.arms[0].error.code, 'model_timeout');
  assert.equal(recallFailure.arms[0].retrieval.status, 'failed');
});

test('ingestion summaries retain finite failure causes and stop later batches', async () => {
  const partial = (code, retryable) => ({ ok: true, value: {
    duplicate: false,
    admission: { memories: [{ id: 'private-admission-reference', revision: 1 }],
      suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'failed', error: { code, retryable } },
  } });
  const cases = [
    [async () => partial('invalid_model_output', true), 'partial', 'classification', 'invalid_model_output', true],
    [async () => partial('private_customer_123', true), 'partial', 'classification', 'classification_failed', false],
    [async () => ({ ok: false, error: { code: 'extraction_failed', retryable: true } }),
      'failed', 'capture', 'extraction_failed', true],
    [async () => ({ ok: false, error: { code: 'private_customer_123', retryable: true } }),
      'failed', 'capture', 'capture_failed', false],
    [async () => ({ ok: true, value: { processing: true } }), 'unknown', 'capture', 'capture_processing', false],
    [async () => ({ ok: true, value: {} }), 'unknown', 'capture', 'malformed_capture_response', false],
    [async () => { throw Object.assign(new Error('private_exception_text'), { code: 'private_customer_123' }); },
      'unknown', 'capture', 'capture_threw', false],
  ];
  for (const [capture, status, errorStage, code, retryable] of cases) {
    let calls = 0;
    const run = await runLongMemEvalComparison(options({ core: fakeCore({
      capture: async () => { calls += 1; return capture(); },
    }) }));
    const arm = run.arms[0];
    assert.equal(calls, 1);
    assert.equal(arm.status, 'failed');
    assert.equal(arm.failedStage, 'ingestion');
    assert.equal(arm.error.code, 'ingestion_incomplete');
    const [first, later] = arm.retrieval.ingestion.outcomes;
    assert.deepEqual(first, { batchIndex: 0, eventId: first.eventId, status,
      errorStage, error: { code, retryable } });
    assert.match(first.eventId, /^lme-/u);
    assert.deepEqual(later, { batchIndex: 1, eventId: later.eventId, status: 'not_run' });
    assert.ok(run.arms.slice(1).every((baseline) => baseline.status === 'completed'));
    assert.doesNotMatch(JSON.stringify(run), /private_customer_123|private_exception_text|private-admission-reference/u);
  }
  for (const capture of [async () => completedCapture,
    async () => ({ ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 0 } })]) {
    const run = await runLongMemEvalComparison(options({ core: fakeCore({ capture }) }));
    assert.equal(run.arms[0].status, 'completed');
    assert.ok(run.arms[0].retrieval.ingestion.outcomes.every((outcome) =>
      !Object.hasOwn(outcome, 'errorStage') && !Object.hasOwn(outcome, 'error')));
  }
});

test('C04/C06/C07: mismatched receipt and dirty namespace are blocking Cairn-only failures', async () => {
  let captured;
  const poisoned = fakeCore({
    capture: async (input) => { captured = input; return { ok: true, value: { duplicate: false,
      admission: { memories: [{ id: 'm', revision: 1 }], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'skipped', reason: 'already_filed' } } }; },
    recall: async () => ({ ok: true, value: { memories: [{ memory: { id: 'm', revision: 1,
      namespace: { ...namespace }, content: 'amber', receiptCount: 1 }, receipts: [{ id: 'r',
      client: INGESTION_CLIENT, sessionId: captured.sessionId, eventId: captured.messages[0].id,
      role: 'assistant', excerpt: captured.messages[0].content, createdAt: 'now' }], receiptCount: 1 }],
    namespaces: [{ namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }],
    coverage: 'complete' } }),
  });
  const provenance = await runLongMemEvalComparison(options({ core: poisoned }));
  assert.equal(provenance.arms[0].failedStage, 'provenance');
  assert.equal(provenance.blockingFlags[0].code, 'unknown_or_mismatched_receipt');
  assert.ok(provenance.arms.slice(1).every((arm) => arm.status === 'completed'));

  const dirty = fakeCore();
  dirty.list = () => ({ ok: true, value: { memories: [{ id: 'existing' }],
    nextCursor: null, exhausted: true } });
  const contaminated = await runLongMemEvalComparison(options({ core: dirty }));
  assert.equal(contaminated.arms[0].error.code, 'namespace_not_pristine');
  assert.ok(contaminated.arms.slice(1).every((arm) => arm.status === 'completed'));
});

test('C03/C07: bad token counts, oversized output, malformed answer, errors and timeout are explicit', async () => {
  await assert.rejects(runLongMemEvalComparison(options({ countTokens: () => NaN })),
    { code: 'token_count_unavailable' });
  for (const [answer, code] of [
    [async () => ({ text: 'x'.repeat(101) }), 'answer_output_too_large'],
    [async () => ({ answer: 'x' }), 'malformed_answer_response'],
    [async () => { throw new Error('sensitive provider text'); }, 'answer_failed'],
  ]) {
    const run = await runLongMemEvalComparison(options({ answer }));
    assert.ok(run.arms.every((arm) => arm.error.code === code));
    assert.ok(!JSON.stringify(run).includes('sensitive provider text'));
  }
  const timeout = await runLongMemEvalComparison(options({ limits: { ...limits, answerTimeoutMs: 5 },
    answer: async ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })));
    }) }));
  assert.ok(timeout.arms.every((arm) => arm.error.code === 'answer_timeout'));
});
