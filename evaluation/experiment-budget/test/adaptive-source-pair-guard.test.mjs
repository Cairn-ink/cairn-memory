import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { countOpenAITokens, createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { createQualificationCandidateSnapshot, qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import { authorizeAdaptiveQualifiedSourcePairCapability, authorizeBenchmarkBudgetExtension,
  authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeChainedBenchmarkBudgetExtension, authorizeQualifiedSourcePairCapability,
  createAdaptiveQualifiedSourcePairExperimentRequestGuard, createExperimentRequestGuard,
  createQualifiedSourcePairExperimentRequestGuard,
  deriveAdaptiveQualifiedSourcePairExperimentDigest } from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { createQualifiedSourcePairPhaseQuota } from '../../live/qualified-source-pair-phase-quota.mjs';

const failCode = (code) => (error) => error?.code === code;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const names = ['qualified-prefix', 'indexed-windows'];
const questionId = `lme-case-${'a'.repeat(64)}`;
const scopeId = (name) => `lme-case-${digest(JSON.stringify([
  'cairn.lme.source-pair.scope.v1', [questionId, name]]))}`;
const roster = [{ questionId, protocolDigest: 'b'.repeat(64), armOrder: names,
  arms: names.map((name) => ({ name, scopeId: scopeId(name) })) }];
const context = (sourceRoster = roster) => ({ qualificationInputProfile: 'adaptive-text-catalog-v1',
  runtimeArtifactSha256: 'c'.repeat(64), adapterConfigurationSha256: 'd'.repeat(64),
  experimentDigest: deriveAdaptiveQualifiedSourcePairExperimentDigest({
    qualificationInputProfile: 'adaptive-text-catalog-v1', runtimeArtifactSha256: 'c'.repeat(64),
    adapterConfigurationSha256: 'd'.repeat(64), roster: sourceRoster,
  }) });
const guardUrl = new URL('../request-guard.mjs', import.meta.url).href;
const request = (body) => ({ method: 'POST', redirect: 'error',
  signal: new AbortController().signal,
  headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });
const repeatedText = Array.from({ length: 13 }, (_, index) => digest(`shared-${index}`)).join('').slice(0, 800);
const items = (catalog) => Array.from({ length: catalog ? 5 : 1 }, (_, index) => ({
  content: `Synthetic claim ${index}`, kind: 'fact', confidence: 0.8,
  receipts: Array.from({ length: catalog ? 4 : 1 }, (_, receipt) => ({ client: 'synthetic',
    sessionId: 'synthetic-session', eventId: `event-${index}-${receipt}`,
    role: receipt % 2 ? 'assistant' : 'user', excerpt: catalog ? repeatedText : 'short source' })),
}));
const qualification = (input) => ({ qualifications: input.items.map((item) => {
  const evidenceIndices = [item.candidates[0].candidateIndex];
  const empty = { value: null, evidenceIndices: [] };
  const unknown = { value: 'unknown', evidenceIndices: [] };
  return { itemIndex: item.itemIndex, subject: { value: null, evidenceIndices }, property: empty,
    scope: empty, applies: empty, value: empty, attribution: unknown, commitment: unknown };
}) });

function settledAttempt(ledger) {
  const handle = reopenExperimentBudget(ledger);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 13 });
    handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 9 });
  } finally { handle.close(); }
}

function state(ledger) {
  const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); }
}

function fixture(t, limit = 100_000_000, stageTimeoutMs = null) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-adaptive-pair-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('setup transport') }).close();
  const stages = benchmarkStagePolicy();
  if (stageTimeoutMs !== null) stages.answer.timeoutMs = stageTimeoutMs;
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'benchmark', stages });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension, authorizationId: 'allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'parent', newLimitMicroUsd: 100_000_000,
    newRequestCap: 40, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  let ledger = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  settledAttempt(ledger);
  let extension = parent;
  if (limit === 200_000_000) {
    const beforeChain = state(ledger);
    extension = authorizeChainedBenchmarkBudgetExtension({ oldLedger: ledger, policy,
      parentBudgetExtension: parent, authorizationId: 'chain', newLimitMicroUsd: 200_000_000,
      newRequestCap: 80, expectedCheckpoint: { requestCount: beforeChain.requestCount,
        reservedMicroUsd: beforeChain.reservedMicroUsd } });
    ledger = { ...ledger, limitMicroUsd: 200_000_000, requestCap: 80 };
  }
  const before = state(ledger);
  const options = { ledger, policy, benchmarkExtension: extension,
    authorizationId: 'adaptive-auth', executionId: 'adaptive-execution',
    checkpoint: { requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd },
    roster, adaptiveContext: context() };
  return { root, ledger, policy, extension, options, before, stages };
}

