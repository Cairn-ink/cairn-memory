import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot, retainedSourceView } from '../../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { officialJudgeRequest, officialPrompt, scorePublicComparison,
  aggregateOfficialScores, OFFICIAL_QUESTION_TYPES } from '../official-scoring.mjs';
import { opaqueQuestionId, opaqueSessionId, prepareLongMemEval, stableTurnIdV2 } from '../prepare.mjs';
import { runQualifiedSourcePair } from '../public-comparison.mjs';
import { loadReferenceRenderings } from '../reference-rendering.mjs';
import { scoreQualifiedSourcePair, aggregateQualifiedSourceScores } from '../qualified-source-scoring.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const names = ['qualified-prefix', 'indexed-windows'];
const type = 'single-session-user';
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 200, recallLimit: 6 };
const question = (sourceId) => ({ question_id: opaqueQuestionId(sourceId), text: 'Which day?', date: 'Saturday' });
const namespace = (sourceId) => ({ ownerId: 'qualified-source-scoring-tests', scope: 'project',
  projectId: opaqueQuestionId(sourceId) });
const history = (sourceId) => ({ question_id: opaqueQuestionId(sourceId), sessions: [
  { session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday', turns: [
    { turn_id: stableTurnIdV2(sourceId, 0, 0), role: 'user', content: 'The day was Friday.' },
    { turn_id: stableTurnIdV2(sourceId, 0, 1), role: 'assistant', content: 'Understood.' },
  ] },
] });
const evaluator = (sourceId, patch = {}) => ({ question_id: opaqueQuestionId(sourceId),
  source_question_id: sourceId, question_type: type, reference_answer: 'Friday',
  answer_session_ids: [opaqueSessionId(sourceId, 0)], turn_labels: [], ...patch });
const metadata = (name, input) => name === names[0]
  ? { retainedSourceWindow: retainedSourceView(captureSnapshot(input, 'source-bound-v2')).retainedSourceWindow }
  : { sourceWindowCatalog: sourceWindowCatalog(captureSnapshot(input, 'source-bound-v2',
    'indexed-windows-v1')).coverage.sourceWindowCatalog };
