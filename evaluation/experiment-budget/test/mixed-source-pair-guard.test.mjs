import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync,
  rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, reopenEmbeddingExperimentBudget,
  reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { assertChainedBenchmarkParentForEmbeddingSnapshot,
  authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeMixedSourcePairCapability, createExperimentRequestGuard,
  createMixedSourcePairExperimentRequestGuard, inspectMixedSourcePairParent } from '../request-guard.mjs';
import { mem0WireProfile } from '../mem0-wire.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';
import { callModel } from '../../../core/model-call.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const rejected = code => error => error?.code === code && error.message === code;
const sha = value => createHash('sha256').update(value).digest('hex');
const questionId = `lme-case-${'a'.repeat(64)}`;
const scopeId = name => `lme-case-${sha(JSON.stringify([
  'cairn.lme.mixed-source-pair.scope.v1', [questionId, name]]))}`;
const roster = [{ questionId, protocolDigest: 'b'.repeat(64),
  armOrder: ['cairn', 'mem0'], arms: ['cairn', 'mem0'].map(name => ({ name, scopeId: scopeId(name) })) }];
const manifest = () => ({ sourceProtocolSha256: '1'.repeat(64),
  contextProtocolSha256: '2'.repeat(64), answerProtocolSha256: '3'.repeat(64),
  scorerProtocolSha256: '4'.repeat(64), cairn: { runtimeArtifactSha256: '5'.repeat(64),
    adapterConfigurationSha256: '6'.repeat(64), qualificationInputProfile: 'adaptive-text-catalog-v1',
    captureSourcePolicy: 'indexed-windows-v1' }, mem0: { version: '2.2.0',
    sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64),
    configurationSha256: '9'.repeat(64), wireProfile: structuredClone(mem0WireProfile()) } });
const caps = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });
const limits = () => ({ phaseCaps: { generation: caps(50, 1_000_000),
  scoring: caps(20, 100_000) }, caseCaps: {
  cairn: { generation: caps(20, 200_000), scoring: caps(5, 20_000) },
  mem0: { generation: caps(20, 100_000), scoring: caps(5, 20_000) },
}, mem0TimeoutMs: 1000 });
const request = body => ({ method: 'POST', redirect: 'error',
  signal: new AbortController().signal,
  headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });
const chat = () => ({ model: 'gpt-4.1-mini-2025-04-14', messages: [
  { role: 'system', content: 'Synthetic system.' }, { role: 'user', content: 'Synthetic user.' }],
max_tokens: 2000, temperature: 0.1, top_p: 0.1,
response_format: { type: 'json_object' }, store: false });
const embedding = input => ({ model: 'text-embedding-3-small', input,
  dimensions: 1536, encoding_format: 'float' });
const embeddingResponse = count => ({ object: 'list', model: 'text-embedding-3-small',
  usage: { prompt_tokens: count, total_tokens: count },
  data: Array.from({ length: count }, (_, index) => ({ object: 'embedding', index,
    embedding: Array(1536).fill(0) })) });
const chatResponse = (memory = []) => ({ object: 'chat.completion',
  model: 'gpt-4.1-mini-2025-04-14', usage: {
    prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
    content: JSON.stringify({ memory }) } }] });
const stageRequest = stage => request({ model: stage.model,
  messages: [{ role: 'user', content: 'Synthetic question.' }], n: 1,
  temperature: 0, max_tokens: 16, store: false, stream: false });

async function cairnWire(inputMode = 'indexed-windows-v1') {
  const captured = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    captured.push({ url, body });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens',
      input_tokens: 100 });
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"items":[]}' }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  } });
  await model.extract({ system: 'Synthetic source.', input: { ...(inputMode ? { inputMode } : {}),
    messages: [{ index: 0, messageIndex: 0, role: 'user', content: 'Synthetic indexed source.' }] },
  maxOutputTokens: 1024, signal: new AbortController().signal });
  return captured;
}

async function qualificationWire(input, qualificationInputMode = 'adaptive-text-catalog-v1') {
  const captured = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', qualificationInputMode,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      captured.push({ url, body });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens',
        input_tokens: 100 });
      const empty = { value: null, evidenceIndices: [] };
      const unknown = { value: 'unknown', evidenceIndices: [] };
      const output = qualificationPoolWire(input, { qualifications: [{ itemIndex: 0,
        subject: empty, property: empty, scope: empty, applies: empty, value: empty,
        attribution: unknown, commitment: unknown }] });
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    } });
  await model.qualifyCandidates({ system: 'Synthetic system.', input, maxOutputTokens: 1024,
    signal: new AbortController().signal });
  return captured;
}

function add(configuration, amount, outcome, actual) {
  const handle = reopenExperimentBudget(configuration);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: amount });
    handle.recordOutcome(actual === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd: actual });
  } finally { handle.close(); }
}

