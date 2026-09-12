import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { scoreOrderedHistoryAudit } from '../../../evaluations/ordered-history-score.mjs';
import { projectOrderedHistoryAudit } from '../../../evaluations/ordered-history-runner.mjs';
import { currentnessReportDigest, scoreCurrentnessAudit } from '../../../evaluations/currentness-score.mjs';
import { inspectOrderedCaptureLoopStage } from '../../../evaluation/live/installed-ordered-stages.mjs';

// Replay published synthetic observations only: no runner, provider, credentials or ledger access.
const bytes = filename => readFileSync(new URL(`../../../${filename}`, import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const read = filename => JSON.parse(bytes(filename));
const result = name => read(`evaluations/results/${name}.json`);
const history = () => result('ordered-history-c1-v1');
const currentness = () => result('currentness-c1-v1');
const installed = () => result('installed-ordered-c1-v1');
const historyLabels = () => ({ v1Review: result('ordered-history-c1-v1-review'),
  historyReview: result('ordered-history-c1-v1-historical-review') });

test('C1 preserves the original seven frozen files and three ordered fixture pins', () => {
  const pins = {
    'evaluations/history-cases.mjs': '13c2bc8b0492054869c9aab94de14a3438b08cbc81d2e9140f89f38fe6f4383f',
    'evaluations/history-rubric.mjs': 'c84b060d8b37f10ca9d0511bad254fff922814e796c88835ba878bf0452e9e75',
    'evaluations/history-runner.mjs': '614b67d252611836c3bf9b2f4e6a17d5053cfa60ac70a053af063df90b004429',
    'evaluations/history-score.mjs': '62c5c2ed3b6ef4a713824d6c6fb39fb714071f5dab46846eee46d727739832f7',
    'evaluations/results/conversation-history-v1.json': 'b3244a104c483f029fc9751c68cf9766798c5cfc54e2cce5e95d6f19e93c14a8',
    'evaluations/results/conversation-history-v1-review.json': '323e2d94ddeb9117c95a825fc73af022408ff0b214691f98d44649bf2a1eb9cd',
    'docs/evidence/conversation-history-accounting.json': '8394f3c61f5855dbed585701fb67f206748b6e14e9dce5d73a4aae45f9a53299',
    'evaluations/currentness-cases.mjs': 'c03e3cbe8911d6afb73282ad748b4caf36922018b8fde7b94d02707f30853da2',
    'evaluations/currentness-rubric.mjs': '19eb813ba3a070f75ed03e2b144cc4ec6786e6014403c815de365180e2166805',
    'evaluation/live/installed-ordered-fixture.mjs': '45a0e45bc8913712d4e59ab29515859057c1bc648439fd47ffa618dd764a3b01',
  };
  for (const [file, expected] of Object.entries(pins)) assert.equal(digest(bytes(file)), expected, file);
});

test('C1 ordered history retains all required facts and answers plus the justified retirement', () => {
  const report = history();
  const score = scoreOrderedHistoryAudit(report, historyLabels());
  assert.equal(score.status, 'passed');
  assert.deepEqual(score.errors, []);
  assert.deepEqual(score.metrics, { histories: 4, windows: 6, requiredFacts: 9, queries: 7,
    historicalAssertions: 1, justifiedHistoricalAssertions: 1, retirements: 1 });
  assert.deepEqual(score.v1Score.metrics, { assertions: 11, supported: 11, finalAssertions: 10,
    stale: 0, requiredFacts: 9, retained: 9, recalled: 8, relevant: 8, queries: 7, answered: 7 });
  assert.deepEqual(report.v1Projection, projectOrderedHistoryAudit(report.evidence));
  assert.ok(report.evidence.cases.every(item => item.windows.every(window => window.status === 'completed')
    && item.recalls.every(recall => recall.status === 'completed')));
  assert.equal(scoreOrderedHistoryAudit(report).status, 'failed');
});

test('C1 currentness preserves the C6 quotation failure with every fixed denominator and label', () => {
  const report = currentness();
  const review = result('currentness-c1-v1-review');
  const score = scoreCurrentnessAudit(report, { review });
  assert.equal(report.status, 'completed');
  assert.equal(score.status, 'failed');
  assert.deepEqual(score.errors, ['unexpected_retirement', 'invalid_currentness_assertion', 'unjustified_retirement']);
  assert.deepEqual(score.metrics, { cases: 7, windows: 15, queries: 9, requiredFacts: 19, forbiddenFacts: 15,
    assertions: 22, historicalAssertions: 3, retirements: 3, supportedAssertions: 22,
    validCurrentnessAssertions: 21, justifiedRetirements: 2, requiredMet: 19, forbiddenAbsent: 15,
    answeredQueries: 9, recalledMemories: 13, relevantMemories: 13 });
  assert.equal(review.reportDigest, currentnessReportDigest(report));
  assert.equal(review.assertions.length, 22);
  const invalid = review.assertions.filter(item => !item.currentnessValid || item.retirementJustified === false);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].caseId, 'C6-historical-quotation');
  assert.equal(invalid[0].currentnessValid, false);
  assert.equal(invalid[0].retirementJustified, false);
  const c6 = report.cases.find(item => item.id === invalid[0].caseId);
  assert.ok(c6.windows.flatMap(window => window.snapshots.flatMap(snapshot => snapshot.records))
    .some(record => record.memory.id === invalid[0].memoryId && record.memory.revision === invalid[0].revision
      && record.memory.state === 'historical'));
  assert.ok(report.cases.every(item => item.windows.every(window => window.status === 'completed')
    && item.recalls.every(recall => recall.status === 'completed')));
  assert.equal(scoreCurrentnessAudit(report).status, 'failed');
});