const core = (name, sourceId) => ({
  list: () => ({ ok: true, value: { memories: [], nextCursor: null, exhausted: true } }),
  capture: (input) => ({ ok: true, value: { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' }, ...metadata(name, input) } }),
  recall: () => ({ ok: true, value: { memories: [], namespaces: [
    { namespace: namespace(sourceId), mapExhausted: true, fetchExhausted: true }], coverage: 'complete' } }),
  get: () => { throw new Error('not called'); },
});
const scope = (seen = [], patch = {}) => ({ withCaseScope: async (identity, operation) => {
  seen.push(identity);
  return operation({ snapshot: () => ({ version: 'case-deadline-scope-v1', phase: identity.phase,
    caseId: identity.caseId, status: 'active' }) });
}, isHalted: () => false, ...patch });
const fixture = (sourceId = 'source-scoring-case', armOrder = names) => {
  const generationScopes = [];
  const options = { history: history(sourceId), question: question(sourceId),
    namespace: namespace(sourceId), answerModel: 'synthetic-answer', limits,
    armOrder: [...armOrder], cores: { qualifiedPrefix: core(names[0], sourceId),
      indexedWindows: core(names[1], sourceId) },
    countTokens: () => 1, answer: async () => ({ text: 'Friday' }), execution: scope(generationScopes) };
  return { options, generationScopes, evaluator: evaluator(sourceId) };
};
const scoring = (run, evalData, patch = {}) => {
  const scopes = [];
  const requests = [];
  const options = { run, expectedProtocol: run.protocol, evaluator: evalData,
    judge: async ({ request }) => { requests.push(request); return { text: 'yes' }; },
    judgeTimeoutMs: 200, execution: scope(scopes), ...patch };
  return { options, scopes, requests };
};
const clone = (value) => structuredClone(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) =>
    [key, canonical(value[key])])) : value;
const protocolDigest = (protocol) => {
  const { digest: ignored, ...fields } = protocol;
  void ignored;
  return digest(JSON.stringify(['cairn.lme.source-pair.protocol.v1', canonical(fields)]));
};

test('P1/P2 actual N reports in both orders use only official requests and scoped identities', async () => {
  for (const armOrder of [names, [...names].reverse()]) {
    const input = fixture('source-scoring-order-' + armOrder[0], armOrder);
    const run = await runQualifiedSourcePair(input.options);
    assert.equal(run.executionStatus, 'completed');
    assert.deepEqual(run.arms.map((arm) => arm.status), ['completed', 'completed'], JSON.stringify(run.arms));
    assert.deepEqual(input.generationScopes.map((item) => item.phase), ['generation', 'generation']);
    const scene = scoring(run, input.evaluator);
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.equal(result.executionStatus, 'completed');
    assert.deepEqual(result.attemptedOrder, armOrder);
    assert.deepEqual(scene.scopes, armOrder.map((name) => ({ phase: 'scoring',
      caseId: run.protocol.arms.find((arm) => arm.name === name).scopeId })));
    assert.deepEqual(scene.requests, armOrder.map((name) => officialJudgeRequest(officialPrompt({
      questionType: type, question: run.protocol.question.text, reference: 'Friday',
      response: run.arms.find((arm) => arm.name === name).answer.text, abstention: false }))));
    assert.deepEqual(result.arms.map((arm) => arm.judgment.correct), [true, true]);
    assert.deepEqual(result.arms[0].referenceSessionCoverage, {
      retrieved: { numerator: 0, denominator: 1, rate: 0 },
      packed: { numerator: 0, denominator: 1, rate: 0 },
    });
    assert.equal(Object.isFrozen(result.arms[0].judgment), true);
    assert.equal(JSON.stringify(result).includes('reference_answer'), false);
    assert.equal(JSON.stringify(result).includes('"answer":{"text"'), false);
    await assert.rejects(scorePublicComparison({ run, evaluator: input.evaluator }), { code: 'invalid_run' });
    assert.throws(() => aggregateOfficialScores({ roster: [{ questionId: run.protocol.questionId,
      sourceQuestionId: input.evaluator.source_question_id, questionType: type }],
    records: [result] }), { code: 'invalid_records' });
  }
});

test('P1 malformed binding, settings, evaluator and token reject before scope or judge', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  const scene = scoring(run, input.evaluator);
  const mutations = [
    { run: { ...run, protocol: { ...run.protocol, digest: '0'.repeat(64) } } },
    { expectedProtocol: { ...run.protocol, answerModel: 'other' } },
    { expectedProtocol: { ...run.protocol, arms: [...run.protocol.arms].reverse() } },
    { run: { ...run, arms: [run.arms[0], run.arms[0]] } },
    { run: { ...run, attemptedOrder: [names[1], names[0]] } },
    { run: { ...run, arms: run.arms.map((arm) => ({ ...arm, status: 'failed',
      reason: 'raw provider error', answer: null })) } },
    { evaluator: { ...input.evaluator, question_id: opaqueQuestionId('foreign') } },
    { execution: { ...scene.options.execution, extra: 1 } },
    { referenceRendering: Object.freeze({}) },
  ];
  for (const patch of mutations) await assert.rejects(scoreQualifiedSourcePair({ ...scene.options, ...patch }));
  assert.equal(scene.scopes.length, 0);
  assert.equal(scene.requests.length, 0);
  const sparseProtocol = clone(run.protocol);
  delete sparseProtocol.arms[0].payloadDigests[0];
  sparseProtocol.arms[0].payloadDigests.foo = null;
  sparseProtocol.digest = protocolDigest(sparseProtocol);
  const sparseRun = clone(run);
  sparseRun.protocol = clone(sparseProtocol);
  await assert.rejects(scoreQualifiedSourcePair({ ...scene.options, run: sparseRun,
    expectedProtocol: sparseProtocol }), { code: 'invalid_protocol' });
  const sparseOrder = clone(run);
  delete sparseOrder.attemptedOrder[0];
  sparseOrder.attemptedOrder.foo = names[0];
  await assert.rejects(scoreQualifiedSourcePair({ ...scene.options, run: sparseOrder }),
    { code: 'invalid_run' });
  const sparseReference = [3];
  delete sparseReference[0];
  sparseReference.foo = 3;
  await assert.rejects(scoreQualifiedSourcePair({ ...scene.options,
    evaluator: { ...input.evaluator, reference_answer: sparseReference } }),
  { code: 'invalid_evaluator' });
});

