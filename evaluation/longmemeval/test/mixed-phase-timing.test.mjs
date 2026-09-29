import assert from 'node:assert/strict';
import test from 'node:test';

import { createMixedPhaseTimingObserver, nextPhaseEventCount } from '../mixed-phase-timing.mjs';
import { prepareMixedComparison, runMixedGeneration, summarizeAttemptsForOrdinal } from '../mixed-generation.mjs';
import { createMixedModelDiagnosticObserver } from '../mixed-ingestion-diagnostics.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { freeze, hash, reportSnapshot } from '../mixed-validation.mjs';
import { evaluatorRow, sourceRow } from '../testing/mixed-fixture.mjs';

const event = index => ({ version: 1, stage: 'extract', phase: 'output_validation',
  outcome: 'completed', elapsedMs: index });
const preparedFor = count => prepareMixedComparison({
  sourceCases: Array.from({ length: count }, (_, index) => sourceRow(`phase-${index}`)),
  armOrders: Array.from({ length: count }, () => ['cairn', 'mem0']),
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64) });

test('T02 phase observer retains exact bounded tail, copied snapshots, and ignores calls after close', () => {
  for (const count of [0, 1, 64, 65, 1000]) {
    const observer = createMixedPhaseTimingObserver();
    for (let index = 0; index < count; index++) observer.onPhaseTiming(event(index));
    const snapshot = observer.snapshot();
    assert.deepEqual(Object.keys(snapshot), ['version', 'sample', 'capacity', 'totalEventCount',
      'retainedEventCount', 'omittedEventCount', 'events']);
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.sample, 'last');
    assert.equal(snapshot.capacity, 64);
    assert.equal(snapshot.totalEventCount, count);
    assert.equal(snapshot.retainedEventCount, Math.min(count, 64));
    assert.equal(snapshot.omittedEventCount, Math.max(count - 64, 0));
    assert.deepEqual(snapshot.events, Array.from({ length: Math.min(count, 64) },
      (_, index) => event(Math.max(0, count - 64) + index)));
    if (count) snapshot.events[0].elapsedMs = -999;
    snapshot.events.push(event(9999));
    assert.equal(observer.snapshot().retainedEventCount, Math.min(count, 64));
    assert.ok(observer.snapshot().events.every(item => item.elapsedMs >= 0));
    observer.close();
    const closed = observer.snapshot();
    observer.onPhaseTiming(event(1234));
    assert.deepEqual(observer.snapshot(), closed);
  }
  for (const outcome of ['failed', 'aborted']) {
    const observer = createMixedPhaseTimingObserver();
    for (let index = 0; index < 80; index++) observer.onPhaseTiming(event(index));
    observer.onPhaseTiming({ ...event(80), outcome });
    assert.equal(observer.snapshot().events.at(-1).outcome, outcome);
    assert.equal(observer.snapshot().totalEventCount, 81);
    assert.equal(observer.snapshot().omittedEventCount, 17);
  }
});

test('T02 phase observer denies malformed data and private fields without invoking getters', () => {
  const observer = createMixedPhaseTimingObserver();
  let getterCalls = 0;
  const getter = { ...event(1) };
  Object.defineProperty(getter, 'stage', { enumerable: true, get() { getterCalls++; return 'extract'; } });
  const secret = 'PRIVATE_SENTINEL';
  for (const value of [null, [], {}, getter, { ...event(1), message: secret },
    { ...event(1), version: 2 }, { ...event(1), stage: secret },
    { ...event(1), phase: secret }, { ...event(1), outcome: secret },
    ...[NaN, Infinity, -1, -0, 2_147_483_648].map(elapsedMs => ({ ...event(1), elapsedMs })),
    new Proxy({}, { ownKeys() { throw Error(secret); } })]) {
    assert.doesNotThrow(() => observer.onPhaseTiming(value));
  }
  assert.equal(getterCalls, 0);
  assert.equal(observer.snapshot().totalEventCount, 0);
  const input = event(1);
  observer.onPhaseTiming(input);
  input.stage = secret;
  assert.equal(JSON.stringify(observer.snapshot()).includes(secret), false);
});

