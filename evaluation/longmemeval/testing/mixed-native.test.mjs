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
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createMixedResultJournal, inspectMixedResultJournal } from '../mixed-result-journal.mjs';
import { interruption, syntheticNativeDescriptors } from './result-journal-fixture.mjs';

test('RD8 actual native generation interruption retains settled answer', t => interruption(t, 'generation', true));
test('RD8 actual native scoring interruption retains settled judgment', t => interruption(t, 'scoring', true));
test('JO2/JO3 actual native generation interruption retains both observations',
  t => interruption(t, 'generation', true, true));
test('JO2/JO3 actual native scoring interruption preserves the observed generation prefix',
  t => interruption(t, 'scoring', true, true));

for (const order of [['cairn', 'mem0'], ['mem0', 'cairn']]) for (const observations of [false, true]) {
  test(`RD2/RD5/RD8 actual native journal completes both phases in ${order.join('/')} order${observations ? ' with JO2 observations' : ''}`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-journal-native-' });
    const descriptors = syntheticNativeDescriptors(workspace.path, true);
    const fake = fakeMixedHttp();
    const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [sourceRow()],
      armOrders: [order], fetchImpl: fake.fetchImpl, workspace });
    const directory = join(workspace.path, 'journal');
    const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
    const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal,
      ...(observations ? { phaseTiming: 'bounded-tail-v1', recallWitness: 'bounded-v1' } : {}) });
    assert.ok(generation.cases[0].arms.every(arm => arm.status === 'completed'), JSON.stringify(generation));
    assert.ok(generation.cases[0].arms.every(arm => !Object.hasOwn(arm.diagnostics, 'nativeFailure')));
    const scored = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'JOURNAL_KEY_CANARY', resultJournal });
    const observed = inspectMixedResultJournal({ directory });
    assert.deepEqual(observed.phases.generation.completion.report, generation);
    assert.deepEqual(observed.phases.scoring.completion.report, scored);
    for (const phase of ['generation', 'scoring']) {
      assert.deepEqual(observed.phases[phase].arms.map(arm => arm.name), order);
      assert.ok(observed.phases[phase].arms.every(arm => arm.state === 'terminal'));
    }
    assert.equal(scored.summary.commonResolvedN, 1);
    if (observations) {
      const cairn = generation.cases[0].arms.find(arm => arm.name === 'cairn');
      assert.ok(cairn.diagnostics.adapterPhaseTiming);
      assert.equal(cairn.diagnostics.recallWitness.closed, true);
      assert.equal(cairn.diagnostics.recallWitness.disposed, true);
    }
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false);
  });
}

test('RD2/RD8 actual Cairn ingestion failure and native answer remain durable', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-journal-native-failure-' });
  const descriptors = syntheticNativeDescriptors(workspace.path, true);
  const fake = fakeMixedHttp((url, body) => url.endsWith('/responses')
    ? indexedResponse(body, { items: [{ content: 'bad', kind: 'context', confidence: 1,
      sourceIndices: [999] }] }) : undefined);
  const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl, workspace });
  const directory = join(workspace.path, 'journal');
  const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
  const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal });
  assert.deepEqual(generation.cases[0].arms.map(arm => arm.status), ['failed', 'completed']);
  const observed = inspectMixedResultJournal({ directory });
  assert.equal(observed.phases.generation.arms[0].result.reason, 'ingestion_incomplete');
  assert.equal(observed.phases.generation.arms[1].result.answer.text, 'Synthetic memory fact.');
});

test('IC5 actual mixed empty extraction text remains zero-admission and journaled', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-journal-empty-text-' });
  const descriptors = syntheticNativeDescriptors(workspace.path, true);
  const fake = fakeMixedHttp((url, body) => url.endsWith('/responses')
    && body.text.format.name === 'cairn_extract'
    ? indexedResponse(body, { items: [{ content: ' \t\n ', kind: 'context', confidence: 1,
      sourceIndices: [0] }] }) : undefined);
  const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl, workspace });
  const directory = join(workspace.path, 'journal');
  const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
  const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
    apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal });
  const [cairn, mem0] = generation.cases[0].arms;
  assert.equal(generation.halted, false);
  assert.deepEqual([cairn.status, mem0.status], ['failed', 'completed']);
  assert.equal(cairn.reason, 'ingestion_incomplete');
  assert.equal(cairn.diagnostics.ingestion.counts.failed, 1);
  const folder = readdirSync(fixture.root).find(name => name.startsWith('mixed-cairn-'));
  const database = new DatabaseSync(join(fixture.root, folder, 'store.db'), { readOnly: true });
  workspace.defer(() => database.close());
  assert.equal(database.prepare('SELECT count(*) AS n FROM memories').get().n, 0);
  assert.deepEqual(cairn.diagnostics.modelDiagnostics.events,
    reportSnapshot([{ version: 1, stage: 'extract', layer: 'core_validation', reason: 'invalid_extraction_text_empty' }]));
  assert.ok([cairn, mem0].every(arm => !Object.hasOwn(arm.diagnostics, 'nativeFailure')));
  const observed = inspectMixedResultJournal({ directory });
  assert.deepEqual(observed.phases.generation.completion.report, generation);
  assert.deepEqual(observed.phases.generation.arms[0].result.diagnostics, cairn.diagnostics);
  assert.equal(fake.calls.filter(call => call.body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION).length, 1);
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
});