test('P1 snapshots caller data, judge and scope methods once before the first await', async () => {
  const input = fixture();
  const run = clone(await runQualifiedSourcePair(input.options));
  const evalData = evaluator('source-scoring-case');
  const seen = [];
  const requests = [];
  let entered;
  const firstEntered = new Promise((resolve) => { entered = resolve; });
  let release;
  const firstReleased = new Promise((resolve) => { release = resolve; });
  const originalJudge = async ({ request }) => {
    requests.push(request);
    if (requests.length === 1) { entered(); await firstReleased; }
    return { text: 'yes' };
  };
  const port = scope(seen);
  const originalScope = port.withCaseScope;
  const originalHalt = port.isHalted;
  const reads = new Map();
  for (const [key, method] of [['withCaseScope', originalScope], ['isHalted', originalHalt]]) {
    Object.defineProperty(port, key, { enumerable: true, configurable: true, get() {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return method;
    } });
  }
  const values = { run, expectedProtocol: clone(run.protocol), evaluator: evalData,
    judge: originalJudge, judgeTimeoutMs: 200, execution: port };
  const options = {};
  for (const [key, value] of Object.entries(values)) Object.defineProperty(options, key, {
    enumerable: true, configurable: true, get() {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return value;
    },
  });
  const scoringPromise = scoreQualifiedSourcePair(options);
  await firstEntered;
  run.arms[1].answer.text = 'poison answer';
  evalData.reference_answer = 'poison reference';
  Object.defineProperty(options, 'judge', { enumerable: true, value: () => assert.fail('replacement judge') });
  Object.defineProperty(port, 'withCaseScope', { enumerable: true,
    value: () => assert.fail('replacement scope') });
  Object.defineProperty(port, 'isHalted', { enumerable: true,
    value: () => assert.fail('replacement halt') });
  release();
  const result = await scoringPromise;
  assert.deepEqual(result.arms.map((arm) => arm.judgment.correct), [true, true]);
  assert.equal(requests.length, 2);
  assert.equal(seen.length, 2);
  assert.ok(requests.every((request) => !JSON.stringify(request).includes('poison')));
  assert.equal(reads.get('run'), 1);
  assert.equal(reads.get('expectedProtocol'), 1);
  assert.equal(reads.get('evaluator'), 1);
  assert.equal(reads.get('judge'), 1);
  assert.equal(reads.get('execution'), 1);
  assert.equal(reads.get('withCaseScope'), 1);
  assert.equal(reads.get('isHalted'), 1);
});

test('P2 official six types, abstention and parser substring behavior stay pinned', async () => {
  for (const [index, questionType] of OFFICIAL_QUESTION_TYPES.entries()) {
    const sourceId = `source-scoring-type-${index}${index === 0 ? '_abs' : ''}`;
    const input = fixture(sourceId);
    const run = await runQualifiedSourcePair(input.options);
    const evalData = evaluator(sourceId, { question_type: questionType });
    const scene = scoring(run, evalData, { judge: async ({ request }) => {
      scene.requests.push(request); return { text: 'yesterday' };
    } });
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.deepEqual(result.arms.map((arm) => arm.judgment.correct), [true, true]);
    assert.equal(result.abstention, index === 0);
    assert.deepEqual(scene.requests[0], officialJudgeRequest(officialPrompt({
      questionType, question: run.protocol.question.text, reference: 'Friday',
      response: 'Friday', abstention: index === 0 })));
  }
});

test('P2 failures and local timeout precedence retain safe generation reasons', async () => {
  const input = fixture();
  const complete = await runQualifiedSourcePair(input.options);
  const failed = clone(complete);
  failed.arms[0] = { ...failed.arms[0], status: 'failed', reason: 'recall_failed', answer: null };
  for (const status of ['active', 'timed_out', 'blocked']) {
    const seen = [];
    const scene = scoring(failed, input.evaluator, { execution: scope(seen, {
      withCaseScope: async (identity, operation) => { seen.push(identity);
        return operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
          phase: identity.phase, caseId: identity.caseId, status }) }); },
    }) });
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.deepEqual(result.arms[0].judgment, { status: 'unresolved', correct: null,
      reason: 'recall_failed', stage: 'generation', attempted: false });
    assert.equal(scene.requests.length, status === 'active' ? 1 : 0);
  }
  const timed = scoring(complete, evaluator('source-scoring-case', { reference_answer: 3 }), {
    judge: undefined, execution: scope([], { withCaseScope: async (identity, operation) =>
      operation({ snapshot: () => ({ version: 'case-deadline-scope-v1', phase: identity.phase,
        caseId: identity.caseId, status: 'blocked' }) }) }),
  });
  const result = await scoreQualifiedSourcePair(timed.options);
  assert.deepEqual(result.arms.map((arm) => arm.judgment.reason), ['case_timeout', 'case_timeout']);
});

