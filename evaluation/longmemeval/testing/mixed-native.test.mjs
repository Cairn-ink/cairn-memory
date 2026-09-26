// Explicit local gate: missing pinned native prerequisites fail rather than skip.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync,
  writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { inspectMem0NativeArtifact } from '../../experiment-budget/mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../../experiment-budget/mem0-native-gateway.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { PUBLIC_ANSWER_INSTRUCTION } from '../public-comparison.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow,
  syntheticMixedFixture } from './mixed-fixture.mjs';

const nativeRequire = createRequire(new URL('../../../adapters/openai/package.json', import.meta.url));
const nativeEncoder = nativeRequire('tiktoken').get_encoding('cl100k_base');

function miniatureNativeArtifact(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-mixed-artifact-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const venvRoot = join(root, 'venv'), pythonRoot = join(root, 'python');
  for (const directory of [join(venvRoot, 'bin'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0/memory'),
    join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info'),
    join(pythonRoot, 'bin'), join(pythonRoot, 'lib/python3.11/encodings')]) {
    mkdirSync(directory, { recursive: true });
  }
  const main = join(venvRoot, 'lib/python3.11/site-packages/mem0/memory/main.py');
  writeFileSync(join(venvRoot, 'pyvenv.cfg'), `home = ${join(pythonRoot, 'bin')}\n`);
  writeFileSync(main, 'value = 1\n');
  writeFileSync(join(venvRoot, 'lib/python3.11/site-packages/mem0ai-2.2.0.dist-info/METADATA'),
    'Name: mem0ai\nVersion: 2.2.0\n');
  writeFileSync(join(pythonRoot, 'bin/python3.11'), '#!/fake\n');
  writeFileSync(join(pythonRoot, 'lib/python3.11/encodings/__init__.py'), '# synthetic\n');
  symlinkSync(join(pythonRoot, 'bin/python3.11'), join(venvRoot, 'bin/python'));
  return { artifact: inspectMem0NativeArtifact({ venvRoot, pythonRoot }), main };
}

test('M12a valid P batch over native 8192-token serialization denies both arms without HTTP',
  async t => {
    assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
    const row = sourceRow();
    row.history.sessions[0].turns = Array.from({ length: 5 }, (_, index) => ({
      turn_id: `lme-turn-${String(index + 1).repeat(64)}`, role: 'user',
      content: '漢'.repeat(3000) }));
    const source = prepareMixedSourceCase(row);
    assert.equal(source.cairnPlan.executable, true);
    assert.equal(source.mem0Input.batches.length, 1);
    const nativeSerialized = source.mem0Input.batches[0]
      .map(message => `${message.role}: ${message.content}\n`).join('');
    assert.ok(nativeEncoder.encode(nativeSerialized, [], []).length > 8192);
    const artifact = inspectMem0NativeArtifact({
      venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    const fake = fakeMixedHttp();
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: [row], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
    try {
      assert.equal(fixture.prepared.counts.fixedN, 1);
      assert.equal(fixture.prepared.preflight[0].reason, 'native_static_input_exceeded');
      assert.equal(fixture.prepared.counts.batchCounts[0], 0);
      const generation = await runMixedGeneration({ prepared: fixture.prepared,
        guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, false);
      assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['failed', 'failed']);
      assert.deepEqual(generation.cases[0].arms.map(arm => arm.reason),
        ['native_static_input_exceeded', 'native_static_input_exceeded']);
      assert.equal(fake.calls.length, 0);
      assert.equal(fixture.guard.attempts().length, 0);
      assert.equal(fixture.guard.caseOutcomes().scopes.length, 2);
    } finally { fixture.guard.close(); }
  });

test('M12a inspected native artifact drift is denied before Cairn-first scope and HTTP', async t => {
  const { artifact, main } = miniatureNativeArtifact(t);
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    writeFileSync(main, 'value = 2\n');
    await assert.rejects(runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root }),
    { code: 'artifact_changed' });
    assert.equal(fake.calls.length, 0);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
    assert.equal(fixture.guard.attempts().length, 0);
  } finally { fixture.guard.close(); }
});

