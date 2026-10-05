import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { prepareMixedComparison, summarizeAttemptsForOrdinal } from '../mixed-generation.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { verifyMixedCapturePlan } from '../mixed-plan.mjs';
import { prepareMixedSourceCase } from '../mixed-source.mjs';
import { officialJudgeRequest } from '../official-scoring.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { freeze, hash, reportSnapshot } from '../mixed-validation.mjs';
import { completionOnce, trackedTransport } from '../mixed-transport.mjs';
import { evaluatorRow, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';

const descriptors = () => ({ nativeArtifact: { sourceTreeSha256: '1'.repeat(64),
  dependencyLockSha256: '2'.repeat(64) },
nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
cairnRuntimeArtifactSha256: '4'.repeat(64) });

test('D1/D2 attempt diagnostics retain the first 64 and count every outcome and price', () => {
  const attempt = (ordinal, index, outcome, actualMicroUsd) => ({ ordinal,
    stage: `stage-${index}`, outcome, reservedMicroUsd: index + 1, actualMicroUsd });
  for (const count of [0, 1, 64, 65]) {
    const attempts = Array.from({ length: count }, (_, index) =>
      attempt(3, index, index % 3 === 0 ? 'failed'
        : index % 3 === 1 ? 'unknown' : 'succeeded', index % 2 ? null : index + 2));
    attempts.splice(Math.min(count, 5), 0, attempt(4, 999, 'succeeded', 999));
    const summary = summarizeAttemptsForOrdinal(attempts, 3);
    assert.equal(summary.requests, count);
    assert.equal(summary.retainedStageCount, Math.min(count, 64));
    assert.equal(summary.omittedStageCount, Math.max(count - 64, 0));
    assert.equal(summary.stages.length, Math.min(count, 64));
    assert.deepEqual(summary.stages.map(item => item.stage),
      Array.from({ length: Math.min(count, 64) }, (_, index) => `stage-${index}`));
    assert.equal(summary.reservedMicroUsd, count * (count + 1) / 2);
    assert.equal(summary.knownActualMicroUsd, attempts.filter(item => item.ordinal === 3)
      .reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0));
    assert.equal(summary.unknownActualCount, Math.floor(count / 2));
    if (count) assert.deepEqual(summary.stages[0], { stage: 'stage-0', outcome: 'failed',
      reservedMicroUsd: 1, actualMicroUsd: 2, transportTermination: null });
    assert.equal(summary.terminationUnavailableCount, count);
    assert.ok(Object.values(summary.terminationCounts).every(value => value === 0));
    if (count >= 5) {
      assert.deepEqual(summary.stages.slice(1, 5).map(item =>
        [item.outcome, item.actualMicroUsd]), [
        ['unknown', null], ['succeeded', 4], ['failed', null], ['unknown', 6],
      ]);
    }
  }
});

test('D3 old unbounded 50001-entry stage shape exceeds the fixed report envelope', () => {
  const stage = { stage: 'answer', outcome: 'succeeded',
    reservedMicroUsd: 1, actualMicroUsd: 1 };
  assert.throws(() => reportSnapshot({ stages: Array.from({ length: 50_001 },
    () => stage) }), { code: 'invalid_mixed_report' });
});

