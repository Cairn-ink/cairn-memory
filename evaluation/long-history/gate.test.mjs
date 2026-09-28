import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runGate } from './gate.mjs';
import { capacityCase, longCase, datedCase } from './fixtures.mjs';

test('frozen long-history gate traverses capture, cold recall and packed answer', async () => {
  const report = await runGate();
  assert.equal(report.version, 1);
  assert.equal(report.denominators.captureBatches, 208);
  assert.equal(report.denominators.plannedCaptureBatches, 208);
  assert.equal(report.denominators.attemptedCaptureBatches, 208);
  assert.equal(report.denominators.failedCaptureBatches, 0);
  assert.equal(report.denominators.notRunCaptureBatches, 0);
  assert.equal(report.denominators.admittedMemories, 1030);
  assert.equal(report.denominators.requiredPassages, 7);
  assert.equal(report.expectedNegativeCount, 8);
  assert.equal(report.unexpectedCount, 0);
  assert.equal(report.batchOutcomes.capacity1025.length, 205);
  assert.ok(report.cases.every(row => row.status === 'completed'));
  assert.equal(report.batchOutcomes.faultControls.find(row => row.control === 'failedClassification').capture,
    'completed-post-admission-failure');
  assert.equal(report.stages.retained, 7);
  assert.equal(report.stages.referenceVisible, 6);
  assert.equal(report.stages.candidateVisible, 0);
  assert.equal(report.stages.selected, 6);
  assert.equal(report.stages.answerContextPresent, 6);
  assert.equal(report.controlStages.emptySelection.selected, false);
  assert.equal(report.controlStages.emptySelection.firstDeliveryFailure, 'selected');
  assert.equal(report.controlStages.emptySelection.ranked, 'not-run');
  assert.equal(report.controlStages.emptyRank.ranked, false);
  assert.equal(report.controlStages.emptyRank.firstDeliveryFailure, 'ranked');
  assert.equal(report.controlStages.emptyRank.answerContextPresent, 'not-run');
  assert.ok(report.finalDatabaseBytes > 0);
  assert.ok(report.tokens.tokenizerCalls > 0 && report.tokens.tokenizerTokens > 0);
  assert.ok(report.calls.extract >= 208 && report.calls.classify >= 208);
  const [long, capacity, dated] = report.cases;
  assert.equal(long.family, longCase.name);
  assert.equal(long.sourceWindows, longCase.expectedWindowCount);
  assert.ok(long.questions.every(row => row.stages.answerContextPresent));
  assert.ok(long.questions.every(row => row.stages.candidateVisible === false &&
    row.routingCueVisible === true && row.deliverySucceeded === true));
  assert.equal(long.questions[0].expectedRefTypeObserved, true);
  assert.equal(capacity.family, capacityCase.name);
  assert.equal(capacity.eligibleMemories, capacityCase.count);
  assert.equal(capacity.questions[0].firstMissing, 'candidate-visible');
  assert.equal(capacity.questions[0].firstDeliveryFailure, 'reference-visible');
  assert.equal(capacity.questions[0].stages.referenceVisible, false);
  assert.equal(capacity.questions[0].stages.selected, 'not-run');
  assert.equal(capacity.questions[1].stages.answerContextPresent, true);
  assert.equal(capacity.questions[1].stages.candidateVisible, false);
  assert.equal(capacity.questions[1].routingCueVisible, true);
  assert.equal(capacity.questions[1].recallCoverage, 'budget_exhausted');
  assert.equal(dated.family, datedCase.name);
  assert.equal(dated.choicesRetained, 2);
  assert.equal(dated.currentChoiceJudgment, 'not-assessed');
  assert.ok(dated.questions.every(row => row.stages.answerContextPresent));
  const publicJson = JSON.stringify(report);
  for (const forbidden of ['frontmarker', 'capacity0000', 'datedalpha',
    'datedbeta', 'faultmarker', 'correctionmarker', '/tmp/', 'sqlite', 'sk-']) {
    assert.equal(publicJson.includes(forbidden), false, `aggregate leaked ${forbidden}`);
  }
  assert.ok(publicJson.length < 30000, 'bounded aggregate');
});