test('M12a actual Cairn model deadline settles X/core before next arm and late fetch', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  let fetchEntered, releasePhysical;
  const entered = new Promise(resolve => { fetchEntered = resolve; });
  let held = false;
  let fixture;
  let firstEmbeddingChecked = false;
  const coreClose = [];
  const fake = fakeMixedHttp(url => {
    if (url.endsWith('/responses/input_tokens') && !held) {
      held = true;
      fetchEntered();
      return new Promise(resolve => { releasePhysical = resolve; });
    }
    if (url.endsWith('/embeddings') && !firstEmbeddingChecked) {
      firstEmbeddingChecked = true;
      assert.equal(coreClose.length, 1, 'core must close before next physical arm request');
      assert.equal(coreClose[0].scopes.length, 1);
      assert.equal(coreClose[0].scopes[0].status, 'failed');
      assert.equal(coreClose[0].scopes[0].reason, 'deadline');
      assert.ok(coreClose[0].attempts.length > 0
        && coreClose[0].attempts.every(attempt => attempt.outcome !== null));
    }
    return undefined;
  });
  fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  const originalClose = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function() {
    let isCore = false;
    try { isCore = this.prepare("SELECT name FROM sqlite_master WHERE name='memories'").get()
      ?.name === 'memories'; } catch { /* A closing non-core connection has no memory schema. */ }
    if (isCore) coreClose.push({ scopes: fixture.guard.caseOutcomes().scopes,
      attempts: fixture.guard.attempts() });
    return originalClose.call(this);
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const running = runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    await entered;
    assert.equal(fake.calls.some(call => call.route === '/v1/embeddings'), false);
    t.mock.timers.tick(30_000);
    const generation = await running;
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['failed', 'completed']);
    assert.equal(firstEmbeddingChecked, true);
    assert.equal(generation.cases[0].arms[0].scope.reason, 'deadline');
    assert.equal(coreClose.length, 1);
    assert.equal(coreClose[0].scopes[0].status, 'failed');
    assert.equal(coreClose[0].scopes[0].reason, 'deadline');
    assert.equal(coreClose[0].attempts[0].outcome, 'unknown');
    assert.equal(coreClose[0].attempts[0].actualMicroUsd, null);
    assert.ok(coreClose[0].attempts[0].reservedMicroUsd > 0);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 2);
    const storeFolder = readdirSync(fixture.root).find(name => name.startsWith('mixed-cairn-'));
    assert.ok(storeFolder);
    const store = join(fixture.root, storeFolder, 'store.db');
    assert.equal(existsSync(store), true);
    const memoryCount = () => {
      const database = new DatabaseSync(store, { readOnly: true });
      try { return database.prepare('SELECT count(*) AS n FROM memories').get().n; }
      finally { database.close(); }
    };
    const storeDigest = () => readdirSync(join(fixture.root, storeFolder)).sort().map(name => [name,
      createHash('sha256').update(readFileSync(join(fixture.root, storeFolder, name)))
        .digest('hex')]);
    const before = { requests: fake.calls.length, attempts: fixture.guard.attempts(),
      scopes: fixture.guard.caseOutcomes().scopes, memories: memoryCount(),
      store: storeDigest() };
    assert.equal(before.memories, 0);
    releasePhysical(Response.json({ object: 'response.input_tokens', input_tokens: 100 }));
    await setImmediate(); await setImmediate();
    assert.equal(fake.calls.length, before.requests);
    assert.deepEqual(fixture.guard.attempts(), before.attempts);
    assert.deepEqual(fixture.guard.caseOutcomes().scopes, before.scopes);
    assert.equal(memoryCount(), before.memories);
    assert.deepEqual(storeDigest(), before.store);
  } finally {
    DatabaseSync.prototype.close = originalClose;
    fixture.guard.close();
  }
});