function fixture(t, changed = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-mixed-guard-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'ledger space'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('setup cannot send') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'mixed-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'mixed-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  add(second, 13, 'unknown');
  add(second, 17, 'succeeded', 9);
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'mixed-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  add(prior, 19, 'failed');
  const ledger = { ...prior, limitMicroUsd: 200_000_000, requestCap: 80 };
  const benchmarkExtension = authorizeChainedBenchmarkBudgetExtension({ oldLedger: prior,
    policy, parentBudgetExtension: parent, authorizationId: 'mixed-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 80,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  add(ledger, 23, 'unknown');
  const before = inspectExperimentBudgetForEmbeddingUpgrade(ledger);
  upgradeExperimentBudgetForEmbeddings({ ...ledger,
    expectedCheckpoint: { requestCount: before.requestCount,
      reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const options = { ledger, policy, benchmarkExtension,
    authorizationId: 'mixed-authorization', executionId: 'mixed-execution',
    checkpoint: { requestCount: snapshot.requestCount, reservedMicroUsd: snapshot.reservedMicroUsd,
      historySha256: snapshot.historySha256 }, manifest: manifest(), roster, limits: limits(), ...changed };
  return { root, ledger, policy, benchmarkExtension, snapshot, options };
}
const create = (f, capability, fetchImpl) => createMixedSourcePairExperimentRequestGuard({
  ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
  mixedSourcePairCapability: capability, fetchImpl });

test('X1/X2/X6/X7 real nonempty chained v2 parent, bounded binding and one-shot claim', t => {
  const f = fixture(t);
  assert.equal(f.snapshot.requestCount, 4);
  assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.benchmarkExtension, snapshot: f.snapshot }), undefined);
  assert.deepEqual(inspectMixedSourcePairParent({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, checkpoint: f.options.checkpoint }), f.snapshot);
  const capability = authorizeMixedSourcePairCapability(f.options);
  assert.equal(capability.version, 'cairn-mem0-source-pair-case-v1');
  assert.equal(capability.schedule.length, 4);
  assert.equal(Object.isFrozen(capability.manifest.mem0.wireProfile.embedding), true);
  const filename = join(f.ledger.directory, 'experiment-mixed-source-pair-mixed-execution.json');
  const claim = join(f.ledger.directory, 'experiment-mixed-source-pair-mixed-execution.claim.json');
  assert.equal(existsSync(filename), true);
  assert.equal(existsSync(claim), false);
  const guard = create(f, capability, () => assert.fail('unexpected HTTP'));
  assert.equal(existsSync(claim), true);
  assert.equal(JSON.parse(readFileSync(claim, 'utf8')).version, 'mixed-source-pair-claim-v1');
  assert.deepEqual(JSON.parse(JSON.stringify(guard.mixedSourcePairCapability)),
    JSON.parse(JSON.stringify(capability)));
  guard.close();
  assert.throws(() => create(f, capability, () => assert.fail('unexpected HTTP')),
    rejected('capability_consumed'));
});

test('X8/X9 Mem0 generation sends canonical chat and embedding, then shared stages', async t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  const sends = [];
  const guard = create(f, capability, async (url, options) => {
    const body = JSON.parse(options.body);
    sends.push({ url, body });
    if (url.endsWith('/embeddings')) return Response.json(embeddingResponse(body.input.length));
    if (body.response_format?.type === 'json_object') return Response.json(chatResponse());
    return Response.json({ object: 'chat.completion', model: body.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'answer' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const first = await guard.withCaseScope(capability.schedule[0], async () => 'cairn-synthetic');
  assert.deepEqual(first, { status: 'completed', reason: null, value: 'cairn-synthetic' });
  const second = await guard.withCaseScope(capability.schedule[1], async () => {
    const chatResult = await guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
    assert.equal(chatResult.status, 200);
    const embedResult = await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a', 'b'])));
    assert.equal(embedResult.status, 200);
    const answer = await guard.answerFetch(f.benchmarkExtension.stages.answer.endpoint,
      stageRequest(f.benchmarkExtension.stages.answer));
    assert.equal(answer.status, 200);
    return 'mem0-synthetic';
  });
  assert.deepEqual(second, { status: 'completed', reason: null, value: 'mem0-synthetic' });
  for (const identity of capability.schedule.slice(2)) {
    const outcome = await guard.withCaseScope(identity, async () => {
      const response = await guard.judgeFetch(f.benchmarkExtension.stages.judge.endpoint,
        stageRequest(f.benchmarkExtension.stages.judge));
      assert.equal(response.status, 200);
    });
    assert.equal(outcome.status, 'completed');
  }
  assert.deepEqual(sends.map(({ url }) => new URL(url).pathname), [
    '/v1/chat/completions', '/v1/embeddings', '/v1/chat/completions',
    '/v1/chat/completions', '/v1/chat/completions']);
  assert.deepEqual(guard.getState().attempts.slice(-5).map(entry => entry.channel), [
    'host-completion', 'host-embedding', 'host-completion', 'host-completion', 'host-completion']);
  assert.equal(guard.caseOutcomes().scopes.length, 4);
  assert.equal(guard.quotaSnapshot().phaseUsed.generation.requests, 3);
  assert.equal(guard.quotaSnapshot().phaseUsed.scoring.requests, 2);
  guard.close();
});

test('X8 actual Cairn count/generation indexed wire and wrong-source denial', async t => {
  const f = fixture(t);
  const indexed = await cairnWire();
  const prefix = await cairnWire(null);
  const capability = authorizeMixedSourcePairCapability(f.options);
  let sends = 0;
  const guard = create(f, capability, (url, options) => {
    sends += 1;
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens',
      input_tokens: 100 });
    return Response.json({ object: 'response', model: body.model,
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  });
  const outcome = await guard.withCaseScope(capability.schedule[0], async () => {
    for (const entry of indexed) {
      assert.equal((await guard.cairnFetch(entry.url, request(entry.body))).status, 200);
    }
    assert.deepEqual(guard.getState().attempts.slice(-2).map(row => row.channel),
      ['cairn-count', 'cairn-generation']);
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(sends, 2);
  // A Mem0 arm rejects the route before it examines the Cairn source shape.
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {
    await guard.cairnFetch(prefix[0].url, request(prefix[0].body));
  }), rejected('callback_failed'));
  assert.equal(sends, 2);
  assert.equal(guard.isHalted(), true);
  guard.close();

  const wrongSource = fixture(t, { executionId: 'wrong-indexed-source' });
  const wrongGrant = authorizeMixedSourcePairCapability(wrongSource.options);
  let wrongSourceSends = 0;
  const wrongGuard = create(wrongSource, wrongGrant, () => { wrongSourceSends += 1;
    return Response.json({}); });
  const before = wrongGuard.getState().requestCount;
  await assert.rejects(wrongGuard.withCaseScope(wrongGrant.schedule[0], async () => {
    await wrongGuard.cairnFetch(prefix[0].url, request(prefix[0].body));
  }), rejected('callback_failed'));
  assert.equal(wrongSourceSends, 0);
  assert.equal(wrongGuard.getState().requestCount, before);
  assert.equal(wrongGuard.isHalted(), true);
  wrongGuard.close();
});

test('X8 actual inline and catalog qualification wire is allowed, relate and malformed qualify deny', async t => {
  const item = { itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
    candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic preference' }] };
  const inline = await qualificationWire({ items: [item] });
  const catalog = await qualificationWire(createQualificationTextCatalog({ items: [item] }).catalog);
  for (const wire of [inline, catalog]) assert.deepEqual(wire.map(entry =>
    entry.body.text.format.name), ['cairn_qualifyCandidates', 'cairn_qualifyCandidates']);
  for (const [mode, wire] of [['inline', inline], ['catalog', catalog]]) {
    const f = fixture(t, { executionId: `qualification-${mode}` });
    const capability = authorizeMixedSourcePairCapability(f.options);
    const forwarded = [];
    const guard = create(f, capability, (url, options) => {
      forwarded.push(JSON.parse(options.body).text.format.name);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens',
        input_tokens: 100 });
      return Response.json({ object: 'response', model: f.policy.cairnGeneration.model,
        usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    });
    const outcome = await guard.withCaseScope(capability.schedule[0], async () => {
      for (const entry of wire) assert.equal((await guard.cairnFetch(entry.url,
        request(entry.body))).status, 200);
    });
    assert.equal(outcome.status, 'completed');
    assert.deepEqual(forwarded, Array(2).fill('cairn_qualifyCandidates'));
    assert.equal(guard.isHalted(), false);
    guard.close();
  }

  for (const altered of ['relate', 'qualify', 'malformed-qualify']) {
    const denied = fixture(t, { executionId: altered });
    const grant = authorizeMixedSourcePairCapability(denied.options);
    let physical = 0;
    const execution = create(denied, grant, () => { physical += 1; return Response.json({}); });
    const body = structuredClone(inline[1].body);
    if (altered === 'relate' || altered === 'qualify') body.text.format.name = `cairn_${altered}`;
    else body.input[0].content[0].text = JSON.stringify({ inputMode: 'prefix-v1', items: [] });
    const before = execution.getState().requestCount;
    await assert.rejects(execution.withCaseScope(grant.schedule[0], async () => {
      await execution.cairnFetch(inline[1].url, request(body));
    }), rejected('callback_failed'));
    assert.equal(physical, 0);
    assert.equal(execution.getState().requestCount, before);
    assert.equal(execution.isHalted(), true);
    execution.close();
  }
});

test('X10 definite embedding batch 500 permits two separately reserved individual retries', async t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, (url, options) => {
    physical += 1;
    const body = JSON.parse(options.body);
    assert.equal(url, mem0WireProfile().embedding.endpoint);
    if (body.input.length > 1) return new Response('synthetic batch failure', { status: 503 });
    return Response.json(embeddingResponse(1));
  });
  await guard.withCaseScope(capability.schedule[0], async () => {});
  const result = await guard.withCaseScope(capability.schedule[1], async () => {
    const batch = await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a', 'b'])));
    assert.equal(batch.status, 500);
    assert.equal((await batch.text()).includes('synthetic batch failure'), false);
    for (const text of ['a', 'b']) assert.equal((await guard.mem0EmbeddingFetch(
      mem0WireProfile().embedding.endpoint, request(embedding([text])))).status, 200);
  });
  assert.equal(result.status, 'completed');
  assert.equal(physical, 3);
  assert.deepEqual(guard.attempts().map(entry => [entry.ledgerChannel,
    entry.outcome, entry.actualMicroUsd]), [
    ['host-embedding', 'failed', null], ['host-embedding', 'succeeded', 1],
    ['host-embedding', 'succeeded', 1]]);
  assert.equal(guard.quotaSnapshot().phaseUsed.generation.requests, 3);
  assert.equal(guard.quotaSnapshot().phaseUsed.generation.reservedMicroUsd, 3);
  guard.close();

  const bounded = limits();
  bounded.caseCaps.mem0.generation.requests = 2;
  const g = fixture(t, { limits: bounded, executionId: 'fallback-cap' });
  const grant = authorizeMixedSourcePairCapability(g.options);
  let boundedPhysical = 0;
  const execution = create(g, grant, (_, options) => {
    boundedPhysical += 1;
    const body = JSON.parse(options.body);
    return body.input.length > 1 ? new Response('batch failed', { status: 500 })
      : Response.json(embeddingResponse(1));
  });
  await execution.withCaseScope(grant.schedule[0], async () => {});
  const limited = await execution.withCaseScope(grant.schedule[1], async () => {
    assert.equal((await execution.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a', 'b'])))).status, 500);
    assert.equal((await execution.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a'])))).status, 200);
    await assert.rejects(execution.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['b']))), rejected('case_cap_exceeded'));
  });
  assert.equal(limited.reason, 'case_cap_exceeded');
  assert.equal(boundedPhysical, 2);
  assert.equal(execution.getState().requestCount, g.snapshot.requestCount + 2);
  execution.close();
});

test('X9/X10 known-priced invalid payload seals one arm, next arm works, scoring skips sealed arm', async t => {
  const mixedRoster = structuredClone(roster);
  mixedRoster[0].armOrder = ['mem0', 'cairn'];
  const f = fixture(t, { roster: mixedRoster });
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, (url, options) => {
    physical += 1;
    if (url === mem0WireProfile().chat.endpoint
      && JSON.parse(options.body).response_format?.type === 'json_object') {
      return Response.json(chatResponse('bad-truthy-memory'));
    }
    return Response.json({ object: 'chat.completion', model: f.benchmarkExtension.stages.answer.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'answer' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  const first = await guard.withCaseScope(capability.schedule[0], async () => {
    await assert.rejects(guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat())),
      rejected('invalid_payload'));
    await assert.rejects(guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a']))), rejected('case_sealed'));
    return 'swallowed';
  });
  assert.deepEqual(first, { status: 'failed', reason: 'invalid_payload', value: null });
  assert.equal(guard.attempts()[0].actualMicroUsd, 3);
  assert.equal(guard.attempts()[0].outcome, 'failed');
  assert.equal(guard.quotaSnapshot().phaseUsed.generation.reservedMicroUsd, 16_308);
  const second = await guard.withCaseScope(capability.schedule[1], async () => {
    assert.equal((await guard.answerFetch(f.benchmarkExtension.stages.answer.endpoint,
      stageRequest(f.benchmarkExtension.stages.answer))).status, 200);
  });
  assert.equal(second.status, 'completed');
  const blocked = await guard.withCaseScope(capability.schedule[2], async () => {
    assert.fail('sealed scoring callback cannot run');
  });
  assert.deepEqual(blocked, { status: 'blocked', reason: 'case_sealed', value: null });
  const fourth = await guard.withCaseScope(capability.schedule[3], async () => {});
  assert.equal(fourth.status, 'completed');
  assert.equal(physical, 2);
  assert.deepEqual(guard.caseOutcomes().scopes.map(entry => entry.status),
    ['failed', 'completed', 'blocked', 'completed']);
  assert.deepEqual(guard.quotaSnapshot().scopes.map(entry => entry.ordinal), [0, 1, 3]);
  guard.close();
});

test('X5/X10 case quota seals locally before HTTP; phase quota halts globally', async t => {
  const changed = limits();
  changed.caseCaps.mem0.generation.requests = 1;
  const f = fixture(t, { limits: changed });
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => {
    physical += 1;
    return Response.json(embeddingResponse(1));
  });
  await guard.withCaseScope(capability.schedule[0], async () => {});
  const local = await guard.withCaseScope(capability.schedule[1], async () => {
    await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a'])));
    await assert.rejects(guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['b']))), rejected('case_cap_exceeded'));
  });
  assert.deepEqual(local, { status: 'failed', reason: 'case_cap_exceeded', value: null });
  assert.equal(physical, 1);
  assert.equal(guard.getState().requestCount, f.snapshot.requestCount + 1);
  guard.close();

  const phaseLimits = limits();
  phaseLimits.phaseCaps.generation.requests = 1;
  phaseLimits.caseCaps.cairn.generation.requests = 1;
  phaseLimits.caseCaps.mem0.generation.requests = 1;
  const g = fixture(t, { limits: phaseLimits, executionId: 'phase-example' });
  const grant = authorizeMixedSourcePairCapability(g.options);
  let phasePhysical = 0;
  const execution = create(g, grant, () => { phasePhysical += 1;
    return Response.json({ object: 'chat.completion',
      model: g.benchmarkExtension.stages.answer.model,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }); });
  const first = await execution.withCaseScope(grant.schedule[0], async () => {
    await execution.answerFetch(g.benchmarkExtension.stages.answer.endpoint,
      stageRequest(g.benchmarkExtension.stages.answer));
  });
  assert.equal(first.status, 'completed');
  await assert.rejects(execution.withCaseScope(grant.schedule[1], async () => {
    await execution.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a'])));
  }), rejected('callback_failed'));
  assert.equal(phasePhysical, 1);
  execution.close();
});

test('X2/X3/X4/X6 descriptors, manifest, roster and checkpoint reject before binding', t => {
  const f = fixture(t);
  const filename = join(f.ledger.directory, 'experiment-mixed-source-pair-mixed-execution.json');
  let getters = 0;
  const hidden = structuredClone(f.options);
  Object.defineProperty(hidden.manifest.mem0, 'hidden', { value: true });
  const getter = structuredClone(f.options);
  Object.defineProperty(getter.manifest.cairn, 'runtimeArtifactSha256', { enumerable: true,
    get() { getters += 1; return '5'.repeat(64); } });
  const alteredProfile = structuredClone(f.options);
  alteredProfile.manifest.mem0.wireProfile.embedding.minimumReservedMicroUsd = 0;
  const alteredScope = structuredClone(f.options);
  alteredScope.roster[0].arms[1].scopeId = scopeId('cairn');
  const alteredCheckpoint = structuredClone(f.options);
  alteredCheckpoint.checkpoint.historySha256 = '0'.repeat(64);
  const extra = structuredClone(f.options); extra.extra = true;
  const sparse = structuredClone(f.options); sparse.roster = new Array(2);
  for (const bad of [hidden, getter, alteredProfile, alteredScope, alteredCheckpoint,
    extra, sparse]) {
    assert.throws(() => authorizeMixedSourcePairCapability(bad), error =>
      ['invalid_options', 'invalid_capability', 'policy_mismatch'].includes(error?.code)
      && error.message === error.code);
    assert.equal(existsSync(filename), false);
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount,
      f.snapshot.requestCount);
  }
  assert.equal(getters, 0);
});

test('X6/X7 capability mutations and partial one-shot claim refuse before transport', t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  const claim = join(f.ledger.directory, 'experiment-mixed-source-pair-mixed-execution.claim.json');
  for (const changed of [
    { ...capability, rosterDigest: '0'.repeat(64) },
    { ...capability, experimentDigest: '0'.repeat(64) },
    { ...capability, methodProfile: 'qualified-source-pair-v1' },
    { ...capability, checkpoint: { ...capability.checkpoint, historySha256: '0'.repeat(64) } },
  ]) {
    assert.throws(() => create(f, changed, () => assert.fail('no HTTP')),
      rejected('invalid_capability'));
    assert.equal(existsSync(claim), false);
  }
  let getters = 0;
  const raw = { ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, mixedSourcePairCapability: capability,
    fetchImpl: () => assert.fail('no HTTP') };
  Object.defineProperty(raw, 'fetchImpl', { enumerable: true,
    get() { getters += 1; return () => {}; } });
  assert.throws(() => createMixedSourcePairExperimentRequestGuard(raw), rejected('invalid_options'));
  assert.equal(getters, 0);
  writeFileSync(claim, 'partial', { mode: 0o600, flag: 'wx' });
  assert.throws(() => create(f, capability, () => assert.fail('no HTTP')),
    rejected('capability_consumed'));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount,
    f.snapshot.requestCount);
});