for (const [fault, expectedCapture, expectedAdmitted, expectedFailure] of [
  ['capacity-second-malformed-extraction', 'failed', 8, 'gate_capacity_capture'],
  ['capacity-second-classification-failure', 'completed-post-admission-failure', 13,
    'gate_capacity_classification'],
]) {
  test(`second capacity batch ${fault} preserves a bounded incomplete report`, async () => {
    const report = await runGate({ fault });
    assert.equal(report.unexpectedCount, 1);
    assert.equal(report.failure, expectedFailure);
    assert.equal(report.denominators.plannedCaptureBatches, 208);
    assert.equal(report.denominators.attemptedCaptureBatches, 3);
    assert.equal(report.denominators.captureBatches, 2);
    assert.equal(report.denominators.failedCaptureBatches, 1);
    assert.equal(report.denominators.notRunCaptureBatches, 205);
    assert.equal(report.denominators.admittedMemories, expectedAdmitted);
    assert.equal(report.cases[1].eligibleMemories, expectedAdmitted - 3);
    assert.equal(report.calls.extract, 3);
    assert.equal(report.calls.classify, expectedAdmitted === 8 ? 2 : 3);
    assert.equal(report.calls.select, 3);
    assert.equal(report.calls.rank, 3);
    assert.equal(report.batchOutcomes.capacity1025[0].capture, 'completed');
    assert.equal(report.batchOutcomes.capacity1025[1].capture, expectedCapture);
    assert.equal(report.batchOutcomes.capacity1025[1].admitted, expectedAdmitted - 8);
    assert.ok(report.batchOutcomes.capacity1025.slice(2).every(row => row.capture === 'not-run'));
    assert.ok(report.batchOutcomes.datedAB.every(row => row.capture === 'not-run'));
    assert.ok(report.batchOutcomes.faultControls.every(row => row.capture === 'not-run'));
    assert.equal(report.cases[0].status, 'completed');
    assert.equal(report.cases[1].status, 'incomplete');
    assert.equal(report.cases[2].status, 'not-run');
    assert.ok(report.cases[0].questions.every(row => row.status === 'completed' && row.deliverySucceeded));
    assert.ok(report.cases[1].questions.every(row => row.status === 'not-run' &&
      row.stages.answerContextPresent === 'not-run'));
    assert.ok(report.cases[2].questions.every(row => row.status === 'not-run'));
    assert.ok(Object.values(report.controls).every(status => status === 'not-run'));
    assert.equal(report.stages.retained, 3);
    assert.equal(report.stages.selected, 3);
    assert.equal(report.stages.answerContextPresent, 3);
    assert.ok(report.elapsedMs.write > 0 && report.elapsedMs.read > 0);
    assert.ok(report.finalDatabaseBytes > 0);
    if (fault === 'capacity-second-classification-failure') {
      assert.equal(report.batchOutcomes.capacity1025[1].coldReceipts, 5);
    }
  });
}

test('test-only fault CLI exits nonzero with a sanitized aggregate', () => {
  const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script',
    'evaluation/long-history/run.mjs', '--fault=capacity-second-malformed-extraction'],
  { encoding: 'utf8', timeout: 30000 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  const report = JSON.parse(child.stdout.trim());
  assert.equal(report.unexpectedCount, 1);
  assert.equal(report.failure, 'gate_capacity_capture');
  assert.equal(report.denominators.attemptedCaptureBatches, 3);
  assert.ok(child.stderr.includes('gate_capacity_capture'));
  for (const forbidden of ['frontmarker', 'capacity0000', 'datedalpha', '/tmp/', 'sqlite', 'sk-']) {
    assert.equal(child.stdout.includes(forbidden), false, `failure aggregate leaked ${forbidden}`);
  }
  assert.ok(child.stdout.length < 30000);
});