test('T02 checked event increment closes before precision loss', () => {
  assert.equal(nextPhaseEventCount(0), 1);
  assert.equal(nextPhaseEventCount(Number.MAX_SAFE_INTEGER - 1), Number.MAX_SAFE_INTEGER);
  for (const count of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, NaN]) {
    assert.equal(nextPhaseEventCount(count), null);
  }
});

test('T01 invalid modes and diagnostic rosters reject before consumption and guard access', async () => {
  for (const count of [1, 6, 30, 31, 250]) {
    const prepared = preparedFor(count);
    let accesses = 0;
    const options = { prepared, guard: { get mixedSourcePairCapability() { accesses++; return null; } },
      apiKey: 'synthetic-only', cairnStoreRoot: '/unused' };
    for (const phaseTiming of [undefined, null, false, 'first', {}]) {
      await assert.rejects(runMixedGeneration({ ...options, phaseTiming }),
        { code: 'invalid_mixed_generation' });
    }
    if (count > 30) await assert.rejects(runMixedGeneration({ ...options,
      phaseTiming: 'bounded-tail-v1' }), { code: 'invalid_mixed_generation' });
    assert.equal(accesses, 0);
    // Reaching the guard proves neither bad modes nor oversized opt-ins consumed preparation.
    await assert.rejects(runMixedGeneration(count > 30 ? options : { ...options,
      phaseTiming: 'bounded-tail-v1' }), { code: 'mixed_guard_mismatch' });
    assert.equal(accesses, 1);
  }
});

test('T01 omitted mode ignores inherited phaseTiming getters and values', async () => {
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'phaseTiming');
  let reads = 0;
  try {
    for (const descriptor of [{ configurable: true,
      get() { reads++; throw Error('SYNTHETIC_INHERITED_MODE'); } },
    { configurable: true, value: 'bounded-tail-v1' }]) {
      const prepared = preparedFor(31);
      Object.defineProperty(Object.prototype, 'phaseTiming', descriptor);
      await assert.rejects(runMixedGeneration({ prepared, guard: {}, apiKey: 'synthetic-only',
        cairnStoreRoot: '/unused' }), { code: 'mixed_guard_mismatch' });
      assert.equal(reads, 0);
      delete Object.prototype.phaseTiming;
    }
  } finally {
    if (prior) Object.defineProperty(Object.prototype, 'phaseTiming', prior);
    else delete Object.prototype.phaseTiming;
  }
});

