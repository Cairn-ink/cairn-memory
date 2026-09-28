import assert from 'node:assert/strict';
import test from 'node:test';
import { runGate } from './gate.mjs';
import { capacityCase, longCase, datedCase } from './fixtures.mjs';

test('frozen long-history gate traverses capture, cold recall and packed answer', async () => {
  const report = await runGate();
  assert.equal(report.version, 1);
  assert.equal(report.denominators.captureBatches, 208);
  assert.equal(report.denominators.admittedMemories, 1030);
  assert.equal(report.denominators.requiredPassages, 7);
  assert.equal(report.expectedNegativeCount, 8);
  assert.equal(report.unexpectedCount, 0);
  assert.equal(report.batchOutcomes.capacity1025.length, 205);
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
