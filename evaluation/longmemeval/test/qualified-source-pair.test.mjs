import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot, retainedSourceView } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { scorePublicComparison } from '../official-scoring.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../prepare.mjs';
import { qualifiedSourcePairProtocol, runQualifiedSourcePair } from '../public-comparison.mjs';

// These literals come from the independent, accepted-plan oracle, not the
// protocol implementation under test.
const sourceId = 'qualified-source-pair-golden';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'qualified-source-pair-tests', scope: 'project', projectId: questionId };
const question = { question_id: questionId, text: 'Which day?', date: 'Saturday' };
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 200, recallLimit: 6 };
const order = ['qualified-prefix', 'indexed-windows'];
const source = (contents = ['x'.repeat(800) + 'Tail Friday.', '  Å  ']) => ({ question_id: questionId,
  sessions: [{ session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday',
    turns: contents.map((content, index) => ({ turn_id: stableTurnIdV2(sourceId, 0, index),
      role: index % 2 ? 'assistant' : 'user', content })) }] });
const config = (patch = {}) => ({ history: source(), question: { ...question }, namespace: { ...namespace },
  answerModel: 'synthetic-answer-v1', limits: { ...limits }, armOrder: [...order], ...patch });
const metadata = (name, input) => name === 'qualified-prefix'
  ? { retainedSourceWindow: retainedSourceView(captureSnapshot(input, 'source-bound-v2')).retainedSourceWindow }
  : { sourceWindowCatalog: sourceWindowCatalog(captureSnapshot(input, 'source-bound-v2',
    'indexed-windows-v1')).coverage.sourceWindowCatalog };
const capturedOk = (name, input) => ({ ok: true, value: { duplicate: false,
  admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
  classification: { status: 'skipped', reason: 'empty' }, ...metadata(name, input) } });