test('T04 complete 30-case high-diagnostic report fits unchanged snapshot and scorer bounds', async t => {
  const prepared = preparedFor(30);
  const observer = createMixedPhaseTimingObserver();
  const model = createMixedModelDiagnosticObserver();
  for (let index = 0; index < 80; index++) {
    observer.onPhaseTiming(event(index));
    model.onDiagnostic({ version: 1, stage: 'qualifyCandidates', layer: 'core_call',
      reason: 'context_budget_exceeded' });
  }
  observer.close();
  const attempts = summarizeAttemptsForOrdinal(Array.from({ length: 80 }, () => ({
    ordinal: 0, stage: 'extract', outcome: 'succeeded', reservedMicroUsd: 100,
    actualMicroUsd: 50 })), 0);
  const scopes = [];
  const cases = prepared.roster.map((row, index) => ({
    questionId: row.questionId,
    question: { text: 'What synthetic fact?', date: '2024-01-02 10:00' },
    caseDigest: prepared.preflight[index].caseDigest,
    preflight: { status: 'ready', reason: null },
    arms: ['cairn', 'mem0'].map((name, position) => {
      const completed = index % 2 === 0;
      const status = completed ? 'completed' : 'failed';
      const reason = completed ? null : 'ingestion_incomplete';
      const scope = { ordinal: index * 2 + position, status,
        reason: completed ? null : 'revoked' };
      scopes.push({ ...scope, phase: 'generation', arm: name });
      const provenance = [{ memoryId: 'synthetic-memory', receiptId: 'synthetic-receipt',
        coordinates: [{ renderedTurnId: `lme-turn-${'c'.repeat(64)}`, originalSessionIndex: 0,
          originalTurnIndex: 0, batchIndex: 0, windowIndex: 0, classification: 'copied',
          originalStartUtf16: 0, originalEndUtf16: 22 }] }];
      const diagnostics = { stage: completed ? 'answer' : name === 'cairn' ? 'ingestion' : 'native',
        attempts: structuredClone(attempts), ...(completed ? {
          ...(name === 'cairn' ? { captureBatches: 40, admittedMemories: 1, recalledCards: 1,
            receiptCount: 1, provenance } : { nativeResults: 1 }),
          selectedIndices: [0], duplicateIndices: [], omittedIndices: [] } : {}) };
      if (name === 'cairn') {
        diagnostics.modelDiagnostics = model.snapshot();
        diagnostics.adapterPhaseTiming = observer.snapshot();
        if (!completed) diagnostics.ingestion = { kind: 'capture_outcome',
          counts: { completed: 39, duplicate: 0, failed: 1, partial: 0, unknown: 0, not_run: 0 },
          firstStop: { batchIndex: 39, status: 'failed', errorStage: 'capture',
            errorCode: 'extraction_failed', retryable: false } };
      }
      return { name, status, reason, scope, diagnostics,
        answer: completed ? { text: 'Synthetic memory fact.',
          usage: { inputTokens: 1, outputTokens: 1, costMicroUsd: 1 } } : null };
    }),
  }));
  // Complete high-diagnostic synthetic control, not a universal provenance maximum.
  const raw = { schemaVersion: 'cairn-lme-mixed-generation-v1', manifest: prepared.manifest,
    roster: prepared.roster, manifestDigest: hash('cairn.lme.mixed.manifest.v1', prepared.manifest),
    rosterDigest: hash('cairn.lme.mixed-source-pair.roster.v1', prepared.roster),
    cases, halted: true, haltReason: 'global_halt' };
  const countNodes = value => value && typeof value === 'object'
    ? 1 + Reflect.ownKeys(value).reduce((sum, key) => sum + 1
      + (Array.isArray(value) && key === 'length' ? 0 : countNodes(value[key])), 0) : 1;
  const nodes = countNodes(raw), bytes = Buffer.byteLength(JSON.stringify(raw));
  assert.ok(nodes < 500_000);
  assert.ok(bytes < 32 * 1024 * 1024);
  t.diagnostic(`complete report: ${nodes} traversal nodes, ${bytes} JSON bytes, 1920 retained phase events`);
  const generation = prepared.roster.flatMap(row => row.armOrder.map(name => ({
    phase: 'generation', caseId: row.arms.find(item => item.name === name).scopeId })));
  const guard = { mixedSourcePairCapability: { manifest: prepared.manifest, roster: prepared.roster,
    schedule: [...generation, ...generation.map(item => ({ ...item, phase: 'scoring' }))] },
  caseOutcomes: () => ({ scopes }), caseScopeSnapshot: () => scopes.at(-1) };
  const report = freeze(reportSnapshot(raw));
  const scored = await scoreMixedGeneration({ generationReport: report,
    evaluatorRows: Array.from({ length: 30 }, (_, index) => evaluatorRow(`phase-${index}`)),
    referenceRenderings: undefined, guard, apiKey: 'synthetic-only' });
  assert.equal(scored.summary.fixedN, 30);
  assert.equal(scored.summary.perArm.cairn.unresolved, 30);
  assert.equal(scored.summary.perArm.mem0.unresolved, 30);
});