const nativeRequire = createRequire(new URL('../../../adapters/openai/package.json', import.meta.url));
const nativeEncoder = nativeRequire('tiktoken').get_encoding('cl100k_base');

test('T01/T03/T05 bounded phase timing preserves paired success and late failure', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  for (const lateFailure of [false, true]) {
    let baseline;
    for (const enabled of [false, true]) {
      const row = sourceRow();
      if (lateFailure) row.history.sessions = Array.from({ length: 10 }, (_, index) => ({
        ...row.history.sessions[0], session_index: index,
        session_id: `lme-session-${String(index).padStart(64, '0')}`,
        turns: [{ ...row.history.sessions[0].turns[0],
          turn_id: `lme-turn-${String(index).padStart(64, '0')}` }],
      }));
      let extracts = 0;
      const fake = fakeMixedHttp((url, body) => {
        if (url.endsWith('/responses') && body.text.format.name === 'cairn_extract') {
          extracts++;
          if (lateFailure && extracts === 10) return indexedResponse(body, 'PRIVATE_SENTINEL');
        }
      });
      const fixture = syntheticMixedFixture(t, { artifact, configuration, sourceCases: [row],
        armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl,
        ...(lateFailure ? { comparisonProfile: 'indexed-evidence-v1' } : {}) });
      try {
        const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
          apiKey: 'synthetic-only', cairnStoreRoot: fixture.root,
          ...(enabled ? { phaseTiming: 'bounded-tail-v1' } : {}) });
        assert.equal(generation.halted, false, JSON.stringify(generation.cases));
        assert.equal(generation.manifest.cairn.comparisonProfile,
          lateFailure ? 'indexed-evidence-v1' : undefined);
        const [cairn, mem0] = generation.cases[0].arms;
        assert.equal(cairn.status, lateFailure ? 'failed' : 'completed');
        assert.equal(mem0.status, 'completed', JSON.stringify(mem0));
        assert.equal(Object.hasOwn(mem0.diagnostics, 'adapterPhaseTiming'), false);
        assert.equal(Object.hasOwn(cairn.diagnostics, 'adapterPhaseTiming'), enabled);
        assert.equal(fake.calls.filter(call => call.body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION)
          .length, lateFailure ? 1 : 2, 'partial ingestion never receives an answer');
        if (enabled) {
          const timing = cairn.diagnostics.adapterPhaseTiming;
          assert.equal(timing.totalEventCount, lateFailure ? 70 : 7);
          assert.equal(timing.retainedEventCount, lateFailure ? 64 : 7);
          assert.equal(timing.omittedEventCount, lateFailure ? 6 : 0);
          assert.equal(timing.events.at(-1).phase, 'output_validation');
          assert.equal(timing.events.at(-1).outcome, lateFailure ? 'failed' : 'completed');
          assert.equal(JSON.stringify(timing).includes('PRIVATE_SENTINEL'), false);
        }
        const scored = await scoreMixedGeneration({ generationReport: generation,
          evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
          guard: fixture.guard, apiKey: 'synthetic-only' });
        assert.equal(scored.summary.fixedN, 1);
        assert.equal(scored.summary.perArm.cairn.unresolved, lateFailure ? 1 : 0);
        assert.equal(scored.summary.perArm.mem0.correct, 1);
        const comparable = JSON.parse(JSON.stringify(generation));
        delete comparable.cases[0].arms[0].diagnostics.adapterPhaseTiming;
        const observed = { generation: comparable, summary: scored.summary,
          calls: fake.calls, attempts: fixture.guard.attempts().map(item => ({
            stage: item.stage, ordinal: item.ordinal, outcome: item.outcome,
            reservedMicroUsd: item.reservedMicroUsd, actualMicroUsd: item.actualMicroUsd })) };
        if (!enabled) baseline = observed;
        else assert.deepEqual(observed, baseline, 'only the opt-in timing field differs');
      } finally { fixture.guard.close(); }
    }
  }
});

test('T03 thrown Cairn execution boundary retains prior timings and native/scoring slots', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl,
    comparisonProfile: 'indexed-evidence-v1' });
  const originalPrepare = DatabaseSync.prototype.prepare;
  let faulted = false;
  DatabaseSync.prototype.prepare = function(sql) {
    if (!faulted && fake.calls.some(call => call.route === '/v1/responses')
      && /FROM memories/iu.test(sql)) {
      faulted = true;
      throw Error('PRIVATE_SQL_SENTINEL');
    }
    return originalPrepare.call(this, sql);
  };
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root,
      phaseTiming: 'bounded-tail-v1', recallWitness: 'bounded-v1' });
    assert.equal(faulted, true);
    const [cairn, mem0] = generation.cases[0].arms;
    assert.equal(cairn.status, 'failed');
    assert.equal(cairn.diagnostics.stage, 'execution');
    assert.equal(cairn.answer, null);
    assert.equal(cairn.diagnostics.adapterPhaseTiming.totalEventCount, 7);
    assert.equal(cairn.diagnostics.recallWitness.closed, true);
    assert.equal(cairn.diagnostics.recallWitness.disposed, true);
    assert.equal(cairn.diagnostics.recallWitness.recallOutcome, 'failed');
    assert.equal(cairn.diagnostics.recallWitness.calls, 0);
    assert.equal(mem0.status, 'completed');
    assert.equal(JSON.stringify(generation).includes('PRIVATE_SQL_SENTINEL'), false);
    const scored = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scored.summary.fixedN, 1);
    assert.equal(scored.summary.perArm.cairn.unresolved, 1);
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    fixture.guard.close();
  }
});