const emptyRecall = () => ({ ok: true, value: { memories: [], namespaces: [
  { namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } });
const fakeCore = (name, record = [], patch = {}) => ({
  list: () => { record.push(`${name}:list`); return { ok: true,
    value: { memories: [], nextCursor: null, exhausted: true } }; },
  capture: (input) => { record.push(`${name}:capture`); return capturedOk(name, input); },
  recall: () => { record.push(`${name}:recall`); return emptyRecall(); },
  get: () => { record.push(`${name}:get`); throw new Error('no memory'); }, ...patch,
});
const scriptedExecution = (record = [], patch = {}) => ({
  withCaseScope: async (identity, operation) => {
    record.push(identity.caseId);
    return operation({ snapshot: () => ({ version: 'case-deadline-scope-v1', phase: identity.phase,
      caseId: identity.caseId, status: 'active' }) });
  }, isHalted: () => false, ...patch,
});
const runner = (patch = {}) => {
  const record = [];
  const executions = [];
  const requests = [];
  return { record, executions, requests, options: { ...config(),
    cores: { qualifiedPrefix: fakeCore('qualified-prefix', record),
      indexedWindows: fakeCore('indexed-windows', record) },
    answer: async ({ request }) => { requests.push(request); return { text: 'Friday' }; },
    countTokens: () => 1, execution: scriptedExecution(executions), ...patch } };
};

test('N1/N2 independent canonical protocol golden and source-binding mutations', () => {
  const protocol = qualifiedSourcePairProtocol(config());
  assert.deepEqual(Object.keys(protocol), ['schemaVersion', 'questionId', 'question', 'namespace',
    'answerModel', 'templateVersion', 'limits', 'armOrder', 'captureQualification',
    'historyDigest', 'sourceMapDigest', 'arms', 'digest']);
  assert.equal(protocol.digest, '2ba041c482a625d184d3398da8b4993c1dc2aeb5bf01203f69a01880668ee905');
  assert.equal(protocol.historyDigest, '8ee8a1822a7ed1dc07d7ac1cf003b62a948f11e8c1dbdde04b3983f036974912');
  assert.equal(protocol.sourceMapDigest, 'af5091f3e9a73005f13d6899a9c08d7fbb7d30b266f205407a7f68ac1bc820d3');
  assert.deepEqual(protocol.arms.map((arm) => arm.scopeId), [
    'lme-case-7630a3b6278161b397c12bd3cadddf9703b06fe04ae0c65855d3ca96abf340b7',
    'lme-case-dfdc699668e6b09c250ff66abc86846bae782cc8203898036c757bc3fb62ddc7']);
  assert.deepEqual(protocol.arms.map((arm) => arm.payloadDigests), [
    ['3bb47431d1806c27fd882833a49c0b5a12b215f92d1015106fedd19acb6ec6aa'],
    ['2b7b5a83c38a63b45898e4ffbfb37199ae4849efa9fce2e244089780b30a2eeb']]);
  assert.equal(Object.isFrozen(protocol.arms[0].payloadDigests), true);
  const variants = [
    config({ history: source(['x'.repeat(800) + 'Tail Monday.', '  Å  ']) }),
    config({ question: { ...question, date: 'Sunday' } }),
    config({ armOrder: [...order].reverse() }),
    config({ limits: { ...limits, outputTokens: 51 } }),
  ];
  for (const variant of variants)
    assert.notEqual(qualifiedSourcePairProtocol(variant).digest, protocol.digest);
  const reordered = config({ question: { date: 'Saturday', text: 'Which day?', question_id: questionId },
    namespace: { projectId: questionId, scope: 'project', ownerId: namespace.ownerId },
    limits: { recallLimit: 6, answerTimeoutMs: 200, outputTokens: 50, contextWindow: 100_000 } });
  assert.equal(qualifiedSourcePairProtocol(reordered).digest, protocol.digest);
});

test('N1 closed options, detached data and callbacks refuse label/same-core/accessor drift', async () => {
  let calls = 0;
  const base = runner();
  const same = base.options.cores.qualifiedPrefix;
  await assert.rejects(runQualifiedSourcePair({ ...base.options,
    cores: { qualifiedPrefix: same, indexedWindows: same } }), { code: 'invalid_options' });
  for (const invalid of [
    { ...base.options, referenceAnswer: 'Friday' },
    { ...base.options, answerTemplateVersion: 'cairn-longmemeval-public-answer-v2' },
    { ...base.options, question: { ...question, label: 'secret' } },
    { ...base.options, limits: { ...limits, extra: 1 } },
    { ...base.options, armOrder: [order[0], order[0]] },
    { ...base.options, execution: { ...base.options.execution, extra: true } },
  ]) await assert.rejects(runQualifiedSourcePair(invalid), { code: /invalid_/ });
  assert.equal(base.record.length, 0);
  const driftFixture = runner();
  const drifting = { ...driftFixture.options };
  let reads = 0;
  Object.defineProperty(drifting, 'answerModel', { enumerable: true, get: () => {
    reads++; return reads === 1 ? 'model-A' : 'model-B'; } });
  const run = await runQualifiedSourcePair(drifting);
  assert.equal(reads, 1);
  assert.equal(run.protocol.answerModel, 'model-A');
  assert.equal(run.arms[0].status, 'completed');
  assert.equal(run.arms[0].diagnostics.preflight.fits, true);
  assert.deepEqual(driftFixture.requests.map((request) => request.model), ['model-A', 'model-A']);
  const invalidQuestion = { ...config() };
  Object.defineProperty(invalidQuestion, 'question', { enumerable: true, get: () => {
    calls++; return calls === 1 ? { ...question, extra: 'reject' } : { ...question }; } });
  assert.throws(() => qualifiedSourcePairProtocol(invalidQuestion), { code: 'invalid_question' });
  assert.equal(calls, 1);
});

test('N3/N4 both orders execute only two qualified arms with common V2 requests and scoped IDs', async () => {
  for (const armOrder of [order, [...order].reverse()]) {
    const fixture = runner({ armOrder });
    const run = await runQualifiedSourcePair(fixture.options);
    assert.equal(run.executionStatus, 'completed');
    assert.equal(run.haltReason, null);
    assert.deepEqual(run.attemptedOrder, armOrder);
    assert.deepEqual(run.arms.map((arm) => [arm.name, arm.status]),
      order.map((name) => [name, 'completed']));
    assert.equal(fixture.requests.length, 2);
    assert.equal(fixture.executions.length, 2);
    assert.deepEqual(fixture.executions, armOrder.map((name) =>
      run.protocol.arms.find((arm) => arm.name === name).scopeId));
    assert.deepEqual(fixture.record.filter((entry) => entry.endsWith(':capture')),
      armOrder.map((name) => `${name}:capture`));
    for (const request of fixture.requests) {
      assert.equal(request.model, 'synthetic-answer-v1');
      assert.equal(request.messages[0].role, 'system');
      assert.deepEqual(Object.keys(JSON.parse(request.messages[1].content)), ['evidence', 'currentQuestion']);
      assert.deepEqual(JSON.parse(request.messages[1].content).currentQuestion,
        { text: question.text, date: question.date });
    }
    let judges = 0;
    await assert.rejects(scorePublicComparison({ run, evaluator: { question_id: questionId },
      judge: () => { judges++; return { text: 'yes' }; } }), { code: 'invalid_run' });
    assert.equal(judges, 0);
    assert.equal(Object.isFrozen(run.arms[0]), true);
  }
});

test('N4/N5 halted wrapper failures preserve earlier arm and never schedule another', async () => {
  for (const when of ['before', 'inside', 'after', 'no-invoke', 'double']) {
    const fixture = runner();
    let entered = 0;
    fixture.options.execution = scriptedExecution([], { withCaseScope: async (identity, operation) => {
      entered++;
      if (entered === 2 && when === 'before') throw new Error('private schedule mismatch');
      if (entered === 2 && when === 'no-invoke') return null;
      const handle = { snapshot: () => ({ version: 'case-deadline-scope-v1', phase: 'generation',
        caseId: identity.caseId, status: 'active' }) };
      if (entered === 2 && when === 'inside') return operation({ snapshot: () => { throw new Error('private'); } });
      const result = await operation(handle);
      if (entered === 2 && when === 'after') throw new Error('private boundary');
      if (entered === 2 && when === 'double') await operation(handle);
      return result;
    } });
    const run = await runQualifiedSourcePair(fixture.options);
    assert.equal(run.executionStatus, 'halted', when);
    assert.equal(run.arms[0].status, 'completed', when);
    assert.equal(run.arms[1].status, when === 'before' || when === 'no-invoke' ? 'blocked' : 'failed', when);
    assert.equal(run.arms[1].answer, null);
    assert.equal(run.attemptedOrder.length, when === 'before' || when === 'no-invoke' ? 1 : 2);
    assert.equal(JSON.stringify(run).includes('private'), false);
  }
});

test('N4 wrapper returning early fences parked capture and rejects operation invoked later', async () => {
  let release;
  const captureGate = new Promise((resolve) => { release = resolve; });
  let entered;
  const captureEntered = new Promise((resolve) => { entered = resolve; });
  const fixture = runner();
  const original = fixture.options.cores.qualifiedPrefix.capture;
  fixture.options.cores.qualifiedPrefix.capture = async (input) => {
    entered();
    await captureGate;
    return original(input);
  };
  let lateOperation;
  let lateHandle;
  fixture.options.execution = scriptedExecution([], { withCaseScope: (identity, operation) => {
    lateOperation = operation;
    lateHandle = { snapshot: () => ({ version: 'case-deadline-scope-v1', phase: 'generation',
      caseId: identity.caseId, status: 'active' }) };
    void operation(lateHandle);
    return captureEntered.then(() => null);
  } });
  const run = await runQualifiedSourcePair(fixture.options);
  assert.equal(run.executionStatus, 'halted');
  assert.equal(run.haltReason, 'scope_contract_invalid');
  assert.deepEqual(run.attemptedOrder, ['qualified-prefix']);
  assert.deepEqual(fixture.record, ['qualified-prefix:list']);
  await assert.rejects(lateOperation(lateHandle), { reason: 'scope_contract_invalid' });
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fixture.record, ['qualified-prefix:list', 'qualified-prefix:capture']);
  assert.equal(fixture.requests.length, 0);

  let deferred;
  const second = runner({ execution: scriptedExecution([], { withCaseScope: (_, operation) => {
    deferred = operation;
    return null;
  } }) });
  const stopped = await runQualifiedSourcePair(second.options);
  assert.equal(stopped.haltReason, 'scope_contract_invalid');
  await assert.rejects(deferred({ snapshot: () => ({}) }), { reason: 'scope_contract_invalid' });
  assert.deepEqual(stopped.attemptedOrder, []);
  assert.equal(second.record.length, 0);
});

test('N4 local timeout isolates only while global guard stays live; malformed scope and halt stop', async () => {
  for (const status of ['timed_out', 'blocked']) {
    const fixture = runner({ execution: scriptedExecution([], { withCaseScope: async (identity, operation) =>
      operation({ snapshot: () => ({ version: 'case-deadline-scope-v1', phase: 'generation',
        caseId: identity.caseId, status: identity.caseId.endsWith('b7') ? status : 'active' }) }) }) });
    const run = await runQualifiedSourcePair(fixture.options);
    assert.equal(run.executionStatus, 'completed');
    assert.deepEqual(run.arms.map((arm) => arm.reason), ['case_timeout', null]);
    assert.deepEqual(fixture.record.filter((entry) => entry.startsWith('qualified-prefix')), []);
  }
  for (const mutate of [
    (identity) => ({ version: 'case-deadline-scope-v1', phase: 'generation', caseId: 'stale', status: 'active' }),
    (identity) => ({ version: 'case-deadline-scope-v1', phase: 'generation',
      caseId: identity.caseId, status: 'completed' }),
    () => { throw new Error('private'); },
  ]) {
    const fixture = runner({ execution: scriptedExecution([], { withCaseScope: async (identity, operation) =>
      operation({ snapshot: () => mutate(identity) }) }) });
    const run = await runQualifiedSourcePair(fixture.options);
    assert.equal(run.executionStatus, 'halted');
    assert.equal(run.haltReason, 'scope_contract_invalid');
    assert.equal(fixture.record.length, 0);
  }
  let halted = false;
  const fixture = runner({ execution: scriptedExecution([], { isHalted: () => halted,
    withCaseScope: async (identity, operation) => {
      const result = await operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
        phase: 'generation', caseId: identity.caseId, status: 'active' }) });
      halted = true;
      return result;
    } }) });
  const run = await runQualifiedSourcePair(fixture.options);
  assert.equal(run.haltReason, 'global_halt');
  assert.deepEqual(run.arms.map((arm) => [arm.status, arm.reason]),
    [['failed', 'global_halt'], ['blocked', 'global_halt']]);
});

