import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadMocNaturalInputs, validateMocNaturalInputs, prepareMocNaturalCases, mocNaturalSourceSha256,
  naturalHash, naturalErrorCode } from '../moc-prior-profile.mjs';
import { runMocNaturalComparison } from '../moc-prior-runner.mjs';
import { loadMocNaturalFreeze, buildBlindMocNaturalPacket, unblindMocNaturalJudgments,
  analyzeMocNaturalReport, aggregateMocNaturalJudgments } from '../moc-prior-evaluator.mjs';
import { naturalFixture, naturalFakeProvider } from './moc-prior-runner.test.mjs';

const judgments = (frozen, change = row => row) => frozen.modelInputs.flatMap(source => ['baseline', 'prior'].map(arm => change({ id: source.id,
  arm, verdict: source.id === 'P01' && arm === 'baseline' ? 'incorrect' : 'correct', reviewedClaims: 1,
  unsupportedClaims: 0, staleClaims: 0, severeError: false, abstained: source.id === 'P04', rationale: 'Synthetic scoring control; not model quality.' })));

test('NR1 strict source-only loader binds frozen bytes and reuses nineteen unchanged batches', async t => {
  const source = await loadMocNaturalInputs(), plans = await prepareMocNaturalCases(source);
  assert.equal(plans.length, 4); assert.ok(plans.every(item => item.plan.cairnPlan.batches.length === 19));
  assert.equal(naturalHash(readFileSync(new URL('../moc-prior-cases.json', import.meta.url))), mocNaturalSourceSha256);
  assert.ok(source.every(row => Object.isFrozen(row) && Object.isFrozen(row.sessions)));
  for (const mutate of [rows => { rows[0].answer = 'gold'; }, rows => { rows[1].question.rubric = {}; },
    rows => { rows[2].sessions.pop(); }, rows => { rows[0].sessions[1].eventTime = rows[0].sessions[0].eventTime; },
    rows => { rows[3].sessions[0].messages[0].content = 'x'.repeat(801); }]) {
    const changed = structuredClone(source); mutate(changed);
    assert.throws(() => validateMocNaturalInputs(changed), error => error.code === 'natural_source_invalid');
  }
  const workspace = createTestWorkspace(t, { prefix: 'natural-moc-loader-' }), path = join(workspace.path, 'changed.json');
  writeFileSync(path, JSON.stringify(source));
  await assert.rejects(loadMocNaturalInputs({ casesPath: path }), error => error.code === 'natural_source_drift');
  assert.equal(naturalErrorCode({ code: 'secret-with-credentials' }), 'natural_failure');
});

test('NR7 full frozen rubric and eight opaque slots, agreement-only fields and explicit NF5 abstention', async t => {
  const frozen = await loadMocNaturalFreeze(), f = naturalFixture(t);
  const report = await runMocNaturalComparison({ cases: frozen.modelInputs, ...f });
  const blind = await buildBlindMocNaturalPacket({ report, freeze: frozen });
  assert.equal(blind.packet.items.length, 8); assert.equal(blind.mapping.length, 8);
  assert.equal(new Set(blind.mapping.map(row => row.label)).size, 8);
  assert.ok(blind.packet.items.every(item => /^[0-9a-f]{32}$/u.test(item.label) && !('arm' in item) && !('id' in item)
    && item.sourceHistory.length === 19 && item.rubric.examples && item.rubric.anchors));
  const original = judgments(frozen), labeled = original.map(row => {
    const identity = blind.mapping.find(item => item.id === row.id && item.arm === row.arm);
    const { id, arm, ...fields } = row; return { label: identity.label, ...fields };
  });
  assert.deepEqual(unblindMocNaturalJudgments(blind.mapping, labeled), original);
  assert.throws(() => unblindMocNaturalJudgments(blind.mapping, [...labeled, labeled[0]]));
  const score = await aggregateMocNaturalJudgments({ report, freeze: frozen, outputDirectory: f.outputDirectory,
    judgmentsA: original, judgmentsB: judgments(frozen, row => row.id === 'P02' && row.arm === 'prior' ? { ...row, unsupportedClaims: null, abstained: null } : row) });
  const unknown = score.outcomes.find(row => row.id === 'P02' && row.arm === 'prior');
  assert.equal(unknown.unsupportedClaims, null); assert.equal(unknown.abstained, null);
  assert.equal(score.arms.prior.unresolvedChoice.verdict, 'correct'); assert.equal(score.arms.prior.unresolvedChoice.abstained, true);
  assert.equal(score.supportsFurtherDevelopment, false); assert.equal(score.productPromotion, false); assert.equal(score.stage3, false);
  assert.deepEqual(score.firstSubmissions.judgeA, original);
  const missing = await aggregateMocNaturalJudgments({ report, freeze: frozen, outputDirectory: f.outputDirectory, judgmentsA: [], judgmentsB: original });
  assert.equal(missing.paired.unresolvedPairs, 4); assert.equal(missing.paired.wins, 0); assert.equal(missing.paired.losses, 0);
});

