import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { INDEXED_WINDOW_INGESTION_PLAN_SCHEMA_VERSION, ingestIndexedWindowLongMemEvalCase,
  ingestLongMemEvalCase, planIndexedWindowLongMemEvalCase, planLongMemEvalCase } from '../ingestion.mjs';
import { scorePublicComparison } from '../official-scoring.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../prepare.mjs';
import { INDEXED_WINDOW_PUBLIC_COMPARISON_SCHEMA_VERSION, PUBLIC_ANSWER_INSTRUCTION,
  runIndexedWindowPublicComparison, runPublicComparison } from '../public-comparison.mjs';

const sourceId = 'indexed-window-provenance-synthetic';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'indexed-window-provenance-tests', scope: 'project', projectId: questionId };
const question = { question_id: questionId, text: 'Which day?', date: 'Saturday' };
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 200,
  recallLimit: 6 };
const tail = 'TAIL FACT: the launch is Friday.';
const history = (contents = ['x'.repeat(800) + tail]) => ({ question_id: questionId,
  sessions: [{ session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday',
    turns: contents.map((content, index) => ({ turn_id: stableTurnIdV2(sourceId, 0, index),
      role: index % 2 ? 'assistant' : 'user', content })) }] });
const catalogFor = (input) => sourceWindowCatalog(captureSnapshot(input, 'source-bound-v2', 'indexed-windows-v1'));
const captureValue = (input, value = { duplicate: false,
  admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
  classification: { status: 'skipped', reason: 'empty' } }) => ({ ok: true,
  value: { ...value, sourceWindowCatalog: catalogFor(input).coverage.sourceWindowCatalog } });