test('N4 swallowed capture halt and throwing port are sticky; late answer cannot resume work', async () => {
  let halted = false;
  const fixture = runner();
  const original = fixture.options.cores.qualifiedPrefix.capture;
  fixture.options.cores.qualifiedPrefix.capture = (input) => {
    const response = original(input);
    halted = true;
    return response;
  };
  fixture.options.execution.isHalted = () => halted;
  const run = await runQualifiedSourcePair(fixture.options);
  assert.equal(run.executionStatus, 'halted');
  assert.equal(run.haltReason, 'global_halt');
  assert.deepEqual(run.attemptedOrder, ['qualified-prefix']);
  assert.equal(fixture.record.includes('qualified-prefix:recall'), false);
  assert.equal(fixture.record.some((entry) => entry.startsWith('indexed-windows')), false);
  const throwing = runner({ execution: scriptedExecution([], { isHalted: () => { throw new Error('private'); } }) });
  const invalid = await runQualifiedSourcePair(throwing.options);
  assert.equal(invalid.haltReason, 'scope_contract_invalid');
  assert.deepEqual(invalid.attemptedOrder, []);
  assert.equal(throwing.record.length, 0);

  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const timeout = runner({ limits: { ...limits, answerTimeoutMs: 5 },
    answer: async () => { calls++; if (calls === 1) return pending; return { text: 'second' }; } });
  const timed = await runQualifiedSourcePair(timeout.options);
  assert.equal(timed.executionStatus, 'completed');
  assert.deepEqual(timed.arms.map((item) => [item.status, item.reason]),
    [['failed', 'answer_timeout'], ['completed', null]]);
  release({ text: 'late' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.deepEqual(timeout.record.filter((entry) => entry.endsWith(':recall')),
    ['qualified-prefix:recall', 'indexed-windows:recall']);
});

const provenanceCore = (name, mutate = () => {}) => {
  let captured;
  const excerpt = () => name === 'qualified-prefix'
    ? retainedSourceView(captureSnapshot(captured, 'source-bound-v2')).messages[0].content
    : sourceWindowCatalog(captureSnapshot(captured, 'source-bound-v2',
      'indexed-windows-v1')).entries[1].content;
  const receipt = () => ({ id: 'source-receipt', eventId: captured.messages[0].id,
    sessionId: captured.sessionId, client: captured.client, role: 'user', excerpt: excerpt() });
  return fakeCore(name, [], {
    capture: (input) => { captured = input; return capturedOk(name, input); },
    recall: () => {
      const value = { memories: [{ memory: { id: 'memory', revision: 1, currentness: 'current' },
        receipts: [{ id: 'source-receipt', role: 'user', excerpt: excerpt() }], receiptCount: 1,
        interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' }],
      namespaces: [{ namespace: { ...namespace }, mapExhausted: true, fetchExhausted: true }],
      coverage: 'complete' };
      mutate('recall', value);
      return { ok: true, value };
    },
    get: () => {
      const value = { memory: { id: 'memory', revision: 1, namespace: { ...namespace },
        state: 'active', receiptCount: 1 }, receipts: [receipt()], exhausted: true,
      nextReceiptCursor: null };
      mutate('get', value);
      return { ok: true, value };
    },
  });
};

test('N3 exact policy-specific receipt passages only; forged provenance blocks before answer', async () => {
  for (const name of order) {
    const requests = [];
    const fixture = runner({ cores: { qualifiedPrefix: provenanceCore('qualified-prefix'),
      indexedWindows: provenanceCore('indexed-windows') },
    answer: async ({ request }) => { requests.push(request); return { text: 'answer' }; } });
    const run = await runQualifiedSourcePair(fixture.options);
    assert.deepEqual(run.arms.map((item) => item.status), ['completed', 'completed']);
    const request = requests[order.indexOf(name)];
    const evidence = JSON.parse(request.messages[1].content).evidence;
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].receipts[0].excerpt,
      name === 'qualified-prefix' ? 'x'.repeat(800) : 'Tail Friday.');
    assert.deepEqual(Object.keys(evidence[0]), ['memoryId', 'revision', 'receipts']);
  }
  const cases = [
    [(stage, value) => { if (stage === 'get') value.memory.namespace.ownerId = 'foreign'; }, 'source_get_mismatch'],
    [(stage, value) => { if (stage === 'get') value.memory.revision++; }, 'source_get_mismatch'],
    [(stage, value) => { if (stage === 'get') value.receipts[0].sessionId = 'foreign'; },
      'unknown_or_mismatched_receipt'],
    [(stage, value) => { if (stage === 'get') value.receipts[0].eventId = 'foreign'; },
      'unknown_or_mismatched_receipt'],
    [(stage, value) => { if (stage === 'get') value.receipts[0].client = 'foreign'; },
      'unknown_or_mismatched_receipt'],
    [(stage, value) => { if (stage === 'get') value.receipts[0].excerpt = 'arbitrary substring';
      else value.memories[0].receipts[0].excerpt = 'arbitrary substring'; }, 'unknown_or_mismatched_receipt'],
    [(stage, value) => { if (stage === 'get') value.exhausted = false; }, 'source_get_mismatch'],
    [(stage, value) => { if (stage === 'get') value.receipts = []; }, 'source_get_mismatch'],
  ];
  for (const [mutate, reason] of cases) {
    const requests = [];
    const run = await runQualifiedSourcePair(runner({ cores: {
      qualifiedPrefix: provenanceCore('qualified-prefix', mutate),
      indexedWindows: provenanceCore('indexed-windows', mutate) },
    answer: async ({ request }) => { requests.push(request); return { text: 'answer' }; } }).options);
    assert.deepEqual(run.arms.map((item) => [item.status, item.reason]),
      [['blocked', reason], ['blocked', reason]]);
    assert.equal(requests.length, 0);
  }
});

test('N3 both policies reject a receipt ID repeated across separate memories', async () => {
  for (const name of order) {
    const core = provenanceCore(name);
    const originalRecall = core.recall;
    const originalGet = core.get;
    core.recall = (...args) => {
      const response = originalRecall(...args);
      const duplicate = structuredClone(response.value.memories[0]);
      duplicate.memory.id = 'memory-two';
      response.value.memories.push(duplicate);
      return response;
    };
    core.get = (input) => {
      const response = originalGet(input);
      response.value.memory.id = input.memoryId;
      return response;
    };
    const cores = { qualifiedPrefix: fakeCore('qualified-prefix'),
      indexedWindows: fakeCore('indexed-windows') };
    cores[name === 'qualified-prefix' ? 'qualifiedPrefix' : 'indexedWindows'] = core;
    const run = await runQualifiedSourcePair(runner({ cores }).options);
    const result = run.arms.find((item) => item.name === name);
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'unknown_or_mismatched_receipt');
  }
});

test('N3 ingestion failures and ordinary answer failure do not schedule a hidden baseline', async () => {
  for (const response of [
    () => ({ ok: false, error: { code: 'invalid_input', retryable: false } }),
    (input) => ({ ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 0,
      ...metadata('qualified-prefix', input) } }),
    (input) => ({ ok: true, value: { duplicate: false,
      admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'failed', error: { code: 'classification_failed', retryable: false } },
      ...metadata('qualified-prefix', input) } }),
  ]) {
    const fixture = runner();
    fixture.options.cores.qualifiedPrefix.capture = response;
    const run = await runQualifiedSourcePair(fixture.options);
    assert.equal(run.executionStatus, 'completed');
    assert.equal(run.arms[0].reason, 'ingestion_incomplete');
    assert.equal(run.arms[1].status, 'completed');
    assert.equal(fixture.requests.length, 1);
  }
  const fixture = runner({ answer: async () => { throw new Error('private'); } });
  const run = await runQualifiedSourcePair(fixture.options);
  assert.deepEqual(run.arms.map((item) => [item.status, item.reason]),
    [['failed', 'answer_failed'], ['failed', 'answer_failed']]);
  assert.equal(run.executionStatus, 'completed');
});