test('T03/T06 aborted phase closes after settlement and ignores late physical completion', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  let signalEntered, release;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  const fake = fakeMixedHttp(url => {
    if (url.endsWith('/responses/input_tokens')) {
      signalEntered();
      return new Promise(resolve => { release = resolve; });
    }
  });
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const running = runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, phaseTiming: 'bounded-tail-v1',
      recallWitness: 'bounded-v1' });
    await entered;
    t.mock.timers.tick(30_000);
    const generation = await running;
    const [cairn, mem0] = generation.cases[0].arms;
    assert.equal(cairn.status, 'failed');
    assert.equal(cairn.scope.reason, 'deadline');
    assert.equal(mem0.status, 'completed');
    const timing = cairn.diagnostics.adapterPhaseTiming;
    assert.equal(timing.events.at(-1).phase, 'count_transport');
    assert.equal(timing.events.at(-1).outcome, 'aborted');
    assert.equal(timing.totalEventCount, 2);
    assert.equal(cairn.diagnostics.attempts.unknownActualCount, 1);
    assert.equal(cairn.diagnostics.recallWitness.closed, true);
    assert.equal(cairn.diagnostics.recallWitness.disposed, true);
    assert.equal(cairn.diagnostics.recallWitness.recallOutcome, 'unknown');
    const before = { report: JSON.stringify(generation), requests: fake.calls.length,
      attempts: fixture.guard.attempts(), scopes: fixture.guard.caseOutcomes().scopes };
    release(Response.json({ object: 'response.input_tokens', input_tokens: 100 }));
    await setImmediate(); await setImmediate();
    assert.equal(JSON.stringify(generation), before.report);
    assert.equal(fake.calls.length, before.requests);
    assert.deepEqual(fixture.guard.attempts(), before.attempts);
    assert.deepEqual(fixture.guard.caseOutcomes().scopes, before.scopes);
    const scored = await scoreMixedGeneration({ generationReport: generation,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scored.summary.perArm.cairn.unresolved, 1);
  } finally { fixture.guard.close(); }
});

test('T01/T06 preflight-only arms never create a phase observer', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const row = sourceRow();
  row.history.sessions[0].date = '2025/01/01 (Wed) 09:00';
  const fake = fakeMixedHttp();
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [row], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, phaseTiming: 'bounded-tail-v1',
      recallWitness: 'bounded-v1' });
    assert.equal(fake.calls.length, 0);
    assert.ok(generation.cases[0].arms.every(arm => arm.status === 'failed'
      && !Object.hasOwn(arm.diagnostics, 'adapterPhaseTiming')
      && !Object.hasOwn(arm.diagnostics, 'recallWitness')));
    assert.equal(readdirSync(fixture.root).some(name => name.startsWith('mixed-cairn-')), false);
  } finally { fixture.guard.close(); }
});

function indexedResponse(body, output) {
  return Response.json({ object: 'response', model: body.model, status: 'completed',
    error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant',
      status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
}

// Collect only generated metadata from this test's owned, already closed store.
// The same bijection applies to report and wire fields. Prose is never rewritten.
function witnessMetadata(root) {
  const folder = readdirSync(root).find(name => name.startsWith('mixed-cairn-'));
  const database = new DatabaseSync(join(root, folder, 'store.db'), { readOnly: true });
  try {
    const memories = database.prepare('SELECT id, created_at, updated_at FROM memories ORDER BY rowid').all();
    const receipts = database.prepare('SELECT id, created_at FROM receipts ORDER BY rowid').all();
    return { identities: new Map([...memories.map((row, index) => [row.id, `memory-${index}`]),
      ...receipts.map((row, index) => [row.id, `receipt-${index}`])]),
    times: new Set([...memories.flatMap(row => [row.created_at, row.updated_at]),
      ...receipts.map(row => row.created_at)]) };
  } finally { database.close(); }
}

function witnessComparable(value, metadata, path = []) {
  if (Array.isArray(value)) return value.map((item, index) => witnessComparable(item, metadata, [...path, index]));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, witnessComparable(item, metadata, [...path, key])]));
  const key = path.at(-1);
  const identityContainer = ['memory', 'memories', 'receipts'].includes(path.at(-2))
    || (typeof path.at(-2) === 'number' && ['memories', 'receipts'].includes(path.at(-3)));
  const memoryIdEnum = path.includes('schema') && path.includes('properties')
    && path.at(-3) === 'memoryId' && path.at(-2) === 'enum';
  if ((['memoryId', 'receiptId', 'childId'].includes(key) || (key === 'id' && identityContainer))
    && metadata.identities.has(value)) return metadata.identities.get(value);
  if (memoryIdEnum && metadata.identities.has(value)) return metadata.identities.get(value);
  if (['createdAt', 'updatedAt'].includes(key) && identityContainer && metadata.times.has(value))
    return '<generated-time>';
  return value;
}