function guardOptions(f, capability, fetchImpl) {
  return { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.extension,
    adaptiveQualifiedSourcePairCapability: capability, fetchImpl };
}

function provider(output, sends) {
  return (url, options) => {
    const body = JSON.parse(options.body);
    sends.push({ url, body });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
}

test('G1/G2 exact canonical outer digest, distinct grant and cross-use denial before claim', (t) => {
  const f = fixture(t);
  const originalDigest = context().experimentDigest;
  assert.match(originalDigest, /^[0-9a-f]{64}$/u);
  for (const change of [
    { runtimeArtifactSha256: 'e'.repeat(64) }, { adapterConfigurationSha256: 'f'.repeat(64) },
    { qualificationInputProfile: 'inline' }, { roster: [{ ...roster[0], protocolDigest: 'f'.repeat(64) }] },
  ]) {
    const data = { qualificationInputProfile: 'adaptive-text-catalog-v1',
      runtimeArtifactSha256: 'c'.repeat(64), adapterConfigurationSha256: 'd'.repeat(64),
      roster, ...change };
    if (change.qualificationInputProfile === 'inline') {
      assert.throws(() => deriveAdaptiveQualifiedSourcePairExperimentDigest(data),
        failCode('invalid_capability'));
    } else assert.notEqual(deriveAdaptiveQualifiedSourcePairExperimentDigest(data), originalDigest);
  }
  assert.throws(() => deriveAdaptiveQualifiedSourcePairExperimentDigest({
    ...context(), roster }), failCode('invalid_capability'));
  for (const bad of [{ ...context(), extra: true }, { ...context(), experimentDigest: '0'.repeat(64) },
    { ...context(), runtimeArtifactSha256: 'ABC' }, { ...context(), qualificationInputProfile: 'inline' }]) {
    assert.throws(() => authorizeAdaptiveQualifiedSourcePairCapability({ ...f.options,
      adaptiveContext: bad }), failCode('invalid_capability'));
  }
  const hidden = context();
  Object.defineProperty(hidden, 'extra', { value: true });
  assert.throws(() => authorizeAdaptiveQualifiedSourcePairCapability({ ...f.options,
    adaptiveContext: hidden }), failCode('invalid_capability'));
  const accessor = context();
  Object.defineProperty(accessor, 'runtimeArtifactSha256', { enumerable: true,
    get: () => 'c'.repeat(64) });
  assert.throws(() => authorizeAdaptiveQualifiedSourcePairCapability({ ...f.options,
    adaptiveContext: accessor }), failCode('invalid_capability'));
  const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
  assert.equal(capability.version, 'qualified-source-pair-adaptive-case-v1');
  assert.equal(capability.methodProfile, 'qualified-source-pair-adaptive-v1');
  assert.deepEqual(capability.adaptiveContext, context());
  assert.deepEqual(authorizeAdaptiveQualifiedSourcePairCapability(f.options), capability);
  const binding = join(f.ledger.directory, 'experiment-adaptive-qualified-source-pair-adaptive-execution.json');
  const claim = join(f.ledger.directory, 'experiment-adaptive-qualified-source-pair-adaptive-execution.claim.json');
  assert.equal(existsSync(binding), true);
  assert.equal(existsSync(claim), false);
  const old = authorizeQualifiedSourcePairCapability(Object.fromEntries(Object.entries(f.options)
    .filter(([key]) => key !== 'adaptiveContext')));
  assert.throws(() => createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.extension, qualifiedSourcePairCapability: capability,
    fetchImpl: () => assert.fail('provider') }), failCode('invalid_capability'));
  assert.throws(() => createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f, old,
    () => assert.fail('provider'))), failCode('invalid_capability'));
  assert.equal(existsSync(claim), false);
  for (const altered of [{ ...capability, adaptiveContext: { ...context(), experimentDigest: '0'.repeat(64) } },
    { ...capability, methodProfile: 'qualified-source-pair-v1' },
    { ...capability, rosterDigest: '0'.repeat(64) }]) {
    assert.throws(() => createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
      altered, () => assert.fail('provider'))), failCode('invalid_capability'));
    assert.equal(existsSync(claim), false);
  }
  const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f, capability,
    () => assert.fail('provider')));
  assert.deepEqual(guard.qualifiedSourcePairCapability, capability);
  guard.close();
  assert.equal(JSON.parse(readFileSync(claim, 'utf8')).version, 'qualified-source-pair-adaptive-claim-v1');
  assert.throws(() => createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
    capability, () => assert.fail('provider'))), failCode('capability_consumed'));
});