test('P2 halted generation opens zero scoring scopes, preserving N evidence', async () => {
  const input = fixture();
  input.options.execution = scope([], { isHalted: () => true });
  const run = await runQualifiedSourcePair(input.options);
  assert.equal(run.executionStatus, 'halted');
  const scene = scoring(run, input.evaluator);
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.equal(scene.scopes.length, 0);
  assert.equal(scene.requests.length, 0);
  assert.equal(result.haltReason, 'generation_halted');
  assert.deepEqual(result.arms.map((arm) => arm.judgment.reason),
    ['generation_halted', 'generation_halted']);
});

test('P2 scope getters, returned proxies and drifting values halt before a later scope', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  for (const badHandle of [
    Object.defineProperty({}, 'snapshot', { get() { throw new Error('secret handle'); } }),
    { snapshot: () => Object.defineProperty({ version: 'case-deadline-scope-v1',
      phase: 'scoring', caseId: run.protocol.arms[0].scopeId }, 'status',
    { enumerable: true, get() { throw new Error('secret status'); } }) },
    { snapshot: () => new Proxy({}, { ownKeys() { throw new Error('secret keys'); } }) },
  ]) {
    let scopes = 0, judges = 0;
    const scene = scoring(run, input.evaluator, {
      judge: async () => { judges++; return { text: 'yes' }; },
      execution: scope([], { withCaseScope: async (_, operation) => { scopes++;
        return operation(badHandle); } }),
    });
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.equal(result.executionStatus, 'halted');
    assert.equal(result.haltReason, 'scope_contract_invalid');
    assert.equal(scopes, 1);
    assert.equal(judges, 0);
    assert.deepEqual(result.arms.map((arm) => arm.judgment.reason),
      ['scope_contract_invalid', 'scope_contract_invalid']);
  }
  let reads = 0;
  const scene = scoring(run, input.evaluator, { execution: scope([], {
    withCaseScope: async (identity, operation) => operation({ snapshot: () => {
      const result = { version: 'case-deadline-scope-v1', phase: 'scoring', caseId: identity.caseId };
      let localReads = 0;
      Object.defineProperty(result, 'status', { enumerable: true, get() {
        reads++; localReads++; if (localReads > 1) throw new Error('reread');
        return 'active'; } });
      return result;
    } }),
  }) });
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.equal(result.executionStatus, 'completed');
  assert.equal(reads, 8); // before/after each of two judges; one field read per check.
});

test('P2 judge response gets detached once; global halt beats timeout and postjudge timeout is attempted', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  let reads = 0;
  const scene = scoring(run, input.evaluator, { judge: async () => {
    const response = {};
    Object.defineProperty(response, 'text', { enumerable: true, get() {
      reads++; return reads % 2 ? 'yes' : 'no'; } });
    return response;
  } });
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.deepEqual(result.arms.map((arm) => arm.judgment.correct), [true, false]);
  assert.equal(reads, 2);

  let global = false;
  const globalScene = scoring(run, input.evaluator, {
    execution: scope([], { isHalted: () => global,
      withCaseScope: async (identity, operation) => operation({ snapshot: () => ({
        version: 'case-deadline-scope-v1', phase: identity.phase,
        caseId: identity.caseId, status: 'timed_out' }) }) }),
    judge: async () => { global = true; return { text: 'yes' }; },
  });
  const local = await scoreQualifiedSourcePair(globalScene.options);
  assert.equal(local.arms[0].judgment.reason, 'case_timeout');
  assert.equal(local.arms[0].judgment.attempted, false);
  global = true;
  const globallyStopped = await scoreQualifiedSourcePair(globalScene.options);
  assert.equal(globallyStopped.haltReason, 'global_halt');
  assert.deepEqual(globallyStopped.attemptedOrder, []);

  let status = 'active';
  const timed = scoring(run, input.evaluator, {
    judge: async () => { status = 'timed_out'; return { text: 'yes' }; },
    execution: scope([], { withCaseScope: async (identity, operation) => operation({
      snapshot: () => ({ version: 'case-deadline-scope-v1', phase: identity.phase,
        caseId: identity.caseId, status }),
    }) }),
  });
  const late = await scoreQualifiedSourcePair(timed.options);
  assert.equal(late.arms[0].judgment.reason, 'case_timeout');
  assert.equal(late.arms[0].judgment.attempted, true);
  assert.equal(aggregateQualifiedSourceScores({ roster: [{ protocol: run.protocol,
    sourceQuestionId: input.evaluator.source_question_id, questionType: type }],
  records: [late] }).arms[names[0]].overall.reasonCounts.case_timeout, 1);
});