function witnessWire(bytes, metadata) {
  const body = JSON.parse(bytes);
  assert.equal(JSON.stringify(body), bytes, 'preserve original outer HTTP serialization');
  const content = body.input?.[0]?.content?.[0];
  if (content && typeof content.text === 'string') {
    const input = JSON.parse(content.text);
    assert.equal(JSON.stringify(input), content.text, 'preserve original model input serialization');
    content.text = JSON.stringify(witnessComparable(input, metadata));
  }
  return JSON.stringify(witnessComparable(body, metadata));
}

const literalSource = 'Literal UUID 11111111-2222-4333-8444-555555555555 and ISO 2024-05-06T07:08:09.123Z.';

test('W304 generated-field comparator preserves UUID/time-looking source, query and answer mutations', () => {
  const generated = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const time = '2026-09-30T00:00:00.000Z';
  const metadata = { identities: new Map([[generated, 'memory-0']]), times: new Set([time]) };
  const input = { query: literalSource, candidates: [{ memory: { id: generated, createdAt: time },
    receipts: [{ id: generated, excerpt: `${literalSource} ${generated} ${time}` }] }] };
  const expected = witnessComparable(input, metadata);
  assert.equal(expected.query, literalSource);
  assert.equal(expected.candidates[0].memory.id, 'memory-0');
  assert.equal(expected.candidates[0].memory.createdAt, '<generated-time>');
  assert.equal(expected.candidates[0].receipts[0].excerpt, input.candidates[0].receipts[0].excerpt);
  for (const [original, replacement] of [
    ['11111111-2222-4333-8444-555555555555', '22222222-3333-4444-8555-666666666666'],
    ['2024-05-06T07:08:09.123Z', '2025-05-06T07:08:09.123Z'],
    [generated, 'ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb'],
    [time, '2027-09-30T00:00:00.000Z'],
  ]) {
    const changed = structuredClone(input);
    changed.candidates[0].receipts[0].excerpt = changed.candidates[0].receipts[0].excerpt
      .replace(original, replacement);
    assert.notDeepEqual(witnessComparable(changed, metadata), expected);
  }
  const body = value => JSON.stringify({ input: [{ content: [{ text: JSON.stringify(value) }] }] });
  assert.notEqual(witnessWire(body({ ...input, query: time }), metadata), witnessWire(body(input), metadata));
  const answer = { messages: [{ content: `${generated} ${time} ${literalSource}` }] };
  assert.deepEqual(witnessComparable(answer, metadata), answer);
  assert.equal(witnessWire(JSON.stringify(answer), metadata), JSON.stringify(answer));
  const schemaBody = { text: { format: { schema: { properties: {
    memoryId: { enum: [generated], description: `${generated} ${literalSource}` },
  } } } } };
  const normalizedSchema = JSON.parse(witnessWire(JSON.stringify(schemaBody), metadata));
  assert.deepEqual(normalizedSchema.text.format.schema.properties.memoryId.enum, ['memory-0']);
  assert.equal(normalizedSchema.text.format.schema.properties.memoryId.description,
    schemaBody.text.format.schema.properties.memoryId.description);
});