test('G1 old and adaptive binding and claim namespaces remain disjoint for overlapping IDs', (t) => {
  const f = fixture(t);
  const adaptiveOptions = { ...f.options, executionId: 'overlap' };
  const oldOptions = { ...f.options, executionId: 'adaptive-overlap' };
  delete oldOptions.adaptiveContext;
  const old = authorizeQualifiedSourcePairCapability(oldOptions);
  const adaptive = authorizeAdaptiveQualifiedSourcePairCapability(adaptiveOptions);
  const oldBinding = join(f.ledger.directory, 'experiment-qualified-source-pair-adaptive-overlap.json');
  const adaptiveBinding = join(f.ledger.directory, 'experiment-adaptive-qualified-source-pair-overlap.json');
  assert.equal(existsSync(oldBinding), true);
  assert.equal(existsSync(adaptiveBinding), true);
  const oldGuard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.extension, qualifiedSourcePairCapability: old,
    fetchImpl: () => assert.fail('provider') });
  oldGuard.close();
  const adaptiveGuard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
    adaptive, () => assert.fail('provider')));
  adaptiveGuard.close();
  assert.equal(existsSync(join(f.ledger.directory,
    'experiment-qualified-source-pair-adaptive-overlap.claim.json')), true);
  assert.equal(existsSync(join(f.ledger.directory,
    'experiment-adaptive-qualified-source-pair-overlap.claim.json')), true);
});

test('G2 factory rejects hidden or accessor adaptive context before a claim', (t) => {
  for (const mutation of ['hidden', 'accessor', 'context-accessor']) {
    const f = fixture(t);
    const capability = structuredClone(authorizeAdaptiveQualifiedSourcePairCapability(f.options));
    const claim = join(f.ledger.directory,
      'experiment-adaptive-qualified-source-pair-adaptive-execution.claim.json');
    let getterCalls = 0;
    if (mutation === 'hidden') Object.defineProperty(capability.adaptiveContext, 'unknown',
      { value: true });
    else if (mutation === 'accessor') Object.defineProperty(capability.adaptiveContext, 'runtimeArtifactSha256', {
      enumerable: true, get() { getterCalls += 1; return 'c'.repeat(64); },
    });
    else Object.defineProperty(capability, 'adaptiveContext', {
      enumerable: true, get() { getterCalls += 1; return context(); },
    });
    let returned;
    t.after(() => returned?.close());
    assert.throws(() => {
      returned = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
        capability, () => assert.fail('provider')));
    }, failCode('invalid_capability'));
    assert.equal(getterCalls, 0);
    assert.equal(existsSync(claim), false);
    assert.deepEqual(state(f.ledger).attempts, f.before.attempts);
    const valid = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
      authorizeAdaptiveQualifiedSourcePairCapability(f.options), () => assert.fail('provider')));
    valid.close();
    assert.equal(existsSync(claim), true);
  }
});