const emptyRecall = () => ({ ok: true, value: { memories: [], namespaces: [
  { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } });
const fakeCore = (patch = {}) => ({
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture: (input) => captureValue(input), recall: emptyRecall,
  get: () => { throw new Error('no selected memory'); }, ...patch,
});
const options = (patch = {}) => ({ history: history(), question: { ...question }, namespace: { ...namespace },
  core: fakeCore(), answer: async () => ({ text: 'Friday' }), countTokens: (text) => text.length,
  answerModel: 'synthetic-answer-v1', limits: { ...limits }, ...patch });

test('I1/I2 fixed-base legacy golden plan and answer request remain unchanged', async () => {
  const id = 'indexed-window-golden';
  const q = opaqueQuestionId(id);
  const source = { question_id: q, sessions: [{ session_index: 0,
    session_id: opaqueSessionId(id, 0), date: 'Tuesday', turns: [{
      turn_id: stableTurnIdV2(id, 0, 0), role: 'user', content: '  Alpha Å  ',
    }] }] };
  const ns = { ownerId: 'indexed-window-tests', scope: 'project', projectId: q };
  const legacy = planLongMemEvalCase({ history: source, namespace: ns });
  assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
    '65173aebf1617f97272d495b831e1a4a2233d2652e7458f70fb23674d9baae9b');
  assert.deepEqual(Object.keys(legacy), ['schemaVersion', 'questionId', 'namespace', 'executable',
    'sourceTurns', 'blockers', 'batches', 'summary', 'limits']);
  assert.equal(legacy.batches[0].captureInput.eventId,
    'lme-event-4b5e4434b6e5fb903f14b73a22f6658ecfc8ffd5169d5809c6bfe971942986ba');
  assert.equal(legacy.batches[0].captureInput.messages[0].id,
    'lme-message-38becc6acf7a6529245f931775e418708c0d8973beb191a7e1d68afac3217f16');
  assert.equal(legacy.batches[0].normalizedCapture.payloadDigest,
    '9199ade51f702bce3ef94fb648ff27fddc9b2cded3d6633bc93aa932a1ca7e15');
  const indexed = planIndexedWindowLongMemEvalCase({ history: source, namespace: ns });
  assert.equal(indexed.schemaVersion, INDEXED_WINDOW_INGESTION_PLAN_SCHEMA_VERSION);
  assert.deepEqual(indexed.batches[0].captureInput, legacy.batches[0].captureInput);
  assert.deepEqual(indexed.batches[0].sourceMap, legacy.batches[0].sourceMap);
  assert.notEqual(indexed.batches[0].normalizedCapture.payloadDigest,
    legacy.batches[0].normalizedCapture.payloadDigest);
  assert.equal(indexed.captureQualification, 'source-bound-v2');
  assert.equal(indexed.captureSourcePolicy, 'indexed-windows-v1');

  const requests = [];
  const run = await runPublicComparison(options({ history: source,
    question: { question_id: q, text: 'Which symbol?', date: 'Saturday' }, namespace: ns,
    core: fakeCore({ list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
      capture: () => ({ ok: true, value: { duplicate: false,
        admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
        classification: { status: 'skipped', reason: 'empty' } } }),
      recall: () => ({ ok: true, value: { memories: [], namespaces: [
        { namespace: ns, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } }) }),
    answer: async ({ request }) => { requests.push(request); return { text: 'Å' }; } }));
  assert.equal(run.schemaVersion, 'cairn-longmemeval-public-comparison-v1');
  assert.deepEqual(requests[0], { model: 'synthetic-answer-v1',
    messages: [{ role: 'system', content: PUBLIC_ANSWER_INSTRUCTION }, { role: 'user',
      content: JSON.stringify({ question: { text: 'Which symbol?', date: 'Saturday' }, evidence: [] }) }],
    temperature: 0, max_tokens: 50, n: 1 });
  assert.equal(createHash('sha256').update(JSON.stringify(requests[0])).digest('hex'),
    'a5d529c440f53f3567c60d5d2f6ceaf1107fcb96909b7287ffc3da9c3049e138');
});

test('I2/I3 indexed digest, exact catalog success envelope, empty/duplicate/processing/partial/failure', async () => {
  const source = history();
  const plan = planIndexedWindowLongMemEvalCase({ history: source, namespace });
  const batch = plan.batches[0];
  assert.equal(plan.executable, true);
  assert.deepEqual(batch.indexedWindows.map((window) => window.content), ['x'.repeat(800), tail]);
  assert.equal(batch.normalizedCapture.payloadDigest,
    captureSnapshot(batch.captureInput, 'source-bound-v2', 'indexed-windows-v1').payloadDigest);
  assert.deepEqual(batch.sourceWindowCatalog, { version: 1, maxUnitsPerWindow: 800,
    messageCount: 1, windowCount: 2, semanticCoverage: 'unassessed' });
  const attempt = (capture) => ingestIndexedWindowLongMemEvalCase({ history: source, namespace, capture });
  const completed = await attempt((input) => captureValue(input));
  assert.equal(completed.outcomes[0].status, 'completed');
  assert.deepEqual(completed.outcomes[0].sourceWindowCatalog, batch.sourceWindowCatalog);
  assert.deepEqual(completed.outcomes[0].result.sourceWindowCatalog, batch.sourceWindowCatalog);
  const duplicate = await attempt((input) => captureValue(input,
    { duplicate: true, memoryIds: [], suppressedCount: 0 }));
  assert.equal(duplicate.outcomes[0].status, 'duplicate');
  assert.deepEqual(duplicate.outcomes[0].sourceWindowCatalog, batch.sourceWindowCatalog);
  const processing = await attempt((input) => captureValue(input, { processing: true }));
  assert.equal(processing.outcomes[0].status, 'unknown');
  assert.equal(processing.outcomes[0].error.code, 'capture_processing');
  assert.deepEqual(processing.outcomes[0].sourceWindowCatalog, batch.sourceWindowCatalog);
  const partial = await attempt((input) => captureValue(input, { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'failed', error: { code: 'customer_secret', retryable: true } } }));
  assert.equal(partial.outcomes[0].status, 'partial');
  assert.deepEqual(partial.outcomes[0].sourceWindowCatalog, batch.sourceWindowCatalog);
  assert.equal(partial.outcomes[0].result.classification.error.code, 'classification_failed');
  const failed = await attempt(() => ({ ok: false, error: { code: 'invalid_input', retryable: false } }));
  assert.equal(failed.outcomes[0].status, 'failed');
  assert.equal(Object.hasOwn(failed.outcomes[0], 'sourceWindowCatalog'), false);
  const failureWithSuccessMetadata = await attempt((input) => ({ ok: false,
    error: { code: 'invalid_input', retryable: false },
    sourceWindowCatalog: catalogFor(input).coverage.sourceWindowCatalog }));
  assert.equal(failureWithSuccessMetadata.outcomes[0].error.code, 'malformed_capture_response');
  const legacy = await ingestLongMemEvalCase({ history: source, namespace,
    capture: (input) => captureValue(input) });
  assert.equal(legacy.outcomes[0].status, 'unknown');
  assert.equal(legacy.outcomes[0].error.code, 'malformed_capture_response');
});

test('I3 malformed or inconsistent indexed metadata never promotes success', async () => {
  for (const mutate of [
    (value) => { delete value.sourceWindowCatalog; },
    (value) => { value.sourceWindowCatalog.windowCount++; },
    (value) => { value.sourceWindowCatalog.extra = true; },
    (value) => { value.sourceWindowCatalog.semanticCoverage = 'assessed'; },
    (value) => { value.extra = true; },
    (value) => { value.sourceWindowCatalog = null; },
  ]) {
    const result = await ingestIndexedWindowLongMemEvalCase({ history: history(), namespace,
      capture: (input) => {
        const response = structuredClone(captureValue(input));
        mutate(response.value);
        return response;
      } });
    assert.equal(result.outcomes[0].status, 'unknown');
    assert.equal(result.outcomes[0].error.code, 'malformed_capture_response');
  }
  for (const value of [{ processing: true }, { duplicate: true, memoryIds: [], suppressedCount: 0 }]) {
    const result = await ingestIndexedWindowLongMemEvalCase({ history: history(), namespace,
      capture: () => ({ ok: true, value }) });
    assert.equal(result.outcomes[0].status, 'unknown');
    assert.equal(result.outcomes[0].error.code, 'malformed_capture_response');
  }
});

test('I2/I3 unrepresentable catalog stops all capture and later batches stay not_run after partial', async () => {
  const unsafe = history(['a'.repeat(800) + '[REDACTED]']);
  const plan = planIndexedWindowLongMemEvalCase({ history: unsafe, namespace });
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.blockers.map((item) => item.code), ['indexed_window_preflight_failed']);
  assert.equal(plan.batches[0].normalizedCapture.payloadDigest,
    captureSnapshot(plan.batches[0].captureInput, 'source-bound-v2', 'indexed-windows-v1').payloadDigest);
  let calls = 0;
  const blocked = await ingestIndexedWindowLongMemEvalCase({ history: unsafe, namespace,
    capture: () => { calls++; throw new Error('must not call'); } });
  assert.equal(calls, 0);
  assert.equal(blocked.outcomes[0].status, 'not_run');

  const many = history(Array.from({ length: 26 }, (_, index) => `Turn ${index}.`));
  const two = planIndexedWindowLongMemEvalCase({ history: many, namespace });
  assert.equal(two.batches.length, 2);
  const partial = await ingestIndexedWindowLongMemEvalCase({ history: many, namespace,
    capture: (input) => { calls++; return captureValue(input, { duplicate: false,
      admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'failed', error: { code: 'classification_failed', retryable: false } } }); } });
  assert.equal(calls, 1);
  assert.deepEqual(partial.outcomes.map((item) => item.status), ['partial', 'not_run']);
  assert.equal(partial.plan.summary.plannedBatchCount, 2);
  assert.equal(partial.plan.summary.plannedMessageCount, 26);
  const failed = await ingestIndexedWindowLongMemEvalCase({ history: many, namespace,
    capture: () => ({ ok: false, error: { code: 'invalid_input', retryable: false } }) });
  assert.deepEqual(failed.outcomes.map((item) => item.status), ['failed', 'not_run']);
});

