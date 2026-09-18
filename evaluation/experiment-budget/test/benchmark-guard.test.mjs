import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';

// Synthetic private ledgers and fake HTTP only: zero network, no environment key.
const filename = 'experiment-benchmark-extension.json';
const key = 'synthetic-benchmark-parent-key-never-expose';
const secretPrompt = 'synthetic-private-question-never-expose';
const ANSWER_MODEL = 'gpt-4.1-mini-2025-04-14';
const JUDGE_MODEL = 'gpt-4o-2024-08-06';
const urls = { host: 'https://api.openai.com/v1/chat/completions',
  count: 'https://api.openai.com/v1/responses/input_tokens', generation: 'https://api.openai.com/v1/responses' };
const price = (microUsdNumerator, tokenDenominator) => ({ microUsdNumerator, tokenDenominator });
const stages = (overrides = {}) => ({
  answer: { endpoint: urls.host, model: ANSWER_MODEL, reservedMicroUsd: 60_000, maxRequestBytes: 1_500_000,
    maxResponseBytes: 262_144, timeoutMs: 5_000, maxInputTokens: 125_000, maxOutputTokens: 512,
    inputTokenFraming: 1_024, inputPrice: price(2, 5), outputPrice: price(8, 5), ...(overrides.answer ?? {}) },
  judge: { endpoint: urls.host, model: JUDGE_MODEL, reservedMicroUsd: 11_000, maxRequestBytes: 100_000,
    maxResponseBytes: 65_536, timeoutMs: 5_000, maxInputTokens: 4_096, maxOutputTokens: 16,
    inputTokenFraming: 256, inputPrice: price(5, 2), outputPrice: price(10, 1), ...(overrides.judge ?? {}) },
});
const answerBody = (overrides = {}) => ({ model: ANSWER_MODEL,
  messages: [{ role: 'system', content: 'Answer using only the supplied evidence.' },
    { role: 'user', content: JSON.stringify({ question: { text: secretPrompt, date: 'Tuesday' }, evidence: [] }) }],
  temperature: 0, max_tokens: 512, n: 1, store: false, stream: false, ...overrides });
const judgeBody = () => ({ model: JUDGE_MODEL,
  messages: [{ role: 'user', content: `Question: ${secretPrompt}\n\nCorrect Answer: Kyoto\n\nModel Response: Kyoto` }],
  n: 1, temperature: 0, max_tokens: 10, store: false, stream: false });
const request = (body, signal = new AbortController().signal) => ({ method: 'POST', redirect: 'error', signal,
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body) });
const chatEnvelope = (model, overrides = {}) => ({ id: 'chatcmpl_synthetic', object: 'chat.completion', model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'Kyoto' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 50, completion_tokens: 3, total_tokens: 53 }, ...overrides });
const extractInput = () => ({ messages: [{ index: 0, role: 'user', content: 'Synthetic source.' }] });
const responsesEnvelope = (inputTokens = 100) => ({ id: 'resp_synthetic', object: 'response', model: DEFAULT_MODEL,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify({ items: [] }), annotations: [] }] }],
  usage: { input_tokens: inputTokens, output_tokens: 5, total_tokens: inputTokens + 5 } });
const fake = (calls, host = (body) => chatEnvelope(body.model)) => async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url, body, rawBody: options.body, headers: options.headers });
  if (url === urls.count) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url === urls.generation) return Response.json(responsesEnvelope());
  return Response.json(host(body));
};

// node:test runs after-hooks in registration order, so the fixture's single hook (registered first)
// drains any in-flight work, closes every tracked guard and only then removes the ledger directory.
function fixture(t, { limitMicroUsd = 50_000_000, requestCap = 1_000, stageOverrides = {}, provision = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-benchmark-guard-'));
  const tracked = [];
  const drains = [];
  t.after(async () => {
    for (const drain of drains) await drain();
    for (const guard of tracked) guard.close();
    rmSync(root, { recursive: true, force: true });
  });
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd, requestCap };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  guards.createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const authorization = { ledger, policy, authorizationId: 'synthetic-benchmark-approval', stages: stages(stageOverrides) };
  return { root, ledger, policy, authorization,
    benchmarkExtension: provision ? guards.authorizeBenchmarkExtension(authorization) : undefined,
    track: (guard) => { tracked.push(guard); return guard; },
    drain: (settle) => { drains.push(settle); } };
}
const make = (f, fetchImpl) => f.track(guards.createBenchmarkExperimentRequestGuard({ ledger: f.ledger,
  policy: f.policy, benchmarkExtension: f.benchmarkExtension, fetchImpl }));
