import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { createDialogueContextJudgingPacket, scoreDialogueContextQa,
  validateDialogueContextJudgments } from '../dialogue-context-qa-score.mjs';

// Integrity and supplied-judgment arithmetic only: no provider or semantic rater.
const root = new URL('../../../', import.meta.url);
const bytes = readFileSync(new URL('../fixtures/dialogue-context-qa-recorded-v1.json', import.meta.url));
const recorded = JSON.parse(bytes);
const sha = value => createHash('sha256').update(value).digest('hex');
const objectHash = value => sha(JSON.stringify(value, null, 2) + '\n');
const options = { fixture: recorded.fixture, rubric: recorded.rubric,
  report: recorded.report, seed: recorded.seed, judgments: recorded.judgments };
const masked = createDialogueContextJudgingPacket(options);
const score = scoreDialogueContextQa(options);
const arms = ['baseline', 'candidate'];

test('recorded public projection and frozen runtime inputs retain their pinned bytes', () => {
  assert.equal(recorded.version, 'dialogue-context-qa-recorded-v1');
  assert.equal(sha(bytes), 'ae8cbe10395ab04d20782cc66b0f8a0d3cbdea5b835d52f24bc48f88748f647b');
  assert.equal(recorded.provenance.runtimeCommit, '884b03b2274558b6e64f9db2bd7d36a93cc9b794');
  for (const [path, expected] of Object.entries(recorded.provenance.frozenFileSha256)) {
    assert.equal(sha(readFileSync(new URL(path, root))), expected, path);
  }
  for (const [name, expected] of Object.entries(recorded.provenance.publicObjectSha256)) {
    assert.equal(objectHash(recorded[name]), expected, name);
  }
  for (const [name, expected] of Object.entries(recorded.provenance.publicRaterObjectSha256)) {
    assert.equal(objectHash(recorded.originalRaters[name]), expected, name);
  }
  for (const [name, file] of [['fixture', 'dialogue-context-qa-v1.json'], ['rubric', 'dialogue-context-qa-rubric-v1.json']]) {
    assert.deepEqual(recorded[name], JSON.parse(readFileSync(new URL('../fixtures/' + file, import.meta.url))));
  }
  // These two original serializations were verified byte-identical; raters and
  // projected notes have distinct original-byte and public-object hashes.
  assert.equal(objectHash(recorded.expectedScore), recorded.provenance.originalArtifactSha256['score.json']);
  assert.equal(objectHash(recorded.judgments), recorded.provenance.originalArtifactSha256['adjudicated.json']);
  assert.equal(Object.hasOwn(recorded.adjudicationNotes.validation, 'node'), false);
  assert.equal(Object.hasOwn(recorded.report, 'ledgerState'), false);
  assert.doesNotMatch(bytes.toString('utf8'), /\/tmp\/|\/home\/|Bearer |api[_-]?key/iu);
});

test('all original and accepted masked judgments bind to the reproducible 24-pair packet', () => {
  assert.equal(masked.packetSha256, '7a629d08d1d2762a8d973bf0c62c1a93b2edad0f78added2f8a74d811eb41363');
  assert.equal(masked.packet.pairs.length, 24);
  assert.equal(recorded.adjudicationNotes.packetSha256, masked.packetSha256);
  for (const judgments of [...Object.values(recorded.originalRaters), recorded.judgments]) {
    assert.deepEqual(validateDialogueContextJudgments(masked.packet, judgments), judgments);
  }
  let comparisons = 0, sourceDifferences = 0;
  for (const a of recorded.originalRaters.raterA.pairs) {
    const b = recorded.originalRaters.raterB.pairs.find(pair => pair.pairId === a.pairId);
    for (const slot of a.slots) for (const claim of slot.claims) {
      const other = b.slots.find(row => row.slot === slot.slot).claims.find(row => row.claimId === claim.claimId);
      for (const field of ['correct', 'supported']) { comparisons++; assert.equal(claim[field], other[field]); }
      sourceDifferences += Number(!isDeepStrictEqual([...claim.sourceIds].sort(), [...other.sourceIds].sort()));
    }
  }
  assert.equal(comparisons, 152);
  assert.equal(sourceDifferences, 2);
  assert.deepEqual(Object.values(recorded.originalRaters).map(j => j.pairs.reduce((n, p) => n + p.issues.length, 0)), [2, 1]);
  assert.equal(recorded.adjudicationNotes.disagreements.filter(row => row.kind === 'issue-existence').length, 1);
  assert.equal(recorded.judgments.pairs.reduce((n, p) => n + p.issues.length, 0), 1);
});