test('I3 caller mutation while awaiting cannot change later indexed batch inputs or catalog', async () => {
  const source = history(Array.from({ length: 26 }, (_, index) => `Original turn ${index}.`));
  const original = planIndexedWindowLongMemEvalCase({ history: source, namespace });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = [];
  const running = ingestIndexedWindowLongMemEvalCase({ history: source, namespace,
    capture: async (input) => { seen.push(structuredClone(input));
      if (seen.length === 1) await gate;
      return captureValue(input); } });
  await new Promise((resolve) => setImmediate(resolve));
  source.sessions[0].turns[25].content = 'MUTATED';
  release();
  const result = await running;
  assert.deepEqual(seen.map((input) => input.messages), original.batches.map((batch) => batch.captureInput.messages));
  assert.deepEqual(result.outcomes.map((item) => item.status), ['completed', 'completed']);
  assert.deepEqual(result.outcomes[1].sourceWindowCatalog, original.batches[1].sourceWindowCatalog);
});

const sourceCore = (mutateGet = () => {}, mutateRecall = () => {}, legacyCapture = false,
  observed = []) => {
  let captured;
  return fakeCore({
    capture: (input) => { captured = input; return legacyCapture ? { ok: true, value: {
      duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'skipped', reason: 'empty' } } } : captureValue(input); },
    recall: () => {
      observed.push('recall');
      const excerpt = catalogFor(captured).entries[1].content;
      const value = { memories: [{ memory: { id: 'memory', revision: 1, currentness: 'current' },
        receipts: [{ id: 'receipt', role: 'user', excerpt }], receiptCount: 1,
        interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }],
      namespaces: [{ namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' };
      mutateRecall(value);
      return { ok: true, value };
    },
    get: () => {
      observed.push('get');
      const value = { memory: { id: 'memory', revision: 1, namespace: { ...namespace },
        state: 'active', receiptCount: 1 }, receipts: [{ id: 'receipt', eventId: captured.messages[0].id,
          sessionId: captured.sessionId, client: captured.client, role: 'user', excerpt: tail }],
      exhausted: true, nextReceiptCursor: null };
      mutateGet(value);
      return { ok: true, value };
    },
  });
};

test('I4/I5 exact tail membership enables only indexed answer and scorer refuses new schema', async () => {
  const requests = [];
  const run = await runIndexedWindowPublicComparison(options({ core: sourceCore(),
    answer: async ({ request }) => { requests.push(request); return { text: 'Friday' }; } }));
  assert.equal(run.schemaVersion, INDEXED_WINDOW_PUBLIC_COMPARISON_SCHEMA_VERSION);
  assert.equal(run.captureSourcePolicy, 'indexed-windows-v1');
  assert.equal(run.captureQualification, 'source-bound-v2');
  assert.equal(run.semanticCoverage, 'unassessed');
  assert.equal(run.interpretation,
    'offline-indexed-window-provenance-not-a-balanced-paid-comparator-or-semantic-score');
  assert.deepEqual(run.arms.map((arm) => arm.status), ['completed', 'completed', 'completed'],
    JSON.stringify(run.arms[0]));
  assert.equal(JSON.parse(requests[0].messages[1].content).evidence[0].receipts[0].excerpt, tail);
  assert.equal(run.arms[0].diagnostics.ingestion.outcomes[0].sourceWindowCatalog.windowCount, 2);
  assert.deepEqual(Object.keys(JSON.parse(requests[0].messages[1].content).evidence[0]),
    ['memoryId', 'revision', 'receipts']);
  let judges = 0;
  await assert.rejects(scorePublicComparison({ run, evaluator: { question_id: questionId },
    judge: async () => { judges++; return { text: 'yes' }; } }), { code: 'invalid_run' });
  assert.equal(judges, 0);

  const oldCalls = [];
  const old = await runPublicComparison(options({ core: sourceCore(() => {}, () => {}, true, oldCalls) }));
  assert.equal(old.arms[0].status, 'blocked');
  assert.equal(old.arms[0].reason, 'unknown_or_mismatched_receipt');
  assert.equal(old.arms[0].diagnostics.stage, 'provenance');
  assert.deepEqual(oldCalls, ['recall', 'get']);
});

test('I4 every forged source or noncanonical passage blocks indexed Cairn before its answer', async () => {
  const cases = [
    [(get) => { get.memory.namespace.ownerId = 'foreign'; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.memory.revision++; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.memory.state = 'historical'; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.receipts[0].sessionId = 'foreign'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].eventId = 'foreign'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].role = 'assistant'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].client = 'foreign'; }, () => {}, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].excerpt = 'launch is Friday'; },
      (recall) => { recall.memories[0].receipts[0].excerpt = 'launch is Friday'; }, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].excerpt = 'x'.repeat(800) + tail; },
      (recall) => { recall.memories[0].receipts[0].excerpt = 'x'.repeat(800) + tail; }, 'unknown_or_mismatched_receipt'],
    [(get) => { get.receipts[0].excerpt = 'x'.repeat(800); }, () => {}, 'unknown_or_mismatched_receipt'],
    [(get) => { get.exhausted = false; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.receipts = []; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.receipts.push({ ...get.receipts[0], id: 'extra' }); }, () => {}, 'source_get_mismatch'],
    [(get) => { get.memory.receiptCount = 2; }, () => {}, 'source_get_mismatch'],
    [(get) => { get.receipts.push({ ...get.receipts[0] }); get.memory.receiptCount = 2; },
      (recall) => { recall.memories[0].receiptCount = 2;
        recall.memories[0].receipts.push({ ...recall.memories[0].receipts[0] }); }, 'duplicate_receipt'],
  ];
  for (const [mutateGet, mutateRecall, reason] of cases) {
    let answers = 0;
    const run = await runIndexedWindowPublicComparison(options({ core: sourceCore(mutateGet, mutateRecall),
      answer: async () => { answers++; return { text: 'Friday' }; } }));
    assert.equal(run.arms[0].status, 'blocked', reason);
    assert.equal(run.arms[0].reason, reason);
    assert.equal(answers, 2, reason);
  }
});