const file = (f) => join(f.ledger.directory, filename);
const state = (ledger) => { const h = reopenExperimentBudget(ledger); try { return h.getState(); } finally { h.close(); } };
const noTransport = () => assert.fail('transport must not be invoked');
const guardError = (code) => (error) => error instanceof guards.ExperimentRequestGuardError && error.code === code
  && error.message === code && !`${error} ${error.stack}`.includes(key) && !`${error} ${error.stack}`.includes(secretPrompt);

test('BG1 authorization writes a private checkpointed record, is idempotent, and rejects changed inputs', (t) => {
  const f = fixture(t);
  const entry = lstatSync(file(f));
  assert.equal(entry.mode & 0o777, 0o600);
  const stored = JSON.parse(readFileSync(file(f), 'utf8'));
  assert.deepEqual(stored.checkpoint, { requestCount: 0, reservedMicroUsd: 0 });
  assert.equal(stored.method, 'benchmark');
  assert.deepEqual(Object.keys(stored.stages).sort(), ['answer', 'judge']);
  assert.equal(stored.stages.judge.model, JUDGE_MODEL);
  assert.equal(JSON.stringify(stored).includes(key), false);
  assert.deepEqual(guards.authorizeBenchmarkExtension(f.authorization), f.benchmarkExtension);
  assert.equal(Object.isFrozen(f.benchmarkExtension.stages.answer), true);
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization, authorizationId: 'other-approval' }),
    guardError('policy_mismatch'));
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization,
    stages: stages({ judge: { maxOutputTokens: 32 } }) }), guardError('policy_mismatch'));
  assert.equal(state(f.ledger).requestCount, 0);
});

test('BG1 invalid stages, missing binding and unsettled ledgers fail before any authorization file exists', (t) => {
  const f = fixture(t, { provision: false });
  const attempt = (stageOverrides) => () => guards.authorizeBenchmarkExtension({ ...f.authorization, stages: stages(stageOverrides) });
  assert.throws(attempt({ judge: { model: ANSWER_MODEL } }), guardError('invalid_extension'));
  assert.throws(attempt({ answer: { model: JUDGE_MODEL } }), guardError('invalid_extension'));
  assert.throws(attempt({ answer: { endpoint: urls.generation } }), guardError('invalid_extension'));
  assert.throws(attempt({ answer: { reservedMicroUsd: 100 } }), guardError('invalid_extension'));
  assert.throws(attempt({ judge: { maxOutputTokens: 0 } }), guardError('invalid_extension'));
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization,
    stages: { answer: stages().answer } }), guardError('invalid_extension'));
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization,
    stages: { ...stages(), extra: stages().answer } }), guardError('invalid_extension'));
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization,
    stages: { ...stages(), answer: { ...stages().answer, top_p: 1 } } }), guardError('invalid_extension'));
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization, authorizationId: 'bad id' }),
    guardError('invalid_extension'));
  assert.throws(() => lstatSync(file(f)), { code: 'ENOENT' });
  const unsettled = reopenExperimentBudget(f.ledger);
  unsettled.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1 });
  unsettled.close();
  assert.throws(() => guards.authorizeBenchmarkExtension(f.authorization), guardError('extension_busy'));
  assert.throws(() => lstatSync(file(f)), { code: 'ENOENT' });
  const root = mkdtempSync(join(tmpdir(), 'cairn-benchmark-unbound-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 1_000_000, requestCap: 10 };
  createExperimentBudget(ledger).close();
  assert.throws(() => guards.authorizeBenchmarkExtension({ ...f.authorization, ledger }),
    guardError('unsafe_policy_binding'));
});