test('M8 empty Cairn recall still permits an empty-evidence answer; native remains real', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT,
    'explicit pinned native roots required');
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['completed', 'completed'],
      JSON.stringify(generation.cases));
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: new Map(),
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.fixedN, 1);
    assert.equal(scoring.summary.commonResolvedN, 1);
    assert.deepEqual(scoring.cases[0].arms.map(arm => arm.judgment.correct), [true, true]);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 4);
    assert.ok(fake.calls.length >= 4);
  } finally { fixture.guard.close(); }
});

test('M8/M11 nonempty actual Cairn admission and recall use authoritative source, not model summary', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp(undefined, { cairnMemory: true });
  const row = sourceRow();
  const source = prepareMixedSourceCase(row);
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [row], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['completed', 'completed'],
      JSON.stringify(generation.cases));
    const cairn = generation.cases[0].arms[0];
    assert.ok(cairn.diagnostics.admittedMemories > 0);
    assert.ok(cairn.diagnostics.receiptCount > 0);
    assert.ok(cairn.diagnostics.provenance[0].coordinates.length > 0);
    assert.ok(cairn.diagnostics.provenance[0].coordinates[0].classification);
    const answerBodies = fake.calls.filter(call => call.body.model === 'gpt-4.1-mini-2025-04-14'
      && Array.isArray(call.body.messages)
      && call.body.messages[0]?.content === PUBLIC_ANSWER_INSTRUCTION);
    assert.equal(answerBodies.length, 2);
    assert.deepEqual(Object.keys(answerBodies[0].body), ['model', 'messages', 'temperature',
      'max_tokens', 'n', 'store', 'stream']);
    assert.equal(answerBodies[0].body.store, false);
    assert.equal(answerBodies[0].body.stream, false);
    const cairnEvidence = JSON.parse(answerBodies[0].body.messages[1].content).evidence;
    assert.deepEqual(cairnEvidence, [{ text: source.cairnPlan.batches[0].indexedWindows[0].content }]);
    assert.equal(JSON.stringify(cairnEvidence).includes('GENERATED_SUMMARY_POISON'), false);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.commonResolvedN, 1);
  } finally { fixture.guard.close(); }
});

test('M7b malformed native usage stops globally without dispatching later arm', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp((url, body) => url.endsWith('/chat/completions')
    && body.response_format?.type === 'json_object'
    ? Response.json({ object: 'chat.completion', model: body.model,
      usage: null, choices: [{ index: 0, finish_reason: 'stop',
        message: { role: 'assistant', content: '{"memory":[]}' } }] }) : undefined);
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['mem0', 'cairn']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, true);
    assert.equal(generation.cases[0].arms[0].status, 'blocked');
    assert.equal(fake.calls.some(call => call.route === '/v1/responses/input_tokens'), false);
    assert.equal(fixture.guard.isHalted(), true);
  } finally { fixture.guard.close(); }
});

test('M8 invalid completed answer is local unresolved; later arm and judge still run', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  let invalidOnce = false;
  const fake = fakeMixedHttp((url, body) => {
    if (url.endsWith('/chat/completions') && body.messages?.[0]?.role === 'system'
      && !invalidOnce) {
      invalidOnce = true;
      return Response.json({ object: 'chat.completion', model: body.model, choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    }
    return undefined;
  });
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false);
    assert.equal(generation.cases[0].arms[0].status, 'failed');
    assert.equal(generation.cases[0].arms[0].reason, 'invalid_mixed_completion');
    assert.equal(generation.cases[0].arms[0].scope.status, 'completed');
    assert.equal(generation.cases[0].arms[1].status, 'completed');
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.cases[0].arms[0].judgment.attempted, false);
    assert.equal(scoring.cases[0].arms[1].judgment.attempted, true);
    assert.equal(scoring.summary.perArm.cairn.unresolved, 1);
    assert.equal(scoring.summary.perArm.mem0.correct, 1);
  } finally { fixture.guard.close(); }
});

test('M4a equal-value native configuration clone is denied before any provider call', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT,
    'explicit pinned native roots required');
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration: structuredClone(configuration),
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    await assert.rejects(runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root }),
    { code: 'native_configuration_identity_required' });
    assert.equal(fake.calls.length, 0);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  } finally { fixture.guard.close(); }
});

