// Explicit local gate: missing pinned native prerequisites fail rather than skip.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { prepareLongMemEval } from '../prepare.mjs';
import { loadReferenceRenderings, resolveReferenceRendering } from '../reference-rendering.mjs';
import { reportSnapshot } from '../mixed-validation.mjs';
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
  const row = sourceRow();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [row], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    await assert.rejects(runMixedGeneration({ prepared: structuredClone(fixture.prepared),
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root }),
    { code: 'prepared_identity_required' });
    assert.equal(fake.calls.length, 0);
    row.history.sessions[0].turns[0].content = 'MUTATED_SOURCE_POISON';
    row.question.text = 'MUTATED_QUESTION_POISON';
    row.question.date = '2099/12/31 (Wed) 00:00';
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false, JSON.stringify(generation.cases));
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['completed', 'completed'],
      JSON.stringify(generation.cases));
    assert.deepEqual(JSON.parse(JSON.stringify(generation.cases[0].question)),
      { text: 'What synthetic fact?', date: '2024-01-02 10:00' });
    const answerBodies = fake.calls.filter(call => call.body.messages?.[0]?.content
      === PUBLIC_ANSWER_INSTRUCTION);
    assert.equal(answerBodies.length, 2);
    assert.ok(answerBodies.every(call => call.body.messages[1].content.includes('What synthetic fact?')
      && !call.body.messages[1].content.includes('MUTATED_')));
    assert.equal(JSON.stringify(fake.calls).includes('MUTATED_SOURCE_POISON'), false);
    assert.ok(fake.calls.some(call => call.route === '/v1/responses/input_tokens'
      && JSON.stringify(call.body).includes('Synthetic memory fact.')));
    assert.ok(fake.calls.some(call => call.route === '/v1/responses'
      && JSON.stringify(call.body).includes('Synthetic memory fact.')));
    assert.ok(fake.calls.some(call => call.body.response_format?.type === 'json_object'
      && JSON.stringify(call.body).includes('Synthetic memory fact.')));
    const beforeReplay = { calls: fake.calls.length, scopes: fixture.guard.caseOutcomes().scopes.length };
    await assert.rejects(runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root }),
    { code: 'prepared_identity_required' });
    assert.equal(fake.calls.length, beforeReplay.calls);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, beforeReplay.scopes);
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
    const question = { text: row.question.text, date: source.canonicalQuestionDate };
    const expectedEvidence = [source.cairnPlan.batches[0].indexedWindows[0].content,
      'Synthetic memory fact.'];
    for (const [index, { body }] of answerBodies.entries()) {
      assert.deepEqual(Object.keys(body), ['model', 'messages', 'temperature',
        'max_tokens', 'n', 'store', 'stream']);
      assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
      assert.equal(body.temperature, 0);
      assert.equal(body.max_tokens, 512);
      assert.equal(body.n, 1);
      assert.equal(body.store, false);
      assert.equal(body.stream, false);
      assert.deepEqual(body.messages[0], { role: 'system', content: PUBLIC_ANSWER_INSTRUCTION });
      assert.deepEqual(body.messages[1], { role: 'user', content: JSON.stringify({
        evidence: [{ text: expectedEvidence[index] }], currentQuestion: question }) });
    }
    assert.equal(answerBodies[0].body.messages[1].content.includes('GENERATED_SUMMARY_POISON'), false);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.commonResolvedN, 1);
  } finally { fixture.guard.close(); }
});

test('M11 priced invalid judge completion is local unresolved; next judge runs once', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  let judgeCalls = 0;
  const fake = fakeMixedHttp((url, body) => {
    if (url.endsWith('/chat/completions') && body.model === 'gpt-4o-2024-08-06') {
      judgeCalls++;
      if (judgeCalls === 1) return Response.json({ object: 'chat.completion',
        model: body.model, choices: [],
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
    assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['completed', 'completed']);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.fixedN, 1);
    assert.equal(scoring.summary.commonResolvedN, 0);
    assert.equal(scoring.summary.outcomeTable.unresolved.correct, 1);
    assert.equal(scoring.cases[0].arms[0].judgment.reason, 'invalid_mixed_completion');
    assert.equal(scoring.cases[0].arms[0].judgment.attempted, true);
    assert.equal(scoring.cases[0].arms[1].judgment.correct, true);
    assert.equal(scoring.cases[0].arms[1].judgment.attempted, true);
    assert.equal(judgeCalls, 2);
    const judgeAttempts = fixture.guard.attempts().filter(item => item.stage === 'judge');
    assert.equal(judgeAttempts.length, 2);
    assert.ok(judgeAttempts.every(item => item.outcome === 'succeeded'
      && item.actualMicroUsd !== null && item.reservedMicroUsd > 0));
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 4);
  } finally { fixture.guard.close(); }
});