test('P2 wrappers that fail, omit, double, or outlive operation halt and fence later work', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  const cases = [
    { withCaseScope: async () => undefined, expected: 'scope_contract_invalid' },
    { withCaseScope: async () => { throw new Error('secret'); }, expected: 'scope_execution_failed' },
    { withCaseScope: async (identity, operation) => {
      const handle = { snapshot: () => ({ version: 'case-deadline-scope-v1', phase: identity.phase,
        caseId: identity.caseId, status: 'active' }) };
      await operation(handle);
      try { await operation(handle); } catch { /* wrapper may swallow; scorer still halts */ }
    }, expected: 'scope_contract_invalid' },
  ];
  for (const item of cases) {
    let scopes = 0, judges = 0;
    const scene = scoring(run, input.evaluator, { execution: scope([], {
      withCaseScope: async (...args) => { scopes++; return item.withCaseScope(...args); },
    }), judge: async () => { judges++; return { text: 'yes' }; } });
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.equal(scopes, 1);
    assert.equal(result.haltReason, item.expected);
    assert.equal(result.arms[1].judgment.attempted, false);
    assert.ok(judges <= 1);
  }
  let release;
  const parked = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const scene = scoring(run, input.evaluator, { judge: async () => { calls.push('judge');
    await parked; return { text: 'yes' }; },
  execution: scope([], { withCaseScope: async (identity, operation) => {
    void operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
      phase: identity.phase, caseId: identity.caseId, status: 'active' }) });
  } }) });
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.equal(result.haltReason, 'scope_contract_invalid');
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['judge']);
});

test('P2 judge failures, malformed replies and backup timeout stay unresolved without retries', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  for (const [judge, expected] of [
    [undefined, 'judge_not_configured'],
    [async () => { throw new Error('private'); }, 'judge_failed'],
    [async () => ({ text: 1 }), 'invalid_judge_response'],
    [async () => new Proxy({}, { ownKeys() { throw new Error('private'); } }),
      'invalid_judge_response'],
  ]) {
    const scene = scoring(run, input.evaluator, { judge });
    const result = await scoreQualifiedSourcePair(scene.options);
    assert.equal(result.executionStatus, 'completed');
    assert.deepEqual(result.arms.map((arm) => arm.judgment.reason), [expected, expected]);
    assert.equal(scene.scopes.length, 2);
  }
  let release;
  const parked = new Promise((resolve) => { release = resolve; });
  let calls = 0, aborted = 0;
  const scene = scoring(run, input.evaluator, { judgeTimeoutMs: 2,
    judge: async ({ signal }) => { calls++; signal.addEventListener('abort', () => { aborted++; });
      await parked; return { text: 'yes' }; } });
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.deepEqual(result.arms.map((arm) => arm.judgment.reason), ['judge_timeout', 'judge_timeout']);
  assert.equal(calls, 2);
  assert.equal(aborted, 2);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result.arms.map((arm) => arm.judgment.status), ['unresolved', 'unresolved']);
});

test('P2 failed later scope retains earlier exited judgment, not a completed pair', async () => {
  const input = fixture();
  const run = await runQualifiedSourcePair(input.options);
  let count = 0;
  const scene = scoring(run, input.evaluator, { execution: scope([], {
    withCaseScope: async (identity, operation) => {
      count++;
      if (count === 2) throw new Error('private exit');
      return operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
        phase: identity.phase, caseId: identity.caseId, status: 'active' }) });
    },
  }) });
  const result = await scoreQualifiedSourcePair(scene.options);
  assert.equal(result.executionStatus, 'halted');
  assert.equal(result.arms[0].judgment.correct, true);
  assert.equal(result.arms[1].judgment.reason, 'scope_execution_failed');
  assert.equal(result.arms[1].judgment.attempted, false);
  const summary = aggregateQualifiedSourceScores({ roster: [{ protocol: run.protocol,
    sourceQuestionId: input.evaluator.source_question_id, questionType: type }], records: [result] });
  assert.equal(summary.arms[names[0]].overall.correct, 1);
  assert.equal(summary.arms[names[1]].overall.unresolved, 1);
  assert.equal(summary.common.commonN, 0);
  const after = scoring(run, input.evaluator, { execution: scope([], {
    withCaseScope: async (identity, operation) => {
      await operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
        phase: identity.phase, caseId: identity.caseId, status: 'active' }) });
      throw new Error('failed after judge');
    },
  }) });
  const postJudge = await scoreQualifiedSourcePair(after.options);
  assert.equal(postJudge.haltReason, 'scope_execution_failed');
  assert.equal(postJudge.arms[0].judgment.status, 'unresolved');
  assert.equal(postJudge.arms[0].judgment.attempted, true);
  assert.equal(postJudge.arms[1].judgment.attempted, false);
  assert.equal(after.requests.length, 1);
});

