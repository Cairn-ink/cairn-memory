import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryCore } from '../../../core/contract.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../prepare.mjs';
import { PublicComparisonError, runPublicComparison } from '../public-comparison.mjs';

const sourceId = 'public-comparison-synthetic';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'public-comparison-tests', scope: 'project', projectId: questionId };
const history = () => ({ question_id: questionId, sessions: [
  { session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday', turns: [
    { turn_id: stableTurnIdV2(sourceId, 0, 0), role: 'user', content: '  The launch color is amber.  ' },
    { turn_id: stableTurnIdV2(sourceId, 0, 1), role: 'assistant', content: 'I heard amber.' },
  ] },
  { session_index: 1, session_id: opaqueSessionId(sourceId, 1), date: 'Friday', turns: [
    { turn_id: stableTurnIdV2(sourceId, 1, 0), role: 'user', content: 'Another visit.' },
  ] },
] });
const question = () => ({ question_id: questionId, text: 'What is the launch color?', date: 'Saturday' });
const limits = { contextWindow: 30_000, outputTokens: 50, answerTimeoutMs: 100, recallLimit: 6 };
const emptyRecall = () => ({ ok: true, value: { memories: [], namespaces: [
  { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } });
const captureOk = () => ({ ok: true, value: { duplicate: false,
  admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
  classification: { status: 'skipped', reason: 'empty' } } });
const fakeCore = (patch = {}) => ({
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture: captureOk, recall: emptyRecall, get: () => { throw new Error('not selected'); }, ...patch,
});
const options = (patch = {}) => ({ history: history(), question: question(), namespace: { ...namespace },
  core: fakeCore(), answer: async () => ({ text: 'amber' }), countTokens: (text) => text.length,
  answerModel: 'synthetic-answer-v1', limits: { ...limits }, ...patch });

test('OC1/OC2: serial arms, compact full-history fidelity, no-memory and frozen common request', async () => {
  const calls = [];
  const run = await runPublicComparison(options({ answer: async ({ request }) => {
    calls.push(request); return { text: 'amber' };
  } }));
  assert.deepEqual(run.arms.map((item) => item.name), ['cairn', 'full-history', 'no-memory']);
  assert.deepEqual(run.arms.map((item) => item.status), ['completed', 'completed', 'completed']);
  assert.equal(calls.length, 3);
  assert.equal(new Set(calls.map((request) => request.messages[0].content)).size, 1);
  assert.deepEqual(calls.map((request) => request.model), Array(3).fill('synthetic-answer-v1'));
  assert.deepEqual(JSON.parse(calls[1].messages[1].content).evidence,
    history().sessions.map((session) => ({ sessionIndex: session.session_index,
      sessionId: session.session_id, date: session.date,
      turns: session.turns.map((turn) => ({ role: turn.role, content: turn.content })) })));
  assert.deepEqual(JSON.parse(calls[2].messages[1].content).evidence, []);
  assert.equal(run.arms[2].answer.usage, null);
  assert.equal(Object.isFrozen(run.arms[1]), true);
  assert.doesNotMatch(JSON.stringify(calls), /reference_answer|source_question_id/u);
});

test('OC2: overflow blocks all arms before core, answer or ingestion work', async () => {
  const calls = [];
  const core = fakeCore(Object.fromEntries(['list', 'capture', 'recall', 'get']
    .map((key) => [key, () => { calls.push(key); throw new Error('should not call'); }])));
  const run = await runPublicComparison(options({ core,
    limits: { ...limits, contextWindow: 200 },
    answer: () => { calls.push('answer'); return { text: 'bad' }; } }));
  assert.deepEqual(calls, []);
  assert.deepEqual(run.arms.map((item) => item.status), ['blocked', 'blocked', 'blocked']);
  assert.ok(run.arms.every((item) => item.reason === 'full_history_context_window_exceeded'));
  assert.equal(run.preflight.counterScope, 'local-estimate-not-provider-window-proof');
});

test('OC1/OC4: poison rejected before callbacks; originals cannot change after snapshot', async () => {
  for (const mutate of [
    (input) => { input.history.sessions[0].turns[0].answer = 'leak'; },
    (input) => { input.history.sessions[0].session_id = 'raw-not-v2'; },
    (input) => { input.history.sessions[1].session_id = input.history.sessions[0].session_id; },
    (input) => { input.question.reference_answer = 'leak'; },
    (input) => { input.namespace.projectId = 'wrong'; },
  ]) {
    let called = 0;
    const input = options({ core: fakeCore({ list: () => { called += 1; } }),
      countTokens: () => { called += 1; return 1; } });
    mutate(input);
    await assert.rejects(runPublicComparison(input), PublicComparisonError);
    assert.equal(called, 0);
  }
  const input = options({ countTokens: () => {
    input.history.sessions[0].turns[0].content = 'poison';
    input.question.text = 'poison';
    return 1;
  }, answer: async ({ request }) => {
    assert.equal(JSON.parse(request.messages[1].content).question.text, question().text);
    return { text: 'x' };
  } });
  const run = await runPublicComparison(input);
  assert.ok(run.arms.every((item) => item.status === 'completed'));
  assert.equal(run.question.text, question().text);
});

test('OC3/OI1: real core source-evidence receipts, not generated memory content', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-public-comparison-'));
  let core;
  t.after(() => { core?.close(); rmSync(root, { recursive: true, force: true }); });
  const path = join(root, 'memory.sqlite');
  const modelCalls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: async ({ input }) => { modelCalls.push('extract'); return { items: input.messages.some((item) => item.content.includes('amber'))
      ? [{ content: 'GENERATED_SECRET_SUMMARY', kind: 'fact', confidence: 0.9,
        sourceIndices: [input.messages.findIndex((item) => item.content.includes('amber'))] }] : [] }; },
    classify: async ({ input }) => ({ items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Launch', parentL2Ids: [] },
    })) }),
    select: async ({ input }) => { modelCalls.push('select'); return { refs: input.maps.flatMap((page) => page.items
      .map((item) => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null)
      .filter(Boolean).map((ref) => ({ namespaceIndex: page.namespaceIndex, ...ref }))) }; },
    rank: async ({ input }) => { modelCalls.push('rank'); return { refs: input.candidates.slice(0, input.limit)
      .map((item) => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id,
        revision: item.memory.revision })) }; },
  };
  core = openMemoryCore({ path, model });
  const seen = [];
  const run = await runPublicComparison(options({ core, answer: async ({ request }) => {
    seen.push(request); return { text: 'amber' };
  } }));
  assert.ok(modelCalls.includes('extract'));
  assert.ok(modelCalls.includes('rank'));
  assert.deepEqual(run.arms.map((item) => item.status), ['completed', 'completed', 'completed']);
  const cairn = JSON.parse(seen[0].messages[1].content);
  assert.equal(cairn.evidence.length, 1);
  assert.equal(cairn.evidence[0].receipts[0].excerpt, 'The launch color is amber.');
  assert.equal(cairn.evidence[0].receipts[0].date, 'Tuesday');
  assert.doesNotMatch(seen[0].messages[1].content, /GENERATED_SECRET_SUMMARY/u);
  assert.equal(run.arms[0].diagnostics.retrieval.selectedCount, 1);
});