test('NR8/9 actual natural fake-provider opportunity, state-fenced existing derivation and positive paired gate controls', async t => {
  const frozen = await loadMocNaturalFreeze(), f = naturalFixture(t, { fetchImpl: naturalFakeProvider({ pressure: true }) });
  const report = await runMocNaturalComparison({ cases: frozen.modelInputs, ...f });
  assert.equal(report.fatal, null, JSON.stringify(report.observations.map(row => ({ id: row.id, fail: row.capture.failure }))));
  assert.ok(report.observations.every(row => row.capture.admissions === 95));
  const analysis = await analyzeMocNaturalReport({ report, freeze: frozen, outputDirectory: f.outputDirectory });
  const first = analysis.cases[0];
  assert.equal(first.derived.status, 'verified'); assert.equal(first.derived.stateBefore, first.derived.stateAfter);
  assert.equal(first.derived.internalPriorMembership, 'unobserved');
  assert.equal(first.opportunity, true, JSON.stringify({ integrity: first.integrity, anchors: first.anchors }));
  const opportunity = first.anchors.find(anchor => anchor.opportunity);
  assert.equal(opportunity.stages.baseline.retained, 'present'); assert.equal(opportunity.stages.baseline.visible, 'absent');
  assert.equal(opportunity.stages.prior.visible, 'present'); assert.equal(opportunity.stages.prior.packed, 'present');
  assert.ok(first.derived.orders.baseline.length === first.derived.orders.prior.length);
  assert.equal(report.observations[0].arms.baseline.recalled.memories.length, 0);
  assert.equal(report.observations[0].arms.prior.recalled.memories.length, 1);
  const args = { report, freeze: frozen, outputDirectory: f.outputDirectory, judgmentsA: judgments(frozen), judgmentsB: judgments(frozen) };
  const positive = await aggregateMocNaturalJudgments(args);
  assert.equal(positive.supportsFurtherDevelopment, true, JSON.stringify(positive.gates));
  assert.equal(positive.decision, 'positive-development-signal'); assert.equal(positive.paired.netCorrect, 1);
  const loss = judgments(frozen, row => row.id === 'P02' ? { ...row, verdict: row.arm === 'baseline' ? 'correct' : 'incorrect' } : row);
  assert.equal((await aggregateMocNaturalJudgments({ ...args, judgmentsA: loss, judgmentsB: loss })).supportsFurtherDevelopment, false);
  const harm = judgments(frozen, row => row.id === 'P01' && row.arm === 'prior' ? { ...row, unsupportedClaims: 1, severeError: true } : row);
  assert.equal((await aggregateMocNaturalJudgments({ ...args, judgmentsA: harm, judgmentsB: harm })).decision, 'reject/unsafe');
  const refusal = judgments(frozen, row => row.id === 'P02' && row.arm === 'prior' ? { ...row, verdict: 'incorrect', abstained: true } : row);
  assert.equal((await aggregateMocNaturalJudgments({ ...args, judgmentsA: refusal, judgmentsB: refusal })).gates.knownUsefulness, false);
  const changed = structuredClone(report); changed.observations[0].arms.prior.packed.request.messages[1].content = JSON.stringify({ evidence: [{ text: 'Unverified fabricated passage.' }] });
  const tampered = await aggregateMocNaturalJudgments({ ...args, report: changed });
  assert.equal(tampered.supportsFurtherDevelopment, false); assert.equal(tampered.analysis.cases[0].opportunity, false);
  assert.equal(tampered.outcomes.find(row => row.id === 'P01' && row.arm === 'prior').verdict, 'unresolved');
  assert.equal(tampered.outcomes.find(row => row.id === 'P01' && row.arm === 'baseline').verdict, 'incorrect', 'untouched baseline retains its agreed first judgment');
  assert.equal(tampered.outcomes.find(row => row.id === 'P01' && row.arm === 'baseline').completed, true);
  assert.equal(tampered.analysis.cases[0].armIntegrity.baseline, true);
  assert.equal(tampered.analysis.cases[0].armIntegrity.prior, false);
  const changedAnswer = structuredClone(report); changedAnswer.observations[0].arms.prior.answer = 'Different undispatched answer.';
  assert.equal((await aggregateMocNaturalJudgments({ ...args, report: changedAnswer })).supportsFurtherDevelopment, false);
  const changedRecord = structuredClone(report); changedRecord.records[0].requestBody = '{}';
  assert.equal((await aggregateMocNaturalJudgments({ ...args, report: changedRecord })).supportsFurtherDevelopment, false);
  const noState = await aggregateMocNaturalJudgments({ ...args, outputDirectory: undefined });
  assert.equal(noState.analysis.cases[0].derived.status, 'unknown'); assert.equal(noState.supportsFurtherDevelopment, false);
});