test('P2 numeric reference requires actual evaluator-bound Python rendering token', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cairn-qualified-source-scoring-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceId = 'source-scoring-numeric';
  const sourceText = `[{
    "question_id":"${sourceId}","question_type":"single-session-user","question":"Which day?",
    "answer":3.0,"question_date":"Saturday","haystack_session_ids":["session"],
    "haystack_dates":["Tuesday"],"haystack_sessions":[[{"role":"user","content":"Three"}]],
    "answer_session_ids":[]}]`;
  const inputPath = join(root, 'source.json');
  const preparedDirectory = join(root, 'prepared');
  const sidecarPath = join(root, 'sidecar.json');
  await writeFile(inputPath, sourceText);
  await prepareLongMemEval({ inputPath, expectedSha256: digest(sourceText),
    datasetRevision: 'synthetic', datasetVariant: 's-cleaned', questionIds: [sourceId],
    outputDirectory: preparedDirectory });
  const python = new URL('../fixtures/render-reference-sidecar.py', import.meta.url).pathname;
  const sidecar = spawnSync('python3', [python, '--source', inputPath, '--prepared', preparedDirectory,
    '--output', sidecarPath], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(sidecar.status, 0, sidecar.stderr);
  const evalData = JSON.parse((await readFile(join(preparedDirectory, 'evaluator.jsonl'), 'utf8')).trim());
  const renderings = await loadReferenceRenderings({ inputPath, preparedDirectory, sidecarPath,
    expectedSidecarSha256: JSON.parse(sidecar.stdout).sidecar_sha256 });
  const token = renderings.get(opaqueQuestionId(sourceId));
  const input = fixture(sourceId);
  const run = await runQualifiedSourcePair(input.options);
  const noToken = scoring(run, evalData);
  const unresolved = await scoreQualifiedSourcePair(noToken.options);
  assert.equal(noToken.requests.length, 0);
  assert.equal(unresolved.compatibility.referenceSerialization, 'unverified-non-string');
  assert.deepEqual(unresolved.arms.map((arm) => arm.judgment.reason),
    ['reference_serialization_unverified', 'reference_serialization_unverified']);
  const withToken = scoring(run, evalData, { referenceRendering: token });
  const scored = await scoreQualifiedSourcePair(withToken.options);
  assert.equal(scored.compatibility.referenceSerialization, 'verified-python-rendered');
  assert.equal(withToken.requests.length, 2);
  assert.ok(withToken.requests.every((request) => request.messages[0].content
    .includes('Correct Answer: 3.0\n\n')));
  const wrongToken = scoring(run, evalData, { referenceRendering: Object.freeze({}) });
  await assert.rejects(scoreQualifiedSourcePair(wrongToken.options), { code: 'rendering_mismatch' });
  assert.equal(wrongToken.scopes.length, 0);
  assert.equal(wrongToken.requests.length, 0);
  const wrongEvaluator = scoring(run, { ...evalData, reference_answer: 4 },
    { referenceRendering: token });
  await assert.rejects(scoreQualifiedSourcePair(wrongEvaluator.options),
    { code: 'rendering_mismatch' });
  assert.equal(wrongEvaluator.scopes.length, 0);
  assert.equal(wrongEvaluator.requests.length, 0);
});