test('W302-W304 actual mixed core/adapter/native witness on/off preserves wire, answers and scoring', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  for (const mode of ['success', 'empty-capture', 'empty-rank', 'ingestion-failure',
    'rejected-rank', 'timeout-rank', 'answer-failure']) {
    let baseline;
    for (const enabled of [false, true]) {
      let signalEntered, release, delayedBody, failedAnswer = false;
      const entered = new Promise(resolve => { signalEntered = resolve; });
      const fake = fakeMixedHttp((url, body) => {
        if (mode === 'answer-failure' && !failedAnswer && url.endsWith('/chat/completions')
          && body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION) {
          failedAnswer = true;
          return Response.json({ object: 'chat.completion', model: body.model, choices: [],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        }
        if (!url.endsWith('/responses')) return;
        const stage = body.text?.format.name;
        if (stage === 'cairn_extract' && mode === 'empty-capture')
          return indexedResponse(body, { items: [] });
        if (stage === 'cairn_extract' && mode === 'ingestion-failure')
          return indexedResponse(body, { items: [{ content: 'PRIVATE_INVALID_EXTRACTION',
            kind: 'context', confidence: 1, sourceIndices: [999] }] });
        if (stage !== 'cairn_rank') return;
        if (mode === 'empty-rank') return indexedResponse(body, { refs: [] });
        if (mode === 'rejected-rank') {
          const candidate = JSON.parse(body.input[0].content[0].text).candidates[0];
          const ref = { namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
            revision: candidate.memory.revision };
          return indexedResponse(body, { refs: [ref, ref] });
        }
        if (mode === 'timeout-rank') {
          delayedBody = body;
          signalEntered();
          return new Promise(resolve => { release = resolve; });
        }
      }, { cairnMemory: true });
      const row = sourceRow();
      row.history.sessions[0].turns[0].content += ` ${literalSource}`;
      const fixture = syntheticMixedFixture(t, { artifact, configuration,
        sourceCases: [row], armOrders: [['cairn', 'mem0']],
        comparisonProfile: 'indexed-evidence-v1', fetchImpl: fake.fetchImpl });
      if (mode === 'timeout-rank') t.mock.timers.enable({ apis: ['setTimeout'] });
      try {
        const running = runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
          apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, phaseTiming: 'bounded-tail-v1',
          ...(enabled ? { recallWitness: 'bounded-v1' } : {}) });
        if (mode === 'timeout-rank') { await entered; t.mock.timers.tick(30_000); }
        const generation = await running;
        const [cairn, mem0] = generation.cases[0].arms;
        assert.equal(generation.halted, false, `${mode}: ${JSON.stringify(generation.cases)}`);
        const recallFailed = ['rejected-rank', 'timeout-rank'].includes(mode);
        const failed = recallFailed || ['ingestion-failure', 'answer-failure'].includes(mode);
        assert.equal(cairn.status, failed ? 'failed' : 'completed');
        assert.equal(mem0.status, 'completed');
        assert.equal(Object.hasOwn(mem0.diagnostics, 'recallWitness'), false);
        assert.equal(Object.hasOwn(cairn.diagnostics, 'recallWitness'), enabled);
        const rankCalls = fake.calls.filter(call => call.route === '/v1/responses'
          && call.body.text?.format.name === 'cairn_rank');
        const preRecall = ['empty-capture', 'ingestion-failure'].includes(mode);
        assert.equal(rankCalls.length, preRecall ? 0 : 1);
        assert.equal(fake.calls.filter(call => call.body.text?.format.name === 'cairn_select').length, 0,
          'the complete-map precondition bypasses model selection');
        if (enabled) {
          const summary = cairn.diagnostics.recallWitness;
          assert.equal(summary.closed, true);
          assert.equal(summary.disposed, true);
          assert.equal(summary.referenceAcceptance, 'not-observed');
          assert.equal(summary.selectVisibility, 'unobservable');
          assert.equal(summary.rankCalls, preRecall ? 0 : 1);
          assert.equal(summary.retainedCalls, summary.rankCalls);
          assert.equal(summary.recallOutcome, mode === 'ingestion-failure' ? 'unknown'
            : recallFailed ? 'failed' : 'completed');
          if (['success', 'answer-failure'].includes(mode)) {
            assert.equal(summary.strategy, 'complete-map');
            assert.equal(summary.finalReturnedRefs, 1);
            assert.equal(summary.shownRefs, 1);
            assert.equal(summary.observation, 'complete', 'later answer failure cannot change the closed recall observation');
          }
          if (mode === 'rejected-rank') {
            assert.equal(summary.returnedRefs, 2, 'adapter returned duplicates that the actual core rejects');
            assert.equal(summary.finalReturnedRefs, 0);
          }
          if (mode === 'timeout-rank') assert.equal(summary.observation, 'partial');
          for (const value of Object.values(summary)) {
            assert.ok(['number', 'boolean', 'string'].includes(typeof value));
            if (typeof value === 'number') assert.ok(Number.isSafeInteger(value) && value >= 0);
            if (typeof value === 'string') assert.ok(['not-observed', 'unobservable', 'unknown',
              'complete', 'partial', 'completed', 'failed', 'complete-map', 'model-selected'].includes(value));
          }
          assert.equal(JSON.stringify(summary).includes('PRIVATE_'), false);
        }
        const extraction = fake.calls.find(call => call.route === '/v1/responses'
          && call.body.text?.format.name === 'cairn_extract');
        const extractedInput = JSON.parse(extraction.body.input[0].content[0].text);
        assert.ok(extractedInput.messages.some(message => message.content.includes(literalSource)),
          'literal UUID/time prose reaches the actual extraction request intact');
        if (mode === 'success') {
          const rankedInput = JSON.parse(rankCalls[0].body.input[0].content[0].text);
          assert.ok(rankedInput.candidates[0].receipts[0].excerpt.includes(literalSource));
          const answer = fake.calls.find(call => call.body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION);
          assert.ok(JSON.parse(answer.body.messages[1].content).evidence[0].text.includes(literalSource));
        }
        if (release) {
          const before = { report: JSON.stringify(generation), calls: fake.calls.length,
            attempts: fixture.guard.attempts(), scopes: fixture.guard.caseOutcomes().scopes };
          release(indexedResponse(delayedBody, { refs: [] }));
          await setImmediate(); await setImmediate();
          assert.equal(JSON.stringify(generation), before.report);
          assert.equal(fake.calls.length, before.calls);
          assert.deepEqual(fixture.guard.attempts(), before.attempts);
          assert.deepEqual(fixture.guard.caseOutcomes().scopes, before.scopes);
        }
        const scored = await scoreMixedGeneration({ generationReport: generation,
          evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
          guard: fixture.guard, apiKey: 'synthetic-only' });
        assert.equal(scored.summary.perArm.cairn.unresolved, failed ? 1 : 0);
        assert.equal(scored.summary.perArm.mem0.correct, 1);
        const comparable = structuredClone(generation);
        delete comparable.cases[0].arms[0].diagnostics.recallWitness;
        // Wall-clock timing is observed on both paths, never an equality claim.
        for (const event of comparable.cases[0].arms[0].diagnostics.adapterPhaseTiming.events)
          delete event.elapsedMs;
        const metadata = witnessMetadata(fixture.root);
        const observed = { generation: witnessComparable(comparable, metadata), summary: scored.summary,
          calls: fake.calls.map(({ route, bytes }) => ({ route, bytes: witnessWire(bytes, metadata) })),
          attempts: fixture.guard.attempts().map(item => ({ stage: item.stage, ordinal: item.ordinal,
            outcome: item.outcome, reservedMicroUsd: item.reservedMicroUsd,
            actualMicroUsd: item.actualMicroUsd })) };
        if (!enabled) baseline = observed;
        else assert.deepEqual(observed, baseline, `paired ${mode}: witness is the only diagnostic addition`);
      } finally {
        t.mock.timers.reset();
        fixture.guard.close();
      }
    }
    t.diagnostic(`witness native differential: ${mode}, two owned stores; exact generated metadata fields normalized, source/query/answer bytes preserved`);
  }
});

