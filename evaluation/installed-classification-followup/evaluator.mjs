import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../longmemeval/prepare.mjs';

// This file is a separately loaded answer key. It does not import source history.
const workshopSourceId = 'm1e_workshop_drying_rack_v1';
const logisticsSourceId = 'm1e_cold_chain_dock_v1';
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const window = (key, session, turn, source_text, role) => ({
  session_id: opaqueSessionId(key, session),
  turn_id: stableTurnIdV2(key, session, turn),
  source_text,
  role,
});

const workshopWindows = [
  window(workshopSourceId, 1, 5,
    'Studio lead Mara adopted the east-wall fixed rack for wet-glaze drying at the kiln workshop. The reason was to keep wet pieces clear of the firing-cart route.', 'earlier_adopted_choice_and_reason'),
  window(workshopSourceId, 9, 5,
    'Facilities found an HVAC drip above the east-wall rack; two test tiles were damp beneath it. That location no longer keeps glaze work dry.', 'changed_condition'),
  window(workshopSourceId, 12, 5,
    'Mara adopted rolling rack bay C instead of the east-wall fixed rack for wet-glaze drying. Bay C avoids the HVAC drip while leaving the firing-cart route clear.', 'later_adopted_replacement_and_reason'),
  window(workshopSourceId, 14, 5,
    'At the shared-kiln check, Mara confirmed that rolling rack bay C remains the adopted wet-glaze drying location. The east-wall rack is for dry tools only.', 'current_reaffirmation'),
];
const logisticsWindows = [
  window(logisticsSourceId, 2, 5,
    '值班主管雅雯決定夜間冷鏈出貨使用四號月台，理由是該月台當時有獨立備援電源，可讓待裝貨的冷藏車維持供電。', 'earlier_adopted_choice_and_reason'),
  window(logisticsSourceId, 11, 5,
    '設施組確認四號月台的獨立備援電源已拆除；原先以備援供電為由選用四號月台的前提，現在不再成立。', 'supporting_premise_no_longer_applies'),
  window(logisticsSourceId, 13, 5,
    '有人提議改用六號月台，但雅雯只要求評估電源與車流，尚未決定採用六號月台或任何替代月台。', 'unadopted_alternative'),
  window(logisticsSourceId, 15, 5,
    '雅雯表示四號月台是先前已採用的安排，現因備援電源變動需要重新確認；目前沒有核准新的夜間出貨月台。', 'needs_reconfirmation_no_replacement'),
];

export const sourceWindowExpectations = freeze({
  [opaqueQuestionId(workshopSourceId)]: workshopWindows,
  [opaqueQuestionId(logisticsSourceId)]: logisticsWindows,
});

export const evaluatorRows = freeze([
  {
    question_id: opaqueQuestionId(workshopSourceId),
    source_question_id: workshopSourceId,
    question_type: 'multi-session',
    reference_answer: 'Mara first adopted the east-wall fixed rack for wet-glaze drying to keep pieces out of the firing-cart route. After an HVAC drip made that rack unsuitable, she explicitly adopted rolling rack bay C because it avoids the drip while preserving cart clearance. Bay C was later reaffirmed as current.',
    answer_session_ids: [1, 9, 12, 14].map(index => opaqueSessionId(workshopSourceId, index)),
    turn_labels: workshopWindows.map(({ turn_id }) => ({ turn_id, has_answer: true })),
  },
  {
    question_id: opaqueQuestionId(logisticsSourceId),
    source_question_id: logisticsSourceId,
    question_type: 'knowledge-update',
    reference_answer: '雅雯先前已決定夜間冷鏈出貨使用四號月台，當時理由是獨立備援電源可維持冷藏車供電。後來備援電源已拆除，原理由不再適用，這項既有決策需要重新確認。六號月台只是提議，尚未採用，也沒有任何新月台獲核准。',
    answer_session_ids: [2, 11, 13, 15].map(index => opaqueSessionId(logisticsSourceId, index)),
    turn_labels: logisticsWindows.map(({ turn_id }) => ({ turn_id, has_answer: true })),
  },
]);

export const rubric = freeze([
  {
    question_id: opaqueQuestionId(workshopSourceId),
    required: [
      'Identify the east-wall fixed rack as an earlier adopted choice, with the firing-cart clearance rationale.',
      'Identify the HVAC drip as the later problem affecting that rack.',
      'Identify rolling rack bay C as an explicitly adopted replacement, not a mere suggestion.',
      'Give the recorded replacement rationale: avoid the drip and preserve firing-cart clearance.',
      'Tie the current claim to the later reaffirmation.',
    ],
    disallow: [
      'Treat the east-wall fixed rack as still adopted for wet-glaze drying.',
      'Describe bay C as only proposed or infer a different current rack.',
      'Invent a safety, cost, or staffing rationale absent from the source.',
    ],
  },
  {
    question_id: opaqueQuestionId(logisticsSourceId),
    required: [
      'Identify dock four as an originally adopted night cold-chain dispatch choice.',
      'State the original backup-power rationale in its past scope.',
      'State that removal of independent backup power invalidated the supporting premise.',
      'Describe the adopted original decision as needing reconfirmation without claiming it was never adopted.',
      'State that dock six and any other replacement remain unadopted.',
    ],
    disallow: [
      'Present dock six as the current adopted dock.',
      'Erase the original dock-four adoption or call it only a proposal.',
      'Assert an automatic cancellation or a newly adopted replacement.',
    ],
  },
]);
