// Evaluator-only: NEVER imported by the model-facing compiler or cases module.
import { sourceRoleCases } from './cases.mjs';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { sourceWindowCatalog } from '../../core/source-windows.mjs';
import { snapshotJson } from '../longmemeval/mixed-validation.mjs';

export const evaluatorMarker = 'N28_EVALUATOR_ONLY_RUBRIC';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
function anchor(ordinal, messageIndex, text, claimSubject) {
  const message = captureSnapshot(sourceRoleCases[ordinal - 1].capture, undefined,
    'indexed-evidence-v1').messages[messageIndex];
  const start = message.content.indexOf(text);
  if (start < 0 || message.content.indexOf(text, start + 1) >= 0) throw new Error('invalid_rubric_anchor');
  return { messageId: message.id, messageIndex, start, end: start + text.length, text,
    claimedSpeaker: message.role, claimSubject };
}
const full = (ordinal, messageIndex, subject = 'user') => {
  const text = captureSnapshot(sourceRoleCases[ordinal - 1].capture, undefined,
    'indexed-evidence-v1').messages[messageIndex].content;
  return anchor(ordinal, messageIndex, text, subject);
};
const direct = [
  [full(1, 0)],
  [anchor(2, 0, 'After lunch I took the orchard tram from Pine Gate to Cedar Square with Mei.', 'user')],
  [full(3, 0), full(3, 1)],
  Array.from({ length: 5 }, (_, index) => full(4, index)),
  Array.from({ length: 21 }, (_, index) => full(5, index)),
  [full(6, 0)], [], [], [], [full(10, 1)], [],
  [full(12, 2)],
];
const constraints = [
  'Direct user repair; assistant inspection advice is not another completed user event.',
  'The full direct-episode anchor spans two canonical windows; count their union.',
  'Do not merge unrelated mapping and lending events into a single experience.',
  'Five distinct direct episodes compete with assistant elaboration within five items.',
  'Twenty-one independent required windows exceed five items times four windows; omissions are expected.',
  'Permit renewal is negated; a future application is uncertain and fee-conditional.',
  'Canoe buyer is quoted neighbor Ivo, not the user; repetition is not purchase.',
  'Volunteering is hypothetical and conditional; no assignment was accepted.',
  'Station locker is an assistant proposal explicitly not adopted or authorized.',
  'User adopted a future plan, not completed shelf labeling.',
  'Drainage recommendation remains useful assistant-only advice, not user action or adoption.',
  'Respect user correction: green scooter, not orange bicycle; retain non-invalidated assistant tire-pressure advice with attribution.',
];
export const sourceRoleRubric = freeze(sourceRoleCases.map(({ ordinal }) => ({
  ordinal, eligibleDirectEpisodes: direct[ordinal - 1],
  requiredAssistantEvidence: ordinal === 11 ? [full(11, 0, 'assistant recommendation')] : ordinal === 12
    ? [anchor(12, 0, 'For a tire-pressure check, use the pressure range printed on the tire sidewall; do not exceed it.',
      'assistant technical explanation')] : [],
  contextEvidence: ordinal === 7 ? [full(7, 0, 'neighbor Ivo')] : ordinal === 8 ? [full(8, 0)]
    : ordinal === 9 ? [full(9, 1, 'assistant proposal'), full(9, 2)]
      : ordinal === 12 ? [full(12, 1)] : [],
  constraints: constraints[ordinal - 1], beyondCapacity: ordinal === 5,
})));