test('NR7 failed/unrun slots remain eight unavailable blind outcomes with fixed denominators', async t => {
  const frozen = await loadMocNaturalFreeze(), f = naturalFixture(t, { fetchImpl: async () => Response.json({ error: {} }, { status: 401 }) });
  const report = await runMocNaturalComparison({ cases: frozen.modelInputs, ...f });
  const blind = await buildBlindMocNaturalPacket({ report, freeze: frozen });
  assert.equal(blind.packet.items.length, 8); assert.ok(blind.packet.items.every(item => item.answer === null && item.answerAvailability === 'unresolved'));
  const score = await aggregateMocNaturalJudgments({ report, freeze: frozen, outputDirectory: f.outputDirectory,
    judgmentsA: judgments(frozen), judgmentsB: judgments(frozen) });
  assert.equal(score.outcomes.length, 8); assert.equal(score.paired.unresolvedPairs, 4);
  assert.equal(score.arms.baseline.correct, 0); assert.equal(score.arms.prior.correct, 0);
});

test('NR10 actual owned subprocess cleanup on success and intentional assertion failure', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'natural-moc-lifecycle-' });
  const runner = new URL('../../../tools/testing/run.mjs', import.meta.url);
  const ownership = new URL('../../../tools/testing/workspace.mjs', import.meta.url).href;
  for (const fail of [false, true]) {
    const file = join(workspace.path, `probe-${fail}.mjs`);
    writeFileSync(file, `import test from 'node:test'; import assert from 'node:assert/strict'; import { createTestWorkspace } from '${ownership}';\ntest('owned probe', t => { const w = createTestWorkspace(t, {prefix:'natural-owned-probe-'}); console.log('OWNED_PATH=' + w.path); assert.equal(${fail}, false); });\n`);
    const child = spawnSync(process.execPath, [runner.pathname, file], { encoding: 'utf8', env: { ...process.env, TMPDIR: workspace.path } });
    assert.equal(child.status, fail ? 1 : 0, child.stdout + child.stderr);
    const match = child.stdout.match(/OWNED_PATH=([^\s]+)/u); assert.ok(match, child.stdout);
    assert.equal(existsSync(match[1]), false);
  }
});