test('existing scorer exactly replays the frozen score and every first-attempt outcome', () => {
  assert.deepEqual(score, recorded.expectedScore);
  assert.equal(objectHash(score), '019915bf4c4fb0f118682a5de84b3856a746eb53b0eed7cbf8a3a13623466027');
  assert.deepEqual(score.denominators, { cases: 24, claims: 38, positiveCases: 20, positiveClaims: 34, insufficientCases: 4 });
  assert.equal(recorded.report.status, 'stopped');
  assert.deepEqual([recorded.report.completedArms, recorded.report.failedArms, recorded.report.notRunArms], [32, 1, 15]);
  for (const [index, row] of score.rows.entries()) {
    assert.equal(row.id, recorded.fixture.cases[index].id);
    for (const arm of arms) {
      const status = index < 16 ? 'completed' : index === 16 && arm === 'baseline' ? 'failed' : 'not-run';
      assert.equal(row[arm].status, status, `${row.id}/${arm}`);
      assert.equal(row[arm].supportedAnswer, index < 16 && ![3, 8].includes(index), `${row.id}/${arm}`);
    }
  }
  for (const arm of arms) {
    assert.deepEqual([score[arm].completed, score[arm].supportedAnswers, score[arm].wrongAnswers, score[arm].unresolvedAnswers], [16, 14, 2, 0]);
    assert.equal(score[arm].failed + score[arm].notRun, 8);
    assert.deepEqual(score[arm].issues, { unsupported: 1, severe: 0, stale: 0, occurrences: 1 });
  }
  assert.equal(score.netGain, 0);
  for (const name of ['gains', 'regressions', 'completionLosses', 'lostDecisions', 'newIssues', 'unresolved']) assert.deepEqual(score[name], []);
  assert.deepEqual(score.gateChecks, {
    netSupportedAnswerGain: false, retainedNecessaryEvidence: false, packedNecessaryEvidence: false,
    noCompletionLoss: true, noNewUnsupported: true, noNewSevere: true, noNewStale: true,
    noLostSupportedDecision: true, noUnresolvedJudgments: true, completedRun: false, opportunity: true,
  });
  assert.equal(score.pass, false);
});

test('formal evidence totals preserve the partial case; completed-pair comparison is secondary', () => {
  for (const phase of ['retained', 'packed']) {
    assert.equal(score.baseline.coverage[phase].claims, 29);
    assert.equal(score.candidate.coverage[phase].claims, 27);
    assert.equal(score.rows[16].baseline.coverage[phase].claims, 2);
    assert.equal(score.rows[16].candidate.coverage[phase].claims, 0);
  }
  const completed = recorded.report.rows.filter(row => arms.every(arm => row[arm].status === 'completed'));
  assert.equal(completed.length, 16);
  const commonIds = new Set(completed.map(row => row.id));
  const commonScore = score.rows.filter(row => commonIds.has(row.id));
  assert.equal(recorded.rubric.cases.filter(row => commonIds.has(row.id)).reduce((n, row) => n + row.claims.length, 0), 27);
  for (const arm of arms) for (const phase of ['retained', 'packed']) {
    assert.equal(commonScore.reduce((n, row) => n + row[arm].coverage[phase].claims, 0), 27);
  }
  assert.deepEqual(arms.map(arm => completed.reduce((n, row) => n + row[arm].packed.includedCount, 0)), [38, 44]);
  assert.deepEqual(arms.map(arm => completed.reduce((n, row) => n + row[arm].packed.includedBytes, 0)), [2873, 3163]);
  const same = completed.filter(row => isDeepStrictEqual(row.baseline.packed.request, row.candidate.packed.request)).length;
  assert.deepEqual([same, completed.length - same], [10, 6]);
  for (const index of [3, 8]) for (const arm of arms) {
    assert.equal(score.rows[index][arm].coverage.packed.fullCase, true);
    assert.equal(score.rows[index][arm].supportedAnswer, false);
  }
});

test('dated structural and accounting observations remain distinct from semantic success', () => {
  assert.equal(recorded.structuralAudit.pass, true);
  assert.deepEqual(recorded.structuralAudit.errors, []);
  assert.equal(recorded.structuralAudit.executionCompleted, false);
  assert.equal(recorded.structuralAudit.q8EvidenceEligible, false);
  const observed = recorded.accounting, counts = recorded.structuralAudit.counts;
  assert.equal(observed.recordCount, 616);
  assert.deepEqual([observed.terminalStatus, observed.terminalReason, observed.actualExitCode], ['stopped', 'run_deadline', 1]);
  assert.deepEqual([observed.physicalRequests, observed.countRequests, observed.generationRequests], [164, 82, 82]);
  assert.deepEqual([counts.physicalRequests, counts.countRequests, counts.generationRequests], [164, 82, 82]);
  assert.deepEqual([counts.inputTokens, counts.outputTokens], [44529, 4711]);
  assert.deepEqual([observed.newUnknownUsage, observed.pendingUsage, counts.unknownCurrentUsage, counts.pendingCurrentUsage], [0, 0, 0, 0]);
  assert.equal(observed.reservationDeltaMicroUsd, observed.physicalRequests * 5000);
  assert.equal(observed.knownGenerationEstimateMicroUsd, 25381);
  assert.equal(observed.countEndpointCost, null);
  assert.equal(observed.agentJudgingCost, null);
  assert.equal(observed.cumulativeReservedMicroUsd + observed.spendableAfterProtectedMicroUsd + observed.protectedMicroUsd, 400000000);
});