for (const limit of [100_000_000, 200_000_000]) {
  test(`G3–G6 actual core and F adapter complete inline/catalog through ${limit} synthetic parent`, async (t) => {
    const f = fixture(t, limit);
    const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
    const inline = items(false);
    const catalog = items(true);
    const wire = [inline, catalog].map((source) => {
      const snapshot = createQualificationCandidateSnapshot(source);
      return qualificationPoolWire(snapshot.input, qualification(snapshot.input));
    });
    const sends = [];
    const guardedProvider = (url, options) => {
      return provider(wire[Math.floor(sends.length / 2)], sends)(url, options);
    };
    const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
      capability, guardedProvider));
    t.after(() => guard.close());
    const caps = { generation: { requests: 4, reservedMicroUsd: 20_000 },
      scoring: { requests: 0, reservedMicroUsd: 0 } };
    const quota = createQualifiedSourcePairPhaseQuota({ guard, policy: f.policy,
      stages: benchmarkStagePolicy(), phaseCaps: caps });
    const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
      fetchImpl: quota.cairnFetch });
    const results = [];
    for (const [index, source] of [inline, catalog].entries()) {
      await quota.execution.withCaseScope(capability.schedule[index], async () => {
        results.push(await qualifyCandidateItems(model, source));
      });
    }
    assert.deepEqual(sends.map(({ url }) => url.endsWith('/input_tokens') ? 'count' : 'generation'),
      ['count', 'generation', 'count', 'generation']);
    assert.equal(JSON.parse(sends[0].body.input[0].content[0].text).inputMode, undefined);
    assert.equal(JSON.parse(sends[2].body.input[0].content[0].text).inputMode, 'text-catalog-v1');
    assert.deepEqual(sends[0].body, Object.fromEntries(Object.entries(sends[1].body)
      .filter(([key]) => !['max_output_tokens', 'store', 'stream'].includes(key))));
    assert.deepEqual(sends[2].body, Object.fromEntries(Object.entries(sends[3].body)
      .filter(([key]) => !['max_output_tokens', 'store', 'stream'].includes(key))));
    for (const [set, source] of [[results[0], inline], [results[1], catalog]]) {
      assert.equal(set.length, source.length);
      const original = createQualificationCandidateSnapshot(source);
      for (const [index, result] of set.entries()) {
        const anchor = result.qualification.anchors[0];
        assert.equal(anchor.text, original.candidates[index][0].text);
        assert.equal(anchor.start, 0);
        assert.equal(anchor.end, original.candidates[index][0].end);
        const receipt = result.receipts[anchor.receiptIndex];
        assert.equal(receipt.eventId, source[index].receipts[0].eventId);
        assert.equal(receipt.role, source[index].receipts[0].role);
      }
    }
    const after = guard.getState();
    assert.deepEqual(after.attempts.slice(0, f.before.requestCount), f.before.attempts);
    assert.equal(after.requestCount, f.before.requestCount + 4);
    assert.equal(after.reservedMicroUsd, f.before.reservedMicroUsd + 20_000);
    assert.ok(after.attempts.every((entry) => entry.outcome !== null));
    assert.deepEqual(quota.snapshot().used.generation, caps.generation);
    assert.equal(guard.isHalted(), false);
    await assert.rejects(quota.execution.withCaseScope(capability.schedule[2], async () => {
      await quota.cairnFetch(f.policy.cairnCount.endpoint, {});
    }), /phase_cap_exceeded/u);
    assert.equal(guard.getState().requestCount, after.requestCount);
  });
}

test('G7 adaptive claim has exactly one cross-process winner', async (t) => {
  const f = fixture(t);
  const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
  const data = JSON.stringify(guardOptions(f, capability, null));
  const script = `import { createAdaptiveQualifiedSourcePairExperimentRequestGuard } from ${JSON.stringify(guardUrl)};
    const options = JSON.parse(process.argv[1]);
    process.stdout.write('ready\\n');
    await new Promise(resolve => process.stdin.once('data', resolve));
    try { const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard({ ...options,
      fetchImpl: () => { throw Error('no transport'); } }); guard.close();
      console.log(JSON.stringify({ result: 'owned' })); }
    catch (error) { console.log(JSON.stringify({ result: error.code ?? 'unexpected' })); }`;
  const start = () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, data],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { NODE_NO_WARNINGS: '1' } });
    let output = ''; let errors = '';
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { output += chunk; if (output.startsWith('ready\n')) resolve(); });
      child.on('error', reject);
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const finished = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (status) => status === 0
        ? resolve(JSON.parse(output.slice('ready\n'.length).trim()))
        : reject(new Error(`child ${status}: ${errors}`)));
    });
    return { ready, finished, go: () => child.stdin.end('go\n') };
  };
  const children = [start(), start()];
  await Promise.all(children.map((child) => child.ready));
  children.forEach((child) => child.go());
  const results = await Promise.all(children.map((child) => child.finished));
  assert.equal(results.filter((item) => item.result === 'owned').length, 1, JSON.stringify(results));
  assert.ok(results.some((item) => ['capability_consumed', 'ledger_busy'].includes(item.result)));
  assert.equal(state(f.ledger).requestCount, f.before.requestCount);
});