test('M11 malformed judge usage globally halts; later judge is not attempted', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  let judgeCalls = 0;
  const fake = fakeMixedHttp((url, body) => {
    if (url.endsWith('/chat/completions') && body.model === 'gpt-4o-2024-08-06') {
      judgeCalls++;
      return Response.json({ object: 'chat.completion', model: body.model, usage: null,
        choices: [{ index: 0, finish_reason: 'stop',
          message: { role: 'assistant', content: 'yes' } }] });
    }
    return undefined;
  });
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    assert.equal(generation.halted, false);
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, true);
    assert.ok(scoring.haltReason);
    assert.equal(scoring.summary.fixedN, 1);
    assert.equal(scoring.cases[0].arms[0].judgment.attempted, true);
    assert.equal(scoring.cases[0].arms[1].judgment.attempted, false);
    assert.equal(judgeCalls, 1);
    const judgeAttempts = fixture.guard.attempts().filter(item => item.stage === 'judge');
    assert.equal(judgeAttempts.length, 1);
    assert.equal(judgeAttempts[0].outcome, 'unknown');
    assert.equal(judgeAttempts[0].actualMicroUsd, null);
    assert.ok(judgeAttempts[0].reservedMicroUsd > 0);
    assert.equal(fixture.guard.isHalted(), true);
  } finally { fixture.guard.close(); }
});

for (const stage of ['count', 'generation', 'answer']) {
  test(`M7/M8 Cairn ${stage} unsettled accounting globally halts before Mem0`, async t => {
    assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
    const artifact = inspectMem0NativeArtifact({
      venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    const fake = fakeMixedHttp((url, body) => {
      if (stage === 'count' && url.endsWith('/responses/input_tokens')) {
        throw Error('synthetic count transport fault');
      }
      if (stage === 'generation' && url.endsWith('/responses')) {
        return Response.json({ object: 'response', model: body.model, status: 'completed',
          error: null, incomplete_details: null, usage: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: '{"items":[]}' }] }] });
      }
      if (stage === 'answer' && url.endsWith('/chat/completions')
        && body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION) {
        return Response.json({ object: 'chat.completion', model: body.model, usage: null,
          choices: [{ index: 0, finish_reason: 'stop',
            message: { role: 'assistant', content: 'Synthetic memory fact.' } }] });
      }
      return undefined;
    });
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
    try {
      const generation = await runMixedGeneration({ prepared: fixture.prepared,
        guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, true, JSON.stringify(generation.cases));
      assert.equal(generation.cases[0].arms[0].status, 'failed');
      assert.ok(generation.cases[0].arms[0].scope, 'entered first scope remains observable');
      assert.equal(generation.cases[0].arms[1].status, 'blocked');
      assert.equal(fake.calls.some(call => call.route === '/v1/embeddings'
        || call.body.response_format?.type === 'json_object'), false);
      assert.equal(fixture.guard.attempts().filter(item => item.outcome === 'unknown').length, 1);
      assert.equal(fixture.guard.isHalted(), true);
    } finally { fixture.guard.close(); }
  });
}