test('X7 B4 rowid witness and durable binding tamper halt before any new HTTP', async t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => { physical += 1;
    return Response.json(chatResponse()); });
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  try { db.exec('UPDATE attempts SET rowid = 99 WHERE rowid = 4'); } finally { db.close(); }
  await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {}),
    error => ['invalid_ledger', 'policy_mismatch'].includes(error?.code));
  assert.equal(physical, 0);
  assert.equal(guard.isHalted(), true);
  guard.close();

  const g = fixture(t, { executionId: 'binding-tamper' });
  const grant = authorizeMixedSourcePairCapability(g.options);
  const execution = create(g, grant, () => { physical += 1;
    return Response.json(chatResponse()); });
  writeFileSync(join(g.ledger.directory, 'experiment-mixed-source-pair-binding-tamper.json'),
    'changed', { mode: 0o600 });
  await assert.rejects(execution.withCaseScope(grant.schedule[0], async () => {}),
    error => ['unsafe_policy_binding', 'policy_mismatch'].includes(error?.code));
  assert.equal(physical, 0);
  execution.close();
});

test('X7/X12 authoritative prefix, suffix, caps, binding and inode drift deny a valid route', async t => {
  const indexed = (await cairnWire())[0];
  const variants = ['prefix', 'suffix', 'caps', 'binding', 'same-path-inode'];
  for (const variant of variants) {
    const f = fixture(t, { executionId: `drift-${variant}` });
    const capability = authorizeMixedSourcePairCapability(f.options);
    let physical = 0;
    const guard = create(f, capability, () => { physical += 1;
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 }); });
    const dbPath = join(f.ledger.directory, 'experiment-budget.sqlite');
    const countRows = () => {
      const db = new DatabaseSync(dbPath);
      try { return db.prepare('SELECT request_count FROM run_config WHERE singleton = 1')
        .get().request_count; } finally { db.close(); }
    };
    let invoked = 0;
    await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
      if (variant === 'prefix' || variant === 'caps') {
        const db = new DatabaseSync(dbPath);
        try {
          if (variant === 'prefix') db.exec("UPDATE attempts SET outcome = 'failed', "
            + 'actual_micro_usd = NULL WHERE rowid = 2');
          else db.exec('UPDATE run_config SET request_cap = 81 WHERE singleton = 1');
        } finally { db.close(); }
      } else if (variant === 'suffix') {
        const foreign = reopenEmbeddingExperimentBudget(f.ledger);
        try { const attemptId = randomUUID();
          foreign.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 1 });
          foreign.recordOutcome({ attemptId, outcome: 'unknown' });
        } finally { foreign.close(); }
      } else if (variant === 'binding') {
        const file = join(f.ledger.directory,
          `experiment-mixed-source-pair-drift-${variant}.json`);
        const changed = JSON.parse(readFileSync(file, 'utf8'));
        changed.manifest.mem0.configurationSha256 = '0'.repeat(64);
        writeFileSync(file, JSON.stringify(changed), { mode: 0o600 });
      } else {
        const replacement = join(f.ledger.directory, 'replacement.sqlite');
        copyFileSync(dbPath, replacement);
        chmodSync(replacement, 0o600);
        renameSync(replacement, dbPath);
      }
      const afterMutation = countRows();
      invoked += 1;
      try { await guard.cairnFetch(indexed.url, request(indexed.body)); }
      finally { assert.equal(countRows(), afterMutation); }
    }), rejected('callback_failed'));
    assert.equal(invoked, 1, variant);
    assert.equal(physical, 0, variant);
    assert.deepEqual(guard.attempts(), [], variant);
    assert.equal(guard.isHalted(), true, variant);
    guard.close();
  }
});