test('BG2 handle shape, denied host channel, and older guards never gain the stages', async (t) => {
  const f = fixture(t);
  const guard = make(f, noTransport);
  assert.deepEqual(Object.keys(guard).sort(), ['answerFetch', 'attempts', 'cairnFetch', 'close', 'getState',
    'hostFetch', 'isHalted', 'judgeFetch', 'policy', 'stages']);
  assert.equal(Object.isFrozen(guard), true);
  assert.equal(guard.stages.answer.model, ANSWER_MODEL);
  assert.equal(guard.isHalted(), false);
  await assert.rejects(guard.hostFetch(urls.host, request(answerBody())), guardError('unsupported_request'));
  assert.deepEqual(guard.attempts(), []);
  assert.equal(guard.getState().requestCount, 0);
  const base = { ledger: f.ledger, policy: f.policy, fetchImpl: noTransport };
  const token = f.benchmarkExtension;
  assert.throws(() => guards.createExtendedExperimentRequestGuard({ ...base, extension: token }), guardError('invalid_extension'));
  assert.throws(() => guards.createReconciliationExperimentRequestGuard({ ...base, extension: token, reconciliationExtension: token }),
    guardError('invalid_extension'));
  assert.throws(() => guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension: token }), guardError('invalid_extension'));
  assert.throws(() => guards.createCandidateQualificationExperimentRequestGuard({ ...base, candidateQualificationExtension: token }),
    guardError('invalid_extension'));
  assert.throws(() => guards.createRationaleExperimentRequestGuard({ ...base, rationaleExtension: token }), guardError('invalid_extension'));
  assert.throws(() => guards.createChecklistSelectionExperimentRequestGuard({ ...base, checklistSelectionExtension: token }),
    guardError('invalid_extension'));
  assert.throws(() => guards.createRationaleModelsExperimentRequestGuard({ ...base, rationaleModelsExtension: token }),
    guardError('invalid_extension'));
  assert.throws(() => guards.createBasisModelsExperimentRequestGuard({ ...base, basisModelsExtension: token }),
    guardError('invalid_extension'));
  const baseline = f.track(guards.createExperimentRequestGuard(base));
  assert.equal(baseline.answerFetch, undefined);
  assert.equal(baseline.judgeFetch, undefined);
  const rationale = guards.authorizeRationaleExtension({ ledger: f.ledger, policy: f.policy, authorizationId: 'synthetic-rationale' });
  assert.throws(() => guards.createBenchmarkExperimentRequestGuard({ ...base, benchmarkExtension: rationale }), guardError('invalid_extension'));
  assert.throws(() => guards.createBenchmarkExperimentRequestGuard({ ...base, benchmarkExtension: 'token' }), guardError('invalid_extension'));
  assert.equal(state(f.ledger).requestCount, 0);
});

test('BG3 every disallowed stage request is rejected before reservation or transport', async (t) => {
  const f = fixture(t);
  let sends = 0;
  const guard = make(f, () => { sends += 1; assert.fail('must not send'); });
  const cases = [
    ['answer', answerBody({ model: JUDGE_MODEL }), 'unsupported_request'],
    ['judge', { ...judgeBody(), model: ANSWER_MODEL }, 'unsupported_request'],
    ['answer', answerBody({ top_p: 1 }), 'unsupported_request'],
    ['answer', answerBody({ temperature: 0.5 }), 'unsupported_request'],
    ['answer', answerBody({ n: 2 }), 'unsupported_request'],
    ['answer', (() => { const body = answerBody(); delete body.store; return body; })(), 'unsupported_request'],
    ['answer', (() => { const body = answerBody(); delete body.stream; return body; })(), 'unsupported_request'],
    ['answer', answerBody({ store: true }), 'unsupported_request'],
    ['answer', answerBody({ stream: true }), 'unsupported_request'],
    ['answer', (() => { const body = answerBody(); delete body.max_tokens; body.max_completion_tokens = 512; return body; })(),
      'unsupported_request'],
    ['answer', answerBody({ max_tokens: 513 }), 'unsupported_request'],
    ['answer', answerBody({ max_tokens: 0 }), 'unsupported_request'],
    ['answer', answerBody({ messages: [] }), 'unsupported_request'],
    ['answer', answerBody({ messages: [{ role: 'user', content: 'x', name: 'n' }] }), 'unsupported_request'],
    ['answer', answerBody({ messages: [{ role: 'tool', content: 'x' }] }), 'unsupported_request'],
    ['answer', answerBody({ messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }), 'unsupported_request'],
    ['judge', { ...judgeBody(), messages: [{ role: 'user', content: 'word '.repeat(6_000) }] }, 'input_bound_exceeded'],
  ];
  for (const [stage, body, code] of cases) {
    await assert.rejects(guard[`${stage}Fetch`](urls.host, request(body)), guardError(code), JSON.stringify(Object.keys(body)));
  }
  await assert.rejects(guard.answerFetch(urls.count, request(answerBody())), guardError('invalid_request'));
  await assert.rejects(guard.answerFetch(urls.host, { ...request(answerBody()), headers: { 'Content-Type': 'application/json' } }),
    guardError('invalid_request'));
  await assert.rejects(guard.answerFetch(urls.host, { ...request(answerBody()), method: 'GET' }), guardError('invalid_request'));
  await assert.rejects(guard.answerFetch(urls.host, request('{')), guardError('invalid_request'));
  await assert.rejects(guard.judgeFetch(urls.host, request({ ...judgeBody(), messages: [{ role: 'user', content: 'x'.repeat(100_001) }] })),
    guardError('request_too_large'));
  assert.equal(sends, 0);
  assert.deepEqual(guard.attempts(), []);
  assert.equal(guard.getState().requestCount, 0);
  assert.equal(guard.isHalted(), false);
});