test('P3 nonzero reference overlap and P4 complete six-type macro/abstention accounting', async () => {
  const roster = [], records = [];
  for (const [index, questionType] of OFFICIAL_QUESTION_TYPES.entries()) {
    const sourceId = `source-scoring-macro-${index}${index === 0 ? '_abs' : ''}`;
    const input = fixture(sourceId);
    const run = clone(await runQualifiedSourcePair(input.options));
    const sessionId = opaqueSessionId(sourceId, 0);
    for (const arm of run.arms) arm.diagnostics.retrieval = {
      retrievedSessionIds: [sessionId], packedSessionIds: [sessionId] };
    const evalData = evaluator(sourceId, { question_type: questionType });
    const result = await scoreQualifiedSourcePair(scoring(run, evalData).options);
    assert.deepEqual(result.arms[0].referenceSessionCoverage, {
      retrieved: { numerator: 1, denominator: 1, rate: 1 },
      packed: { numerator: 1, denominator: 1, rate: 1 },
    });
    roster.push({ protocol: run.protocol, sourceQuestionId: sourceId, questionType });
    records.push(result);
  }
  const summary = aggregateQualifiedSourceScores({ roster, records });
  assert.equal(summary.completeVerifiedOfficialStyle, true);
  assert.equal(summary.arms[names[0]].macroSixTypeAccuracy, 1);
  assert.equal(summary.arms[names[1]].macroSixTypeAccuracy, 1);
  assert.equal(summary.arms[names[0]].abstentionOverlay.fixedN, 1);
  assert.equal(summary.common.commonN, 6);
  assert.equal(summary.common.abstentionOverlay.commonN, 1);
  assert.equal(summary.common.pairedOutcomes.bothCorrect, 6);
  const malformed = clone(records[0]);
  malformed.arms[0].referenceSessionCoverage.packed.numerator = 2;
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [malformed] }),
    { code: 'invalid_records' });
});

test('P4 independent three-case fixed-roster golden and strict record consistency', async () => {
  const sourceIds = ['source-scoring-golden-one', 'source-scoring-golden-two',
    'source-scoring-golden-three'];
  const inputs = sourceIds.map((id) => fixture(id));
  const runs = await Promise.all(inputs.map((input) => runQualifiedSourcePair(input.options)));
  const roster = runs.map((run, index) => ({ protocol: run.protocol,
    sourceQuestionId: sourceIds[index], questionType: type }));
  let answer = 0;
  const first = await scoreQualifiedSourcePair(scoring(runs[0], inputs[0].evaluator, {
    judge: async () => ({ text: answer++ === 0 ? 'yes' : 'no' }),
  }).options);
  let calls = 0;
  const second = await scoreQualifiedSourcePair(scoring(runs[1], inputs[1].evaluator, {
    judge: async () => ({ text: 'no' }),
    execution: scope([], { withCaseScope: async (identity, operation) => {
      calls++;
      if (calls === 2) throw new Error('second scope failed');
      return operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
        phase: identity.phase, caseId: identity.caseId, status: 'active' }) });
    } }),
  }).options);
  assert.equal(second.executionStatus, 'halted');
  assert.equal(second.arms[0].judgment.correct, false);
  assert.equal(second.arms[1].judgment.reason, 'scope_execution_failed');
  const summary = aggregateQualifiedSourceScores({ roster, records: [first, second] });
  assert.equal(summary.fixedCaseCount, 3);
  assert.equal(summary.scoredRecordCount, 2);
  assert.deepEqual([summary.arms[names[0]].overall.correct,
    summary.arms[names[0]].overall.incorrect, summary.arms[names[0]].overall.unresolved], [1, 1, 1]);
  assert.deepEqual([summary.arms[names[1]].overall.correct,
    summary.arms[names[1]].overall.incorrect, summary.arms[names[1]].overall.unresolved], [0, 1, 2]);
  assert.deepEqual(summary.arms[names[0]].overall.fixedNBounds, { lower: 1 / 3, upper: 2 / 3 });
  assert.deepEqual(summary.arms[names[1]].overall.fixedNBounds, { lower: 0, upper: 2 / 3 });
  assert.equal(summary.common.commonN, 1);
  assert.deepEqual(summary.common.pairedOutcomes, { bothCorrect: 0, prefixOnlyCorrect: 1,
    indexedOnlyCorrect: 0, bothIncorrect: 0 });
  assert.equal(summary.arms[names[0]].macroSixTypeAccuracy, null);
  assert.equal(summary.arms[names[0]].perType['multi-session'].coverage, null);
  assert.deepEqual(summary.arms[names[0]].perType['multi-session'].fixedNBounds,
    { lower: null, upper: null });
  assert.equal(summary.completeVerifiedOfficialStyle, false);
  assert.equal(Object.isFrozen(summary.common.pairedOutcomes), true);
  const forgedCorrect = clone(second);
  forgedCorrect.arms[1].judgment.correct = true;
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [first, forgedCorrect] }),
    { code: 'invalid_records' });
  const forgedLater = clone(second);
  forgedLater.arms[0].judgment = { status: 'unresolved', correct: null,
    reason: 'scope_execution_failed', stage: 'execution', attempted: false };
  forgedLater.arms[1].judgment = { status: 'resolved', correct: true,
    reason: null, stage: null, attempted: true };
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [first, forgedLater] }),
    { code: 'invalid_records' });
  const forgedAttempt = clone(second);
  forgedAttempt.arms[1].judgment.attempted = true;
  forgedAttempt.arms[1].generationStatus = 'failed';
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [first, forgedAttempt] }),
    { code: 'invalid_records' });
  const forgedFailedTimeout = clone(first);
  forgedFailedTimeout.arms[0].generationStatus = 'failed';
  forgedFailedTimeout.arms[0].judgment = { status: 'unresolved', correct: null,
    reason: 'case_timeout', stage: 'execution', attempted: false };
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [forgedFailedTimeout] }),
    { code: 'invalid_records' });
  const forgedGenerationHalt = clone(first);
  forgedGenerationHalt.arms[0].generationStatus = 'failed';
  forgedGenerationHalt.arms[0].judgment = { status: 'unresolved', correct: null,
    reason: 'global_halt', stage: 'generation', attempted: false };
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [forgedGenerationHalt] }),
    { code: 'invalid_records' });
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [first, first] }),
    { code: 'invalid_records' });
  assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [{
    ...first, schemaVersion: 'cairn-longmemeval-official-scoring-v2' }] }),
  { code: 'invalid_records' });
});

