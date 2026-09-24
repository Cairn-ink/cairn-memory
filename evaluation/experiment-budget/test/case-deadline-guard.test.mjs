import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdtempSync, openSync,
  readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate } from 'node:timers/promises';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import {
  authorizeBenchmarkExtension,
  authorizeCaseDeadlineCapability,
  createBenchmarkExperimentRequestGuard,
  createCaseDeadlineExperimentRequestGuard,
  createExperimentRequestGuard,
  ExperimentRequestGuardError,
} from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const url = 'https://api.openai.com/v1/chat/completions';
const model = 'gpt-4.1-mini-2025-04-14';
const price = (microUsdNumerator, tokenDenominator) => ({ microUsdNumerator, tokenDenominator });
const stage = (stageModel, timeoutMs = 10) => ({ endpoint: url, model: stageModel,
  reservedMicroUsd: 50_000, maxRequestBytes: 100_000, maxResponseBytes: 65_536,
  timeoutMs, maxInputTokens: 100_000, maxOutputTokens: 512, inputTokenFraming: 1_024,
  inputPrice: price(2, 5), outputPrice: price(8, 5) });
const stages = () => ({ answer: stage(model), judge: stage('gpt-4o-2024-08-06') });
const body = () => ({ model, messages: [{ role: 'user', content: 'synthetic' }], n: 1,
  temperature: 0, max_tokens: 16, store: false, stream: false });
const request = () => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify(body()) });
const requestWithSignal = signal => ({ ...request(), signal });
const judgeRequest = () => ({ ...request(), body: JSON.stringify({ ...body(), model: 'gpt-4o-2024-08-06' }) });
const response = (responseModel = model) => Response.json({ id: 'synthetic', object: 'chat.completion', model: responseModel,
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
const countResponse = (inputTokens = 100) => Response.json({ object: 'response.input_tokens', input_tokens: inputTokens });
const generationResponse = () => Response.json({ id: 'resp_synthetic', object: 'response', model: DEFAULT_MODEL,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify({ items: [] }), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
const generationResponseFor = (payload, output) => Response.json({ id: 'resp_synthetic', object: 'response',
  model: payload.model, status: 'completed', error: null, incomplete_details: null,
  output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const extractInput = () => ({ messages: [{ index: 0, role: 'user', content: 'Synthetic source.' }] });
const countBody = () => ({ model: DEFAULT_MODEL, instructions: 'Synthetic extraction.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(extractInput()) }] }],
  truncation: 'disabled', text: { format: { name: 'cairn_extract', type: 'json_schema', strict: true,
    schema: schemasFor('extract', extractInput()) } } });
const countRequest = () => ({ ...request(), body: JSON.stringify(countBody()) });
const generationRequest = () => ({ ...request(), body: JSON.stringify({ ...countBody(),
  max_output_tokens: 1024, store: false, stream: false }) });
const namespace = { ownerId: 'case-deadline', scope: 'project', projectId: 'synthetic' };
const captureInput = index => ({ namespace, client: 'synthetic', eventId: `event-${index}`,
  sessionId: 'session', messages: [{ id: `message-${index}`, role: 'user', content: `Preference ${index}.` }] });
const generatedOutput = (payload, ordinal) => {
  const method = payload.text.format.name.replace(/^cairn_/u, '');
  const input = JSON.parse(payload.input[0].content[0].text);
  if (method === 'extract') return { items: [{ content: input.messages[0].content,
    kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
  assert.equal(method, 'classify');
  return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
    newL1: { title: `Preference ${ordinal}`, parentL2Ids: [] } })) };
};
const memoryCount = databasePath => {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try { return database.prepare("SELECT count(*) AS count FROM memories WHERE deleted = 0").get().count; }
  finally { database.close(); }
};
const persistBoundary = (root, name, value) => {
  const filename = join(root, name);
  const descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try { writeFileSync(descriptor, JSON.stringify(value)); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
  return filename;
};

function fixture(t, { historicalUnknown = false, stageTimeoutMs = 10, answerReservation = 50_000,
  limitMicroUsd = 1_000_000, requestCap = 20 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-case-deadline-red-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd, requestCap };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('no transport') }).close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
    authorizationId: 'synthetic-benchmark', stages: {
      answer: { ...stage(model, stageTimeoutMs), reservedMicroUsd: answerReservation },
      judge: stage('gpt-4o-2024-08-06', stageTimeoutMs),
    } });
  if (historicalUnknown) {
    const history = reopenExperimentBudget(ledger);
    const attemptId = randomUUID();
    history.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 7 });
    history.recordOutcome({ attemptId, outcome: 'unknown' });
    history.close();
  }
  const checkpoint = reopenExperimentBudget(ledger);
  const state = checkpoint.getState();
  checkpoint.close();
  const schedule = [{ phase: 'generation', caseId: 'case-a' }, { phase: 'generation', caseId: 'case-b' },
    { phase: 'scoring', caseId: 'case-a' }, { phase: 'scoring', caseId: 'case-b' }];
  const caseDeadlineCapability = authorizeCaseDeadlineCapability({ ledger, policy, benchmarkExtension,
    authorizationId: 'synthetic-case-deadline', executionId: 'synthetic-execution',
    checkpoint: { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd }, schedule });
  return { root, ledger, policy, benchmarkExtension, caseDeadlineCapability, schedule };
}