test('X10 invalid model/usage and known priced usage bound globally halt without refund', async t => {
  for (const variant of ['model', 'usage', 'bound']) {
    const f = fixture(t, { executionId: `global-${variant}` });
    const capability = authorizeMixedSourcePairCapability(f.options);
    let physical = 0;
    const guard = create(f, capability, () => {
      physical += 1;
      const body = chatResponse();
      if (variant === 'model') body.model = 'not-the-pinned-model';
      if (variant === 'usage') body.usage = null;
      if (variant === 'bound') body.usage = { prompt_tokens: 32_769,
        completion_tokens: 1, total_tokens: 32_770 };
      return Response.json(body);
    });
    await guard.withCaseScope(capability.schedule[0], async () => {});
    await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {
      await guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
    }), rejected('callback_failed'));
    assert.equal(physical, 1);
    assert.equal(guard.isHalted(), true);
    const attempt = guard.attempts()[0];
    assert.equal(attempt.reservedMicroUsd, 16_308);
    assert.equal(attempt.outcome, variant === 'bound' ? 'failed' : 'unknown');
    assert.equal(attempt.actualMicroUsd, variant === 'bound' ? 13_110 : null);
    await assert.rejects(guard.withCaseScope(capability.schedule[2], async () => {}),
      rejected('paid_work_halted'));
    guard.close();
  }
});