async function capturedWire(method, input, mode = 'adaptive-text-catalog-v1') {
  const captured = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: mode,
    fetchImpl: (url, options) => {
      const body = JSON.parse(options.body);
      captured.push({ url, body });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const output = method === 'extract' ? { items: [] }
        : qualificationPoolWire(input, qualification(input));
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
    } });
  await model[method]({ system: 'Synthetic system.', input, maxOutputTokens: 1024,
    signal: new AbortController().signal });
  return captured;
}

test('G7 malformed catalog, foreign IDs, wrong model/method/arm and missing scope reserve nothing', async (t) => {
  const inline = createQualificationCandidateSnapshot(items(false)).input;
  const catalog = { inputMode: 'text-catalog-v1', texts: ['short source'],
    items: inline.items.map((item) => ({ ...item, candidates: item.candidates.map((candidate) => ({
      candidateIndex: candidate.candidateIndex, role: candidate.role, textIndex: 0 })) })) };
  const valid = await capturedWire('qualifyCandidates', catalog);
  const indexed = await capturedWire('extract', { inputMode: 'indexed-windows-v1',
    messages: [{ index: 0, messageIndex: 0, role: 'user', content: 'Synthetic indexed source.' }] });
  const alterInput = (body, change) => {
    const copied = structuredClone(body);
    const parsed = JSON.parse(copied.input[0].content[0].text);
    change(parsed);
    copied.input[0].content[0].text = JSON.stringify(parsed);
    return copied;
  };
  const bad = [
    ['unused-text', alterInput(valid[0].body, (input) => input.texts.push('unused'))],
    ['foreign-id', alterInput(valid[0].body, (input) => { input.items[0].candidates[0].candidateIndex = 999; })],
    ['duplicate-id', alterInput(valid[0].body, (input) => {
      input.items[0].candidates.push({ ...input.items[0].candidates[0] });
    })],
    ['unknown-mode', alterInput(valid[0].body, (input) => { input.inputMode = 'other'; })],
    ['wrong-model', { ...valid[0].body, model: 'foreign-model' }],
    ['wrong-method', { ...valid[0].body,
      text: { format: { ...valid[0].body.text.format, name: 'cairn_qualify' } } }],
    ['wrong-arm', indexed[0].body, indexed[0].url],
  ];
  for (const [name, body, url = valid[0].url] of bad) {
    await t.test(name, async (nested) => {
      const f = fixture(nested);
      const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
      let sends = 0;
      const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
        capability, () => { sends += 1; assert.fail('unexpected transport'); }));
      nested.after(() => guard.close());
      await assert.rejects(guard.cairnFetch(url, request(body)), failCode('case_scope_required'));
      assert.equal(guard.getState().requestCount, f.before.requestCount);
      await guard.withCaseScope(capability.schedule[0], async () => {
        await assert.rejects(guard.cairnFetch(url, request(body)), failCode('unsupported_request'));
      });
      assert.equal(sends, 0);
      assert.deepEqual(guard.getState().attempts, f.before.attempts);
    });
  }
});

test('G7 policy and binding drift reject before a new adaptive claim', (t) => {
  const f = fixture(t);
  const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
  const claim = join(f.ledger.directory, 'experiment-adaptive-qualified-source-pair-adaptive-execution.claim.json');
  assert.throws(() => createAdaptiveQualifiedSourcePairExperimentRequestGuard({
    ...guardOptions(f, capability, () => assert.fail('provider')),
    policy: { ...f.policy, cairnCount: { ...f.policy.cairnCount, timeoutMs: 1 } },
  }), failCode('invalid_capability'));
  assert.equal(existsSync(claim), false);
  const binding = join(f.ledger.directory, 'experiment-adaptive-qualified-source-pair-adaptive-execution.json');
  writeFileSync(binding, '{}\n');
  assert.throws(() => createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
    capability, () => assert.fail('provider'))), failCode('policy_mismatch'));
  assert.equal(existsSync(claim), false);
});