// Only validated canonical passages count, never generated summary wording.
export function retainedCoverage(ordinal, result) {
  const rubric = sourceRoleRubric[ordinal - 1];
  if (!rubric || rubric.ordinal !== ordinal) throw new Error('invalid_rubric_ordinal');
  result = snapshotJson(result, { bytes: 128_000, nodes: 8192, depth: 14 }, 'invalid_coverage_result');
  if (!result || typeof result !== 'object' || result.caseOrdinal !== ordinal ||
      !['baseline', 'candidate'].includes(result.arm) || !['completed', 'refused'].includes(result.status) ||
      !Array.isArray(result.passages) || result.passages.length > 20 ||
      (result.status === 'refused' && result.passages.length)) throw new Error('invalid_coverage_result');
  const catalog = sourceWindowCatalog(captureSnapshot(sourceRoleCases[ordinal - 1].capture,
    undefined, 'indexed-evidence-v1'));
  const indices = new Set();
  for (const passage of result.passages) {
    if (!passage || typeof passage !== 'object' || Array.isArray(passage) ||
        !Number.isSafeInteger(passage.index)) throw new Error('invalid_coverage_result');
    const entry = catalog.entries[passage?.index];
    if (!entry || indices.has(entry.index) || Object.keys(passage).length !== 7 ||
        !Object.entries({ index: entry.index, messageIndex: entry.messageIndex, messageId: entry.id,
          role: entry.role, start: entry.start, end: entry.end, excerpt: entry.content })
          .every(([field, value]) => Object.hasOwn(passage, field) && passage[field] === value)) {
      throw new Error('invalid_coverage_result');
    }
    indices.add(entry.index);
  }
  const covered = anchor => {
    if (result.status !== 'completed') return false;
    const spans = result.passages.filter(passage => passage.messageId === anchor.messageId)
      .map(passage => [passage.start, passage.end]).sort((a, b) => a[0] - b[0]);
    let cursor = anchor.start;
    for (const [start, end] of spans) {
      // Catalog trimming removes only canonical separator spaces at a boundary.
      while (cursor < anchor.end && anchor.text[cursor - anchor.start] === ' ') cursor++;
      if (start > cursor) continue;
      cursor = Math.max(cursor, end);
    }
    return cursor >= anchor.end;
  };
  return { ordinal, arm: result.arm, status: result.status, beyondCapacity: rubric.beyondCapacity,
    directTotal: rubric.eligibleDirectEpisodes.length,
    directRetained: rubric.eligibleDirectEpisodes.filter(covered).length,
    assistantTotal: rubric.requiredAssistantEvidence.length,
    assistantRetained: rubric.requiredAssistantEvidence.filter(covered).length,
    semanticCorrectness: 'unassessed', capsUnchanged: JSON.stringify(result.caps) ===
      JSON.stringify({ inputTokens: 6000, outputTokens: 1024, items: 5, windowsPerItem: 4, contentUnits: 600 }) };
}