test('X10 embedding singleton 5xx seals case and cannot present native success', async t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => { physical += 1;
    return new Response('synthetic failure', { status: 503 }); });
  await guard.withCaseScope(capability.schedule[0], async () => {});
  const result = await guard.withCaseScope(capability.schedule[1], async () => {
    await assert.rejects(guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a']))), rejected('http_failed'));
    return 'must not count as completed';
  });
  assert.deepEqual(result, { status: 'failed', reason: 'embedding_singleton_failed', value: null });
  assert.equal(physical, 1);
  assert.deepEqual(guard.attempts().map(entry => [entry.outcome, entry.actualMicroUsd]),
    [['failed', null]]);
  guard.close();
});

test('X9 trusted revoke aborts in-flight, fences stale ALS descendants and does not poison next arm', async t => {
  const changedRoster = structuredClone(roster);
  changedRoster[0].armOrder = ['mem0', 'cairn'];
  const f = fixture(t, { roster: changedRoster });
  const capability = authorizeMixedSourcePairCapability(f.options);
  let start;
  const started = new Promise(resolve => { start = resolve; });
  let physical = 0;
  const guard = create(f, capability, (url, options) => {
    physical += 1;
    if (url === mem0WireProfile().chat.endpoint
      && JSON.parse(options.body).response_format?.type === 'json_object') {
      start();
      return new Promise(() => {});
    }
    return Response.json({ object: 'chat.completion',
      model: f.benchmarkExtension.stages.answer.model,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  let staleHandle;
  let lateCall;
  const first = await guard.withCaseScope(capability.schedule[0], async handle => {
    staleHandle = handle;
    const pending = guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
    const dispatch = await Promise.race([started.then(() => 'started'),
      pending.then(() => 'unexpected_success', error => error.code ?? 'unknown_failure')]);
    assert.equal(dispatch, 'started');
    assert.equal(handle.revocationSignal.aborted, false);
    handle.revoke(); handle.revoke();
    assert.equal(handle.revocationSignal.aborted, true);
    await assert.rejects(pending, rejected('case_cancelled'));
    lateCall = new Promise(resolve => setTimeout(async () => {
      try { await guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
        resolve('sent'); } catch (error) { resolve(error.code); }
    }, 5));
  });
  assert.deepEqual(first, { status: 'failed', reason: 'cancelled', value: null });
  const second = await guard.withCaseScope(capability.schedule[1], async () => {
    staleHandle.revoke();
    assert.equal(await lateCall, 'case_scope_required');
    assert.equal((await guard.answerFetch(f.benchmarkExtension.stages.answer.endpoint,
      stageRequest(f.benchmarkExtension.stages.answer))).status, 200);
  });
  assert.equal(second.status, 'completed');
  assert.equal(physical, 2);
  assert.equal(guard.attempts()[0].outcome, 'unknown');
  assert.equal(guard.attempts()[0].actualMicroUsd, null);
  guard.close();
});

test('X9/X10 real core deadline isolates case; spoofed error code globally halts', async t => {
  const changedRoster = structuredClone(roster);
  changedRoster[0].armOrder = ['mem0', 'cairn'];
  const f = fixture(t, { roster: changedRoster, executionId: 'real-deadline' });
  const capability = authorizeMixedSourcePairCapability(f.options);
  const guard = create(f, capability, () => new Promise(() => {}));
  let reveal;
  const ready = new Promise(resolve => { reveal = resolve; });
  const model = callModel({ contextWindow: 8192, countTokens: () => 1,
    extract({ signal }) { reveal(signal); return new Promise(() => {}); } },
  'extract', 'Synthetic system.', { messages: [] },
  { deadline: { expired: () => false, remainingMs: () => 500 } });
  const signal = await ready;
  await guard.withCaseScope(capability.schedule[0], async () => {
    await assert.rejects(guard.mem0ChatFetch(mem0WireProfile().chat.endpoint,
      { ...request(chat()), signal }), rejected('case_deadline_exceeded'));
  }).then(result => assert.deepEqual(result, { status: 'failed', reason: 'deadline', value: null }));
  await assert.rejects(model, /model_timeout/u);
  const next = await guard.withCaseScope(capability.schedule[1], async () => {});
  assert.equal(next.status, 'completed');
  guard.close();

  const g = fixture(t, { executionId: 'spoof-deadline' });
  const grant = authorizeMixedSourcePairCapability(g.options);
  const execution = create(g, grant, () => assert.fail('no HTTP'));
  await assert.rejects(execution.withCaseScope(grant.schedule[0], async () => {
    throw Object.assign(new Error('private source'), { code: 'case_deadline_exceeded' });
  }), rejected('callback_failed'));
  assert.equal(execution.isHalted(), true);
  assert.equal(execution.caseOutcomes().scopes.length, 0);
  execution.close();
});

test('X10 first ambiguous transport/body cause remains global despite later revoke', async t => {
  for (const mode of ['transport', 'body', 'synchronous']) {
    const changedRoster = structuredClone(roster);
    changedRoster[0].armOrder = ['mem0', 'cairn'];
    const f = fixture(t, { roster: changedRoster, executionId: `ambiguous-${mode}` });
    const capability = authorizeMixedSourcePairCapability(f.options);
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    let activeHandle;
    const guard = create(f, capability, () => {
      if (mode === 'synchronous') {
        queueMicrotask(() => activeHandle.revoke());
        throw new Error('private synchronous transport failure');
      }
      if (mode === 'transport') {
        entered();
        return new Promise((_, reject) => { release = reject; });
      }
      const stream = new ReadableStream({ pull(controller) {
        entered();
        release = () => controller.error(new Error('private body failure'));
      } }, { highWaterMark: 0 });
      return new Response(stream, { status: 200 });
    });
    await assert.rejects(guard.withCaseScope(capability.schedule[0], async handle => {
      activeHandle = handle;
      const pending = guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
      if (mode !== 'synchronous') {
        await started;
        release(new Error('private transport failure'));
        queueMicrotask(() => handle.revoke());
      }
      await assert.rejects(pending, rejected('transport_failed'));
    }), rejected('paid_work_halted'));
    assert.equal(guard.isHalted(), true);
    assert.equal(guard.attempts()[0].outcome, 'unknown');
    assert.equal(guard.attempts()[0].actualMicroUsd, null);
    assert.equal(guard.caseOutcomes().scopes.length, 0);
    await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {}),
      rejected('paid_work_halted'));
    guard.close();
  }
});

test('X5 simultaneous case/phase exhaustion is global and reserves no second request', async t => {
  const changedRoster = structuredClone(roster);
  changedRoster[0].armOrder = ['mem0', 'cairn'];
  const changed = limits();
  changed.phaseCaps.generation.requests = 1;
  changed.caseCaps.mem0.generation.requests = 1;
  changed.caseCaps.cairn.generation.requests = 1;
  const f = fixture(t, { roster: changedRoster, limits: changed });
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => { physical += 1;
    return Response.json(embeddingResponse(1)); });
  await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
    await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a'])));
    await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['b'])));
  }), rejected('callback_failed'));
  assert.equal(physical, 1);
  assert.equal(guard.isHalted(), true);
  assert.equal(guard.getState().requestCount, f.snapshot.requestCount + 1);
  assert.equal(guard.caseOutcomes().scopes.length, 0);
  guard.close();
});