test('I6 real opt-in core cold restart carries mixed-role canonical tail into answer, not memory text', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-indexed-provenance-'));
  const path = join(root, 'memory.sqlite');
  let core, cold;
  t.after(() => { core?.close(); cold?.close(); rmSync(root, { recursive: true, force: true }); });
  const secret = 'sk-' + 'a'.repeat(48);
  const raw = 'x'.repeat(800) + `Ｆｒｉｄａｙ ${secret} is the launch day.`;
  const source = history([raw, 'Assistant confirms the schedule.']);
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: 'GENERATED_SUMMARY_POISON', kind: 'context', confidence: 0.9,
      sourceIndices: [0, input.messages.findIndex((entry) => entry.content.includes('Friday')),
        input.messages.findIndex((entry) => entry.content.includes('Assistant confirms'))] }] }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map((entry) => ({ itemIndex: entry.itemIndex,
      subject: { value: null, evidenceIndices: [] }, property: { value: null, evidenceIndices: [] },
      scope: { value: null, evidenceIndices: [] }, applies: { value: null, evidenceIndices: [] },
      value: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
      attribution: { value: 'unknown', evidenceIndices: [] },
      commitment: { value: 'unknown', evidenceIndices: [] } })) }),
    classify: ({ input }) => ({ items: input.memories.map((memory) => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: 'Synthetic schedule', parentL2Ids: [] } })) }),
    select: ({ input }) => ({ refs: input.maps.flatMap((page) => page.items.map((item) =>
      item.type === 'unfiled' ? { namespaceIndex: page.namespaceIndex, ...item.ref }
        : item.type === 'ref' && item.ref.childType === 'memory'
          ? { namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId,
            revision: item.ref.childRevision } : null).filter(Boolean)) }),
    rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((entry) => ({
      namespaceIndex: entry.namespaceIndex, memoryId: entry.memory.id, revision: entry.memory.revision })) }),
  };
  core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
    captureSourcePolicy: 'indexed-windows-v1' });
  const requests = [];
  const bridge = {
    list: (...args) => core.list(...args),
    capture: async (input) => { const response = await core.capture(input); core.close(); core = null;
      cold = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
        captureSourcePolicy: 'indexed-windows-v1' }); return response; },
    recall: (...args) => cold.recall(...args), get: (...args) => cold.get(...args),
  };
  const run = await runIndexedWindowPublicComparison(options({ history: source, core: bridge,
    answer: async ({ request }) => { requests.push(request); return { text: 'Friday' }; } }));
  assert.deepEqual(run.arms.map((arm) => arm.status), ['completed', 'completed', 'completed'],
    JSON.stringify(run.arms[0]));
  const evidence = JSON.parse(requests[0].messages[1].content).evidence;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].receipts.length, 3);
  assert.ok(evidence[0].receipts.some((receipt) => receipt.excerpt.includes('Friday [REDACTED]')));
  assert.ok(evidence[0].receipts.some((receipt) => receipt.role === 'assistant'));
  const sameMessage = evidence[0].receipts.filter((receipt) => receipt.role === 'user');
  assert.equal(sameMessage.length, 2);
  assert.notEqual(sameMessage[0].excerpt, sameMessage[1].excerpt);
  assert.deepEqual(sameMessage.map((receipt) => receipt.source.turnId),
    [source.sessions[0].turns[0].turn_id, source.sessions[0].turns[0].turn_id]);
  const listed = cold.list({ namespace, statuses: ['filed', 'unfiled'], limit: 1 });
  assert.equal(listed.ok, true);
  const detail = cold.get({ namespace, memoryId: listed.value.memories[0].id, receiptLimit: 100 });
  assert.equal(detail.ok, true);
  const userReceipts = detail.value.receipts.filter((receipt) => receipt.role === 'user');
  assert.equal(userReceipts.length, 2);
  assert.equal(new Set(userReceipts.map((receipt) => receipt.id)).size, 2);
  assert.equal(new Set(userReceipts.map((receipt) => receipt.eventId)).size, 1);
  assert.ok(!requests[0].messages[1].content.includes(secret));
  assert.ok(!requests[0].messages[1].content.includes('GENERATED_SUMMARY_POISON'));
});