test('BG3/BG6 the judge and answer stages pass the caller body through unchanged and record priced attempts', async (t) => {
  const f = fixture(t);
  const calls = [];
  const guard = make(f, fake(calls));
  const judgeResponse = await guard.judgeFetch(urls.host, request(judgeBody()));
  assert.equal((await judgeResponse.json()).choices[0].message.content, 'Kyoto');
  assert.equal(calls[0].rawBody, JSON.stringify(judgeBody()));
  assert.equal(new Headers(calls[0].headers).get('authorization'), `Bearer ${key}`);
  assert.equal(calls[0].url, urls.host);
  const answerResponse = await guard.answerFetch(urls.host, request(answerBody()));
  assert.equal((await answerResponse.json()).model, ANSWER_MODEL);
  assert.equal(calls[1].rawBody, JSON.stringify(answerBody()));
  const attempts = guard.attempts();
  assert.equal(Object.isFrozen(attempts), true);
  assert.deepEqual(attempts.map((item) => Object.keys(item).sort()), Array(2).fill(['actualMicroUsd', 'attemptId',
    'elapsedMs', 'endpoint', 'ledgerChannel', 'model', 'outcome', 'rates', 'reservedMicroUsd', 'settledAt', 'stage',
    'startedAt', 'usage']));
  assert.deepEqual(attempts.map((item) => item.rates), [
    { inputPrice: price(5, 2), outputPrice: price(10, 1) }, { inputPrice: price(2, 5), outputPrice: price(8, 5) }]);
  assert.equal(Object.isFrozen(attempts[0].rates.inputPrice), true);
  assert.deepEqual(attempts.map(({ stage, ledgerChannel, model, endpoint, reservedMicroUsd, outcome, actualMicroUsd, usage }) =>
    ({ stage, ledgerChannel, model, endpoint, reservedMicroUsd, outcome, actualMicroUsd, usage })), [
    { stage: 'judge', ledgerChannel: 'host-completion', model: JUDGE_MODEL, endpoint: urls.host, reservedMicroUsd: 11_000,
      outcome: 'succeeded', actualMicroUsd: 155, usage: { inputTokens: 50, outputTokens: 3 } },
    { stage: 'answer', ledgerChannel: 'host-completion', model: ANSWER_MODEL, endpoint: urls.host, reservedMicroUsd: 60_000,
      outcome: 'succeeded', actualMicroUsd: 25, usage: { inputTokens: 50, outputTokens: 3 } },
  ]);
  for (const item of attempts) {
    assert.ok(item.startedAt <= item.settledAt && item.elapsedMs >= 0);
    assert.match(item.attemptId, /^[0-9a-f-]{36}$/u);
  }
  const serialized = JSON.stringify(attempts);
  assert.equal(serialized.includes('Bearer'), false);
  assert.equal(serialized.includes(key), false);
  assert.equal(serialized.includes(secretPrompt), false);
  assert.equal(serialized.includes('Kyoto'), false);
  const ledgerState = guard.getState();
  assert.deepEqual(ledgerState.attempts.map((item) => [item.channel, item.reservedMicroUsd, item.outcome, item.actualMicroUsd]),
    [['host-completion', 11_000, 'succeeded', 155], ['host-completion', 60_000, 'succeeded', 25]]);
  assert.equal(ledgerState.attempts[0].attemptId, attempts[0].attemptId);
  assert.equal(guard.isHalted(), false);
});