const make = (f, fetchImpl, transportDiagnostics = null) => createCaseDeadlineExperimentRequestGuard({ ledger: f.ledger,
  policy: f.policy, benchmarkExtension: f.benchmarkExtension,
  caseDeadlineCapability: f.caseDeadlineCapability, fetchImpl,
  ...(transportDiagnostics ? { transportDiagnostics } : {}) });
const state = (ledger) => { const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); } };
const guardError = code => error => error instanceof ExperimentRequestGuardError
  && error.code === code && error.message === code;

test('G3/G4 an explicitly scoped transport timeout seals one case and permits the next frozen case', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  let calls = 0;
  const guard = make(f, (_url, options) => {
    calls += 1;
    return calls === 1 ? new Promise(() => {}) : response(JSON.parse(options.body).model);
  }, 'bounded-v1');
  t.after(() => guard.close());
  const first = guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    const pending = assert.rejects(guard.answerFetch(url, request()), { code: 'case_deadline_exceeded' });
    await Promise.resolve();
    t.mock.timers.tick(10);
    await pending;
  });
  await first;
  const fetchWait = guard.transportDiagnostics().observations[0];
  assert.equal(fetchWait.route, 'answer');
  assert.equal(fetchWait.fetchEnteredMs !== null, true);
  assert.equal(fetchWait.responseAvailableMs, null);
  assert.equal(fetchWait.bodyCompleteMs, null);
  assert.equal(fetchWait.termination, 'transport_deadline');
  assert.equal(fetchWait.accountingOutcome, 'unknown');
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async () => {
    const received = await guard.answerFetch(url, request());
    assert.equal(received.status, 200);
  });
  let blockedSnapshot;
  await guard.withCaseScope({ phase: 'scoring', caseId: 'case-a' }, async (scope) => {
    blockedSnapshot = scope.snapshot();
    await assert.rejects(guard.judgeFetch(url, judgeRequest()), guardError('case_timeout_halted'));
  });
  await guard.withCaseScope({ phase: 'scoring', caseId: 'case-b' }, async () => {
    const received = await guard.judgeFetch(url, judgeRequest());
    assert.equal(received.status, 200);
  });
  assert.equal(calls, 3);
  assert.equal(blockedSnapshot.status, 'blocked');
  assert.deepEqual(guard.caseTimeouts(), [{ version: 'case-deadline-timeout-v1', phase: 'generation',
    caseId: 'case-a', termination: 'transport_deadline' }]);
  assert.equal(Object.isFrozen(guard.caseTimeouts()[0]), true);
  const attempts = guard.attempts();
  assert.deepEqual(attempts.map(entry => [entry.caseId, entry.phase, entry.outcome, entry.termination]), [
    ['case-a', 'generation', 'unknown', 'transport_deadline'],
    ['case-b', 'generation', 'succeeded', 'response'],
    ['case-b', 'scoring', 'succeeded', 'response'],
  ]);
  assert.equal(state(f.ledger).attempts[0].actualMicroUsd, null);
  assert.equal(guard.isHalted(), false);
});

test('G1/G2 capability pins a terminal-unknown prefix, stays private and frozen, then is one-shot', (t) => {
  const f = fixture(t, { historicalUnknown: true });
  const binding = join(f.ledger.directory, 'experiment-case-deadline-synthetic-execution.json');
  assert.equal(lstatSync(binding).mode & 0o777, 0o600);
  const stored = JSON.parse(readFileSync(binding, 'utf8'));
  assert.equal(stored.version, 'case-deadline-v1');
  assert.match(stored.historicalDigest, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(f.caseDeadlineCapability.schedule[0]), true);
  assert.deepEqual(authorizeCaseDeadlineCapability({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, authorizationId: 'synthetic-case-deadline',
    executionId: 'synthetic-execution', checkpoint: f.caseDeadlineCapability.checkpoint,
    schedule: f.schedule }), f.caseDeadlineCapability);
  const guard = make(f, () => assert.fail('no transport'));
  assert.notEqual(guard.caseDeadlineCapability, f.caseDeadlineCapability);
  assert.deepEqual(guard.caseDeadlineCapability, f.caseDeadlineCapability);
  assert.equal(Object.isFrozen(guard.caseDeadlineCapability), true);
  assert.throws(() => make(f, () => assert.fail('no transport')), guardError('capability_consumed'));
  assert.throws(() => authorizeCaseDeadlineCapability({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, authorizationId: 'synthetic-case-deadline',
    executionId: 'synthetic-execution', checkpoint: f.caseDeadlineCapability.checkpoint,
    schedule: f.schedule }), guardError('capability_consumed'));
  guard.close();
});

