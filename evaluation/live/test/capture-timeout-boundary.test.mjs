import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import {
  authorizeBenchmarkExtension,
  createBenchmarkExperimentRequestGuard,
  createExperimentRequestGuard,
} from '../../experiment-budget/request-guard.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const SYNTHETIC_KEY = 'synthetic-timeout-boundary-key';
const namespace = { ownerId: 'timeout-boundary', scope: 'project', projectId: 'synthetic' };
const COUNT_PATH = '/v1/responses/input_tokens';
const GENERATION_PATH = '/v1/responses';

const captureInput = (index) => ({
  namespace,
  client: 'synthetic',
  eventId: `event-${index}`,
  sessionId: 'session',
  messages: [{ id: `message-${index}`, role: 'user', content: `Preference ${index}.` }],
});

const responseEnvelope = (model, output) => ({
  id: 'resp_synthetic',
  object: 'response',
  model,
  status: 'completed',
  error: null,
  incomplete_details: null,
  output: [{
    id: 'msg_synthetic',
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
  }],
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
});

const generatedOutput = (body, generationIndex) => {
  const method = body.text.format.name.replace(/^cairn_/u, '');
  const input = JSON.parse(body.input[0].content[0].text);
  if (method === 'extract') {
    return { method, output: { items: [{ content: input.messages[0].content,
      kind: 'preference', confidence: 0.9, sourceIndices: [0] }] } };
  }
  assert.equal(method, 'classify');
  return { method, output: { items: input.memories.map((memory) => ({
    memoryId: memory.id,
    parentIds: [],
    newL1: { title: `Preference topic ${generationIndex}`, parentL2Ids: [] },
  })) } };
};

const activeMemoryCount = (databasePath) => {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare("SELECT count(*) AS count FROM memories WHERE deleted = 0 AND currentness = 'current'")
      .get().count;
  } finally { database.close(); }
};