test('X1/X7 old readers deny v2, foreign pending and rowid history block before HTTP', async t => {
  const f = fixture(t);
  assert.throws(() => createExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    fetchImpl: () => assert.fail('no HTTP') }), rejected('invalid_ledger'));
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => { physical += 1;
    return Response.json(chatResponse()); });
  const foreign = reopenEmbeddingExperimentBudget(f.ledger);
  try { foreign.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 3 }); } finally { foreign.close(); }
  await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {}),
    error => ['invalid_ledger', 'paid_work_halted', 'policy_mismatch'].includes(error?.code));
  assert.equal(physical, 0);
  assert.equal(guard.isHalted(), true);
  guard.close();
});

test('X7/X12 in-flight foreign rowid mutation fences bound settlement and globally halts', async t => {
  const f = fixture(t, { executionId: 'foreign-during-settlement' });
  const capability = authorizeMixedSourcePairCapability(f.options);
  let physical = 0;
  const guard = create(f, capability, () => {
    physical += 1;
    const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
    try { db.prepare('UPDATE attempts SET rowid = 100 WHERE rowid = 1').run(); }
    finally { db.close(); }
    return Response.json(chatResponse());
  });
  await guard.withCaseScope(capability.schedule[0], async () => {});
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {
    await guard.mem0ChatFetch(mem0WireProfile().chat.endpoint, request(chat()));
  }), rejected('callback_failed'));
  assert.equal(physical, 1);
  assert.equal(guard.isHalted(), true);
  const attempt = guard.attempts()[0];
  assert.equal(attempt.outcome, null);
  assert.equal(attempt.actualMicroUsd, null);
  assert.equal(attempt.observedActualMicroUsd, 3);
  assert.equal(attempt.inputTokens, 1);
  assert.equal(attempt.outputTokens, 1);
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  try {
    const persisted = db.prepare('SELECT outcome FROM attempts WHERE attempt_id = ?').get(attempt.attemptId);
    assert.equal(persisted.outcome, null);
  } finally { db.close(); }
  await assert.rejects(guard.withCaseScope(capability.schedule[2], async () => {}),
    rejected('paid_work_halted'));
  guard.close();
});

