import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../../longmemeval/prepare.mjs';
import { runQualifiedSourcePair } from '../../longmemeval/public-comparison.mjs';
import { scoreQualifiedSourcePair } from '../../longmemeval/qualified-source-scoring.mjs';
import { projectSourcePairCase } from '../../longmemeval/source-pair-preparation.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';

test('R3 actual scripted cores and adapter stay within source-derived two-arm route ceilings', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-source-pair-projection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceId = 'projection-actual-adapter-synthetic';
  const questionId = opaqueQuestionId(sourceId);
  const sessionId = opaqueSessionId(sourceId, 0);
  const history = { question_id: questionId, sessions: [{ session_index: 0,
    session_id: sessionId, date: 'Tuesday', turns: Array.from({ length: 25 }, (_, index) => ({
      turn_id: stableTurnIdV2(sourceId, 0, index), role: index % 2 ? 'assistant' : 'user',
      content: index === 24 ? 'Friday is the day.' : `Synthetic turn ${index}.`,
    })) }] };
  const data = { history, question: { question_id: questionId, text: 'Which day?', date: 'Saturday' },
    namespace: { ownerId: 'source-pair-projection', scope: 'project', projectId: questionId },
    answerModel: 'synthetic-answer', limits: { contextWindow: 100_000, outputTokens: 50,
      answerTimeoutMs: 15_000, recallLimit: 6 }, armOrder: ['indexed-windows', 'qualified-prefix'] };
  const projection = projectSourcePairCase({ ...data, reservations: {
    cairnCount: 5_000, cairnGeneration: 5_000, answer: 50_820, judge: 10_400 } });
  assert.deepEqual(projection.batchCounts, { qualifiedPrefix: 2, indexedWindows: 2 });
  const calls = { cairnCount: 0, cairnGeneration: 0, answer: 0, judge: 0 };
  const methods = [];
  const qualificationInputs = [];
  let extractionOrdinal = 0;
  const answerRequests = [];
  const empty = { value: null, evidenceIndices: [] };
  const unknown = { value: 'unknown', evidenceIndices: [] };
  const sourceOutput = (body) => {
    const method = body.text.format.name.replace(/^cairn_/u, '');
    methods.push(method);
    const input = JSON.parse(body.input[0].content[0].text);
    if (method === 'extract') return { items: [{ content: `GENERATED_SUMMARY_POISON_${++extractionOrdinal}`,
      kind: 'context', confidence: 0.9, sourceIndices: [0] }] };
    if (method === 'qualifyCandidates') {
      qualificationInputs.push(input.items.map((entry) => entry.candidates.length));
      return qualificationPoolWire(input, { qualifications:
      input.items.map((entry) => ({ itemIndex: entry.itemIndex,
        subject: empty, property: empty, scope: empty, applies: empty,
        value: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
        attribution: unknown, commitment: unknown })) });
    }
    if (method === 'classify') {
      const existing = input.map.find((item) => item.type === 'moc' && item.moc.level === 'L1');
      return { items: input.memories.map((memory) => ({ memoryId: memory.id,
        parentIds: existing ? [existing.moc.id] : [],
        ...(existing ? {} : { newL1: { title: 'Synthetic schedule', parentL2Ids: [] } }),
      })) };
    }
    if (method === 'select') return { refs: input.maps.flatMap((page) => page.items.map((item) =>
      item.type === 'unfiled' ? { namespaceIndex: page.namespaceIndex, ...item.ref }
        : item.type === 'ref' && item.ref.childType === 'memory'
          ? { namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId,
            revision: item.ref.childRevision } : null).filter(Boolean)) };
    if (method === 'rank') return { refs: input.candidates.slice(0, input.limit).map((entry) => ({
      namespaceIndex: entry.namespaceIndex, memoryId: entry.memory.id,
      revision: entry.memory.revision })) };
    return assert.fail(`unexpected model method ${method}`);
  };
  const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: (url, options) => {
    if (url.endsWith('/input_tokens')) {
      calls.cairnCount++;
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    }
    assert.ok(url.endsWith('/responses'));
    calls.cairnGeneration++;
    const body = JSON.parse(options.body);
    const output = sourceOutput(body);
    return Response.json({ id: 'synthetic', object: 'response', model: body.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'synthetic-message', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  } });
  const cores = {};
  const captureErrors = [];
  for (const [name, key, sourcePolicy] of [['qualified-prefix', 'qualifiedPrefix', undefined],
    ['indexed-windows', 'indexedWindows', 'indexed-windows-v1']]) {
    const core = openMemoryCore({ path: join(root, `${name}.sqlite`), model,
      captureQualification: 'source-bound-v2',
      ...(sourcePolicy ? { captureSourcePolicy: sourcePolicy } : {}) });
    t.after(() => core.close());
    cores[key] = { list: core.list.bind(core), recall: core.recall.bind(core), get: core.get.bind(core),
      capture: async (input) => {
        const result = await core.capture(input);
        if (!result.ok) captureErrors.push({ name, code: result.error.code });
        return result;
      } };
  }
  const execution = { withCaseScope: (_identity, operation) => operation({ snapshot: () => ({
    version: 'case-deadline-scope-v1', phase: _identity.phase, caseId: _identity.caseId,
    status: 'active' }) }), isHalted: () => false };
  const run = await runQualifiedSourcePair({ ...data, cores, countTokens: model.countTokens.bind(model),
    answer: async ({ request }) => { calls.answer++; answerRequests.push(request);
      return { text: 'Friday' }; }, execution });
  assert.equal(run.executionStatus, 'completed');
  assert.deepEqual(run.arms.map((arm) => arm.status), ['completed', 'completed'],
    JSON.stringify({ arms: run.arms, methods, calls, qualificationInputs, captureErrors }));
  assert.deepEqual(captureErrors, []);
  assert.deepEqual(qualificationInputs, [[1], [1], [1], [1]]);
  const scored = await scoreQualifiedSourcePair({ run, expectedProtocol: projection.protocol,
    evaluator: { question_id: questionId, source_question_id: sourceId,
      question_type: 'single-session-user', reference_answer: 'Friday',
      answer_session_ids: [sessionId], turn_labels: [] }, execution, judgeTimeoutMs: 15_000,
    judge: async () => { calls.judge++; return { text: 'yes' }; } });
  assert.equal(scored.executionStatus, 'completed');
  for (const [route, count] of Object.entries(calls)) {
    assert.ok(count <= projection.upperCounts[route], `${route}: ${count} exceeds projected ceiling`);
  }
  assert.ok(calls.cairnCount > 0);
  assert.ok(calls.cairnGeneration > 0);
  for (const method of ['extract', 'qualifyCandidates', 'classify', 'select', 'rank']) {
    assert.ok(methods.includes(method), `actual adapter did not exercise ${method}`);
  }
  assert.equal(calls.answer, 2);
  assert.equal(calls.judge, 2);
  assert.equal(answerRequests.length, 2);
  for (const request of answerRequests) {
    const evidence = JSON.parse(request.messages[1].content).evidence;
    assert.ok(evidence.length > 0);
    assert.ok(evidence.some((item) => item.receipts.some((receipt) => receipt.role === 'user')));
    assert.equal(JSON.stringify(evidence).includes('GENERATED_SUMMARY_POISON'), false);
  }
  assert.ok(Object.values(calls).reduce((sum, count) => sum + count, 0) <= projection.total.requests);
});