test('BG4 reservation precedes transport, failures never refund, and caps stop sends', async (t) => {
  const f = fixture(t, { limitMicroUsd: 70_000, requestCap: 3 });
  let observedDuringSend = null;
  const guard = make(f, async (url, options) => {
    observedDuringSend = state(f.ledger);
    return Response.json(chatEnvelope(JSON.parse(options.body).model), { status: 500 });
  });
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody())), guardError('http_failed'));
  assert.equal(observedDuringSend.reservedMicroUsd, 60_000);
  assert.equal(observedDuringSend.attempts[0].outcome, null);
  assert.deepEqual(guard.attempts().map((item) => [item.outcome, item.actualMicroUsd]), [['failed', null]]);
  assert.equal(guard.getState().reservedMicroUsd, 60_000);
  assert.equal(guard.isHalted(), false);
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody())), (error) =>
    error.code === 'budget_exceeded' && error.name === 'ExperimentBudgetError');
  assert.equal(guard.getState().requestCount, 1);
  const g2 = fixture(t, { requestCap: 1 });
  const calls = [];
  const capped = make(g2, fake(calls));
  await capped.judgeFetch(urls.host, request(judgeBody()));
  await assert.rejects(capped.judgeFetch(urls.host, request(judgeBody())), (error) =>
    error.code === 'request_cap_exceeded' && error.name === 'ExperimentBudgetError');
  assert.equal(calls.length, 1);
  assert.equal(capped.getState().requestCount, 1);
});

test('BG5 timeout, malformed response and missing usage settle unknown and halt further paid work', async (t) => {
  for (const [label, fetchImpl, code] of [
    ['timeout', (url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }), 'request_timeout'],
    ['malformed', async () => new Response('not json', { status: 200 }), 'invalid_response'],
    ['missing-usage', async () => Response.json({ ...chatEnvelope(JUDGE_MODEL), usage: undefined }), 'invalid_response'],
    ['wrong-model', async () => Response.json(chatEnvelope(ANSWER_MODEL)), 'invalid_response'],
    ['transport-throw', async () => { throw new Error(secretPrompt); }, 'transport_failed'],
  ]) {
    const f = fixture(t, { stageOverrides: { judge: { timeoutMs: 20 } } });
    let sends = 0;
    const guard = make(f, (url, options) => { sends += 1; return fetchImpl(url, options); });
    await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), guardError(code), label);
    assert.equal(guard.isHalted(), true, label);
    assert.deepEqual(guard.attempts().map((item) => [item.stage, item.outcome, item.actualMicroUsd, item.usage]),
      [['judge', 'unknown', null, null]], label);
    for (const send of [() => guard.judgeFetch(urls.host, request(judgeBody())),
      () => guard.answerFetch(urls.host, request(answerBody())),
      () => guard.cairnFetch(urls.count, request({}))]) {
      await assert.rejects(send(), guardError('paid_work_halted'), label);
    }
    assert.equal(sends, 1, label);
    assert.equal(guard.getState().requestCount, 1, label);
    assert.equal(guard.getState().reservedMicroUsd, 11_000, label);
  }
});

test('BG5 an overrun response persists, halts this guard, and blocks the ledger for a new guard', async (t) => {
  const f = fixture(t);
  const guard = make(f, async () => Response.json(chatEnvelope(JUDGE_MODEL,
    { usage: { prompt_tokens: 4_000, completion_tokens: 10, total_tokens: 4_010 } })));
  const within = await guard.judgeFetch(urls.host, request(judgeBody()));
  assert.equal((await within.json()).usage.prompt_tokens, 4_000);
  assert.equal(guard.attempts()[0].outcome, 'succeeded');
  assert.equal(guard.attempts()[0].actualMicroUsd, 10_100);
  assert.equal(guard.isHalted(), false, 'priced usage within the reservation and bounds completes normally');
  const overrun = fixture(t);
  const guard2 = make(overrun, async () => Response.json(chatEnvelope(JUDGE_MODEL,
    { usage: { prompt_tokens: 4_096, completion_tokens: 16, total_tokens: 4_112 } })));
  await assert.rejects(guard2.judgeFetch(urls.host, request(judgeBody())), guardError('usage_bound_exceeded'));
  assert.equal(guard2.attempts()[0].actualMicroUsd, 10_400);
  assert.equal(guard2.isHalted(), false);
  const big = fixture(t);
  const guard3 = make(big, async () => Response.json(chatEnvelope(JUDGE_MODEL,
    { usage: { prompt_tokens: 4_096, completion_tokens: 16_000, total_tokens: 20_096 } })));
  await assert.rejects(guard3.judgeFetch(urls.host, request(judgeBody())), guardError('usage_bound_exceeded'));
  assert.equal(guard3.attempts()[0].outcome, 'succeeded');
  assert.equal(guard3.attempts()[0].actualMicroUsd, 170_240);
  assert.equal(guard3.isHalted(), true);
  assert.equal(guard3.getState().state, 'overrun');
  await assert.rejects(guard3.answerFetch(urls.host, request(answerBody())), guardError('paid_work_halted'));
  const guard4 = make(big, noTransport);
  await assert.rejects(guard4.answerFetch(urls.host, request(answerBody())), (error) =>
    error.code === 'budget_blocked' && error.name === 'ExperimentBudgetError');
});