test('G1 rejects malformed, duplicate, reordered and non-lowercase schedules before binding', (t) => {
  const f = fixture(t);
  const base = { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    authorizationId: 'another-authorization', checkpoint: f.caseDeadlineCapability.checkpoint };
  for (const [executionId, schedule] of [
    ['bad-one', [{ phase: 'generation', caseId: 'only' }]],
    ['bad-case', [{ phase: 'generation', caseId: 'Case' }, { phase: 'scoring', caseId: 'Case' }]],
    ['bad-order', [{ phase: 'scoring', caseId: 'a' }, { phase: 'generation', caseId: 'a' }]],
    ['bad-duplicate', [{ phase: 'generation', caseId: 'a' }, { phase: 'generation', caseId: 'a' },
      { phase: 'scoring', caseId: 'a' }, { phase: 'scoring', caseId: 'a' }]],
  ]) assert.throws(() => authorizeCaseDeadlineCapability({ ...base, executionId, schedule }),
    guardError('invalid_capability'));
});

test('G4 scopes enforce route, order, concurrency and closed-descendant fences without sending', async (t) => {
  const f = fixture(t);
  let calls = 0;
  const guard = make(f, () => { calls += 1; return response(); });
  t.after(() => guard.close());
  await assert.rejects(guard.answerFetch(url, request()), guardError('case_scope_required'));
  let release;
  let delayed;
  const first = guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async (scope) => {
    assert.equal(scope.snapshot().status, 'active');
    await assert.rejects(guard.judgeFetch(url, judgeRequest()), guardError('case_scope_violation'));
    delayed = () => guard.answerFetch(url, request());
    await new Promise(resolve => { release = resolve; });
    return 'persisted';
  });
  await Promise.resolve();
  await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {}),
    guardError('case_scope_busy'));
  release();
  assert.equal(await first, 'persisted');
  await assert.rejects(delayed(), guardError('case_scope_required'));
  await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {}),
    guardError('case_schedule_mismatch'));
  assert.equal(calls, 0);
  assert.equal(guard.isHalted(), false);
});

test('G4 an uncaught persistence exception, including throw undefined, is sticky global fatal', async (t) => {
  const f = fixture(t);
  const guard = make(f, () => assert.fail('no transport'));
  t.after(() => guard.close());
  let caught = false;
  try {
    await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => { throw undefined; });
  } catch (error) { caught = true; assert.equal(error, undefined); }
  assert.equal(caught, true);
  assert.equal(guard.isHalted(), true);
  await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {}),
    guardError('paid_work_halted'));
});

test('G3 body-read timer ownership isolates, but forged timeout and ordinary abort remain global', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bodyFixture = fixture(t);
  let calls = 0;
  const bodyGuard = make(bodyFixture, () => {
    calls += 1;
    if (calls === 1) return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }));
    return response();
  }, 'bounded-v1');
  t.after(() => bodyGuard.close());
  await bodyGuard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    const pending = assert.rejects(bodyGuard.answerFetch(url, request()), guardError('case_deadline_exceeded'));
    await setImmediate();
    t.mock.timers.tick(10);
    await pending;
  });
  const bodyWait = bodyGuard.transportDiagnostics().observations[0];
  assert.equal(bodyWait.responseAvailableMs !== null, true);
  assert.equal(bodyWait.bodyCompleteMs, null);
  assert.equal(bodyWait.termination, 'transport_deadline');
  await bodyGuard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async () => {
    await bodyGuard.answerFetch(url, request());
  });
  assert.equal(bodyGuard.caseTimeouts()[0].termination, 'transport_deadline');

  const forgedFixture = fixture(t);
  const forged = make(forgedFixture, () => { throw new ExperimentRequestGuardError('request_timeout'); });
  t.after(() => forged.close());
  await forged.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(forged.answerFetch(url, request()), guardError('request_timeout'));
  });
  assert.equal(forged.isHalted(), true);
  assert.deepEqual(forged.caseTimeouts(), []);

  const abortFixture = fixture(t);
  const abortGuard = make(abortFixture, () => new Promise(() => {}), 'bounded-v1');
  t.after(() => abortGuard.close());
  const external = new AbortController();
  await abortGuard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    const pending = assert.rejects(abortGuard.answerFetch(url, requestWithSignal(external.signal)),
      guardError('request_aborted'));
    await Promise.resolve();
    external.abort('request_timeout');
    await pending;
  });
  assert.equal(abortGuard.isHalted(), true);
  assert.deepEqual(abortGuard.caseTimeouts(), []);
  assert.equal(abortGuard.transportDiagnostics().observations[0].termination, 'external_abort');
});