test('C1-C7 actual qualified failure and explicit indexed-evidence success share source/native/common scoring', async t => {
  const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const row = sourceRow();
  row.history.sessions[0].turns[0].content = 'x'.repeat(850) + ' Earlier choice: Friday.' + 'y'.repeat(850);
  row.history.sessions.push({ session_index: 1, session_id: `lme-session-${'d'.repeat(64)}`,
    date: '2024/01/02 (Tue) 09:00', turns: [{ turn_id: `lme-turn-${'e'.repeat(64)}`,
      role: 'user', content: 'Changed choice: Saturday.' }] });
  for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
    const fake = fakeMixedHttp((_url, body) => {
      if (!_url.endsWith('/responses')) return;
      if (body.text?.format.name === 'cairn_qualifyCandidates') return indexedResponse(body, {});
      if (body.text?.format.name === 'cairn_extract') {
        const input = JSON.parse(body.input[0].content[0].text);
        const windows = input.windows ?? input.messages;
        assert.ok(windows, JSON.stringify(input));
        const selected = windows.findIndex(window => window.content.includes('choice:'));
        assert.ok(selected >= 0);
        return indexedResponse(body, { items: [{ content: 'GENERATED_SUMMARY_POISON', kind: 'context',
          confidence: 0.9, sourceIndices: [selected] }] });
      }
    }, { cairnMemory: true });
    const fixture = syntheticMixedFixture(t, { artifact, configuration, sourceCases: [row],
      armOrders: [comparisonProfile ? ['mem0', 'cairn'] : ['cairn', 'mem0']],
      comparisonProfile, fetchImpl: fake.fetchImpl });
    try {
      const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
        apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, false, JSON.stringify(generation.cases));
      const cairn = generation.cases[0].arms[0], mem0 = generation.cases[0].arms[1];
      assert.equal(mem0.status, 'completed', JSON.stringify(mem0));
      assert.equal(Object.hasOwn(mem0.diagnostics, 'nativeFailure'), false);
      assert.equal(Object.hasOwn(cairn.diagnostics, 'nativeFailure'), false);
      assert.equal(cairn.status, comparisonProfile ? 'completed' : 'failed', JSON.stringify(cairn));
      if (comparisonProfile) {
        assert.equal(fake.calls.some(call => call.body.text?.format.name === 'cairn_qualifyCandidates'), false);
        assert.equal(cairn.diagnostics.captureBatches, 2);
        assert.equal(cairn.diagnostics.admittedMemories, 2);
        const answer = fake.calls.filter(call => call.body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION)
          .map(call => JSON.parse(call.body.messages[1].content))
          .find(input => input.evidence.some(unit => unit.text.includes('Earlier choice:')));
        assert.ok(answer);
        assert.ok(answer.evidence.some(unit => unit.text.includes('Changed choice: Saturday.')));
        assert.ok(answer.evidence.every(unit => !unit.text.includes('GENERATED_SUMMARY_POISON')));
        assert.ok(cairn.diagnostics.provenance.some(item => item.coordinates.some(coordinate =>
          coordinate.windowIndex > 0 && coordinate.originalEndUtf16 > 850)));
      } else {
        assert.equal(cairn.reason, 'ingestion_incomplete');
        assert.equal(fake.calls.filter(call => call.route === '/v1/responses'
          && call.body.text?.format.name === 'cairn_extract').length, 1);
      }
      const scored = await scoreMixedGeneration({ generationReport: generation,
        evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
        guard: fixture.guard, apiKey: 'synthetic-only' });
      assert.equal(scored.summary.fixedN, 1);
      assert.equal(scored.summary.perArm.cairn.unresolved, comparisonProfile ? 0 : 1);
      assert.equal(scored.summary.commonResolvedN, comparisonProfile ? 1 : 0);
    } finally { fixture.guard.close(); }
  }
});