test('BG5 a foreign unsettled ledger attempt halts a benchmark guard; a fresh guard after settlement proceeds', async (t) => {
  const f = fixture(t);
  const foreign = reopenExperimentBudget(f.ledger);
  const attemptId = randomUUID();
  foreign.reserve({ attemptId, channel: 'cairn-count', reservedMicroUsd: 1 });
  foreign.close();
  const halted = make(f, noTransport);
  assert.equal(halted.isHalted(), true);
  await assert.rejects(halted.answerFetch(urls.host, request(answerBody())), guardError('paid_work_halted'));
  assert.equal(halted.getState().requestCount, 1);
  const calls = [];
  const live = make(f, fake(calls));
  assert.equal(live.isHalted(), true);
  const settle = reopenExperimentBudget(f.ledger);
  settle.recordOutcome({ attemptId, outcome: 'failed' });
  settle.close();
  const fresh = make(f, fake(calls));
  assert.equal(fresh.isHalted(), false);
  await fresh.judgeFetch(urls.host, request(judgeBody()));
  assert.equal(calls.length, 1);
  assert.equal(fresh.getState().requestCount, 2);
});

test('BG7 restart re-reads the extension, keeps the ledger history, and rejects tampered or missing files', async (t) => {
  const f = fixture(t);
  const calls = [];
  const first = make(f, fake(calls));
  try { await first.answerFetch(urls.host, request(answerBody())); } finally { first.close(); }
  assert.throws(() => first.getState(), guardError('guard_closed'));
  const second = make(f, fake(calls));
  try {
    assert.deepEqual(second.attempts(), []);
    assert.equal(second.getState().requestCount, 1);
    await second.judgeFetch(urls.host, request(judgeBody()));
    assert.equal(second.getState().requestCount, 2);
    assert.equal(second.attempts().length, 1);
  } finally { second.close(); }
  const reauthorized = guards.authorizeBenchmarkExtension(f.authorization);
  assert.deepEqual(reauthorized, f.benchmarkExtension);
  const forged = { ...f.benchmarkExtension, checkpoint: { requestCount: 1, reservedMicroUsd: 60_000 } };
  assert.throws(() => make({ ...f, benchmarkExtension: forged }, noTransport), guardError('policy_mismatch'));
  const original = readFileSync(file(f), 'utf8');
  writeFileSync(file(f), original.replace('"authorizationId":"synthetic-benchmark-approval"',
    '"authorizationId":"synthetic-benchmark-tampered"'));
  chmodSync(file(f), 0o600);
  assert.throws(() => make(f, noTransport), guardError('policy_mismatch'));
  assert.throws(() => guards.authorizeBenchmarkExtension(f.authorization), guardError('policy_mismatch'));
  writeFileSync(file(f), original);
  chmodSync(file(f), 0o644);
  assert.throws(() => make(f, noTransport), guardError('unsafe_policy_binding'));
  chmodSync(file(f), 0o600);
  const restored = make(f, noTransport);
  restored.close();
  unlinkSync(file(f));
  assert.throws(() => make(f, noTransport), guardError('unsafe_policy_binding'));
  assert.equal(state(f.ledger).requestCount, 2);
});