test('G6 an observed forged core timeout diagnostic grants no case-timeout authority', async (t) => {
  const f = fixture(t);
  const diagnostics = [];
  let calls = 0;
  const guard = make(f, () => { calls += 1; return new Promise(() => {}); });
  t.after(() => guard.close());
  const forgedModel = {
    contextWindow: 8_192,
    countTokens: () => 1,
    onDiagnostic: event => diagnostics.push(event),
    async select() {
      const forged = new Error('untrusted model timeout claim');
      forged.code = 'model_timeout';
      throw forged;
    },
  };
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    const ordinary = new AbortController();
    const pending = guard.answerFetch(url, requestWithSignal(ordinary.signal));
    await Promise.resolve();
    await assert.rejects(callModel(forgedModel, 'select', 'Synthetic selection.', {}),
      error => error.code === 'model_timeout');
    assert.deepEqual(diagnostics,
      [{ version: 1, stage: 'select', layer: 'core_call', reason: 'model_timeout' }]);
    assert.equal(guard.isHalted(), false);
    assert.deepEqual(guard.caseTimeouts(), []);
    ordinary.abort('ordinary caller cancellation');
    await assert.rejects(pending, guardError('request_aborted'));
  });
  assert.equal(guard.isHalted(), true);
  assert.deepEqual(guard.caseTimeouts(), []);
  assert.equal(guard.attempts()[0].termination, 'other_failure');
  await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async () => {
    await guard.answerFetch(url, request());
  }), guardError('paid_work_halted'));
  assert.equal(calls, 1);
  assert.equal(state(f.ledger).requestCount, 1);
});

test('G3 first observed transport/body failure cannot be relabelled by a later timer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['transport', 'body']) {
    const f = fixture(t);
    const guard = make(f, () => mode === 'transport'
      ? new Promise((_, reject) => setTimeout(() => reject(new Error('synthetic failure')), 5))
      : new Response(new ReadableStream({ pull: () => new Promise((_, reject) =>
        setTimeout(() => reject(new Error('synthetic body failure')), 5)) })), 'bounded-v1');
    const operation = guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
      const pending = assert.rejects(guard.answerFetch(url, request()), guardError('transport_failed'));
      await setImmediate();
      t.mock.timers.tick(5);
      await setImmediate();
      await pending;
    });
    await operation;
    t.mock.timers.tick(10);
    assert.equal(guard.isHalted(), true, mode);
    assert.deepEqual(guard.caseTimeouts(), [], mode);
    assert.equal(guard.attempts()[0].termination, 'other_failure', mode);
    const observation = guard.transportDiagnostics().observations[0];
    assert.equal(observation.termination, mode === 'transport' ? 'transport_failure' : 'body_failure');
    assert.equal(observation.responseAvailableMs !== null, mode === 'body');
    assert.equal(observation.bodyCompleteMs, null);
    guard.close();
  }
  const hostileFixture = fixture(t);
  const hostile = make(hostileFixture, () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(70_000)); },
    cancel() { t.mock.timers.tick(10); },
  })));
  await hostile.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(hostile.answerFetch(url, request()), guardError('response_too_large'));
  });
  assert.equal(hostile.isHalted(), true);
  assert.deepEqual(hostile.caseTimeouts(), []);
  assert.equal(hostile.attempts()[0].termination, 'other_failure');
  hostile.close();

  const throwingFixture = fixture(t);
  const hostileReader = { read() { throw new Error('synthetic synchronous reader failure'); },
    cancel() { t.mock.timers.tick(10); }, releaseLock() {} };
  class ThrowingResponse extends Response {
    get body() { return { getReader: () => hostileReader }; }
  }
  const throwing = make(throwingFixture, () => new ThrowingResponse('ignored'));
  await throwing.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(throwing.answerFetch(url, request()), guardError('transport_failed'));
  });
  assert.equal(throwing.isHalted(), true);
  assert.deepEqual(throwing.caseTimeouts(), []);
  throwing.close();
});

