import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../longmemeval/prepare.mjs';

// Evaluation-side expectations are authored separately; this module never imports the source histories.
const ids = ['installed-phase-aster-lab-2026-v1', 'installed-phase-fog-harbor-2026-v1'];
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const evaluator = (sourceId, questionType, referenceAnswer, coordinates) => ({
  question_id: opaqueQuestionId(sourceId), source_question_id: sourceId,
  question_type: questionType, reference_answer: referenceAnswer,
  answer_session_ids: [...new Set(coordinates.map(([session]) =>
    opaqueSessionId(sourceId, session)))],
  turn_labels: coordinates.map(([session, turn]) => ({
    turn_id: stableTurnIdV2(sourceId, session, turn), has_answer: true })),
});

export const evaluatorRows = freeze([
  evaluator(ids[0], 'multi-session',
    'Aster Field Lab adopted a numbered ticket board as the record for calibration-request intake, replacing its earlier adopted shared-email-inbox method. The recorded reasons were duplicate replies without a visible owner, a missed weekend handoff because email did not show what a request was waiting for, and the need for ownership and blocked-versus-ready status across shifts. The inbox remained a notification channel, not the intake record.',
    [[0, 3], [2, 14], [4, 7], [5, 17], [6, 20], [7, 23], [8, 11], [10, 25], [12, 4], [15, 19]]),
  evaluator(ids[1], 'knowledge-update',
    'The Thursday 21:00 opening extension was an adopted decision, supported in part by the then-21:30 shuttle departure. The shuttle was later moved to 19:10, so that supporting transport premise no longer applies and the extension needs reconfirmation. The record does not show adoption of a replacement closing time; an old posted schedule alone is not a new vote or a cancellation.',
    [[0, 10], [2, 21], [4, 6], [7, 16], [10, 27], [12, 9], [14, 18], [15, 29]]),
]);

export const rubric = freeze([
  { question_id: opaqueQuestionId(ids[0]),
    required: ['adopted numbered ticket board', 'earlier shared inbox was an adopted pilot method',
      'duplicate replies and invisible ownership', 'blocked/ready visibility across handoffs'],
    disallow: ['mailbox remained the authoritative intake record',
      'ticket-board trial alone established adoption'] },
  { question_id: opaqueQuestionId(ids[1]),
    required: ['recorded Thursday extension was adopted', 'shuttle premise changed',
      'reconfirmation is needed', 'no replacement closing time was adopted'],
    disallow: ['the extension was automatically cancelled',
      'the posted old schedule proves a fresh decision', 'a new time was adopted'] },
]);