test('capture shares one core deadline across count and generation, then halts without late admission', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-capture-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ledgerOptions = { directory: path.join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 1_000_000, requestCap: 100 };
  createExperimentBudget(ledgerOptions).close();

  const calls = [];
  let countIndex = 0;
  let generationIndex = 0;
  let notifyTimelyCount;
  let notifyTimelyGeneration;
  let notifyTimeoutCount;
  let notifyStalledGeneration;
  let releaseStalledGeneration;
  let stalledSignal;
  const timelyCountStarted = new Promise((resolve) => { notifyTimelyCount = resolve; });
  const timelyGenerationStarted = new Promise((resolve) => { notifyTimelyGeneration = resolve; });
  const timeoutCountStarted = new Promise((resolve) => { notifyTimeoutCount = resolve; });
  const stalledGenerationStarted = new Promise((resolve) => { notifyStalledGeneration = resolve; });

  const fetchImpl = async (url, options) => {
    const pathname = new URL(url).pathname;
    const body = JSON.parse(options.body);
    if (pathname === COUNT_PATH) {
      countIndex += 1;
      calls.push({ pathname, method: body.text.format.name.replace(/^cairn_/u, '') });
      if (countIndex === 1 || countIndex === 11) {
        (countIndex === 1 ? notifyTimelyCount : notifyTimeoutCount)();
        return new Promise((resolve) => setTimeout(() => resolve(Response.json({
          object: 'response.input_tokens', input_tokens: 100,
        })), 1_000));
      }
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    }
    assert.equal(pathname, GENERATION_PATH);
    generationIndex += 1;
    const { method, output } = generatedOutput(body, generationIndex);
    calls.push({ pathname, method });
    if (generationIndex === 1) {
      notifyTimelyGeneration();
      return new Promise((resolve) => setTimeout(() => {
        resolve(Response.json(responseEnvelope(body.model, output)));
      }, 28_000));
    }
    if (generationIndex === 11) {
      stalledSignal = options.signal;
      notifyStalledGeneration();
      return new Promise((resolve) => {
        releaseStalledGeneration = () => resolve(Response.json(responseEnvelope(body.model, output)));
      });
    }
    return Response.json(responseEnvelope(body.model, output));
  };

  const policy = experimentPolicy();
  const bootstrap = createExperimentRequestGuard({ ledger: ledgerOptions, policy,
    fetchImpl: () => assert.fail('bootstrap transport must not run') });
  bootstrap.close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger: ledgerOptions, policy,
    authorizationId: 'synthetic-timeout-boundary', stages: benchmarkStagePolicy() });
  const guard = createBenchmarkExperimentRequestGuard({ ledger: ledgerOptions,
    policy, benchmarkExtension, fetchImpl });
  const diagnostics = [];
  const model = createOpenAIModel({ apiKey: SYNTHETIC_KEY, fetchImpl: guard.cairnFetch,
    onDiagnostic: (event) => diagnostics.push(event) });
  const databasePath = path.join(root, 'memory.sqlite');
  const core = openMemoryCore({ path: databasePath, model });
  t.after(() => { core.close(); guard.close(); });

  const timely = core.capture(captureInput(0));
  await timelyCountStarted;
  t.mock.timers.tick(1_000);
  await timelyGenerationStarted;
  t.mock.timers.tick(28_000);
  const timelyResult = await timely;
  assert.equal(timelyResult.ok, true, JSON.stringify(timelyResult));
  assert.equal(timelyResult.value.classification.status, 'applied');

  for (let index = 1; index < 5; index += 1) {
    const result = await core.capture(captureInput(index));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.admission.memories.length, 1);
    assert.equal(result.value.classification.status, 'applied');
  }

  const timedOut = core.capture(captureInput(5));
  await timeoutCountStarted;
  t.mock.timers.tick(1_000);
  await stalledGenerationStarted;
  assert.equal(calls.length, 22);
  t.mock.timers.tick(28_999);
  assert.equal(stalledSignal.aborted, false);
  assert.equal(guard.isHalted(), false);
  t.mock.timers.tick(1);
  assert.deepEqual(await timedOut,
    { ok: false, error: { code: 'model_timeout', retryable: false } });
  assert.equal(stalledSignal.aborted, true);
  assert.equal(guard.isHalted(), true);

  const attemptsAtHalt = guard.attempts();
  assert.equal(attemptsAtHalt.length, 22);
  assert.deepEqual(attemptsAtHalt.map(({ outcome }) => outcome),
    [...Array(21).fill('succeeded'), 'unknown']);
  const unknownAttempt = attemptsAtHalt.at(-1);
  assert.equal(unknownAttempt.outcome, 'unknown');
  assert.equal(unknownAttempt.actualMicroUsd, null);
  assert.equal(unknownAttempt.usage, null);
  assert.equal(unknownAttempt.reservedMicroUsd, 5_000);
  const stateAtHalt = guard.getState();
  assert.equal(stateAtHalt.reservedMicroUsd, 110_000);
  assert.equal(stateAtHalt.requestCount, 22);
  assert.deepEqual(diagnostics.slice(-2), [
    { version: 1, stage: 'extract', layer: 'core_call', reason: 'model_timeout' },
    { version: 1, stage: 'extract', layer: 'adapter', reason: 'model_cancelled' },
  ]);
  assert.deepEqual(calls.slice(-2), [
    { pathname: COUNT_PATH, method: 'extract' },
    { pathname: GENERATION_PATH, method: 'extract' },
  ]);
  assert.equal(calls.filter(({ pathname }) => pathname === COUNT_PATH).length, 11);
  assert.equal(calls.filter(({ pathname }) => pathname === GENERATION_PATH).length, 11);
  assert.equal(activeMemoryCount(databasePath), 5);

  const attemptsSnapshot = structuredClone(attemptsAtHalt);
  releaseStalledGeneration();
  await setImmediate();
  assert.deepEqual(guard.attempts(), attemptsSnapshot);
  assert.deepEqual(guard.getState(), stateAtHalt);
  assert.equal(activeMemoryCount(databasePath), 5);

  assert.deepEqual(await core.capture(captureInput(6)),
    { ok: false, error: { code: 'extraction_failed', retryable: false } });
  assert.equal(calls.length, 22);
  assert.deepEqual(guard.attempts(), attemptsSnapshot);
  assert.deepEqual(guard.getState(), stateAtHalt);
  assert.equal(activeMemoryCount(databasePath), 5);
});