test('G3/G6 real core -> OpenAI adapter -> guard brands only the core timer and fences a late reply', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { stageTimeoutMs: 60_000 });
  let lateReply;
  const calls = [];
  const guard = make(f, async (requestUrl) => {
    calls.push(requestUrl);
    if (calls.length === 1 || calls.length === 3) {
      return new Promise(resolve => setTimeout(() => resolve(countResponse()), 5));
    }
    if (calls.length === 2) return new Promise(resolve => { lateReply = resolve; });
    return generationResponse();
  }, 'bounded-v1');
  t.after(() => guard.close());
  const adapter = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: guard.cairnFetch });
  const input = { messages: [{ index: 0, role: 'user', content: 'Synthetic source.' }] };
  let admittedA = false;
  const persisted = [];
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async (scope) => {
    const core = callModel(adapter, 'extract', 'Synthetic extraction.', input).then(() => { admittedA = true; });
    const rejected = assert.rejects(core, error => error.code === 'model_timeout');
    await setImmediate();
    t.mock.timers.tick(5);
    await setImmediate();
    assert.equal(typeof lateReply, 'function');
    t.mock.timers.tick(29_995);
    await rejected;
    persisted.push(scope.snapshot());
  });
  assert.equal(persisted[0].status, 'timed_out');
  const coreTimeout = guard.transportDiagnostics();
  const frozenTimeout = JSON.stringify(coreTimeout);
  assert.equal(Object.isFrozen(coreTimeout), true);
  assert.equal(Object.isFrozen(coreTimeout.observations), true);
  assert.equal(Object.isFrozen(coreTimeout.observations.at(-1)), true);
  assert.throws(() => { coreTimeout.observations.at(-1).termination = 'response'; }, TypeError);
  assert.equal(coreTimeout.observations.at(-1).termination, 'core_deadline');
  assert.equal(coreTimeout.observations.at(-1).accountingOutcome, 'unknown');
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async () => {
    lateReply(generationResponse());
    await setImmediate();
    assert.equal(admittedA, false);
    assert.equal(guard.transportDiagnostics().total, 0);
    assert.equal(JSON.stringify(coreTimeout), frozenTimeout);
    const completed = callModel(adapter, 'extract', 'Synthetic extraction.', input);
    await setImmediate();
    t.mock.timers.tick(5);
    assert.deepEqual(await completed, { items: [] });
  });
  assert.equal(admittedA, false);
  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(coreTimeout), frozenTimeout);
  assert.deepEqual(guard.transportDiagnostics().observations.map(row => [row.scopeOrdinal, row.route]),
    [[1, 'count'], [1, 'generation']]);
  assert.equal(guard.caseTimeouts()[0].termination, 'core_deadline');
  assert.deepEqual(guard.attempts().map(attempt => attempt.outcome),
    ['succeeded', 'unknown', 'succeeded', 'succeeded']);
});

test('G6 real capture persists timeout boundary, continues next case, and never admits late case A', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { stageTimeoutMs: 60_000 });
  let notifyACount;
  let notifyAStalled;
  let notifyBCount;
  let releaseA;
  const aCountStarted = new Promise(resolve => { notifyACount = resolve; });
  const aStalled = new Promise(resolve => { notifyAStalled = resolve; });
  const bCountStarted = new Promise(resolve => { notifyBCount = resolve; });
  let countOrdinal = 0;
  let generationOrdinal = 0;
  const calls = [];
  const guard = make(f, async (requestUrl, options) => {
    const payload = JSON.parse(options.body);
    const pathname = new URL(requestUrl).pathname;
    const method = payload.text.format.name.replace(/^cairn_/u, '');
    calls.push({ pathname, method });
    if (pathname.endsWith('/input_tokens')) {
      countOrdinal += 1;
      if (countOrdinal === 1 || countOrdinal === 2) {
        (countOrdinal === 1 ? notifyACount : notifyBCount)();
        return new Promise(resolve => setTimeout(() => resolve(countResponse()), 1_000));
      }
      return countResponse();
    }
    generationOrdinal += 1;
    const reply = generationResponseFor(payload, generatedOutput(payload, generationOrdinal));
    if (generationOrdinal === 1) {
      notifyAStalled();
      return new Promise(resolve => { releaseA = () => resolve(reply); });
    }
    return reply;
  });
  const modelClient = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: guard.cairnFetch });
  const databasePath = join(f.root, 'memory.sqlite');
  const core = openMemoryCore({ path: databasePath, model: modelClient });
  t.after(() => { core.close(); guard.close(); });

  let aArtifact;
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async (scope) => {
    const capture = core.capture(captureInput(1));
    await aCountStarted;
    t.mock.timers.tick(1_000);
    await aStalled;
    t.mock.timers.tick(29_000);
    assert.deepEqual(await capture, { ok: false, error: { code: 'model_timeout', retryable: false } });
    assert.equal(scope.snapshot().status, 'timed_out');
    aArtifact = persistBoundary(f.root, 'case-a-boundary.json', {
      scope: scope.snapshot(), attempts: guard.attempts().length,
    });
  });
  assert.equal(lstatSync(aArtifact).mode & 0o777, 0o600);
  assert.equal(memoryCount(databasePath), 0);
  const attemptsAfterA = structuredClone(guard.attempts());

  let bArtifact;
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async (scope) => {
    const capture = core.capture(captureInput(2));
    await bCountStarted;
    releaseA();
    await setImmediate();
    assert.equal(memoryCount(databasePath), 0);
    assert.deepEqual(guard.attempts().slice(0, 2), attemptsAfterA);
    t.mock.timers.tick(1_000);
    const result = await capture;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.admission.memories.length, 1);
    bArtifact = persistBoundary(f.root, 'case-b-boundary.json', {
      scope: scope.snapshot(), attempts: guard.attempts().length,
    });
  });
  assert.equal(lstatSync(bArtifact).mode & 0o777, 0o600);
  assert.equal(memoryCount(databasePath), 1);
  assert.equal(calls.length, 6);
  assert.deepEqual(guard.attempts().map(attempt => attempt.outcome),
    ['succeeded', 'unknown', 'succeeded', 'succeeded', 'succeeded', 'succeeded']);
  assert.deepEqual(guard.attempts().slice(0, 2), attemptsAfterA);
  assert.equal(guard.isHalted(), false);
});

