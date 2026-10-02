import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { prepareMixedComparison, runMixedGeneration } from '../mixed-generation.mjs';
import { scoreMixedGeneration } from '../mixed-scoring.mjs';
import { suppliedHistoryPolicy } from '../mixed-source.mjs';
import { freeze, hash } from '../mixed-validation.mjs';
import { evaluatorRow, sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';

const descriptors = { nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '5'.repeat(64) };
const options = (row = sourceRow(), comparisonProfile) => ({ sourceCases: [row],
  armOrders: [['cairn', 'mem0']], ...descriptors,
  ...(comparisonProfile ? { comparisonProfile } : {}) });
const supplied = (row, profile) => prepareMixedComparison({ ...options(row, profile),
  sourceHistoryPolicy: 'supplied-history-v1' });
const chronology = () => {
  const row = sourceRow();
  const dates = ['2024/01/03 (Wed) 00:00', '2024/01/02 (Tue) 10:00',
    '2024/01/01 (Mon) 09:00', '2024/01/02 (Tue) 10:01', '2024/01/02 (Tue) 10:00'];
  row.history.sessions = dates.map((date, index) => ({ session_index: index,
    session_id: `lme-session-${String(index + 1).repeat(64)}`, date,
    turns: [{ turn_id: `lme-turn-${String(index + 1).repeat(64)}`,
      role: index % 2 ? 'assistant' : 'user', content: `Synthetic sentinel ${index}.` }] }));
  return row;
};
function halted(prepared, suppliedMode = false) {
  const generation = prepared.roster.flatMap(row => row.armOrder.map(name => ({
    phase: 'generation', caseId: row.arms.find(arm => arm.name === name).scopeId })));
  const report = freeze({ schemaVersion: suppliedMode ? 'cairn-lme-supplied-history-mixed-generation-v1'
    : 'cairn-lme-mixed-generation-v1', manifest: prepared.manifest, roster: prepared.roster,
  manifestDigest: hash('cairn.lme.mixed.manifest.v1', prepared.manifest),
  rosterDigest: hash('cairn.lme.mixed-source-pair.roster.v1', prepared.roster),
  cases: prepared.roster.map((row, index) => ({ questionId: row.questionId,
    question: { text: 'What synthetic fact?', date: '2024-01-02 10:00' },
    caseDigest: prepared.preflight[index].caseDigest,
    preflight: { status: prepared.preflight[index].status, reason: prepared.preflight[index].reason },
    arms: ['cairn', 'mem0'].map(name => ({ name, status: 'blocked', reason: 'global_halt',
      answer: null, scope: null, diagnostics: {} })) })), halted: true, haltReason: 'global_halt' });
  const guard = { mixedSourcePairCapability: { manifest: prepared.manifest, roster: prepared.roster,
    schedule: [...generation, ...generation.map(row => ({ ...row, phase: 'scoring' }))] },
  caseOutcomes: () => ({ scopes: [] }), caseScopeSnapshot: () => null,
  judgeFetch: () => assert.fail('no judge for halted or malformed report') };
  return { report, guard };
}
const score = ({ report, guard }) => scoreMixedGeneration({ generationReport: report,
  evaluatorRows: [evaluatorRow()], referenceRenderings: undefined, guard, apiKey: 'synthetic-only' });

for (const comparisonProfile of [undefined, 'indexed-evidence-v1']) {
  test(`SCI1–SCI3 explicit source policy and legacy full projection (${comparisonProfile ?? 'default'})`, () => {
    const old = prepareMixedComparison(options(sourceRow(), comparisonProfile));
    assert.equal(createHash('sha256').update(JSON.stringify(old)).digest('hex'), comparisonProfile
      ? '81462d9950f7e8c646a428cf4729ed1137815405abb45e15379827aac732db80'
      : 'f643d0757b552ce6456359fa62f3caa6e45aae8a284302700e6b5f98aff99922');
    const newer = supplied(sourceRow(), comparisonProfile);
    assert.equal(newer.schemaVersion, comparisonProfile
      ? 'cairn-lme-supplied-history-mixed-indexed-evidence-preparation-v1'
      : 'cairn-lme-supplied-history-mixed-preparation-v1');
    assert.equal(newer.manifest.sourceProtocolSha256, suppliedHistoryPolicy().digest);
    for (const key of ['contextProtocolSha256', 'scorerProtocolSha256'])
      assert.notEqual(newer.manifest[key], old.manifest[key]);
    assert.equal(newer.manifest.answerProtocolSha256, old.manifest.answerProtocolSha256);
    assert.deepEqual(newer.manifest.mem0, old.manifest.mem0);
    assert.deepEqual(newer.manifest.cairn, old.manifest.cairn);
    assert.notEqual(newer.roster[0].protocolDigest, old.roster[0].protocolDigest);
    assert.equal(newer.counts.fixedN, 1);
    assert.equal(newer.preflight[0].status, 'ready');
    assert.equal(Object.isFrozen(newer.manifest), true);
    assert.equal(supplied(chronology(), comparisonProfile).counts.batchCounts[0], 5);
    assert.equal(prepareMixedComparison(options(chronology(), comparisonProfile)).counts.batchCounts[0], 3);
    const future = chronology(); future.question.date = '2023/12/31 (Sun) 00:00';
    assert.equal(supplied(future, comparisonProfile).preflight[0].status, 'ready');
    assert.equal(prepareMixedComparison(options(future, comparisonProfile)).preflight[0].reason, 'no_eligible_history');
  });
  test(`SCI4 separately bound fixed-N scorer family (${comparisonProfile ?? 'default'})`, async () => {
    const fixture = halted(supplied(sourceRow(), comparisonProfile), true);
    const scored = await score(fixture);
    assert.equal(scored.schemaVersion, 'cairn-lme-supplied-history-mixed-scoring-v1');
    assert.equal(scored.summary.fixedN, 1);
    assert.equal(scored.summary.outcomeTable.unresolved.unresolved, 1);
    assert.equal(scored.generationDigest,
      hash('cairn.lme.supplied-history-mixed.generation-report.v1', fixture.report));
    const old = await score(halted(prepareMixedComparison(options(sourceRow(), comparisonProfile))));
    assert.equal(old.schemaVersion, 'cairn-lme-mixed-scoring-v1');
    assert.notEqual(scored.generationDigest, old.generationDigest);
  });
}

test('SCI1 strict caller source policy options fail before callbacks or getters', () => {
  for (const value of [undefined, null, '', 'mixed-source-v2', 'supplied-history-v2', true]) {
    assert.throws(() => prepareMixedComparison({ ...options(), sourceHistoryPolicy: value }),
      { code: 'invalid_mixed_preparation' });
  }
  let reads = 0;
  const getter = options();
  Object.defineProperty(getter, 'sourceHistoryPolicy', { enumerable: true,
    get() { reads++; return 'supplied-history-v1'; } });
  assert.throws(() => prepareMixedComparison(getter), { code: 'invalid_mixed_preparation' });
  assert.equal(reads, 0);
  const oracle = sourceRow(); oracle.history.answer_session_ids = ['forbidden'];
  assert.throws(() => supplied(oracle), { code: 'invalid_source_cases' });
});

test('SCI3 authentic legacy capability, cloned preparation and runtime selector refuse before scopes/HTTP', async t => {
  const fixture = syntheticMixedFixture(t, { artifact: descriptors.nativeArtifact,
    configuration: descriptors.nativeConfiguration, sourceCases: [sourceRow()],
    armOrders: [['cairn', 'mem0']], fetchImpl: () => assert.fail('no HTTP') });
  try {
    const prepared = supplied(sourceRow());
    const run = value => runMixedGeneration({ prepared: value, guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root });
    await assert.rejects(run(structuredClone(prepared)), { code: 'prepared_identity_required' });
    await assert.rejects(run(prepared), { code: 'mixed_guard_mismatch' });
    await assert.rejects(run(prepared), { code: 'prepared_identity_required' });
    await assert.rejects(runMixedGeneration({ prepared: supplied(sourceRow()), guard: fixture.guard,
      apiKey: 'synthetic-only', cairnStoreRoot: fixture.root, sourceHistoryPolicy: 'supplied-history-v1' }),
    { code: 'invalid_mixed_generation' });
    assert.equal(fixture.guard.attempts().length, 0);
    assert.equal(fixture.guard.caseOutcomes().scopes.length, 0);
    assert.deepEqual(readdirSync(fixture.root), ['ledger']);
  } finally { fixture.guard.close(); }
});

test('SCI4 malformed legacy context and source-policy transplant reject at actual scorer before judge', async () => {
  for (const mutation of [manifest => { manifest.sourceProtocolSha256 = suppliedHistoryPolicy().digest; },
    manifest => { manifest.contextProtocolSha256 = 'a'.repeat(64); },
    manifest => { manifest.scorerProtocolSha256 = 'a'.repeat(64); }]) {
    const prepared = structuredClone(prepareMixedComparison(options())); mutation(prepared.manifest);
    await assert.rejects(score(halted(prepared)), { code: 'invalid_mixed_report' });
  }
});

test('SCI4 new schema/policy/context transplants reject, including against a matching forged guard', async () => {
  const prepared = supplied(sourceRow());
  for (const mutate of [row => { row.schemaVersion = 'cairn-lme-mixed-generation-v1'; },
    row => { row.schemaVersion = 'cairn-lme-supplied-history-mixed-generation-v2'; },
    row => { row.manifest.sourceProtocolSha256 = 'a'.repeat(64); },
    row => { row.manifest.contextProtocolSha256 = 'a'.repeat(64); },
    row => { row.manifest.scorerProtocolSha256 = 'a'.repeat(64); }]) {
    const fixture = halted(prepared, true), report = structuredClone(fixture.report);
    mutate(report); report.manifestDigest = hash('cairn.lme.mixed.manifest.v1', report.manifest);
    freeze(report); fixture.report = report; fixture.guard.mixedSourcePairCapability.manifest = report.manifest;
    await assert.rejects(score(fixture), { code: 'invalid_mixed_report' });
  }
});

test('SCI4 legacy schema cannot accept unknown current-family or supplied-schema reports', async () => {
  for (const version of ['cairn-lme-mixed-generation-v2', 'cairn-lme-supplied-history-mixed-generation-v1']) {
    const fixture = halted(prepareMixedComparison(options()));
    const report = structuredClone(fixture.report); report.schemaVersion = version;
    fixture.report = freeze(report);
    await assert.rejects(score(fixture), { code: 'invalid_mixed_report' });
  }
});

test('SCI2/SCI5 source policy retains explicit native static overflow in fixed N', () => {
  const row = sourceRow(); row.history.sessions[0].date = '2024/01/03 (Wed) 00:00';
  row.history.sessions[0].turns = Array.from({ length: 5 }, (_, index) => ({
    turn_id: `lme-turn-${String(index + 1).repeat(64)}`, role: 'user', content: '漢'.repeat(3000) }));
  const prepared = supplied(row);
  assert.equal(prepared.counts.fixedN, 1);
  assert.equal(prepared.preflight[0].reason, 'native_static_input_exceeded');
  assert.equal(prepared.counts.batchCounts[0], 0);
});