test('D3 394629 synthetic attempts across 60 arms pass report snapshot and real scorer', async () => {
  const armCount = 60, requestCount = 394_629;
  const sourceIds = Array.from({ length: armCount / 2 }, (_, index) =>
    `synthetic_bounded_${index}`);
  const prepared = prepareMixedComparison({ sourceCases: sourceIds.map(sourceRow),
    armOrders: sourceIds.map(() => ['cairn', 'mem0']), ...descriptors() });
  const attempts = [];
  let retainedTotal = 0, omittedTotal = 0;
  const expected = Array.from({ length: armCount }, () =>
    ({ requests: 0, reservedMicroUsd: 0, knownActualMicroUsd: 0,
      unknownActualCount: 0 }));
  for (let index = 0; index < requestCount; index++) {
    const ordinal = index % armCount;
    const isSentinel = index === requestCount - 1;
    const reservedMicroUsd = isSentinel ? 123_456 : index % 7 + 1;
    const actualMicroUsd = isSentinel ? 98_765 : index % 4 === 0 ? null : index % 5 + 1;
    attempts.push({ ordinal, stage: isSentinel ? 'late-sentinel' : `stage-${index}`,
      outcome: index % 3 === 0 ? 'failed' : index % 3 === 1 ? 'unknown' : 'succeeded',
      reservedMicroUsd, actualMicroUsd });
    expected[ordinal].requests++;
    expected[ordinal].reservedMicroUsd += reservedMicroUsd;
    expected[ordinal].knownActualMicroUsd += actualMicroUsd ?? 0;
    if (actualMicroUsd === null) expected[ordinal].unknownActualCount++;
  }
  const cases = sourceIds.map((sourceId, index) => ({
    questionId: prepared.roster[index].questionId,
    question: { text: 'What synthetic fact?', date: '2024-01-02 10:00' },
    caseDigest: prepared.preflight[index].caseDigest,
    preflight: { status: 'ready', reason: null },
    arms: ['cairn', 'mem0'].map((name, position) => {
      const ordinal = index * 2 + position;
      const diagnostics = summarizeAttemptsForOrdinal(attempts, ordinal);
      assert.deepEqual({ requests: diagnostics.requests,
        reservedMicroUsd: diagnostics.reservedMicroUsd,
        knownActualMicroUsd: diagnostics.knownActualMicroUsd,
        unknownActualCount: diagnostics.unknownActualCount }, expected[ordinal]);
      assert.equal(diagnostics.retainedStageCount, 64);
      assert.equal(diagnostics.omittedStageCount, expected[ordinal].requests - 64);
      retainedTotal += diagnostics.retainedStageCount;
      omittedTotal += diagnostics.omittedStageCount;
      assert.deepEqual(diagnostics.stages.map(item => item.stage),
        Array.from({ length: 64 }, (_, offset) => `stage-${ordinal + offset * armCount}`));
      assert.equal(diagnostics.stages.some(item => item.stage === 'late-sentinel'), false);
      return { name, status: 'blocked', reason: 'global_halt', answer: null,
        scope: null, diagnostics: { attempts: diagnostics } };
    }),
  }));
  const report = freeze(reportSnapshot({ schemaVersion: 'cairn-lme-mixed-generation-v1',
    manifest: prepared.manifest, roster: prepared.roster,
    manifestDigest: hash('cairn.lme.mixed.manifest.v1', prepared.manifest),
    rosterDigest: hash('cairn.lme.mixed-source-pair.roster.v1', prepared.roster),
    cases, halted: true, haltReason: 'global_halt' }));
  assert.equal(retainedTotal, armCount * 64);
  assert.equal(omittedTotal, requestCount - retainedTotal);
  assert.equal(report.cases[14].arms[0].diagnostics.attempts.requests,
    expected[28].requests);
  const generation = prepared.roster.flatMap(row => row.armOrder.map(name => ({
    phase: 'generation', caseId: row.arms.find(item => item.name === name).scopeId })));
  const schedule = [...generation, ...generation.map(item => ({ ...item, phase: 'scoring' }))];
  const guard = { mixedSourcePairCapability: { manifest: prepared.manifest,
    roster: prepared.roster, schedule }, caseOutcomes: () => ({ scopes: [] }),
  caseScopeSnapshot: () => null };
  const scored = await scoreMixedGeneration({ generationReport: report,
    evaluatorRows: sourceIds.map(evaluatorRow), referenceRenderings: undefined,
    guard, apiKey: 'synthetic-only' });
  assert.equal(scored.summary.fixedN, 30);
  assert.equal(scored.summary.perArm.cairn.unresolved, 30);
  assert.equal(scored.summary.perArm.mem0.unresolved, 30);
});

test('M2/M3 source-only preparation freezes exact public projection and fixed roster', () => {
  const row = sourceRow();
  const result = prepareMixedComparison({ sourceCases: [row], armOrders: [['mem0', 'cairn']],
    ...descriptors() });
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'manifest', 'roster', 'counts', 'preflight']);
  assert.equal(result.counts.fixedN, 1);
  assert.deepEqual(result.counts.batchCounts, [1]);
  assert.equal(result.preflight[0].status, 'ready');
  assert.deepEqual(result.roster[0].armOrder, ['mem0', 'cairn']);
  assert.equal(Object.isFrozen(result.roster[0].arms[0]), true);
  row.question.text = 'caller mutation after preparation';
  assert.equal(result.preflight[0].status, 'ready');
});

test('M3 fixed protocol and scope golden is accepted by actual X authority', t => {
  // SHA256(JSON.stringify([domain, canonical-sorted value])); fixed sourceRow(),
  // 1/2/3/4 descriptors, Cairn-first schedule, and token-fit source policy v3.
  // These are literal goldens,
  // not expected values recomputed with the production hash helper.
  const fixture = syntheticMixedFixture(t, { artifact: descriptors().nativeArtifact,
    configuration: descriptors().nativeConfiguration, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], fetchImpl: () => assert.fail('no HTTP') });
  try {
    const row = fixture.prepared.roster[0];
    assert.equal(row.protocolDigest,
      '613fc5d50e30d9a0957671bb90c8e988b0836e755d7afa899ee51b9c86be632f');
    assert.notEqual(row.protocolDigest,
      '08d4f3804aeed541e17de13e37e3f4660d02a4bfb3eaa499714c378400bd6203',
      'the old source policy cannot have the new prepared protocol identity');
    assert.deepEqual(row.arms.map(item => item.scopeId), [
      'lme-case-60944a186cb2b615f6b643cecc585fb79be01d6739b468228b46b0d88e1f9f73',
      'lme-case-15015798b217141bb54a70b1682ec77d61e7f16acf3ff4d7cdd99f7ec1698629',
    ]);
    assert.deepEqual(fixture.capability.schedule.slice(0, 2).map(item => item.caseId),
      row.arms.map(item => item.scopeId));
    assert.deepEqual(fixture.capability.roster, fixture.prepared.roster);
  } finally { fixture.guard.close(); }
});

