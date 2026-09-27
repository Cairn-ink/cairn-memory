import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareMixedComparison } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { freeze, hash, reportSnapshot } from '../mixed-validation.mjs';
import { evaluatorRow, sourceRow } from '../testing/mixed-fixture.mjs';

function fixture() {
  const prepared = prepareMixedComparison({ sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']],
    nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
    nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
    cairnRuntimeArtifactSha256: '4'.repeat(64) });
  const cases = [{ questionId: prepared.roster[0].questionId,
    question: { text: 'What synthetic fact?', date: '2024-01-02 10:00' },
    caseDigest: prepared.preflight[0].caseDigest,
    preflight: { status: 'ready', reason: null },
    arms: ['cairn', 'mem0'].map(name => ({ name, status: 'blocked', reason: 'global_halt',
      answer: null, scope: null, diagnostics: {} })) }];
  const report = freeze({ schemaVersion: 'cairn-lme-mixed-generation-v1',
    manifest: prepared.manifest, roster: prepared.roster,
    manifestDigest: hash('cairn.lme.mixed.manifest.v1', prepared.manifest),
    rosterDigest: hash('cairn.lme.mixed-source-pair.roster.v1', prepared.roster),
    cases, halted: true, haltReason: 'global_halt' });
  const generation = prepared.roster[0].armOrder.map(name => {
    const caseId = prepared.roster[0].arms.find(item => item.name === name).scopeId;
    return { phase: 'generation', caseId };
  });
  const schedule = [...generation, ...generation.map(item => ({ ...item, phase: 'scoring' }))];
  // The negative fixture has no issued X authority and may not dispatch.
  const guard = { mixedSourcePairCapability: { manifest: prepared.manifest,
    roster: prepared.roster, schedule }, caseOutcomes: () => ({ scopes: [] }),
  caseScopeSnapshot: () => null };
  return { report, guard };
}

test('M9 fixed-N halted scoring keeps every arm unresolved with undefined renderings', async () => {
  const { report, guard } = fixture();
  const scored = await scoreMixedGeneration({ generationReport: report,
    evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
    guard, apiKey: 'synthetic-only' });
  assert.equal(scored.summary.fixedN, 1);
  assert.equal(scored.summary.perArm.cairn.unresolved, 1);
  assert.equal(scored.summary.perArm.mem0.unresolved, 1);
  assert.equal(scored.summary.outcomeTable.unresolved.unresolved, 1);
  assert.equal(scored.summary.commonResolvedN, 0);
  assert.equal(scored.haltReason, 'global_halt');
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(scored.summary.perArm.cairn), { correct: 0, incorrect: 0,
    unresolved: 1, accuracyFixedN: 0, accuracyResolved: null, resolvedFraction: 0 });
  assert.deepEqual(plain(scored.summary.outcomeTable), {
    correct: { correct: 0, incorrect: 0, unresolved: 0 },
    incorrect: { correct: 0, incorrect: 0, unresolved: 0 },
    unresolved: { correct: 0, incorrect: 0, unresolved: 1 },
  });
  assert.equal(Object.keys(scored.summary.byCategory).length, 6);
  assert.deepEqual(plain(scored.summary.byCategory['single-session-user']), {
    fixedN: 1, perArm: { cairn: plain(scored.summary.perArm.cairn),
      mem0: plain(scored.summary.perArm.mem0) } });
  for (const [name, category] of Object.entries(scored.summary.byCategory)) {
    if (name === 'single-session-user') continue;
    assert.equal(category.fixedN, 0);
    for (const arm of Object.values(category.perArm)) assert.deepEqual(plain(arm),
      { correct: 0, incorrect: 0, unresolved: 0, accuracyFixedN: null,
        accuracyResolved: null, resolvedFraction: null });
  }
});

test('M9 forged successful answer without authentic X scope is rejected before judge', async () => {
  const { report, guard } = fixture();
  const changed = structuredClone(report);
  changed.cases[0].arms[0] = { name: 'cairn', status: 'completed', reason: null,
    answer: { text: 'forged', usage: { inputTokens: 1, outputTokens: 1,
      costMicroUsd: 1 } }, scope: null, diagnostics: {} };
  freeze(changed);
  await assert.rejects(scoreMixedGeneration({ generationReport: changed,
    evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
    guard, apiKey: 'synthetic-only' }), { code: 'invalid_mixed_report' });
});

test('M10 report detachment refuses a value beyond the fixed UTF-8 cap', () => {
  assert.throws(() => reportSnapshot({ text: 'x'.repeat(32 * 1024 * 1024 + 1) }),
    { code: 'invalid_mixed_report' });
});

test('M9/M10 malformed frozen report identity, order, status, and data deny before judge', async () => {
  const { report, guard } = fixture();
  guard.judgeFetch = () => assert.fail('malformed report must not reach judge');
  for (const [name, mutate] of [
    ['case ID', value => { value.cases[0].questionId = `lme-case-${'0'.repeat(64)}`; }],
    ['arm order', value => { value.cases[0].arms.reverse(); }],
    ['status', value => { value.cases[0].arms[0].status = 'completed'; }],
    ['nonfinite diagnostic', value => { value.cases[0].arms[0].diagnostics.count = Infinity; }],
    ['sparse cases', value => { delete value.cases[0]; }],
  ]) {
    const changed = structuredClone(report);
    mutate(changed);
    freeze(changed);
    await assert.rejects(scoreMixedGeneration({ generationReport: changed,
      evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
      guard, apiKey: 'synthetic-only' }), { code: 'invalid_mixed_report' }, name);
  }
  let getterCalled = false;
  const accessor = { ...report };
  Object.defineProperty(accessor, 'cases', { enumerable: true,
    get() { getterCalled = true; throw Error('must not call getter'); } });
  Object.freeze(accessor);
  await assert.rejects(scoreMixedGeneration({ generationReport: accessor,
    evaluatorRows: [evaluatorRow()], referenceRenderings: undefined,
    guard, apiKey: 'synthetic-only' }), { code: 'invalid_mixed_report' });
  assert.equal(getterCalled, false);
});