test('G4 adaptive qualifier checks logical and equivalent count body without a generation-body ceiling',
  async (t) => {
    const inline = createQualificationCandidateSnapshot(items(false)).input;
    const wire = await capturedWire('qualifyCandidates', inline);
    const base = wire[0].body;
    const generate = wire[1].body;
    const countTokens = (body) => countOpenAITokens(JSON.stringify(body));
    const extra = countTokens(generate) - countTokens(base);
    assert.ok(extra > 0);
    const desired = 6000;
    const countBody = structuredClone(base);
    countBody.instructions += ' x'.repeat(Math.max(0, desired - countTokens(countBody)));
    while (countTokens(countBody) > desired) countBody.instructions = countBody.instructions.slice(0, -2);
    while (countTokens(countBody) < desired) countBody.instructions += ' x';
    const generationBody = { ...countBody, max_output_tokens: 1024, store: false, stream: false };
    assert.equal(countTokens(countBody), 6000);
    assert.ok(countTokens(generationBody) > 6000);
    assert.ok(countOpenAITokens(JSON.stringify({ system: countBody.instructions,
      input: inline, maxOutputTokens: 1024 })) <= 6000);
    const f = fixture(t);
    const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
    const sends = [];
    const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
      capability, provider(qualificationPoolWire(inline, qualification(inline)), sends)));
    t.after(() => guard.close());
    await guard.withCaseScope(capability.schedule[0], async () => {
      assert.equal((await guard.cairnFetch(wire[0].url, request(countBody))).status, 200);
      assert.equal((await guard.cairnFetch(wire[1].url, request(generationBody))).status, 200);
    });
    assert.equal(sends.length, 2);
    assert.equal(guard.getState().requestCount, f.before.requestCount + 2);

    const deniedFixture = fixture(t);
    const deniedCapability = authorizeAdaptiveQualifiedSourcePairCapability(deniedFixture.options);
    let deniedSends = 0;
    const deniedGuard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(
      deniedFixture, deniedCapability, () => { deniedSends += 1; assert.fail('provider'); }));
    t.after(() => deniedGuard.close());
    const oversized = structuredClone(countBody);
    oversized.instructions += ' x';
    assert.ok(countTokens(oversized) > 6000);
    await deniedGuard.withCaseScope(deniedCapability.schedule[0], async () => {
      await assert.rejects(deniedGuard.cairnFetch(wire[0].url, request(oversized)),
        failCode('input_bound_exceeded'));
    });
    assert.equal(deniedSends, 0);
    assert.equal(deniedGuard.getState().requestCount, deniedFixture.before.requestCount);
  });

test('G7 adaptive campaign cap refuses an unreserved next request after retained history', async (t) => {
  const f = fixture(t);
  const prior = reopenExperimentBudget(f.ledger);
  for (let index = 0; index < 38; index += 1) {
    const attemptId = randomUUID();
    prior.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 1 });
    prior.recordOutcome({ attemptId, outcome: 'unknown' });
  }
  prior.close();
  const prefix = state(f.ledger);
  assert.equal(prefix.requestCount, 39);
  const capability = authorizeAdaptiveQualifiedSourcePairCapability({ ...f.options,
    checkpoint: { requestCount: prefix.requestCount, reservedMicroUsd: prefix.reservedMicroUsd } });
  const wire = await capturedWire('qualifyCandidates', createQualificationCandidateSnapshot(items(false)).input);
  let calls = 0;
  const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
    capability, (url, options) => { calls += 1;
      return provider({}, [])(url, options); }));
  t.after(() => guard.close());
  await guard.withCaseScope(capability.schedule[0], async () => {
    assert.equal((await guard.cairnFetch(wire[0].url, request(wire[0].body))).status, 200);
  });
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {
    await assert.rejects(guard.cairnFetch(wire[0].url, request(wire[0].body)),
      failCode('request_cap_exceeded'));
  }), failCode('ledger_closed'));
  assert.equal(calls, 1);
  const after = state(f.ledger);
  assert.deepEqual(after.attempts.slice(0, prefix.requestCount), prefix.attempts);
  assert.equal(after.requestCount, 40);
  assert.equal(after.attempts[39].outcome, 'succeeded');
});