for (const fault of ['classification', 'extraction', 'empty']) {
  test(`C5/C7 indexed-evidence actual native pair retains ${fault} outcome in fixed N`, async t => {
    const artifact = inspectMem0NativeArtifact({ venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    const fake = fakeMixedHttp((_url, body) => {
      if (!_url.endsWith('/responses')) return;
      if (body.text?.format.name === 'cairn_extract' && fault !== 'classification')
        return indexedResponse(body, fault === 'empty' ? { items: [] }
          : { items: [{ content: 'bad', kind: 'context', confidence: 1, sourceIndices: [999] }] });
      if (body.text?.format.name === 'cairn_classify' && fault === 'classification')
        return indexedResponse(body, { items: [{ memoryId: 'forged', parentIds: [] }] });
    }, { cairnMemory: true });
    const fixture = syntheticMixedFixture(t, { artifact, configuration, sourceCases: [sourceRow()],
      armOrders: [['cairn', 'mem0']], comparisonProfile: 'indexed-evidence-v1', fetchImpl: fake.fetchImpl });
    try {
      const generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
        apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      assert.equal(generation.halted, false);
      assert.equal(generation.cases[0].arms[0].status, fault === 'empty' ? 'completed' : 'failed');
      assert.equal(generation.cases[0].arms[1].status, 'completed');
      assert.equal(fake.calls.some(call => call.body.text?.format.name === 'cairn_qualifyCandidates'), false);
      const answers = fake.calls.filter(call => call.body.messages?.[0]?.content === PUBLIC_ANSWER_INSTRUCTION);
      assert.equal(answers.length, fault === 'empty' ? 2 : 1);
      if (fault === 'empty') assert.deepEqual(JSON.parse(answers[0].body.messages[1].content).evidence, []);
      const scored = await scoreMixedGeneration({ generationReport: generation,
        evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
        guard: fixture.guard, apiKey: 'synthetic-only' });
      assert.equal(scored.summary.fixedN, 1);
      assert.equal(scored.summary.perArm.cairn.unresolved, fault === 'empty' ? 0 : 1);
    } finally { fixture.guard.close(); }
  });
}

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

test('O1 mixed runner retains the known stopping capture error', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp((url, body) => body.text?.format?.name === 'cairn_extract'
    && url.endsWith('/responses')
    ? Response.json({ object: 'response', model: body.model, status: 'completed',
      error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: 'not-json' }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } })
    : undefined);
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl: fake.fetchImpl });
  try {
    const report = await runMixedGeneration({ prepared: fixture.prepared,
      guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    const cairn = report.cases[0].arms.find(arm => arm.name === 'cairn');
    const mem0 = report.cases[0].arms.find(arm => arm.name === 'mem0');
    assert.equal(cairn.status, 'failed');
    assert.equal(cairn.reason, 'ingestion_incomplete');
    assert.equal(cairn.answer, null);
    assert.equal(mem0.status, 'completed');
    assert.equal(report.halted, false);
    assert.deepEqual({ ...cairn.diagnostics.ingestion?.firstStop }, {
      batchIndex: 0, status: 'failed', errorStage: 'capture',
      errorCode: 'invalid_model_output', retryable: false });
    assert.equal(cairn.diagnostics.ingestion.kind, 'capture_outcome');
    assert.equal(cairn.diagnostics.ingestion.counts.failed, 1);
    assert.equal(cairn.diagnostics.ingestion.counts.completed, 0);
    assert.ok(cairn.diagnostics.modelDiagnostics.events.some(event =>
      event.stage === 'extract' && event.layer === 'adapter' && event.reason === 'output_json'));
    const scoring = await scoreMixedGeneration({ generationReport: report,
      evaluatorRows: [evaluatorRow()], referenceRenderings: new Map(),
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scoring.halted, false);
    assert.equal(scoring.summary.fixedN, 1);
    assert.equal(scoring.summary.perArm.cairn.unresolved, 1);
  } finally { fixture.guard.close(); }
});

test('O5 real core and fake HTTP distinguish extract, qualification and classification stops', async t => {
  assert.ok(process.env.CAIRN_MEM0_NATIVE_VENV_ROOT && process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT);
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const scenarios = [
    { method: 'cairn_extract', stage: 'extract', layer: 'core_validation',
      reason: 'invalid_extraction_source_range',
      status: 'failed', errorStage: 'capture', mutate: output => { output.items[0].sourceIndices = [99]; } },
    { method: 'cairn_qualifyCandidates', stage: 'qualifyCandidates', layer: 'core_validation',
      reason: 'qualification_citation_integrity', status: 'failed', errorStage: 'capture',
      mutate: output => { output.qualifications.item_0.value.evidenceSlots = []; } },
    { method: 'cairn_classify', stage: 'classify', layer: 'adapter', reason: 'output_shape',
      status: 'partial', errorStage: 'classification',
      mutate: output => { output.items[0].parentIds = ['synthetic-nonvisible-parent']; } },
  ];
  for (const scenario of scenarios) {
    const base = fakeMixedHttp(undefined, { cairnMemory: true });
    let changed = false;
    const fetchImpl = async (url, options) => {
      const response = await base.fetchImpl(url, options);
      const body = JSON.parse(options.body);
      if (changed || !url.endsWith('/responses') || body.text?.format?.name !== scenario.method) {
        return response;
      }
      const envelope = await response.json();
      const output = JSON.parse(envelope.output[0].content[0].text);
      scenario.mutate(output);
      envelope.output[0].content[0].text = JSON.stringify(output);
      changed = true;
      return Response.json(envelope);
    };
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl });
    try {
      const report = await runMixedGeneration({ prepared: fixture.prepared,
        guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
      const cairn = report.cases[0].arms.find(arm => arm.name === 'cairn');
      const mem0 = report.cases[0].arms.find(arm => arm.name === 'mem0');
      assert.equal(changed, true, scenario.method);
      assert.equal(cairn.reason, 'ingestion_incomplete', scenario.method);
      assert.equal(cairn.answer, null, scenario.method);
      assert.equal(mem0.status, 'completed', scenario.method);
      assert.equal(cairn.diagnostics.ingestion.firstStop.status, scenario.status, scenario.method);
      assert.equal(cairn.diagnostics.ingestion.firstStop.errorStage,
        scenario.errorStage, scenario.method);
      assert.ok(cairn.diagnostics.modelDiagnostics.events.some(event =>
        event.stage === scenario.stage && event.layer === scenario.layer
          && event.reason === scenario.reason),
      `${scenario.method}: ${JSON.stringify(cairn.diagnostics.modelDiagnostics.events)}`);
      assert.equal(report.halted, false, scenario.method);
    } finally { fixture.guard.close(); }
  }
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
  const nativeScratchBefore = readdirSync(tmpdir()).filter(name => name.startsWith('cairn-y-')).sort();
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
    assert.equal(generation.haltReason, 'scope_execution_failed');
    const native = generation.cases[0].arms[1];
    assert.equal(native.reason, 'scope_execution_failed');
    assert.deepEqual({ ...native.diagnostics.nativeFailure },
      { version: 1, layer: 'runtime', reason: 'native_gateway_failed' });
    assert.deepEqual(Reflect.ownKeys(native.diagnostics.nativeFailure), ['version', 'layer', 'reason']);
    assert.equal(Object.isFrozen(native.diagnostics.nativeFailure), true);
    assert.equal(Object.hasOwn(generation.cases[0].arms[0].diagnostics, 'nativeFailure'), false);
    // X throws before appending a scope outcome on this global accounting halt.
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
    assert.ok(fixture.guard.attempts().every(attempt => attempt.outcome !== null));
    assert.equal(fixture.guard.attempts().filter(attempt => attempt.outcome === 'unknown').length, 1);
    assert.equal(native.diagnostics.attempts.unknownActualCount, 1);
    assert.deepEqual(readdirSync(tmpdir()).filter(name => name.startsWith('cairn-y-')).sort(),
      nativeScratchBefore, 'native child/listener work closes before owned scratch removal');
    assert.equal(generation.cases[0].arms[0].status, 'blocked');
    assert.equal(fake.calls.some(call => call.route === '/v1/responses/input_tokens'), false);
    assert.equal(fixture.guard.isHalted(), true);
  } finally { fixture.guard.close(); }
});