test('P4 scope-exit failure must invalidate a boundary slot in both orders', async () => {
  for (const armOrder of [names, [...names].reverse()]) {
    const sourceId = `source-scoring-exit-${armOrder[0]}`;
    const input = fixture(sourceId, armOrder);
    const run = await runQualifiedSourcePair(input.options);
    const roster = [{ protocol: run.protocol, sourceQuestionId: sourceId, questionType: type }];
    const fullyResolved = await scoreQualifiedSourcePair(scoring(run, input.evaluator).options);
    const forged = clone(fullyResolved);
    forged.executionStatus = 'halted';
    forged.haltReason = 'scope_execution_failed';
    assert.deepEqual(forged.arms.map((arm) => arm.judgment.status), ['resolved', 'resolved']);
    assert.throws(() => aggregateQualifiedSourceScores({ roster, records: [forged] }),
      { code: 'invalid_records' });
    // Global or contract halt can occur after a clean final scope exit, so
    // this refusal is intentionally specific to wrapper execution failure.
    for (const haltReason of ['global_halt', 'scope_contract_invalid']) {
      const afterCleanExit = { ...forged, haltReason };
      assert.equal(aggregateQualifiedSourceScores({ roster, records: [afterCleanExit] })
        .common.commonN, 1);
    }
    for (const boundaryIndex of [0, 1]) for (const position of ['before', 'after']) {
      let entered = 0, judgeCalls = 0;
      const scene = scoring(run, input.evaluator, {
        judge: async () => { judgeCalls++; return { text: boundaryIndex === 1
          && position === 'after' ? 'no' : 'yes' }; },
        execution: scope([], { withCaseScope: async (identity, operation) => {
          const current = entered++;
          if (current === boundaryIndex && position === 'before') throw Error('private before');
          const value = await operation({ snapshot: () => ({ version: 'case-deadline-scope-v1',
            phase: identity.phase, caseId: identity.caseId, status: 'active' }) });
          if (current === boundaryIndex) throw Error('private after');
          return value;
        } }),
      });
      const result = await scoreQualifiedSourcePair(scene.options);
      assert.equal(result.executionStatus, 'halted');
      assert.equal(result.haltReason, 'scope_execution_failed');
      assert.deepEqual(result.attemptedOrder,
        armOrder.slice(0, boundaryIndex + (position === 'after' ? 1 : 0)));
      const failing = result.arms.find((arm) => arm.name === armOrder[boundaryIndex]);
      assert.equal(failing.judgment.status, 'unresolved');
      assert.equal(failing.judgment.stage, 'execution');
      assert.equal(failing.judgment.reason, 'scope_execution_failed');
      assert.equal(failing.judgment.attempted, position === 'after');
      if (boundaryIndex === 1) {
        const earlier = result.arms.find((arm) => arm.name === armOrder[0]);
        assert.equal(earlier.judgment.status, 'resolved');
        assert.equal(earlier.judgment.correct, position === 'before');
      }
      assert.equal(judgeCalls, boundaryIndex + (position === 'after' ? 1 : 0));
      assert.equal(aggregateQualifiedSourceScores({ roster, records: [result] }).common.commonN, 0);
    }
  }
});