test('X9 concurrency, closure and bounded source-free snapshots', async t => {
  const f = fixture(t);
  const capability = authorizeMixedSourcePairCapability(f.options);
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let physical = 0;
  const guard = create(f, capability, () => {
    physical += 1;
    entered();
    return new Promise(resolve => { release = () => resolve(Response.json(embeddingResponse(1))); });
  });
  await guard.withCaseScope(capability.schedule[0], async () => {});
  const outcome = await guard.withCaseScope(capability.schedule[1], async handle => {
    assert.deepEqual(Object.keys(handle), ['snapshot', 'revocationSignal', 'revoke', 'halt']);
    assert.equal(handle.snapshot().status, 'active');
    const first = guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['a'])));
    await started;
    await assert.rejects(guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      request(embedding(['b']))), rejected('guard_busy'));
    await assert.rejects(guard.withCaseScope(capability.schedule[2], async () => {}),
      rejected('case_scope_busy'));
    assert.throws(() => guard.close(), rejected('guard_busy'));
    release();
    assert.equal((await first).status, 200);
  });
  assert.equal(outcome.status, 'completed');
  assert.equal(physical, 1);
  assert.equal(guard.caseScopeSnapshot().status, 'completed');
  const publicText = JSON.stringify([guard.caseOutcomes(), guard.quotaSnapshot(),
    guard.caseScopeSnapshot()]);
  assert.equal(publicText.includes(questionId), false);
  assert.equal(publicText.includes('Synthetic'), false);
  assert.equal(Object.isFrozen(guard.quotaSnapshot().scopes), true);
  guard.close();
  await assert.rejects(guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
    request(embedding(['a']))), rejected('guard_closed'));
});