test('G3/G5 malformed, oversized, count-overlimit and usage-bound failures are global', async (t) => {
  const scenarios = [
    ['malformed', () => new Response('{'), request, 'invalid_response'],
    ['oversized', () => new Response('x'.repeat(70_000)), request, 'response_too_large'],
    ['usage', () => Response.json({ id: 'synthetic', object: 'chat.completion', model,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100_001, completion_tokens: 1, total_tokens: 100_002 } }),
    request, 'usage_bound_exceeded'],
  ];
  for (const [label, fetchImpl, makeRequest, code] of scenarios) {
    const f = fixture(t);
    let calls = 0;
    const guard = make(f, (...args) => { calls += 1; return fetchImpl(...args); });
    await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
      await assert.rejects(guard.answerFetch(url, makeRequest()), guardError(code));
    });
    assert.equal(guard.isHalted(), true, label);
    assert.deepEqual(guard.caseTimeouts(), [], label);
    await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-b' }, async () => {}),
      guardError('paid_work_halted'));
    assert.equal(calls, 1, label);
    guard.close();
  }

  const countFixture = fixture(t);
  let countCalls = 0;
  const countGuard = make(countFixture, () => { countCalls += 1; return countResponse(7_025); });
  await countGuard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(countGuard.cairnFetch(countFixture.policy.cairnCount.endpoint, countRequest()),
      guardError('invalid_response'));
  });
  assert.equal(countGuard.isHalted(), true);
  assert.deepEqual(countGuard.attempts()[0].countDiagnostic,
    { reason: 'input_limit_exceeded', observedInputTokens: 7_025, configuredInputLimit: 7_024 });
  assert.equal(countCalls, 1);
  countGuard.close();

  const requestFixture = fixture(t);
  let invalidCalls = 0;
  const invalidGuard = make(requestFixture, () => { invalidCalls += 1; return response(); });
  const malformedRequest = request();
  malformedRequest.body = JSON.stringify({ ...body(), extra: true });
  await invalidGuard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(invalidGuard.answerFetch(url, malformedRequest), guardError('unsupported_request'));
  });
  assert.equal(invalidGuard.isHalted(), true);
  assert.equal(invalidCalls, 0);
  assert.equal(state(requestFixture.ledger).requestCount, 0);
  invalidGuard.close();
});

test('G5 foreign ledger rows, historical edits and binding changes halt before provider work', async (t) => {
  for (const mutation of ['foreign', 'foreign-unsettled', 'history', 'binding']) {
    const f = fixture(t, { historicalUnknown: mutation === 'history' });
    let calls = 0;
    const guard = make(f, () => { calls += 1; return response(); });
    if (mutation === 'foreign' || mutation === 'foreign-unsettled') {
      const external = reopenExperimentBudget(f.ledger);
      const attemptId = randomUUID();
      external.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 1 });
      if (mutation === 'foreign') external.recordOutcome({ attemptId, outcome: 'failed' });
      external.close();
    } else if (mutation === 'history') {
      const database = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
      database.prepare("UPDATE attempts SET outcome = 'failed' WHERE rowid = 1").run();
      database.close();
    } else {
      chmodSync(join(f.ledger.directory, 'experiment-case-deadline-synthetic-execution.json'), 0o644);
    }
    await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
      await guard.answerFetch(url, request());
    }), error => ['policy_mismatch', 'unsafe_policy_binding'].includes(error.code));
    assert.equal(guard.isHalted(), true, mutation);
    assert.equal(calls, 0, mutation);
    guard.close();
  }
});

test('G5 settlement failure leaves the exact reservation unsettled and boundary globally fatal', async (t) => {
  const f = fixture(t);
  let lock;
  const guard = make(f, () => {
    lock = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
    lock.exec('BEGIN IMMEDIATE');
    return response();
  }, 'bounded-v1');
  let persisted = false;
  await assert.rejects(guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(guard.answerFetch(url, request()),
      error => error.name === 'ExperimentBudgetError' && error.code === 'ledger_busy');
    persisted = true;
  }), guardError('guard_busy'));
  assert.equal(persisted, true);
  assert.equal(guard.isHalted(), true);
  assert.equal(guard.attempts()[0].outcome, null);
  assert.equal(state(f.ledger).attempts[0].outcome, null);
  const unsettledObservation = guard.transportDiagnostics().observations[0];
  assert.equal(unsettledObservation.termination, 'response');
  assert.equal(unsettledObservation.settledMs !== null, true);
  assert.equal(unsettledObservation.accountingOutcome, null);
  lock.exec('ROLLBACK');
  lock.close();
  guard.close();
});

