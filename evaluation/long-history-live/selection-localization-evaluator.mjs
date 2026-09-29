// Load only after generation is durably recorded. Never import from preflight.
import { sourceCases } from './selection-localization-source-cases.mjs';

const answers = [
  {
    sourceQuestionId: 'fresh_harbor_beacon_h7_v1',
    questionType: 'knowledge-update',
    referenceAnswer: 'Beacon H7 adopted 06:00 and 18:00 uploads because the shore gateway was available only during those patrol windows. The gateway later became available throughout the day, but no replacement cadence has been approved; the original schedule remains in use pending review.',
    evidence: [[3, 0], [11, 0], [13, 0]],
    supportedFacts: [
      'The adopted H7 upload cadence was 06:00 and 18:00.',
      'The stated original reason was limited shore-gateway availability during those patrol windows.',
      'Later continuous gateway availability invalidated that original availability premise; no replacement cadence was approved and the adopted schedule remains in use pending review.',
    ],
    forbiddenInferences: [
      'Claiming a new upload cadence was adopted automatically when gateway availability changed.',
      'Presenting the later uptime test as the original reason for the 06:00 and 18:00 decision.',
      'Claiming the original cadence was cancelled or never adopted.',
    ],
  },
  {
    sourceQuestionId: 'fresh_community_pantry_tokens_v1',
    questionType: 'knowledge-update',
    referenceAnswer: '青禾食物站目前以 QR 碼為主要領取憑證。最初採用紙本號碼牌，是因領取室當時沒有可用網路；後來本地終端可離線掃碼並在恢復連線後同步，主管正式改採 QR 碼。紙本號碼牌仍保留作故障備援。',
    evidence: [[2, 1], [9, 0], [11, 0]],
    supportedFacts: [
      'The original adopted pickup credential was a paper number token because the pickup room then had no usable network.',
      'A local terminal later passed offline scanning and delayed synchronization tests.',
      'The supervisor explicitly adopted QR codes as the primary credential, with paper tokens retained only as an outage fallback.',
    ],
    forbiddenInferences: [
      'Treating the local-terminal test alone as adoption of QR codes.',
      'Claiming the paper token is still the primary credential or was completely discontinued.',
      'Claiming network access existed in the pickup room when paper tokens were first chosen.',
    ],
  },
  {
    sourceQuestionId: 'fresh_ridge_shuttle_last_trip_v1',
    questionType: 'knowledge-update',
    referenceAnswer: 'No 20:30 Ridge Shuttle last departure was adopted. The planner proposed it because the festival was expected to end at 20:00, but the event end changed to 19:00 and the board later deferred the proposal without changing the current timetable.',
    evidence: [[4, 0], [10, 0], [13, 0]],
    supportedFacts: [
      'A 20:30 last departure was proposed, not adopted, because the festival was expected to end at 20:00.',
      'The festival organizer later changed the event end time to 19:00.',
      'The board deferred the proposal and did not adopt a later last departure or change the current timetable.',
    ],
    forbiddenInferences: [
      'Claiming the proposal was an adopted shuttle timetable.',
      'Claiming the earlier proposal was originally based on the later 19:00 end time.',
      'Inferring a new departure time from the changed event schedule.',
    ],
  },
];

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const evaluatorRows = freeze(answers.map((answer, index) => {
  const source = sourceCases[index];
  return {
    question_id: source.question.question_id,
    source_question_id: answer.sourceQuestionId,
    question_type: answer.questionType,
    reference_answer: answer.referenceAnswer,
    answer_session_ids: [...new Set(answer.evidence.map(([session]) =>
      source.history.sessions[session].session_id))],
    turn_labels: answer.evidence.map(([session, turn]) => ({
      turn_id: source.history.sessions[session].turns[turn].turn_id,
      has_answer: true,
    })),
  };
}));

export const rubric = freeze(answers.map(answer => ({
  sourceQuestionId: answer.sourceQuestionId,
  supportedFacts: answer.supportedFacts,
  forbiddenInferences: answer.forbiddenInferences,
})));