test('N3 no full-history-fit gate; question ceiling, whole-item omission and output ceiling', async () => {
  const fullHistoryWouldNotFit = runner({ history: source(['x'.repeat(3500), 'Assistant says Å.']),
    limits: { ...limits, contextWindow: 900 }, countTokens: (text) => text.length });
  const generated = await runQualifiedSourcePair(fullHistoryWouldNotFit.options);
  assert.deepEqual(generated.arms.map((item) => item.status), ['completed', 'completed']);
  assert.equal(fullHistoryWouldNotFit.requests.length, 2);
  const tooLargeQuestion = runner({ limits: { ...limits, contextWindow: 500 },
    countTokens: () => 10_000 });
  const blocked = await runQualifiedSourcePair(tooLargeQuestion.options);
  assert.deepEqual(blocked.arms.map((item) => item.reason),
    ['question_or_framing_too_large', 'question_or_framing_too_large']);
  assert.equal(tooLargeQuestion.record.some((entry) => entry.endsWith(':capture')), false);
  assert.equal(tooLargeQuestion.requests.length, 0);

  const omittedRequests = [];
  const omitted = await runQualifiedSourcePair(runner({ cores: {
    qualifiedPrefix: provenanceCore('qualified-prefix'), indexedWindows: provenanceCore('indexed-windows') },
  limits: { ...limits, contextWindow: 650 }, countTokens: (text) => text.length,
  answer: async ({ request }) => { omittedRequests.push(request); return { text: 'answer' }; } }).options);
  assert.equal(omitted.arms[0].status, 'completed');
  assert.equal(omitted.arms[0].diagnostics.retrieval.candidateCount, 1);
  assert.equal(omitted.arms[0].diagnostics.retrieval.selectedCount, 0);
  assert.deepEqual(omitted.arms[0].diagnostics.retrieval.omitted,
    [{ memoryId: 'memory', reason: 'context_window_exceeded' }]);
  assert.deepEqual(JSON.parse(omittedRequests[0].messages[1].content).evidence, []);

  const output = runner({ answer: async () => ({ text: 'x'.repeat(51) }),
    countTokens: (text) => text.length });
  const over = await runQualifiedSourcePair(output.options);
  assert.deepEqual(over.arms.map((item) => item.reason),
    ['answer_output_too_large', 'answer_output_too_large']);
});

