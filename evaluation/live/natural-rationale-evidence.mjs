import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

const CASES = [
  ['dev-vendor-transition-en', ['d1', 'd2', 'd3', 'd4'], 'q1'],
  ['dev-tentative-zh', ['d5', 'd6'], 'q2'],
  ['dev-premise-failure-en', ['d7', 'd8'], 'q3'],
  ['dev-other-actor-zh', ['d9', 'd10'], 'q4'],
];
const PINS = Object.freeze({
  'evaluation/decision-evolution/fixture.json': '67117f6f0feb273ded64cbcffd98f4b00dde50d37fdfa85ba47fba6511e6f739',
  'evaluation/decision-evolution/contract.mjs': 'db6d63541ed6e8c34c5bebe111ed78e6964aefb3b77721e31f8fec76d69111d7',
  'evaluation/decision-evolution/core-runner.mjs': 'fcb85624b5f2b4119c85b121eac7f933dd6b83ee15a0f32e02d49be2b92bf48e',
  'evaluation/decision-evolution/natural-rationale-trace.mjs': 'c1af16ff2f843ff32eaa13ab265fdb730f24f29f27f05781f46f471680d5b624',
  'evaluation/live/natural-rationale-pilot.mjs': '01515493de280a66afb6dec5276a4c29f86a0c8c98d366d88618bc9cf5693202',
  'adapters/openai/index.mjs': '8077cf6b829d23867ff4afdebd53f7bf4a503da35e532506a639424a76078c44',
  'adapters/openai/schemas.mjs': '31e29e617a04cc386f2208645cf1a07aef80e38853a459c821a4c5ea5eddd67c',
  'core/prompts/relate-rationale.md': 'b00cc2511e7e01d6507f9d13abf6115b315cca8208866a5e15721b6bee212615',
  'evaluation/experiment-budget/request-guard.mjs': 'c20d2cf8a52aa3ebaf52d376133843f8210c95f7184d21440080d220c37a2bb1',
});
const CANDIDATE = 'f2a79f9e6bf0be638945606e84a31f659917496c';
const FIXTURE = 'b26960db6151733d6c0b5b2e45803d3d444b25c6a3dc2dd7c06d9570f5d5056c';
const fail = () => { throw new Error('invalid_natural_rationale_evidence'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const oneOf = (value, choices) => choices.includes(value) ? value : fail();
const source = (value, ids) => value === null || ids.includes(value) ? value : fail();
const list = value => Array.isArray(value) ? value : fail();
const budget = value => value === null ? null : {
  requestCount: requiredInteger(value.requestCount), reservedMicroUsd: requiredInteger(value.reservedMicroUsd),
  knownUsageMicroUsd: requiredInteger(value.knownUsageMicroUsd),
  unknownCostRequests: requiredInteger(value.unknownCostRequests), unsettled: requiredInteger(value.unsettled),
  limitMicroUsd: requiredInteger(value.limitMicroUsd), requestCap: requiredInteger(value.requestCap),
  state: oneOf(value.state, ['open', 'overrun']),
};
function requiredInteger(value) { if (!integer(value)) fail(); return value; }
function sourceIds(values, ids) { return list(values).map(value => source(value, ids)); }
function provenance(value, ids) {
  if (!object(value)) fail();
  const status = oneOf(value.status, ['matched', 'truncated', 'unmatched', 'ambiguous', 'unverified-receipt']);
  if (status === 'matched' || status === 'truncated') {
    if (!ids.includes(value.sourceId)) fail();
    return { status, sourceId: value.sourceId };
  }
  if (status === 'ambiguous') return { status, matchingReceiptCount: requiredInteger(value.matchingReceiptCount) };
  return { status };
}
function lifecycle(value, ids) {
  if (!object(value)) fail();
  const edges = list(value.edges).map(edge => ({ relation: oneOf(edge.relation, ['supports-decision', 'challenges-premise']),
    fromSourceId: source(edge.fromSourceId, ids), toSourceId: source(edge.toSourceId, ids) }));
  return { status: oneOf(value.status, ['ok', 'incomplete']), edges, failureCount: list(value.failures).length };
}
function call(value, ids) {
  if (!object(value)) fail();
  const candidates = list(value.candidates).map(candidate => ({ index: requiredInteger(candidate.index),
    receipts: list(candidate.receipts).map(receipt => ({ index: requiredInteger(receipt.index),
      role: oneOf(receipt.role, ['user', 'assistant', 'system', 'tool']),
      provenance: provenance(receipt.provenance, ids) })) }));
  const edges = value.proposedEdges === null ? null : list(value.proposedEdges).map(edge => {
    const from = candidates.find(item => item.index === edge.from);
    const to = candidates.find(item => item.index === edge.to);
    if (!from?.receipts.some(item => item.index === edge.fromReceipt)
      || !to?.receipts.some(item => item.index === edge.toReceipt)) fail();
    return { from: edge.from, to: edge.to, fromReceipt: edge.fromReceipt, toReceipt: edge.toReceipt,
      relation: oneOf(edge.relation, ['supports-decision', 'challenges-premise']) };
  });
  return { status: oneOf(value.status, ['returned', 'rejected', 'threw', 'called', 'trace-unavailable']),
    candidates, proposedEdges: edges };
}
function arm(value, ids) {
  if (!object(value)) fail();
  const coverage = oneOf(value.coverage, ['complete', 'complete-current-admitted', 'budget_exhausted',
    'unavailable', 'selection-unassessed']);
  const counts = value.sourceCoverage;
  if (!object(counts)) fail();
  return { status: oneOf(value.status, ['ok', 'failed', 'not_run']),
    sourceIds: sourceIds(value.sourceIds, ids), coverage,
    sourceCoverage: { expectedEvents: requiredInteger(counts.expectedEvents),
      capturedEvents: requiredInteger(counts.capturedEvents), returnedEvents: requiredInteger(counts.returnedEvents),
      unreturnedSourceIds: sourceIds(counts.unreturnedSourceIds, ids) },
    ...(value.selectedSourceIds === undefined ? {} : { selectedSourceIds: sourceIds(value.selectedSourceIds, ids) }),
    ...(value.relationshipStatus === undefined ? {} : { relationshipStatus: oneOf(value.relationshipStatus,
      ['model-proposed', 'unassessed-not-linked']) }),
    ...(value.relationshipGeneration === undefined ? {} : { relationshipGeneration: oneOf(value.relationshipGeneration,
      ['automatic-source-bound-v1', 'not-configured']) }) };
}
function projectCase(slot, [caseId, ids, questionId]) {
  if (slot?.caseId !== caseId) fail();
  const status = oneOf(slot.status, ['not_run', 'failed', 'completed', 'completed_with_failures']);
  if (slot.result === null) {
    if (!['not_run', 'failed'].includes(status)) fail();
    return { caseId, status, result: null };
  }
  const result = slot.result;
  if (!object(result) || result.caseId !== caseId || result.split !== 'dev' || result.sourceCount !== ids.length
    || list(result.captures).length !== ids.length || list(result.questions).length !== 1) fail();
  const captures = result.captures.map((item, index) => {
    if (item.sourceId !== ids[index]) fail();
    const natural = item.naturalRationale;
    if (!object(natural)) fail();
    const rawRationale = natural.captureRationale;
    const rationale = object(rawRationale)
      ? { status: oneOf(rawRationale.status, ['reviewed', 'failed', 'not-run', 'skipped']),
        proposed: rawRationale.proposed === undefined ? null : requiredInteger(rawRationale.proposed),
        inserted: rawRationale.inserted === undefined ? null : requiredInteger(rawRationale.inserted),
        interpretationStatus: rawRationale.interpretationStatus === undefined ? null
          : oneOf(rawRationale.interpretationStatus, ['model-proposed']) } : null;
    if (rationale?.status === 'reviewed' && (rationale.proposed === null || rationale.inserted === null
      || rationale.interpretationStatus === null)) fail();
    return { sourceId: item.sourceId, status: oneOf(item.status, ['ok', 'failed']),
      classificationStatus: item.classification ? oneOf(item.classification.status,
        ['applied', 'failed', 'not-run', 'skipped']) : null, rationale,
      observation: oneOf(natural.observation, ['capture-failed', 'admission-absent', 'source-absent',
        'not-candidate', 'candidate-ambiguous', 'candidate-seen-no-proposal',
        'candidate-seen-proposal-not-stored', 'candidate-seen-proposal-persistence-unavailable',
        'stored-model-proposed', 'candidate-seen-callback-failed-or-pending',
        'candidate-seen-trace-unavailable', 'source-inspection-incomplete']),
      relateCalls: list(natural.relateCalls).map(item => call(item, ids)),
      beforeCapture: lifecycle(natural.beforeCapture, ids), afterCapture: lifecycle(natural.afterCapture, ids),
      afterColdReopen: natural.afterColdReopen === undefined ? null : lifecycle(natural.afterColdReopen, ids) };
  });
  const question = result.questions[0];
  if (question.questionId !== questionId || !object(question.arms)
    || Object.keys(question.arms).sort().join(',') !== 'rationale-evidence,source-evidence,sourceSnapshot') fail();
  return { caseId, status, result: { sourceCount: ids.length, capturedSourceIds: sourceIds(result.capturedSourceIds, ids),
    absentSourceIds: sourceIds(result.absentSourceIds, ids), truncatedSourceIds: sourceIds(result.truncatedSourceIds, ids),
    incompleteCapture: typeof result.incompleteCapture === 'boolean' ? result.incompleteCapture : fail(), captures,
    questions: [{ questionId, arms: Object.fromEntries(['source-evidence', 'rationale-evidence', 'sourceSnapshot']
      .map(name => [name, arm(question.arms[name], ids)])) }] } };
}

/** Pure allowlisted projection of the fixed synthetic development run. */
export function exportNaturalRationaleEvidence(report) {
  if (report?.version !== 1 || report.id !== 'natural-rationale-dev-v1'
    || report.fixtureSha256 !== FIXTURE || report.diagnosticOnly !== true
    || !object(report.pins)
    || Object.entries(PINS).some(([name, value]) => report.pins[name] !== value)
    || !Array.isArray(report.cases) || report.cases.length !== 4) fail();
  const cases = report.cases.map((slot, index) => projectCase(slot, CASES[index]));
  const before = budget(report.budgetBefore), after = budget(report.budgetAfter);
  const attempt = report.attempt === null ? null : {
    requests: requiredInteger(report.attempt.requests), reservedMicroUsd: requiredInteger(report.attempt.reservedMicroUsd),
    halted: report.attempt.halted === null ? null : 'halted', readOnly: report.attempt.readOnly === true,
  };
  const delta = before && after ? { requests: after.requestCount - before.requestCount,
    reservedMicroUsd: after.reservedMicroUsd - before.reservedMicroUsd,
    knownUsageMicroUsd: after.knownUsageMicroUsd - before.knownUsageMicroUsd,
    unknownCostRequests: after.unknownCostRequests - before.unknownCostRequests } : null;
  if (delta && (Object.values(delta).some(value => !integer(value))
    || (attempt && (attempt.requests !== delta.requests || attempt.reservedMicroUsd !== delta.reservedMicroUsd)))) fail();
  const cleanup = report.cleanup;
  if (!object(cleanup)) fail();
  const captures = cases.flatMap(item => item.result?.captures ?? []);
  const questions = cases.flatMap(item => item.result?.questions ?? []);
  const readArms = questions.flatMap(item => Object.values(item.arms));
  const relateCalls = captures.flatMap(item => item.relateCalls);
  const result = { version: 1, id: report.id, status: oneOf(report.status,
    ['not_run', 'halted', 'completed', 'completed_with_failures']),
    diagnosticOnly: true, semanticReview: 'nonblind-development-source-review-separate',
    provenance: { candidateSha: CANDIDATE, fixtureSha256: FIXTURE, pins: PINS },
    budgetBefore: before, budgetAfter: after, budgetDelta: delta, attempt,
    cleanup: Object.fromEntries(['drain', 'sessionClose', 'ledgerClose']
      .map(name => [name, oneOf(cleanup[name], ['completed', 'failed', 'not-opened'])])),
    denominators: { cases: 4, events: 10, questions: 4, readArmSlots: 12,
      completedCases: cases.filter(item => item.status === 'completed').length,
      completedWithFailuresCases: cases.filter(item => item.status === 'completed_with_failures').length,
      failedCases: cases.filter(item => item.status === 'failed').length,
      notRunCases: cases.filter(item => item.status === 'not_run').length,
      failedCaptures: captures.filter(item => item.status === 'failed').length,
      unavailableCaptureSlots: 10 - captures.length,
      unavailableQuestionSlots: 4 - questions.length,
      failedReadArms: readArms.filter(item => item.status === 'failed').length,
      notRunReadArms: readArms.filter(item => item.status === 'not_run').length,
      unavailableReadArmSlots: 12 - readArms.length,
      relateCalls: relateCalls.length,
      proposedEdges: relateCalls.reduce((sum, item) => sum + (item.proposedEdges?.length ?? 0), 0) }, cases };
  const encoded = JSON.stringify(result);
  if (redactSecrets(encoded) !== encoded || /\/(?:tmp|home|Users|workspace)\/|[A-Za-z]:\\|Bearer\s|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(encoded)) {
    throw new Error('sensitive_natural_rationale_evidence');
  }
  return JSON.parse(encoded);
}
