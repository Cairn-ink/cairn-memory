// Authored answers and manual checks. This module must be loaded only after generation is durable.
import { sourceCases } from './source-cases.mjs';

const sourceIds = [
  'lh_live_archive_drawers_v1', 'lh_live_gallery_route_v1',
  'lh_live_seed_library_v1', 'lh_live_lanbridge_walk_v1',
];

const answers = [
  {
    question_type: 'single-session-user',
    reference_answer: 'Dawn: moss-green ceramic key; noon: brass spiral clip; dusk: violet wax seal.',
    evidence: [[0, 0]],
    supportedFacts: [
      'Dawn drawer: moss-green ceramic key, near the front of the long original message.',
      'Noon drawer: brass spiral clip, near the middle of the same message.',
      'Dusk drawer: violet wax seal, near the tail of the same message.',
    ],
    forbiddenInferences: ['Treating the three drawers as interchangeable.',
      'Substituting the surrounding archive logistics for a checkpoint object.'],
  },
  {
    question_type: 'knowledge-update',
    reference_answer: 'Mara adopted Orchard Walk instead of Harbor Loop because its quieter crossing makes spoken directions audible and its ramp stays open during the evening program.',
    evidence: [[0, 0], [2, 8], [3, 4]],
    supportedFacts: [
      'Harbor Loop was the initial adopted route.',
      'Orchard Walk was proposed before Mara decided.',
      'Mara later explicitly adopted Orchard Walk and stated two reasons: audible directions at its quieter crossing and an open ramp during the evening program.',
    ],
    forbiddenInferences: ['Treating the guide’s proposal alone as adoption.',
      'Claiming the prepared printed map was a reason for the later Orchard Walk decision.'],
  },
  {
    question_type: 'knowledge-update',
    reference_answer: 'Niko’s Saturday seed-library plan at Alder Hall needs reconfirmation because the no-fee room is unavailable. Ferry Hall was only suggested and has not been adopted; Niko also did not cancel the pop-up.',
    evidence: [[0, 0], [2, 6], [3, 2]],
    supportedFacts: [
      'Niko adopted the Saturday Alder Hall pop-up while relying on its no-fee room.',
      'The no-fee room later became unavailable, challenging that premise.',
      'Niko explicitly withheld a replacement choice; Ferry Hall is only a suggestion and the pop-up was not cancelled.',
    ],
    forbiddenInferences: ['Claiming Ferry Hall was adopted.',
      'Claiming the pop-up was cancelled or automatically moved.',
      'Treating the changed room premise as proof that the original decision never existed.'],
  },
  {
    question_type: 'multi-session',
    reference_answer: '已確認的蘭橋步道導覽日期是 2025 年 4 月 12 日；2025 年 5 月 3 日只是舊紀錄匯入資料庫的日期，並非活動日期；2025 年 4 月 19 日是尚未採納、未確認的延伸導覽提議。',
    evidence: [[1, 9], [2, 3], [2, 10], [3, 14]],
    supportedFacts: [
      '2025-04-12 is the confirmed event date.',
      '2025-05-03 is the date an older record was imported, not an event date.',
      '2025-04-19 is an unadopted proposal for an additional event.',
    ],
    forbiddenInferences: ['Treating the import date as the event date.',
      'Treating the proposed additional event as confirmed or adopted.'],
  },
];

export const evaluatorRows = Object.freeze(answers.map((answer, index) => {
  const source = sourceCases[index];
  return Object.freeze({ question_id: source.question.question_id,
    source_question_id: sourceIds[index], question_type: answer.question_type,
    reference_answer: answer.reference_answer,
    answer_session_ids: Object.freeze([...new Set(answer.evidence.map(([session]) =>
      source.history.sessions[session].session_id))]),
    turn_labels: Object.freeze(answer.evidence.map(([session, turn]) => Object.freeze({
      turn_id: source.history.sessions[session].turns[turn].turn_id, has_answer: true,
    }))),
  });
}));

export const rubric = Object.freeze(answers.map((answer, index) => Object.freeze({
  sourceQuestionId: sourceIds[index],
  supportedFacts: Object.freeze(answer.supportedFacts),
  forbiddenInferences: Object.freeze(answer.forbiddenInferences),
})));