test('IC2 journal retains actual native failure despite outer global halt', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-integration-native-failure-' });
  const nativeScratchBefore = readdirSync(tmpdir()).filter(name => name.startsWith('cairn-y-')).sort();
  const descriptors = syntheticNativeDescriptors(workspace.path, true);
  const fake = fakeMixedHttp((url, body) => url.endsWith('/chat/completions')
    && body.response_format?.type === 'json_object'
    ? Response.json({ object: 'chat.completion', model: body.model,
      usage: null, choices: [{ index: 0, finish_reason: 'stop',
        message: { role: 'assistant', content: '{"memory":[]}' } }] }) : undefined);
  const fixture = syntheticMixedFixture(null, { ...descriptors, sourceCases: [sourceRow()],
    armOrders: [['mem0', 'cairn']], fetchImpl: fake.fetchImpl, workspace });
  const directory = join(workspace.path, 'journal');
  const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
  let generation, failure;
  try {
    generation = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'JOURNAL_KEY_CANARY', cairnStoreRoot: fixture.root, resultJournal });
  } catch (error) { failure = error; }
  // Accounting and containment must remain conservative even on baseline RED.
  const attempts = fixture.guard.attempts();
  assert.equal(fixture.guard.isHalted(), true);
  assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
  assert.ok(attempts.every(attempt => attempt.outcome !== null));
  const unknown = attempts.filter(attempt => attempt.outcome === 'unknown');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].actualMicroUsd, null);
  assert.ok(unknown[0].reservedMicroUsd > 0);
  assert.equal(fake.calls.some(call => call.route === '/v1/responses/input_tokens'), false);
  assert.deepEqual(readdirSync(tmpdir()).filter(name => name.startsWith('cairn-y-')).sort(),
    nativeScratchBefore, 'native work closes before owned scratch removal');
  assert.ifError(failure);
  assert.equal(generation.halted, true);
  assert.equal(generation.haltReason, 'scope_execution_failed');
  const native = generation.cases[0].arms.find(arm => arm.name === 'mem0');
  const cairn = generation.cases[0].arms.find(arm => arm.name === 'cairn');
  assert.equal(native.status, 'failed');
  assert.equal(native.reason, 'scope_execution_failed');
  assert.deepEqual({ ...native.diagnostics.nativeFailure },
    { version: 1, layer: 'runtime', reason: 'native_gateway_failed' });
  assert.deepEqual(Reflect.ownKeys(native.diagnostics.nativeFailure), ['version', 'layer', 'reason']);
  assert.equal(Object.isFrozen(native.diagnostics.nativeFailure), true);
  assert.equal(native.diagnostics.attempts.unknownActualCount, 1);
  assert.equal(cairn.status, 'blocked');
  assert.equal(Object.hasOwn(cairn.diagnostics, 'nativeFailure'), false);
  const observed = inspectMixedResultJournal({ directory });
  const view = observed.phases.generation;
  assert.deepEqual(view.arms.map(arm => arm.state), ['terminal', 'unobserved']);
  assert.deepEqual(view.arms[0].result, native);
  assert.deepEqual(view.completion.report, generation);
  assert.deepEqual(view.arms[0].result.diagnostics.nativeFailure, native.diagnostics.nativeFailure);
  assert.equal(observed.phases.scoring.started, false);
  assert.equal(readFileSync(join(directory, '000003.json'), 'utf8').includes('JOURNAL_KEY_CANARY'), false);
  await workspace.cleanup();
  assert.equal(existsSync(workspace.path), false);
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