const sourceCore = (mutateGet = () => {}, mutateRecall = () => {}) => {
  let firstCapture;
  return fakeCore({
    capture: (input) => { firstCapture ??= input; return captureOk(); },
    recall: () => {
      const value = { memories: [{ memory: { id: 'memory', revision: 1,
        currentness: 'current' }, receipts: [{ id: 'receipt', role: 'user', excerpt: 'The launch color is amber.' }],
      receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }],
      namespaces: [{ namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' };
      mutateRecall(value);
      return { ok: true, value };
    },
    get: ({ receiptLimit }) => {
      assert.equal(receiptLimit, 100);
      const value = { memory: { id: 'memory', revision: 1,
        namespace: { ...namespace }, state: 'active', receiptCount: 1 },
      receipts: [{ id: 'receipt', eventId: firstCapture.messages[0].id,
        sessionId: firstCapture.sessionId, client: 'longmemeval-ingestion-v1', role: 'user',
        excerpt: 'The launch color is amber.' }], exhausted: true, nextReceiptCursor: null };
      mutateGet(value);
      return { ok: true, value };
    },
  });
};

test('OC3: authoritative get and recall receipt faults each block Cairn only', async () => {
  const valid = await runPublicComparison(options({ core: sourceCore() }));
  assert.equal(valid.arms[0].status, 'completed');
  const cases = [
    [(detail) => { detail.memory.namespace.ownerId = 'other'; }, () => {}, 'source_get_mismatch'],
    [(detail) => { detail.memory.revision = 2; }, () => {}, 'source_get_mismatch'],
    [(detail) => { detail.memory.state = 'historical'; }, () => {}, 'source_get_mismatch'],
    [(detail) => { detail.receipts[0].excerpt = 'wrong'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(detail) => { detail.receipts[0].client = 'wrong'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(detail) => { detail.exhausted = false; detail.nextReceiptCursor = 'cursor'; }, () => {}, 'source_get_mismatch'],
    [(detail) => { detail.memory.receiptCount = 2; }, () => {}, 'source_get_mismatch'],
    [() => {}, (recall) => { recall.memories[0].receiptCount = 2; }, 'invalid_recall_provenance'],
    [() => {}, (recall) => { recall.memories[0].receipts[0].excerpt = 'wrong'; }, 'unknown_or_mismatched_receipt'],
    [(detail) => {
      detail.memory.receiptCount = 2;
      detail.receipts.push({ ...detail.receipts[0] });
    }, (recall) => {
      recall.memories[0].receiptCount = 2;
      recall.memories[0].receipts.push({ ...recall.memories[0].receipts[0] });
    }, 'duplicate_receipt'],
  ];
  for (const [mutateGet, mutateRecall, reason] of cases) {
    const run = await runPublicComparison(options({ core: sourceCore(mutateGet, mutateRecall) }));
    assert.equal(run.arms[0].status, 'blocked', reason);
    assert.equal(run.arms[0].reason, reason);
    assert.equal(run.arms[0].diagnostics.stage, 'provenance');
    assert.deepEqual(run.arms.slice(1).map((item) => item.status), ['completed', 'completed']);
  }
});

test('OC3: Cairn packing omits whole receipt items and records separate source coverage', async () => {
  const seen = [];
  const run = await runPublicComparison(options({ core: sourceCore(),
    limits: { ...limits, contextWindow: 500 },
    countTokens: (text) => text.includes('memoryId') ? 1000 : 1,
    answer: async ({ request }) => { seen.push(request); return { text: 'x' }; },
  }));
  assert.equal(run.arms[0].status, 'completed');
  assert.deepEqual(JSON.parse(seen[0].messages[1].content).evidence, []);
  assert.deepEqual(run.arms[0].diagnostics.retrieval.retrievedSessionIds,
    [opaqueSessionId(sourceId, 0)]);
  assert.deepEqual(run.arms[0].diagnostics.retrieval.packedSessionIds, []);
  assert.deepEqual(run.arms[0].diagnostics.retrieval.omitted,
    [{ memoryId: 'memory', reason: 'context_window_exceeded' }]);
});

test('OC4: private callback error codes never cross the run boundary', async () => {
  const run = await runPublicComparison(options({ core: fakeCore({
    recall: () => ({ ok: false, error: { code: 'customer_private_secret', retryable: false } }),
  }) }));
  assert.equal(run.arms[0].status, 'failed');
  assert.equal(run.arms[0].reason, 'recall_failed');
  assert.doesNotMatch(JSON.stringify(run), /customer_private_secret/u);
});

test('OC4: empty prior capture cannot pass freshness through a duplicate result', async () => {
  let recalled = false;
  const run = await runPublicComparison(options({ core: fakeCore({
    capture: () => ({ ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 0 } }),
    recall: () => { recalled = true; return emptyRecall(); },
  }) }));
  assert.equal(recalled, false);
  assert.equal(run.arms[0].status, 'failed');
  assert.equal(run.arms[0].reason, 'ingestion_incomplete');
  assert.equal(run.arms[0].diagnostics.ingestion.outcomes[0].status, 'duplicate');
  assert.deepEqual(run.arms.slice(1).map(item => item.status), ['completed', 'completed']);
});

test('OC4: timed-out answer blocks later arms to prevent overlapping callbacks', async () => {
  let calls = 0;
  const run = await runPublicComparison(options({
    limits: { ...limits, answerTimeoutMs: 15 },
    answer: ({ signal }) => { calls += 1; return calls === 1 ? new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve({ text: 'late' }));
    }) : Promise.resolve({ text: 'ok' }); },
  }));
  assert.equal(calls, 1);
  assert.equal(run.arms[0].status, 'failed');
  assert.equal(run.arms[0].reason, 'answer_timeout');
  assert.equal(run.arms[0].answer, null);
  assert.deepEqual(run.arms.slice(1).map((item) => item.status), ['blocked', 'blocked']);
  assert.ok(run.arms.slice(1).every((item) => item.reason === 'prior_answer_timeout'));
});