test('N1 snapshot ports and later batch inputs survive mutation during first await', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fixture = runner({ history: source(Array.from({ length: 26 }, (_, index) =>
    `Original turn ${index}.`)) });
  const original = fixture.options.cores.qualifiedPrefix.capture;
  let replacementCalls = 0;
  const seen = [];
  fixture.options.cores.qualifiedPrefix.capture = async (input) => {
    seen.push(structuredClone(input));
    await gate;
    return original(input);
  };
  const firstAnswer = fixture.options.answer;
  const running = runQualifiedSourcePair(fixture.options);
  await new Promise((resolve) => setImmediate(resolve));
  fixture.options.history.sessions[0].turns[25].content = 'MUTATED';
  fixture.options.answer = () => { replacementCalls++; throw new Error('replacement'); };
  fixture.options.cores.indexedWindows.capture = () => {
    replacementCalls++; throw new Error('replacement');
  };
  fixture.options.execution.withCaseScope = () => {
    replacementCalls++; throw new Error('replacement');
  };
  release();
  const run = await running;
  assert.deepEqual(run.arms.map((item) => item.status), ['completed', 'completed']);
  assert.equal(replacementCalls, 0);
  assert.equal(fixture.requests.length, 2);
  assert.deepEqual(seen.map((input) => input.messages.length), [24, 2]);
  assert.equal(seen[1].messages[1].content, 'Original turn 25.');
  assert.equal(firstAnswer instanceof Function, true);
});