test('G7 unclosed adaptive request halts and a recognized timeout stays local to its slot', async (t) => {
  const f = fixture(t);
  const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
  const wire = await capturedWire('qualifyCandidates', createQualificationCandidateSnapshot(items(false)).input);
  let release;
  const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
    capability, (url, options) => new Promise((resolve) => { release = () => resolve(provider({}, [])(url, options)); })));
  t.after(() => guard.close());
  let pending;
  await assert.rejects(guard.withCaseScope(capability.schedule[0], async () => {
    pending = guard.cairnFetch(wire[0].url, request(wire[0].body));
    await new Promise((resolve) => setImmediate(resolve));
  }), failCode('guard_busy'));
  release();
  await pending;
  assert.equal(guard.isHalted(), true);
  await assert.rejects(guard.withCaseScope(capability.schedule[1], async () => {}),
    failCode('paid_work_halted'));
  assert.equal(guard.getState().requestCount, f.before.requestCount + 1);

  const timeout = fixture(t, 100_000_000, 1_000);
  const timedCapability = authorizeAdaptiveQualifiedSourcePairCapability(timeout.options);
  let sends = 0;
  const timedGuard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(timeout,
    timedCapability, () => {
      sends += 1;
      if (sends === 1) return new Promise(() => {});
      return Response.json({ id: 'synthetic', object: 'chat.completion',
        model: timeout.stages.answer.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'synthetic' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } });
    }));
  t.after(() => timedGuard.close());
  const answer = request({ model: timeout.stages.answer.model,
    messages: [{ role: 'user', content: 'Synthetic answer.' }], n: 1, temperature: 0,
    max_tokens: 16, store: false, stream: false });
  await timedGuard.withCaseScope(timedCapability.schedule[0], async () => {
    await assert.rejects(timedGuard.answerFetch(timeout.stages.answer.endpoint, answer),
      failCode('case_deadline_exceeded'));
  });
  assert.equal(timedGuard.isHalted(), false);
  await timedGuard.withCaseScope(timedCapability.schedule[1], async () => {
    assert.equal((await timedGuard.answerFetch(timeout.stages.answer.endpoint, answer)).status, 200);
  });
  assert.equal(sends, 2);
  assert.deepEqual(timedGuard.getState().attempts.slice(-2).map((entry) => entry.outcome),
    ['unknown', 'succeeded']);
});

test('G7 source mutation cannot change compiled anchors and a foreign citation fails after settled transport',
  async (t) => {
    const original = items(false);
    const snapshot = createQualificationCandidateSnapshot(original);
    const expected = qualificationPoolWire(snapshot.input, qualification(snapshot.input));
    const f = fixture(t);
    const capability = authorizeAdaptiveQualifiedSourcePairCapability(f.options);
    let sends = 0;
    const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(f,
      capability, (url, options) => {
        sends += 1;
        if (sends === 1) {
          original[0].receipts[0].excerpt = 'forged later source';
          original[0].receipts[0].eventId = 'forged-event';
        }
        return provider(expected, [])(url, options);
      }));
    t.after(() => guard.close());
    const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
      fetchImpl: guard.cairnFetch });
    let qualified;
    await guard.withCaseScope(capability.schedule[0], async () => {
      qualified = await qualifyCandidateItems(model, original);
    });
    assert.equal(qualified[0].qualification.anchors[0].text, 'short source');
    assert.equal(qualified[0].receipts[0].eventId, 'event-0-0');
    assert.equal(sends, 2);

    const deniedFixture = fixture(t);
    const deniedCapability = authorizeAdaptiveQualifiedSourcePairCapability(deniedFixture.options);
    const forged = structuredClone(expected);
    forged.qualifications.item_0.pool = [999];
    let deniedSends = 0;
    const deniedGuard = createAdaptiveQualifiedSourcePairExperimentRequestGuard(guardOptions(deniedFixture,
      deniedCapability, (url, options) => { deniedSends += 1;
        return provider(forged, [])(url, options); }));
    t.after(() => deniedGuard.close());
    const deniedModel = createOpenAIModel({ apiKey: 'synthetic',
      qualificationInputMode: 'adaptive-text-catalog-v1', fetchImpl: deniedGuard.cairnFetch });
    await assert.rejects(deniedGuard.withCaseScope(deniedCapability.schedule[0], async () => {
      await qualifyCandidateItems(deniedModel, items(false));
    }), failCode('invalid_model_output'));
    assert.equal(deniedSends, 2);
    assert.equal(deniedGuard.getState().requestCount, deniedFixture.before.requestCount + 2);
    assert.ok(deniedGuard.getState().attempts.every((entry) => entry.outcome !== null));
  });
