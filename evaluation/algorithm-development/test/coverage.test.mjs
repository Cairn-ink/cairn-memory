import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDevelopmentFreeze } from '../corpus.mjs';
import { prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { scoreDevelopmentCoverage } from '../coverage.mjs';
import { INGESTION_CLIENT } from '../../longmemeval/ingestion.mjs';
import { verifiedEvidence } from '../../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';

const frozen = await loadDevelopmentFreeze();
function fixture(modelInputs = frozen.modelInputs, evaluatorRubric = frozen.evaluatorRubric) {
  const observations = modelInputs.map(source => {
    const { namespace, plan } = prepareAlgorithmDevelopmentCase(source);
    const details = plan.cairnPlan.batches.flatMap(batch => batch.sourceMap.map((mapped, index) => {
      const receipts = batch.indexedWindows.filter(window => window.messageIndex === mapped.messageIndex).map(window => ({
        id: `${source.id}-receipt-${batch.batchIndex}-${index}-${window.index}`, role: mapped.role, excerpt: window.content,
        client: INGESTION_CLIENT, sessionId: batch.captureInput.sessionId, eventId: mapped.messageId }));
      return { memory: { id: `${source.id}-memory-${batch.batchIndex}-${index}`, revision: 1, state: 'active', namespace,
        receiptCount: receipts.length }, receipts, exhausted: true, nextReceiptCursor: null };
    }));
    const observation = { id: source.id, family: source.family, capture: { status: 'completed',
      inputs: plan.cairnPlan.batches.map(batch => batch.captureInput), receipts: details }, arms: {} };
    for (const name of ['baseline', 'full']) {
      const refs = details.map(detail => ({ namespaceIndex: 0, memoryId: detail.memory.id, revision: detail.memory.revision }));
      const recalled = { memories: details.map(detail => ({ memory: { id: detail.memory.id, revision: 1, currentness: 'current' },
        receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })), receiptCount: detail.receipts.length,
        interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' })) };
      const evidence = verifiedEvidence(recalled, ({ memoryId }) => ({ ok: true,
        value: details.find(detail => detail.memory.id === memoryId) }), plan, namespace);
      observation.arms[name] = { name, status: 'completed', failure: null, recalled, evidence,
        modelCalls: [{ method: 'select', input: { maps: [{ namespaceIndex: 0,
          items: refs.map(ref => ({ type: 'unfiled', ref: { memoryId: ref.memoryId, revision: ref.revision }, label: 'Clipped preview.' })) }] },
          output: { refs }, failure: null }], packed: packMixedAnswer({ question: source.question, units: evidence.units, countTokens: () => 0 }) };
    }
    return observation;
  });
  return { modelInputs, evaluatorRubric, observations };
}
function outcome(result, id = 'D01', index = 0, arm = 'full') {
  return result.cases.find(item => item.id === id).anchors[index].statuses[arm];
}
function repack(source, observation, name) {
  const { namespace, plan } = prepareAlgorithmDevelopmentCase(source), arm = observation.arms[name];
  arm.evidence = verifiedEvidence(arm.recalled, ({ memoryId }) => ({ ok: true,
    value: observation.capture.receipts.find(detail => detail.memory.id === memoryId) }), plan, namespace);
  arm.packed = packMixedAnswer({ question: source.question, units: arm.evidence.units, countTokens: () => 0 });
}

test('all actual required anchors are source-bound through every stage with fixed denominators', () => {
  const result = scoreDevelopmentCoverage(fixture());
  assert.equal(result.anchorDenominator, 42); assert.equal(result.targetedStage, 'packed'); assert.equal(result.gain, 0);
  for (const arm of Object.values(result.aggregates)) for (const stage of Object.values(arm)) {
    assert.deepEqual(stage, { denominator: 42, present: 42, absent: 0, unknown: 0, 'not-run': 0 });
  }
});

test('omitted packing units earn no packed credit, while earlier stages remain observed', () => {
  const value = fixture(), observation = value.observations[0], arm = observation.arms.baseline;
  arm.packed = packMixedAnswer({ question: value.modelInputs[0].question, units: arm.evidence.units,
    countTokens: text => JSON.parse(JSON.parse(text).messages[1].content).evidence.length ? 200_000 : 0 });
  assert.equal(arm.packed.selectedIndices.length, 0);
  const result = scoreDevelopmentCoverage(value);
  assert.equal(outcome(result, 'D01', 0, 'baseline').recalled, 'present');
  assert.equal(outcome(result, 'D01', 0, 'baseline').packed, 'absent');
  assert.equal(result.aggregates.baseline.packed.present, 41); assert.equal(result.gain, 1);
});

test('identical literal text in the wrong message cannot satisfy the required source anchor', () => {
  const modelInputs = structuredClone(frozen.modelInputs), evaluatorRubric = structuredClone(frozen.evaluatorRubric);
  modelInputs[0].sessions[0].messages[1].content = modelInputs[0].sessions[0].messages[0].content;
  const value = fixture(modelInputs, evaluatorRubric), observation = value.observations[0];
  const missingId = observation.capture.receipts.shift().memory.id;
  for (const name of ['baseline', 'full']) {
    const arm = observation.arms[name];
    arm.recalled.memories = arm.recalled.memories.filter(item => item.memory.id !== missingId);
    arm.modelCalls[0].input.maps[0].items = arm.modelCalls[0].input.maps[0].items.filter(item => item.ref.memoryId !== missingId);
    arm.modelCalls[0].output.refs = arm.modelCalls[0].output.refs.filter(ref => ref.memoryId !== missingId);
    repack(modelInputs[0], observation, name);
  }
  assert.ok(observation.arms.full.evidence.units.some(unit => unit.text.includes(evaluatorRubric.cases.D01.anchors[0].text)));
  const result = scoreDevelopmentCoverage(value);
  for (const status of Object.values(outcome(result))) assert.equal(status, 'absent');
});

test('CJK, NFKC and whitespace normalization matches source-rendered evidence without altering spans', () => {
  const modelInputs = structuredClone(frozen.modelInputs), evaluatorRubric = structuredClone(frozen.evaluatorRubric);
  const text = '週五讀書會改在北館２樓的小閱覽室　集合';
  const message = modelInputs[6].sessions[0].messages[0];
  message.content = message.content.replace(evaluatorRubric.cases.D07.anchors[0].text, text);
  evaluatorRubric.cases.D07.anchors[0].text = text;
  for (const anchor of evaluatorRubric.cases.D07.anchors) {
    anchor.start = message.content.indexOf(anchor.text); anchor.end = anchor.start + anchor.text.length;
  }
  const value = fixture(modelInputs, evaluatorRubric);
  assert.ok(value.observations[6].arms.full.evidence.units.some(unit => unit.text.includes('北館2樓的小閱覽室 集合')));
  assert.equal(outcome(scoreDevelopmentCoverage(value), 'D07').packed, 'present');
});

test('missing stages retain all anchors as not-run; partial failures remain unknown unless literally observed', () => {
  const empty = scoreDevelopmentCoverage({ ...frozen, observations: [] });
  for (const arm of Object.values(empty.aggregates)) for (const stage of Object.values(arm)) {
    assert.deepEqual(stage, { denominator: 42, present: 0, absent: 0, unknown: 0, 'not-run': 42 });
  }
  const value = fixture();
  value.observations[0].capture.status = 'unresolved';
  value.observations[0].capture.receipts = [];
  value.observations[0].arms = {};
  const result = scoreDevelopmentCoverage(value);
  assert.equal(outcome(result)['capture-retained'], 'unknown');
  assert.equal(outcome(result).packed, 'not-run');
  assert.equal(result.aggregates.full.packed.denominator, 42);
  const partial = fixture(); partial.observations[0].capture.status = 'unresolved';
  assert.equal(outcome(scoreDevelopmentCoverage(partial))['capture-retained'], 'present');
  partial.observations[0].capture.receipts[1].receipts[0].sessionId = 'unverified';
  assert.equal(outcome(scoreDevelopmentCoverage(partial))['capture-retained'], 'present', 'unrelated malformed receipt must not erase observed valid support');
});

test('tampered packed provenance, request text, namespace and selected index never earn packed credit', () => {
  for (const mutate of [
    value => { value.observations[0].arms.full.evidence.provenance[0].coordinates[0].originalTurnIndex = 1; },
    value => { value.observations[0].arms.full.packed.request.messages[1].content = JSON.stringify({ evidence: [{ text: 'Invented evidence' }] }); },
    value => { value.observations[0].arms.full.packed.selectedIndices = [99]; },
    value => { value.observations[0].capture.receipts[0].memory.namespace.projectId = 'foreign'; },
    value => { value.observations[0].capture.receipts[0].receipts[0].sessionId = 'wrong-session'; },
  ]) {
    const value = structuredClone(fixture()); mutate(value);
    assert.equal(outcome(scoreDevelopmentCoverage(value)).packed, 'unknown');
  }
});

test('candidate and selected stages follow actual namespace/revision identities rather than text or all-source backfill', () => {
  const value = fixture(), arm = value.observations[0].arms.full;
  arm.modelCalls[0].input.maps[0].items[0].ref.revision = 99;
  const result = scoreDevelopmentCoverage(value);
  assert.equal(outcome(result)['candidate-reachable'], 'absent'); assert.equal(outcome(result).selected, 'absent');
  assert.equal(outcome(result).recalled, 'present'); assert.equal(outcome(result).packed, 'present');
});

test('unknown/duplicate case IDs, changed anchor denominator and malformed spans fail validation', () => {
  for (const mutate of [
    value => { value.observations[0].id = 'D25'; },
    value => { value.observations[1] = structuredClone(value.observations[0]); },
    value => { value.evaluatorRubric.cases.D01.anchors = []; },
    value => { value.evaluatorRubric.cases.D01.anchors[0].end++; },
  ]) {
    const value = structuredClone(fixture()); mutate(value);
    assert.throws(() => scoreDevelopmentCoverage(value), TypeError);
  }
});