test('C1 installed A–F pass recomputed mechanics and separate review without rewriting raw status', () => {
  const report = installed();
  const review = result('installed-ordered-c1-v1-review');
  assert.equal(report.status, 'mechanical_pass_pending_semantic_review');
  assert.deepEqual(report.stages.map(item => item.stage), ['A', 'B', 'C', 'D', 'E', 'F']);
  const state = {};
  for (const record of report.stages) {
    assert.equal(record.status, 'completed');
    assert.deepEqual(inspectOrderedCaptureLoopStage(record.stage, record, state), {
      stage: record.stage, passedAutomated: true, semanticReviewRequired: true,
    });
  }
  assert.equal(review.reviewerType, 'agent');
  assert.equal(review.accepted, true);
  assert.deepEqual(review.stages.map(item => [item.stage, item.accepted]),
    ['A', 'B', 'C', 'D', 'E', 'F'].map(stage => [stage, true]));
  assert.equal(Object.hasOwn(report.provenance, 'packageRoot'), false);
  const accounting = read('docs/evidence/ordered-c1-accounting.json');
  // Review binds the retained private raw copy, whose provenance path was removed for publication.
  assert.equal(review.reviewedRawDigest, accounting.rawReports.installed.structuralDigest);
});

test('C1 published reports retain frozen bytes and digest-bound structural copies', () => {
  const pins = {
    'ordered-history-c1-v1': 'febb44b2f0d72358af81fab39d8864f180753923e1d82d0687874f7c2e0a4e84',
    'currentness-c1-v1': '0460a709ea2d4521fd58d73f8b5337781391e3b98a9d04acb7a5b4549aa1979f',
    'installed-ordered-c1-v1': '950039fb450a617622ccb5d3f5206c2873149b2643eae9ea03689e10b9acb810',
  };
  for (const [name, expected] of Object.entries(pins)) {
    assert.equal(digest(bytes(`evaluations/results/${name}.json`)), expected, name);
  }
  const accounting = read('docs/evidence/ordered-c1-accounting.json');
  for (const [stage, reportName] of [['ordered-history', 'ordered-history-c1-v1'], ['currentness', 'currentness-c1-v1']]) {
    assert.equal(accounting.rawReports[stage].fileSha256, pins[reportName]);
    assert.equal(accounting.rawReports[stage].structuralDigest, digest(JSON.stringify(result(reportName))));
  }
});

test('C1 accounting is consistent reserved allowance and known usage, not an invoice', () => {
  const accounting = read('docs/evidence/ordered-c1-accounting.json');
  assert.equal(accounting.sourceCommit, 'a01f35bddc74fa60a62b69f3f339b10e0cc42178');
  assert.equal(accounting.ownerCumulativeAuthorizedUsd, 30);
  assert.equal(accounting.implementedLedgerLimitUsd, 20);
  assert.equal(accounting.noRetries, true);
  assert.equal(accounting.noReplacementRuns, true);
  assert.deepEqual(accounting.delta, { requests: 194, reservedMicroUsd: 1088312,
    knownUsageMicroUsd: 41818, unknownCostRequests: 97 });
  for (const [key, amount] of Object.entries(accounting.delta)) {
    assert.equal(accounting.after[key] - accounting.before[key], amount, key);
  }
  assert.equal(accounting.before.requests, 1725);
  assert.equal(accounting.before.reservedMicroUsd, 14617736);
  assert.equal(accounting.after.requests, 1919);
  assert.equal(accounting.after.reservedMicroUsd, 15706048);
  assert.equal(accounting.after.unsettled, 0);
  assert.ok(accounting.delta.requests <= accounting.maxAdditionalRequests);
  assert.ok(accounting.delta.reservedMicroUsd <= accounting.maxAdditionalReservedMicroUsd);
  assert.equal(accounting.observations.length, accounting.delta.requests);
  assert.ok(accounting.observations.every(item => item.status === 200));
  assert.equal(accounting.haltCode, null);
  assert.equal(accounting.remainingImplementedReservedMicroUsd,
    accounting.implementedLedgerLimitUsd * 1000000 - accounting.after.reservedMicroUsd);
  assert.ok(accounting.delta.unknownCostRequests > 0);
  assert.ok(accounting.delta.knownUsageMicroUsd < accounting.delta.reservedMicroUsd);
});