// This does not promote a prompt. Unknown semantic review blocks even further consideration.
export function advancementEvidence(rows, semanticReview) {
  rows = snapshotJson(rows, { bytes: 16_000, nodes: 1024, depth: 4 }, 'invalid_ablation_rows');
  if (!Array.isArray(rows) || rows.length !== 24) throw new Error('invalid_ablation_rows');
  const slots = new Set();
  const fields = ['ordinal', 'arm', 'status', 'beyondCapacity', 'directTotal', 'directRetained',
    'assistantTotal', 'assistantRetained', 'semanticCorrectness', 'capsUnchanged'];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== fields.length ||
        fields.some(field => !Object.hasOwn(row, field)) ||
        !Number.isSafeInteger(row.ordinal) || row.ordinal < 1 || row.ordinal > 12 ||
        !['baseline', 'candidate'].includes(row.arm) || slots.has(`${row.ordinal}:${row.arm}`)) {
      throw new Error('invalid_ablation_rows');
    }
    const rubric = sourceRoleRubric[row.ordinal - 1];
    if (row.beyondCapacity !== rubric.beyondCapacity || row.directTotal !== rubric.eligibleDirectEpisodes.length ||
        row.assistantTotal !== rubric.requiredAssistantEvidence.length ||
        !['completed', 'refused'].includes(row.status) || row.semanticCorrectness !== 'unassessed' ||
        typeof row.capsUnchanged !== 'boolean' ||
        ['direct', 'assistant'].some(kind => !Number.isSafeInteger(row[`${kind}Retained`]) ||
          row[`${kind}Retained`] < 0 || row[`${kind}Retained`] > row[`${kind}Total`] ||
          (row.status === 'refused' && row[`${kind}Retained`] !== 0)) ||
        (rubric.beyondCapacity && row.directRetained > 20)) throw new Error('invalid_ablation_rows');
    slots.add(`${row.ordinal}:${row.arm}`);
  }
  const sum = (arm, field, overCapacity = false) => rows.filter(row => row.arm === arm &&
    sourceRoleRubric[row.ordinal - 1].beyondCapacity === overCapacity).reduce((total, row) => total + row[field], 0);
  const additionalDirect = sum('candidate', 'directRetained') - sum('baseline', 'directRetained');
  const structuralFailures = arm => rows.filter(row => row.arm === arm && row.status !== 'completed').length;
  const assistantLoss = sourceRoleRubric.some(({ ordinal }) => {
    const pair = rows.filter(row => row.ordinal === ordinal);
    return pair.find(row => row.arm === 'candidate').assistantRetained <
      pair.find(row => row.arm === 'baseline').assistantRetained;
  });
  semanticReview = snapshotJson(semanticReview ?? { status: 'unknown', reviewedSlots: 0,
    baselineUnsupportedPromotions: null, candidateUnsupportedPromotions: null },
  { bytes: 1024, nodes: 32, depth: 2 }, 'invalid_semantic_review');
  const reviewFields = ['status', 'reviewedSlots', 'baselineUnsupportedPromotions', 'candidateUnsupportedPromotions'];
  if (!semanticReview || typeof semanticReview !== 'object' || Array.isArray(semanticReview) ||
      Object.keys(semanticReview).length !== reviewFields.length ||
      reviewFields.some(field => !Object.hasOwn(semanticReview, field)) ||
      (semanticReview.status === 'unknown' ? semanticReview.reviewedSlots !== 0 ||
        semanticReview.baselineUnsupportedPromotions !== null || semanticReview.candidateUnsupportedPromotions !== null
        : semanticReview.status !== 'independent-blind-reviewed' || semanticReview.reviewedSlots !== 24 ||
          ['baseline', 'candidate'].some(arm => !Number.isSafeInteger(semanticReview[`${arm}UnsupportedPromotions`]) ||
            semanticReview[`${arm}UnsupportedPromotions`] < 0 || semanticReview[`${arm}UnsupportedPromotions`] > 60))) {
    throw new Error('invalid_semantic_review');
  }
  const semanticAccepted = semanticReview.status === 'independent-blind-reviewed' &&
    semanticReview.candidateUnsupportedPromotions === 0;
  const candidateRequiredMissing = sum('candidate', 'assistantTotal') - sum('candidate', 'assistantRetained');
  const capsUnchanged = rows.every(row => row.capsUnchanged);
  return { additionalDirect, assistantLoss,
    candidateRequiredMissing, capsUnchanged,
    baselineStructuralFailures: structuralFailures('baseline'),
    candidateStructuralFailures: structuralFailures('candidate'),
    overCapacity: { directTotal: 21, baselineRetained: sum('baseline', 'directRetained', true),
      candidateRetained: sum('candidate', 'directRetained', true) },
    semanticReview: semanticAccepted ? 'reviewed-zero-observed-promotions' : 'unknown-or-not-accepted',
    baselineUnsupportedPromotions: semanticReview.baselineUnsupportedPromotions,
    candidateUnsupportedPromotions: semanticReview.candidateUnsupportedPromotions,
    decision: additionalDirect >= 2 && !assistantLoss && candidateRequiredMissing === 0 && capsUnchanged &&
      structuralFailures('candidate') <= structuralFailures('baseline') && semanticAccepted
      ? 'eligible-for-separate-review-not-prompt-promotion' : 'do-not-advance' };
}