test('G5 a priced overrun is distinct from a within-reservation token-bound failure and blocks the ledger', async (t) => {
  const f = fixture(t, { answerReservation: 40_820 });
  const guard = make(f, () => Response.json({ id: 'synthetic', object: 'chat.completion', model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100_001, completion_tokens: 512, total_tokens: 100_513 } }));
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    await assert.rejects(guard.answerFetch(url, request()), guardError('usage_bound_exceeded'));
  });
  assert.equal(guard.isHalted(), true);
  assert.equal(guard.attempts()[0].actualMicroUsd, 40_821);
  assert.equal(state(f.ledger).state, 'overrun');
  guard.close();
});

test('G1/G4 constructor snapshots getters once and a second in-scope send never reserves', async (t) => {
  const f = fixture(t);
  let release;
  let calls = 0;
  const fetchImpl = () => { calls += 1; return new Promise(resolve => { release = () => resolve(response()); }); };
  const values = { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    caseDeadlineCapability: f.caseDeadlineCapability, fetchImpl };
  const reads = {};
  const options = {};
  for (const [key, value] of Object.entries(values)) Object.defineProperty(options, key, { enumerable: true,
    get() { reads[key] = (reads[key] ?? 0) + 1; return value; } });
  const guard = createCaseDeadlineExperimentRequestGuard(options);
  assert.deepEqual(reads, { ledger: 1, policy: 1, benchmarkExtension: 1, caseDeadlineCapability: 1, fetchImpl: 1 });
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    const first = guard.answerFetch(url, request());
    await setImmediate();
    await assert.rejects(guard.answerFetch(url, request()), guardError('guard_busy'));
    assert.equal(calls, 1);
    assert.equal(state(f.ledger).requestCount, 1);
    release();
    await first;
  });
  assert.equal(guard.isHalted(), false);
  guard.close();
});

test('G2 partial claim and unsafe capability bindings are never repaired or made reusable', (t) => {
  const partial = fixture(t);
  const claim = join(partial.ledger.directory, 'experiment-case-deadline-synthetic-execution.claim.json');
  writeFileSync(claim, '{', { mode: 0o600 });
  assert.throws(() => authorizeCaseDeadlineCapability({ ledger: partial.ledger, policy: partial.policy,
    benchmarkExtension: partial.benchmarkExtension, authorizationId: 'synthetic-case-deadline',
    executionId: 'synthetic-execution', checkpoint: partial.caseDeadlineCapability.checkpoint,
    schedule: partial.schedule }), guardError('capability_consumed'));
  assert.equal(readFileSync(claim, 'utf8'), '{');

  const unsafe = fixture(t);
  const binding = join(unsafe.ledger.directory, 'experiment-case-deadline-synthetic-execution.json');
  const target = join(unsafe.root, 'replacement.json');
  writeFileSync(target, readFileSync(binding));
  rmSync(binding);
  symlinkSync(target, binding);
  assert.throws(() => make(unsafe, () => assert.fail('no transport')), guardError('unsafe_policy_binding'));
  assert.throws(() => lstatSync(join(unsafe.ledger.directory,
    'experiment-case-deadline-synthetic-execution.claim.json')), { code: 'ENOENT' });
});

test('G2 a locked claim boundary fails with a fixed envelope before any send or reservation', (t) => {
  const f = fixture(t);
  const database = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  database.exec('BEGIN IMMEDIATE');
  let calls = 0;
  try {
    assert.throws(() => make(f, () => { calls += 1; return response(); }), guardError('capability_busy'));
    assert.equal(calls, 0);
    assert.equal(state(f.ledger).requestCount, 0);
    assert.throws(() => lstatSync(join(f.ledger.directory,
      'experiment-case-deadline-synthetic-execution.claim.json')), { code: 'ENOENT' });
  } finally {
    database.exec('ROLLBACK');
    database.close();
  }
});