test('BG7 the actual OpenAI adapter runs baseline Cairn methods through the benchmark guard, nothing wider', async (t) => {
  const f = fixture(t);
  const calls = [];
  const guard = make(f, fake(calls));
  const model = createOpenAIModel({ apiKey: key, fetchImpl: guard.cairnFetch });
  assert.deepEqual(await model.extract({ system: 'Synthetic extraction.', input: extractInput(), maxOutputTokens: 1024,
    signal: new AbortController().signal }), { items: [] });
  assert.deepEqual(calls.map((call) => [call.url, call.body.model, call.body.text.format.name]),
    [[urls.count, DEFAULT_MODEL, 'cairn_extract'], [urls.generation, DEFAULT_MODEL, 'cairn_extract']]);
  assert.deepEqual(guard.attempts().map(({ stage, ledgerChannel, reservedMicroUsd, outcome, actualMicroUsd, usage }) =>
    ({ stage, ledgerChannel, reservedMicroUsd, outcome, actualMicroUsd, usage })), [
    { stage: 'cairn-count', ledgerChannel: 'cairn-count', reservedMicroUsd: 5_000, outcome: 'succeeded', actualMicroUsd: null, usage: null },
    { stage: 'cairn-generation', ledgerChannel: 'cairn-generation', reservedMicroUsd: 5_000, outcome: 'succeeded',
      actualMicroUsd: 48, usage: { inputTokens: 100, outputTokens: 5 } },
  ]);
  const body = (name, extractionModel = DEFAULT_MODEL, generation = true) => ({ model: extractionModel,
    instructions: 'Synthetic.',
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(extractInput()) }] }],
    truncation: 'disabled',
    text: { format: { name, type: 'json_schema', strict: true, schema: schemasFor('extract', extractInput()) } },
    ...(extractionModel === DEFAULT_MODEL ? {} : { reasoning: { effort: 'none' } }),
    ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) });
  await assert.rejects(guard.cairnFetch(urls.generation, request(body('cairn_extract', LUNA_EXTRACTION_MODEL))),
    guardError('unsupported_request'));
  await assert.rejects(guard.cairnFetch(urls.count, request(body('cairn_relate', DEFAULT_MODEL, false))),
    guardError('unsupported_request'));
  await assert.rejects(async () => guard.cairnFetch(urls.host, request(answerBody())), guardError('invalid_request'));
  assert.equal(guard.getState().requestCount, 2);
  assert.equal(calls.length, 2);
});

test('BG5/BG7 an external abort before send settles nothing and sends nothing', async (t) => {
  const f = fixture(t);
  let sends = 0;
  const guard = make(f, () => { sends += 1; assert.fail('must not send'); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody(), controller.signal)), guardError('request_aborted'));
  assert.equal(sends, 0);
  assert.deepEqual(guard.attempts(), []);
  assert.equal(guard.getState().requestCount, 0);
  assert.equal(guard.isHalted(), false);
});

test('BG5 a ledger lock during settlement leaves the attempt unsettled and halts later paid work', async (t) => {
  const f = fixture(t);
  let sends = 0;
  let lock;
  const guard = make(f, async () => {
    sends += 1;
    lock = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
    lock.exec('BEGIN IMMEDIATE');
    return Response.json(chatEnvelope(JUDGE_MODEL));
  });
  await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), (error) =>
    error.name === 'ExperimentBudgetError' && error.code === 'ledger_busy');
  lock.exec('ROLLBACK');
  lock.close();
  assert.equal(guard.isHalted(), true);
  const stuck = guard.getState();
  assert.equal(stuck.attempts.length, 1);
  assert.equal(stuck.attempts[0].outcome, null);
  assert.equal(stuck.reservedMicroUsd, 11_000);
  assert.deepEqual(guard.attempts().map((item) => [item.outcome, item.actualMicroUsd, item.settledAt, item.usage]),
    [[null, null, null, { inputTokens: 50, outputTokens: 3 }]]);
  await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), guardError('paid_work_halted'));
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody())), guardError('paid_work_halted'));
  assert.equal(sends, 1);
  assert.equal(guard.getState().requestCount, 1);
  const stillHalted = make(f, noTransport);
  assert.equal(stillHalted.isHalted(), true);
  const settle = reopenExperimentBudget(f.ledger);
  settle.recordOutcome({ attemptId: stuck.attempts[0].attemptId, outcome: 'unknown' });
  settle.close();
  const calls = [];
  const fresh = make(f, fake(calls));
  assert.equal(fresh.isHalted(), false);
  await fresh.judgeFetch(urls.host, request(judgeBody()));
  assert.equal(calls.length, 1);
  assert.equal(fresh.getState().requestCount, 2);
});

test('BG5 an external abort after reservation settles unknown, keeps the reservation and halts', async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  let sends = 0;
  const guard = make(f, (url, options) => { sends += 1; return new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    controller.abort();
  }); });
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody(), controller.signal)), guardError('request_aborted'));
  assert.equal(sends, 1);
  assert.deepEqual(guard.attempts().map((item) => [item.stage, item.outcome, item.actualMicroUsd]), [['answer', 'unknown', null]]);
  assert.equal(guard.getState().reservedMicroUsd, 60_000);
  assert.equal(guard.getState().attempts[0].outcome, 'unknown');
  assert.equal(guard.isHalted(), true);
  await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), guardError('paid_work_halted'));
  assert.equal(sends, 1);
});

