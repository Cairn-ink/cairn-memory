// Load only after generation has been durably recorded. Never import from preflight.
import { sourceCases } from './localization-source-cases.mjs';

const answers = [
  {
    sourceQuestionId: 'fresh_observatory_hatch_v1',
    questionType: 'single-session-user',
    referenceAnswer: 'The east hatch uses a 3 mm blue silicone gasket.',
    evidence: [[0, 3]],
    supportedFacts: [
      'The specified replacement part for the east hatch is a gasket.',
      'Its material is silicone, its color is blue, and its thickness is 3 mm.',
    ],
    forbiddenInferences: [
      'Assigning this part to the north or west hatch.',
      'Substituting a surrounding maintenance item for the gasket.',
    ],
  },
  {
    sourceQuestionId: 'fresh_bookmobile_checkin_v1',
    questionType: 'knowledge-update',
    referenceAnswer: 'Imani adopted text-message check-in codes instead of printed number tickets. Her stated reasons were that volunteers could update the queue when the van moves and would not have to reprint rain-damaged tickets.',
    evidence: [[0, 2], [1, 10], [3, 4]],
    supportedFacts: [
      'Printed number tickets were Imani’s initial choice.',
      'Text-message codes were proposed before Imani made a later explicit decision.',
      'Imani adopted text-message codes, citing queue updates when the van moves and avoiding reprints of rain-damaged tickets.',
    ],
    forbiddenInferences: [
      'Treating the volunteer’s proposal as Imani’s adoption.',
      'Presenting the first stop’s fixed waiting area as a reason for the later text-message decision.',
    ],
  },
  {
    sourceQuestionId: 'fresh_field_recorder_v1',
    questionType: 'knowledge-update',
    referenceAnswer: 'Leila’s choice of the Lark R4 for the winter owl survey needs reconfirmation: it relied on a 72-hour unattended battery claim, but the team measured only 18 hours at minus five degrees Celsius. Cedar R2 was proposed but not adopted; Leila did not cancel the survey.',
    evidence: [[0, 1], [2, 7], [3, 2]],
    supportedFacts: [
      'Leila initially adopted the Lark R4 for the winter owl survey, relying on a supplier claim of 72 hours unattended battery life.',
      'The team later measured only 18 hours of unattended operation at minus five degrees Celsius; this challenges the stated planning premise.',
      'Leila made no replacement decision, did not adopt Cedar R2, and did not cancel the survey.',
    ],
    forbiddenInferences: [
      'Treating the cold-weather result as a measurement at every temperature or as proof of a general battery specification.',
      'Claiming Leila switched automatically to Cedar R2 or cancelled the owl survey.',
      'Claiming the original Lark R4 decision never existed.',
    ],
  },
  {
    sourceQuestionId: 'fresh_river_photo_show_v1',
    questionType: 'multi-session',
    referenceAnswer: '已確認的河口攝影展開幕日期是 2025 年 7 月 12 日。2025 年 7 月 20 日只是舊會議筆記的匯入日期，並非開幕日期；2025 年 7 月 26 日的加場導覽只是尚未採納或確認的提議。',
    evidence: [[1, 6], [2, 4], [2, 11], [3, 8]],
    supportedFacts: [
      '2025-07-12 is the confirmed exhibition opening date.',
      '2025-07-20 is an import date for an older meeting note, not the opening date.',
      '2025-07-26 is the date of a proposed extra tour, which the curator had not adopted or confirmed.',
    ],
    forbiddenInferences: [
      'Treating the import date as the exhibition opening.',
      'Treating the proposed extra tour as confirmed or adopted.',
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