test('M7b authentic native deadline remains local and next Cairn arm runs once', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 1000 });
  let delayed = false;
  const fake = fakeMixedHttp(async (url, body) => {
    if (url.endsWith('/embeddings') && !delayed) {
      delayed = true;
      await new Promise(resolve => setTimeout(resolve, 1600));
      return Response.json({
        object: 'list', model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
        data: body.input.map((_, index) => ({ object: 'embedding', index,
          embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === 0 ? 1 : 0) })) });
    }
    return undefined;
  });
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['mem0', 'cairn']],
    httpTimeoutMs: 1000, fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.equal(generation.cases[0].arms[1].status, 'failed');
    assert.equal(generation.cases[0].arms[1].scope.reason, 'deadline');
    assert.equal(generation.cases[0].arms[0].status, 'completed');
    assert.equal(fake.calls.filter(call => call.route === '/v1/responses/input_tokens').length, 1);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.perArm.mem0.unresolved, 1);
    assert.equal(scoring.summary.perArm.cairn.correct, 1);
    assert.equal(scoring.cases[0].arms[1].scope.status, 'blocked');
  } finally { fixture.guard.close(); }
});

test('M9 real local fixed-N three-case scoring retains both arm orders and all 3x3 cells', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const rows = ['synthetic_source_1', 'synthetic_source_2', 'synthetic_source_3'].map(sourceRow);
  rows[2].history.sessions[0].date = '2025/01/01 (Wed) 09:00';
  let judgeCount = 0;
  const fake = fakeMixedHttp((url, body) => {
    if (url.endsWith('/chat/completions') && body.model === 'gpt-4o-2024-08-06') {
      judgeCount++;
      return Response.json({ object: 'chat.completion', model: body.model,
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
          content: judgeCount % 2 ? 'yes' : 'no' } }] });
    }
    return undefined;
  });
  const fixture = syntheticMixedFixture(t, { artifact, configuration, sourceCases: rows,
    armOrders: [['cairn', 'mem0'], ['mem0', 'cairn'], ['cairn', 'mem0']],
    fetchImpl: fake.fetchImpl });
  try {
    assert.equal(fixture.prepared.counts.fixedN, 3);
    assert.equal(fixture.prepared.preflight[2].status, 'failed');
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.deepEqual(generation.cases.map(item => item.arms.map(arm => arm.status)),
      [['completed', 'completed'], ['completed', 'completed'], ['failed', 'failed']]);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: ['synthetic_source_1', 'synthetic_source_2', 'synthetic_source_3']
        .map(evaluatorRow), referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(judgeCount, 4);
    assert.equal(scoring.summary.fixedN, 3);
    assert.equal(scoring.summary.commonResolvedN, 2);
    assert.equal(scoring.summary.outcomeTable.correct.incorrect, 1);
    assert.equal(scoring.summary.outcomeTable.incorrect.correct, 1);
    assert.equal(scoring.summary.outcomeTable.unresolved.unresolved, 1);
    for (const name of ['cairn', 'mem0']) {
      assert.equal(scoring.summary.perArm[name].correct, 1);
      assert.equal(scoring.summary.perArm[name].incorrect, 1);
      assert.equal(scoring.summary.perArm[name].unresolved, 1);
    }
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 12);
  } finally { fixture.guard.close(); }
});

test('M9 non-string reference without verified rendering is unresolved before judge reserve', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['mem0', 'cairn']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false);
    const evaluator = evaluatorRow();
    evaluator.reference_answer = [1, 2];
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluator], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.deepEqual(scoring.cases[0].arms.map(item => item.judgment.reason),
      ['reference_rendering_unverified', 'reference_rendering_unverified']);
    assert.deepEqual(scoring.cases[0].arms.map(item => item.judgment.attempted), [false, false]);
    assert.equal(fixture.guard.attempts().some(item => item.stage === 'judge'), false);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 4);
  } finally { fixture.guard.close(); }
});