const sourceModel = () => ({ contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: [{ content: 'GENERATED_SUMMARY_POISON', kind: 'context',
      confidence: 0.9, sourceIndices: input.inputMode === 'indexed-windows-v1' ? [0, 1, 2] : [0, 1] }] }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map((entry) => ({
      itemIndex: entry.itemIndex,
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
  });

test('N3 real separate stores cold reopen preserve source-only prefix versus tail and mixed role', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-pair-'));
  const close = [];
  t.after(() => { for (const core of close) core.close(); rmSync(root, { recursive: true, force: true }); });
  const secret = 'sk-' + 'a'.repeat(48);
  const history = source(['x'.repeat(800) + `Ｆｒｉｄａｙ ${secret} is the launch day.`,
    'Assistant confirms the schedule.']);
  const model = sourceModel();
  for (const armOrder of [order, [...order].reverse()]) {
    const cores = {};
    for (const [name, key, policy] of [['qualified-prefix', 'qualifiedPrefix', undefined],
      ['indexed-windows', 'indexedWindows', 'indexed-windows-v1']]) {
      const path = join(root, `${armOrder[0]}-${name}.sqlite`);
      let warm = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
        ...(policy ? { captureSourcePolicy: policy } : {}) });
      let cold;
      close.push({ close: () => { warm?.close(); cold?.close(); } });
      cores[key] = { list: (...args) => warm.list(...args),
        capture: async (input) => {
          const response = await warm.capture(input);
          warm.close(); warm = null;
          cold = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
            ...(policy ? { captureSourcePolicy: policy } : {}) });
          return response;
        }, recall: (...args) => cold.recall(...args), get: (...args) => cold.get(...args) };
    }
    const requests = [];
    const run = await runQualifiedSourcePair(runner({ history, cores, armOrder,
      answer: async ({ request }) => { requests.push(request); return { text: 'Friday' }; } }).options);
    assert.deepEqual(run.arms.map((item) => item.status), ['completed', 'completed'], JSON.stringify(run.arms));
    assert.equal(requests.length, 2);
    const prefix = JSON.parse(requests[armOrder.indexOf('qualified-prefix')].messages[1].content).evidence;
    const indexed = JSON.parse(requests[armOrder.indexOf('indexed-windows')].messages[1].content).evidence;
    assert.equal(prefix.length, 1);
    assert.equal(indexed.length, 1);
    assert.equal(prefix[0].receipts.length, 2);
    assert.equal(indexed[0].receipts.length, 3);
    assert.ok(prefix[0].receipts.some((receipt) => receipt.role === 'user'
      && receipt.excerpt === 'x'.repeat(800)));
    assert.ok(indexed[0].receipts.some((receipt) => receipt.excerpt.includes('Friday [REDACTED]')));
    assert.ok(prefix[0].receipts.some((receipt) => receipt.role === 'assistant'));
    assert.ok(indexed[0].receipts.some((receipt) => receipt.role === 'assistant'));
    assert.ok(!JSON.stringify(requests).includes(secret));
    assert.ok(!JSON.stringify(requests).includes('GENERATED_SUMMARY_POISON'));
  }
});

test('N3 distinct facades sharing a real dirty store fail the second pristine check', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-pair-shared-'));
  const path = join(root, 'shared.sqlite');
  const core = openMemoryCore({ path, model: sourceModel(), captureQualification: 'source-bound-v2' });
  t.after(() => { core.close(); rmSync(root, { recursive: true, force: true }); });
  const facade = () => ({ list: (...args) => core.list(...args),
    capture: (...args) => core.capture(...args), recall: (...args) => core.recall(...args),
    get: (...args) => core.get(...args) });
  const run = await runQualifiedSourcePair(runner({ cores: {
    qualifiedPrefix: facade(), indexedWindows: facade() } }).options);
  assert.equal(run.executionStatus, 'completed');
  assert.equal(run.arms[0].status, 'completed');
  assert.equal(run.arms[1].status, 'blocked');
  assert.equal(run.arms[1].reason, 'namespace_not_pristine');
});