test('BG5 a foreign unsettled attempt that appears after construction halts before the next reservation', async (t) => {
  const f = fixture(t);
  let sends = 0;
  const guard = make(f, () => { sends += 1; assert.fail('must not send'); });
  assert.equal(guard.isHalted(), false);
  const foreign = reopenExperimentBudget(f.ledger);
  foreign.reserve({ attemptId: randomUUID(), channel: 'cairn-generation', reservedMicroUsd: 1 });
  foreign.close();
  await assert.rejects(guard.answerFetch(urls.host, request(answerBody())), guardError('paid_work_halted'));
  assert.equal(guard.isHalted(), true);
  assert.equal(sends, 0);
  assert.deepEqual(guard.attempts(), []);
  assert.equal(guard.getState().requestCount, 1);
});

test('BG4/BG5 two concurrent in-flight calls both reserve, block close, and both settle', async (t) => {
  const f = fixture(t);
  const releases = [];
  const guard = make(f, (url, options) => new Promise((resolve) => {
    releases.push(() => resolve(Response.json(chatEnvelope(JSON.parse(options.body).model))));
  }));
  const pendingJudge = guard.judgeFetch(urls.host, request(judgeBody()));
  const pendingAnswer = guard.answerFetch(urls.host, request(answerBody()));
  // An assertion failure below must not leak in-flight work: release, settle, then the fixture closes.
  f.drain(async () => { for (const release of releases) release(); await Promise.allSettled([pendingJudge, pendingAnswer]); });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(releases.length, 2);
  assert.equal(guard.getState().requestCount, 2);
  assert.equal(guard.getState().reservedMicroUsd, 71_000);
  assert.deepEqual(guard.getState().attempts.map((item) => item.outcome), [null, null]);
  assert.throws(() => guard.close(), guardError('guard_busy'));
  assert.equal(guard.isHalted(), false);
  for (const release of releases) release();
  assert.equal((await pendingJudge).status, 200);
  assert.equal((await pendingAnswer).status, 200);
  assert.deepEqual(guard.attempts().map((item) => [item.stage, item.outcome]), [['judge', 'succeeded'], ['answer', 'succeeded']]);
  assert.equal(guard.isHalted(), false);
  guard.close();
});

test('BG5 oversized and non-Response transport results settle unknown and halt', async (t) => {
  for (const [label, fetchImpl, code] of [
    ['response-too-large', async () => new Response('x'.repeat(70_000), { status: 200 }), 'response_too_large'],
    ['non-response', async () => ({ ok: true, status: 200 }), 'transport_failed'],
  ]) {
    const f = fixture(t);
    let sends = 0;
    const guard = make(f, (url, options) => { sends += 1; return fetchImpl(url, options); });
    await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), guardError(code), label);
    assert.deepEqual(guard.attempts().map((item) => [item.outcome, item.actualMicroUsd]), [['unknown', null]], label);
    assert.equal(guard.isHalted(), true, label);
    await assert.rejects(guard.judgeFetch(urls.host, request(judgeBody())), guardError('paid_work_halted'), label);
    assert.equal(sends, 1, label);
    assert.equal(guard.getState().reservedMicroUsd, 11_000, label);
  }
});

test('BG1 authorization on an overrun ledger fails extension_busy without writing a file', (t) => {
  const f = fixture(t, { provision: false });
  const handle = reopenExperimentBudget(f.ledger);
  const attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 1 });
  handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 5 });
  assert.equal(handle.getState().state, 'overrun');
  handle.close();
  assert.throws(() => guards.authorizeBenchmarkExtension(f.authorization), guardError('extension_busy'));
  assert.throws(() => lstatSync(file(f)), { code: 'ENOENT' });
});

test('BG3 the 128-message boundary is accepted and 129 messages are rejected before reservation', async (t) => {
  const f = fixture(t);
  const calls = [];
  const guard = make(f, fake(calls));
  const messages = (count) => Array.from({ length: count }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `turn ${index}` }));
  await assert.rejects(guard.judgeFetch(urls.host, request({ ...judgeBody(), messages: messages(129) })), guardError('unsupported_request'));
  assert.equal(calls.length, 0);
  assert.equal(guard.getState().requestCount, 0);
  const response = await guard.judgeFetch(urls.host, request({ ...judgeBody(), messages: messages(128) }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.messages.length, 128);
  assert.equal(guard.getState().requestCount, 1);
});