test('TD1 invalid diagnostics options reject before consuming a one-shot claim; accessor reads once', (t) => {
  const f = fixture(t);
  const claimPath = join(f.ledger.directory,
    `experiment-case-deadline-${f.caseDeadlineCapability.executionId}.claim.json`);
  const base = { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    caseDeadlineCapability: f.caseDeadlineCapability, fetchImpl: () => response() };
  for (const value of [null, undefined, 7]) {
    assert.throws(() => createCaseDeadlineExperimentRequestGuard(value), guardError('invalid_options'));
  }
  for (const value of [null, undefined, 'other']) {
    assert.throws(() => createCaseDeadlineExperimentRequestGuard({ ...base,
      transportDiagnostics: value }), guardError('invalid_options'));
    assert.throws(() => lstatSync(claimPath), { code: 'ENOENT' });
    assert.equal(state(f.ledger).requestCount, 0);
  }
  assert.throws(() => createBenchmarkExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    fetchImpl: () => response(), transportDiagnostics: 'bounded-v1' }), guardError('invalid_options'));
  assert.throws(() => createExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, fetchImpl: () => response(), transportDiagnostics: 'bounded-v1' }),
  guardError('invalid_options'));
  let reads = 0;
  const options = { ...base };
  Object.defineProperty(options, 'transportDiagnostics', { enumerable: true,
    get() { reads++; return 'bounded-v1'; } });
  const guard = createCaseDeadlineExperimentRequestGuard(options);
  assert.equal(reads, 1);
  assert.equal(typeof guard.transportDiagnostics, 'function');
  guard.close();
});

test('TD2 opt-in count and validated generation methods preserve request and ledger outcomes', async (t) => {
  const exercise = async (enabled) => {
    const f = fixture(t);
    const routes = [];
    const guard = make(f, (requestUrl, options) => {
      routes.push({ url: requestUrl, method: options.method, redirect: options.redirect,
        headers: { ...options.headers }, body: options.body, signalAborted: options.signal.aborted });
      return requestUrl === f.policy.cairnCount.endpoint ? countResponse() : generationResponse();
    }, enabled ? 'bounded-v1' : null);
    let results;
    await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
      const counted = await guard.cairnFetch(f.policy.cairnCount.endpoint, countRequest());
      const generated = await guard.cairnFetch(f.policy.cairnGeneration.endpoint, generationRequest());
      results = [await counted.json(), await generated.json()];
    });
    const diagnostic = guard.transportDiagnostics?.();
    const attempts = guard.attempts().map(({ stage, outcome, actualMicroUsd, termination }) =>
      ({ stage, outcome, actualMicroUsd, termination }));
    const ledger = state(f.ledger).attempts.map(({ channel, reservedMicroUsd, outcome, actualMicroUsd }) =>
      ({ channel, reservedMicroUsd, outcome, actualMicroUsd }));
    assert.equal(Object.hasOwn(guard, 'transportDiagnostics'), enabled);
    guard.close();
    return { results, attempts, ledger, routes, diagnostic };
  };
  const off = await exercise(false);
  const on = await exercise(true);
  assert.deepEqual(on.results, off.results);
  assert.deepEqual(on.attempts, off.attempts);
  assert.deepEqual(on.ledger, off.ledger);
  assert.deepEqual(on.routes, off.routes);
  assert.equal(on.routes.length, 2);
  assert.deepEqual(on.diagnostic.observations.map(({ route, method, accountingOutcome }) =>
    [route, method, accountingOutcome]), [
    ['count', 'unknown', 'succeeded'], ['generation', 'extract', 'succeeded']]);
  assert.equal(off.diagnostic, undefined);
});

test('TD2/TD5 real guard ring retains the 257th failed fake-HTTP attempt and its reservation', async (t) => {
  const f = fixture(t, { stageTimeoutMs: 60_000, limitMicroUsd: 20_000_000, requestCap: 300 });
  let calls = 0;
  const guard = make(f, () => {
    calls += 1;
    if (calls === 257) throw new Error('synthetic transport failure');
    return response();
  }, 'bounded-v1');
  t.after(() => guard.close());
  await guard.withCaseScope({ phase: 'generation', caseId: 'case-a' }, async () => {
    for (let index = 0; index < 256; index += 1) {
      const result = await guard.answerFetch(url, request());
      assert.equal(result.status, 200);
    }
    await assert.rejects(guard.answerFetch(url, request()), guardError('transport_failed'));
  });
  const snapshot = guard.transportDiagnostics();
  assert.equal(calls, 257);
  assert.equal(snapshot.scopeOrdinal, 0);
  assert.equal(snapshot.phase, 'generation');
  assert.equal(snapshot.total, 257);
  assert.equal(snapshot.dropped, 1);
  assert.equal(snapshot.observations.length, 256);
  assert.equal(snapshot.observations[0].attemptOrdinal, 1);
  assert.equal(snapshot.observations.at(-1).attemptOrdinal, 256);
  assert.equal(snapshot.observations.at(-1).termination, 'transport_failure');
  assert.equal(snapshot.observations.at(-1).accountingOutcome, 'unknown');
  assert.equal(snapshot.observations.at(-1).responseAvailableMs, null);
  assert.equal(guard.isHalted(), true);
  assert.equal(state(f.ledger).requestCount, 257);
  assert.equal(state(f.ledger).attempts.at(-1).outcome, 'unknown');
});