for (const [label, completion] of [
  ['finish_reason length', { finish_reason: 'length', content: 'partial' }],
  ['over 512 counted tokens', { finish_reason: 'stop', content: 'word '.repeat(600) }],
]) {
  test(`M8 ${label} answer is locally unresolved and never judged`, async t => {
    assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
    const artifact = inspectMem0NativeArtifact({
      venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    let answerCalls = 0, judgeCalls = 0;
    const fake = fakeMixedHttp((url, body) => {
      if (url.endsWith('/chat/completions') && body.model === 'gpt-4o-2024-08-06') judgeCalls++;
      if (url.endsWith('/chat/completions')
        && body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION && ++answerCalls === 1) {
        return Response.json({ object: 'chat.completion', model: body.model,
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          choices: [{ index: 0, finish_reason: completion.finish_reason,
            message: { role: 'assistant', content: completion.content } }] });
      }
      return undefined;
    });
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
    try {
      const generation = await runMixedGeneration({ prepared: fixture.prepared,
        guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, false, JSON.stringify(generation.cases));
      assert.equal(generation.cases[0].arms[0].status, 'failed');
      assert.equal(generation.cases[0].arms[0].reason, 'invalid_mixed_completion');
      assert.equal(generation.cases[0].arms[1].status, 'completed');
      const scoring = await scoreMixedGeneration({ generationReport: generation,
        evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
        guard: fixture.guard, apiKey: 'synthetic-only' });
      assert.equal(scoring.halted, false);
      assert.deepEqual(scoring.cases[0].arms.map(item => item.judgment.attempted), [false, true]);
      assert.equal(judgeCalls, 1);
      assert.equal(answerCalls, 2);
    } finally { fixture.guard.close(); }
  });
}

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
    const reordered = structuredClone(generation);
    reordered.cases.reverse();
    Object.freeze(reordered);
    await assert.rejects(scoreMixedGeneration({ generationReport: reordered,
      evaluatorRows: ['synthetic_source_1', 'synthetic_source_2', 'synthetic_source_3']
        .map(evaluatorRow), referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' }), { code: 'invalid_mixed_report' });
    assert.equal(judgeCount, 0, 'wrong real case order denied before the first judge');
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
    assert.deepEqual(JSON.parse(JSON.stringify(scoring.summary.outcomeTable)), {
      correct: { correct: 0, incorrect: 1, unresolved: 0 },
      incorrect: { correct: 1, incorrect: 0, unresolved: 0 },
      unresolved: { correct: 0, incorrect: 0, unresolved: 1 },
    });
    for (const name of ['cairn', 'mem0']) {
      assert.equal(scoring.summary.perArm[name].correct, 1);
      assert.equal(scoring.summary.perArm[name].incorrect, 1);
      assert.equal(scoring.summary.perArm[name].unresolved, 1);
      assert.equal(scoring.summary.perArm[name].accuracyFixedN, 1 / 3);
      assert.equal(scoring.summary.perArm[name].accuracyResolved, 1 / 2);
      assert.equal(scoring.summary.perArm[name].resolvedFraction, 2 / 3);
    }
    assert.equal(Object.keys(scoring.summary.byCategory).length, 6);
    assert.equal(scoring.summary.byCategory['single-session-user'].fixedN, 3);
    for (const name of ['cairn', 'mem0']) assert.deepEqual(
      JSON.parse(JSON.stringify(scoring.summary.byCategory['single-session-user'].perArm[name])),
      JSON.parse(JSON.stringify(scoring.summary.perArm[name])));
    for (const [category, value] of Object.entries(scoring.summary.byCategory)) {
      if (category === 'single-session-user') continue;
      assert.equal(value.fixedN, 0);
      for (const arm of Object.values(value.perArm)) assert.deepEqual(JSON.parse(JSON.stringify(arm)),
        { correct: 0, incorrect: 0, unresolved: 0, accuracyFixedN: null,
          accuracyResolved: null, resolvedFraction: null });
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

test('M9 genuine evaluator-bound Python rendering permits non-string mixed judging', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
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
    const inputPath = join(fixture.root, 'reference-source.json');
    const preparedDirectory = join(fixture.root, 'reference-prepared');
    const sidecarPath = join(fixture.root, 'reference-sidecar.json');
    const source = JSON.stringify([{ question_id: 'synthetic_source_1',
      question_type: 'single-session-user', question: 'What synthetic fact?',
      answer: [1, 2], question_date: '2024/01/02', haystack_session_ids: ['s'],
      haystack_dates: ['2024/01/01'], haystack_sessions: [[{
        role: 'user', content: 'Synthetic memory fact.' }]], answer_session_ids: [] }]);
    writeFileSync(inputPath, source);
    await prepareLongMemEval({ inputPath,
      expectedSha256: createHash('sha256').update(source).digest('hex'),
      datasetRevision: 'synthetic', datasetVariant: 's-cleaned',
      questionIds: ['synthetic_source_1'], outputDirectory: preparedDirectory });
    const script = new URL('../fixtures/render-reference-sidecar.py', import.meta.url).pathname;
    const rendered = spawnSync('python3', [script, '--source', inputPath,
      '--prepared', preparedDirectory, '--output', sidecarPath],
    { encoding: 'utf8', timeout: 10_000 });
    assert.equal(rendered.status, 0, rendered.stderr);
    const referenceRenderings = await loadReferenceRenderings({ preparedDirectory, sidecarPath,
      expectedSidecarSha256: JSON.parse(rendered.stdout).sidecar_sha256 });
    const evaluator = JSON.parse(readFileSync(join(preparedDirectory, 'evaluator.jsonl'), 'utf8'));
    assert.deepEqual(evaluator.reference_answer, [1, 2]);
    const token = referenceRenderings.get(evaluator.question_id);
    assert.equal(resolveReferenceRendering(token, evaluator), '[1, 2]');
    const validatedEquivalent = reportSnapshot(evaluator);
    assert.throws(() => resolveReferenceRendering(token, validatedEquivalent),
      { code: 'rendering_mismatch' });
    assert.equal(resolveReferenceRendering(token, structuredClone(validatedEquivalent)), '[1, 2]');
    const scoring = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluator], referenceRenderings,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.deepEqual(scoring.cases[0].arms.map(item => item.judgment.attempted), [true, true],
      JSON.stringify(scoring.cases[0].arms.map(item => item.judgment)));
    assert.deepEqual(scoring.cases[0].arms.map(item => item.judgment.correct), [true, true]);
    const judgeBodies = fake.calls.filter(call => call.body.model === 'gpt-4o-2024-08-06');
    assert.equal(judgeBodies.length, 2);
    assert.ok(judgeBodies.every(call => call.body.messages[0].content.includes('Correct Answer: [1, 2]')));
  } finally { fixture.guard.close(); }
});

test('M12b wrong, missing, cross-bound, and changed renderings deny mixed judge pre-dispatch',
  async t => {
    assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
    const artifact = inspectMem0NativeArtifact({
      venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    const ids = [1, 2, 3, 4].map(index => `synthetic_source_${index}`);
    const fake = fakeMixedHttp();
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: ids.map(sourceRow), armOrders: ids.map(() => ['cairn', 'mem0']),
      fetchImpl: fake.fetchImpl });
    try {
      const generation = await runMixedGeneration({ prepared: fixture.prepared,
        guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, false, JSON.stringify(generation.cases));
      assert.ok(generation.cases.every(item => item.arms.every(arm => arm.status === 'completed')));
      const inputPath = join(fixture.root, 'negative-reference-source.json');
      const preparedDirectory = join(fixture.root, 'negative-reference-prepared');
      const sidecarPath = join(fixture.root, 'negative-reference-sidecar.json');
      const source = JSON.stringify(ids.map(id => ({ question_id: id,
        question_type: 'single-session-user', question: 'What synthetic fact?',
        answer: [1, 2], question_date: '2024/01/02', haystack_session_ids: ['s'],
        haystack_dates: ['2024/01/01'], haystack_sessions: [[{
          role: 'user', content: 'Synthetic memory fact.' }]], answer_session_ids: [] })));
      writeFileSync(inputPath, source);
      await prepareLongMemEval({ inputPath,
        expectedSha256: createHash('sha256').update(source).digest('hex'),
        datasetRevision: 'synthetic', datasetVariant: 's-cleaned',
        questionIds: ids, outputDirectory: preparedDirectory });
      const script = new URL('../fixtures/render-reference-sidecar.py', import.meta.url).pathname;
      const rendered = spawnSync('python3', [script, '--source', inputPath,
        '--prepared', preparedDirectory, '--output', sidecarPath],
      { encoding: 'utf8', timeout: 10_000 });
      assert.equal(rendered.status, 0, rendered.stderr);
      const issued = await loadReferenceRenderings({ preparedDirectory, sidecarPath,
        expectedSidecarSha256: JSON.parse(rendered.stdout).sidecar_sha256 });
      const evaluators = readFileSync(join(preparedDirectory, 'evaluator.jsonl'), 'utf8')
        .trimEnd().split('\n').map(JSON.parse);
      const renderings = new Map([
        [evaluators[0].question_id, Object.freeze({})], // Forged, unissued token.
        // Case 1 deliberately has no capability.
        [evaluators[2].question_id, issued.get(evaluators[0].question_id)], // Other row.
        [evaluators[3].question_id, issued.get(evaluators[3].question_id)],
      ]);
      evaluators[3].reference_answer = [3, 4]; // Changed after issuance.
      const scoring = await scoreMixedGeneration({ generationReport: generation,
        evaluatorRows: evaluators, referenceRenderings: renderings,
        guard: fixture.guard, apiKey: 'synthetic-only' });
      assert.equal(scoring.halted, false);
      assert.equal(scoring.summary.fixedN, 4);
      assert.ok(scoring.cases.every(item => item.arms.every(arm =>
        arm.judgment.reason === 'reference_rendering_unverified'
          && arm.judgment.attempted === false)));
      assert.equal(fixture.guard.attempts().some(item => item.stage === 'judge'), false);
      assert.equal(fake.calls.some(call => call.body.model === 'gpt-4o-2024-08-06'), false);
    } finally { fixture.guard.close(); }
  });