test('M2 duplicate IDs, evaluator labels, getters and overwidth arrays reject pre-work', () => {
  const row = sourceRow();
  assert.throws(() => prepareMixedComparison({ sourceCases: [row, row],
    armOrders: [['cairn', 'mem0'], ['mem0', 'cairn']], ...descriptors() }),
  { code: 'invalid_source_cases' });
  assert.throws(() => prepareMixedComparison({ sourceCases: [{ ...row, answer: 'label' }],
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
  const getter = { ...row, question: { ...row.question } };
  Object.defineProperty(getter.question, 'text', { enumerable: true,
    get() { assert.fail('getter must not run'); } });
  assert.throws(() => prepareMixedComparison({ sourceCases: [getter],
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
  const extra = [row]; extra.extra = 1;
  assert.throws(() => prepareMixedComparison({ sourceCases: extra,
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
});

test('M2/P errors become fixed-N preflight failure after valid identity', () => {
  const row = sourceRow();
  row.history.sessions[0].date = '2025/01/01 (Wed) 09:00';
  const result = prepareMixedComparison({ sourceCases: [row],
    armOrders: [['cairn', 'mem0']], ...descriptors() });
  assert.equal(result.counts.fixedN, 1);
  assert.equal(result.preflight[0].status, 'failed');
  assert.equal(result.preflight[0].caseDigest, null);
  assert.equal(result.counts.batchCounts[0], 0);
});

test('M12a production pre-capture planner rejects a changed expected plan', () => {
  const row = sourceRow();
  const prepared = prepareMixedSourceCase(row);
  assert.deepEqual(verifyMixedCapturePlan({ history: prepared.renderedHistory,
    namespace: row.namespace, expectedPlan: prepared.cairnPlan }), prepared.cairnPlan);
  const changed = structuredClone(prepared.cairnPlan);
  changed.batches[0].batchIndex += 1;
  assert.throws(() => verifyMixedCapturePlan({ history: prepared.renderedHistory,
    namespace: row.namespace, expectedPlan: changed }), { code: 'planner_mismatch' });
});

for (const [stage, deadlineMs] of [['answer', 180_000], ['judge', 60_000]]) {
  test(`M7c real X ${stage} deadline owns timeout without competing runner timer`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    let releasePhysical;
    let dispatches = 0;
    const fixture = syntheticMixedFixture(t, { artifact: descriptors().nativeArtifact,
      configuration: descriptors().nativeConfiguration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']],
      fetchImpl: () => { dispatches++; started();
        return new Promise(resolve => { releasePhysical = resolve; }); } });
    const guard = fixture.guard;
    t.after(() => guard.close());
    const schedule = guard.mixedSourcePairCapability.schedule;
    if (stage === 'judge') {
      for (const item of schedule.slice(0, 2)) {
        const result = await guard.withCaseScope({ phase: item.phase, caseId: item.caseId },
          async () => null);
        assert.equal(result.status, 'completed');
      }
    }
    const item = stage === 'answer' ? schedule[0] : schedule[2];
    const identity = { phase: item.phase, caseId: item.caseId };
    const request = stage === 'answer'
      ? packMixedAnswer({ question: { text: 'Synthetic?', date: '2024-01-02 10:00' },
        units: [], countTokens: () => 10 }).request
      : officialJudgeRequest('Synthetic reference and response?');
    const work = guard.withCaseScope(identity, async () => {
      const transport = trackedTransport();
      try {
        await assert.rejects(completionOnce({ guard, stage, request,
          apiKey: 'synthetic-only', timeoutMs: stage === 'answer' ? 200_000 : deadlineMs,
          transport }));
      } finally { await transport.drain(); }
    });
    await entered;
    t.mock.timers.tick(deadlineMs);
    const outcome = await work;
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'deadline');
    assert.equal(guard.isHalted(), false);
    const attempt = guard.attempts().at(-1);
    assert.equal(attempt.stage, stage);
    assert.equal(attempt.outcome, 'unknown');
    assert.equal(attempt.actualMicroUsd, null);
    assert.ok(attempt.reservedMicroUsd > 0);
    const settledAttempts = guard.attempts();
    const settledScopes = guard.caseOutcomes().scopes;
    releasePhysical(Response.json({ object: 'chat.completion', model: request.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'yes' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    await setImmediate();
    assert.deepEqual(guard.attempts(), settledAttempts);
    assert.deepEqual(guard.caseOutcomes().scopes, settledScopes);
    assert.equal(dispatches, 1);
  });
}
