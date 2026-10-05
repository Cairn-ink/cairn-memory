// Explicit installed-native gate; synthetic source and fake HTTP only.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { inspectMem0NativeArtifact } from '../../experiment-budget/mem0-native-artifact.mjs';
import { mem0NativeConfiguration } from '../../experiment-budget/mem0-native-gateway.mjs';
import { runMixedGeneration } from '../mixed-generation.mjs';
import { createMixedResultJournal, inspectMixedResultJournal } from '../mixed-result-journal.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { evaluatorRow, fakeMixedHttp, sourceRow, syntheticMixedFixture } from './mixed-fixture.mjs';

async function rankRejected(t, observed = false, journaled = true) {
  const artifact = inspectMem0NativeArtifact({
    venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
    pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
  const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
    childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
  const fake = fakeMixedHttp(undefined, { cairnMemory: true });
  let changed = 0;
  const fetchImpl = async (url, options) => {
    const response = await fake.fetchImpl(url, options);
    if (!url.endsWith('/responses')
      || JSON.parse(options.body).text?.format?.name !== 'cairn_rank') return response;
    const envelope = await response.json();
    const output = JSON.parse(envelope.output[0].content[0].text);
    assert.equal(output.refs.length, 1);
    // Valid response/schema and identifier; core alone knows visibility.
    output.refs[0].memoryId = 'RFD_NON_VISIBLE_SENTINEL';
    envelope.output[0].content[0].text = JSON.stringify(output);
    changed++;
    return Response.json(envelope);
  };
  const fixture = syntheticMixedFixture(t, { artifact, configuration,
    sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl });
  const directory = join(fixture.root, 'journal');
  const resultJournal = journaled ? createMixedResultJournal({ directory, prepared: fixture.prepared }) : undefined;
  const report = await runMixedGeneration({ prepared: fixture.prepared,
    guard: fixture.guard, apiKey: 'synthetic-only', cairnStoreRoot: fixture.root,
    ...(journaled ? { resultJournal } : {}), phaseTiming: 'bounded-tail-v1',
    ...(observed ? { recallWitness: 'bounded-v1' } : {}) });
  assert.equal(changed, 1);
  assert.equal(report.halted, false);
  const cairn = report.cases[0].arms.find(arm => arm.name === 'cairn');
  assert.equal(cairn.status, 'failed');
  assert.equal(cairn.reason, 'recall_failed');
  assert.equal(cairn.answer, null);
  assert.equal(report.cases[0].arms.find(arm => arm.name === 'mem0').status, 'completed');
  if (observed) {
    assert.equal(cairn.diagnostics.recallWitness.recallOutcome, 'failed');
  }
  assert.ok(cairn.diagnostics.adapterPhaseTiming.events.some(event =>
    event.stage === 'rank' && event.phase === 'output_validation' && event.outcome === 'completed'));
  return { fixture, report, cairn, fake, directory, resultJournal };
}

test('RFD1 trusted core recall cause survives adapter-accepted ranking rejection', async t => {
  const { cairn } = await rankRejected(t, false, false);
  assert.equal(cairn.diagnostics.modelDiagnostics?.recallErrorCode, 'invalid_model_output');
  assert.ok(cairn.diagnostics.modelDiagnostics.events.some(event =>
    event.stage === 'rank' && event.layer === 'core_validation' && event.reason === 'non_visible_ref'));
  assert.equal(JSON.stringify(cairn.diagnostics).includes('RFD_NON_VISIBLE_SENTINEL'), false);
});

test('RFD3 rejected recall witness differential preserves request order/count/accounting and journal/scorer U', async t => {
  let baseline;
  for (const enabled of [false, true]) {
    const { fixture, report, cairn, fake, directory, resultJournal } = await rankRejected(t, enabled);
    assert.deepEqual(inspectMixedResultJournal({ directory }).phases.generation.completion.report, report);
    assert.equal(Object.isFrozen(cairn.diagnostics.modelDiagnostics), true);
    assert.equal(Object.hasOwn(report.cases[0].arms[1].diagnostics, 'modelDiagnostics'), false);
    const scored = await scoreMixedGeneration({ generationReport: report,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only', resultJournal });
    assert.equal(scored.halted, false);
    assert.equal(scored.summary.fixedN, 1);
    assert.equal(scored.summary.perArm.cairn.unresolved, 1);
    assert.equal(scored.summary.perArm.mem0.correct, 1);
    assert.deepEqual(scored.cases[0].arms.map(arm => arm.judgment.attempted), [false, true]);
    assert.deepEqual(inspectMixedResultJournal({ directory }).phases.scoring.completion.report, scored);
    const comparable = structuredClone(report);
    delete comparable.cases[0].arms[0].diagnostics.recallWitness;
    delete comparable.cases[0].arms[0].diagnostics.adapterPhaseTiming;
    for (const call of fake.calls) assert.equal(call.bytes, JSON.stringify(call.body));
    // The canonical W302-W304 differential checks full wire bodies using its
    // existing exact generated-identity/time-field normalization.
    const observed = { report: comparable, summary: scored.summary,
      calls: fake.calls.map(call => ({ route: call.route,
        stage: call.body.text?.format?.name ?? null, model: call.body.model })),
      attempts: fixture.guard.attempts().map(item => ({ stage: item.stage,
        ordinal: item.ordinal, outcome: item.outcome, reservedMicroUsd: item.reservedMicroUsd,
        actualMicroUsd: item.actualMicroUsd, transportTermination: item.transportTermination })) };
    if (!enabled) baseline = observed;
    else assert.deepEqual(observed, baseline);
  }
});

for (const mode of ['transport', 'accounting']) {
  test(`RFD3 rank ${mode} unknown preserves global halt and journal, never judges`, async t => {
    const artifact = inspectMem0NativeArtifact({
      venvRoot: process.env.CAIRN_MEM0_NATIVE_VENV_ROOT,
      pythonRoot: process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT });
    const configuration = mem0NativeConfiguration({ topK: 6, threshold: 0,
      childTimeoutMs: 3_600_000, httpTimeoutMs: 10_000 });
    const fake = fakeMixedHttp(undefined, { cairnMemory: true });
    const fetchImpl = async (url, options) => {
      const response = await fake.fetchImpl(url, options);
      if (!url.endsWith('/responses')
        || JSON.parse(options.body).text?.format?.name !== 'cairn_rank') return response;
      if (mode === 'transport') throw Error('RFD_PRIVATE_TRANSPORT_SENTINEL');
      const envelope = await response.json();
      envelope.usage = null;
      return Response.json(envelope);
    };
    const fixture = syntheticMixedFixture(t, { artifact, configuration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']], fetchImpl });
    const directory = join(fixture.root, 'journal');
    const resultJournal = createMixedResultJournal({ directory, prepared: fixture.prepared });
    const report = await runMixedGeneration({ prepared: fixture.prepared, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, resultJournal,
      recallWitness: 'bounded-v1' });
    assert.equal(report.halted, true);
    assert.equal(report.haltReason, 'scope_execution_failed');
    const [cairn, mem0] = report.cases[0].arms;
    assert.equal(cairn.reason, 'scope_execution_failed');
    assert.equal(cairn.status, 'failed');
    assert.equal(cairn.answer, null);
    assert.equal(mem0.status, 'blocked');
    assert.equal(cairn.diagnostics.modelDiagnostics.recallErrorCode, 'recall_failed');
    const attempts = fixture.guard.attempts();
    assert.equal(attempts.filter(item => item.outcome === 'unknown').length, 1);
    assert.ok(attempts.every(item => item.outcome !== null && item.ordinal === 0));
    assert.equal(cairn.diagnostics.attempts.unknownActualCount,
      attempts.filter(item => item.actualMicroUsd === null).length);
    assert.equal(fixture.guard.isHalted(), true);
    assert.equal(fake.calls.some(call => call.route === '/v1/embeddings'), false);
    assert.deepEqual(inspectMixedResultJournal({ directory }).phases.generation.completion.report, report);
    const before = fake.calls.length;
    const scored = await scoreMixedGeneration({ generationReport: report,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard: fixture.guard, apiKey: 'synthetic-only' });
    assert.equal(scored.halted, true);
    assert.ok(scored.cases[0].arms.every(arm => arm.judgment.attempted === false));
    assert.equal(fake.calls.length, before);
    assert.equal(JSON.stringify(cairn.diagnostics).includes('RFD_PRIVATE_TRANSPORT_SENTINEL'), false);
  });
}
