// Fresh synthetic submitted histories only. Importing this module does no I/O.
import { createHash } from 'node:crypto';

import { opaqueQuestionId } from '../longmemeval/prepare.mjs';

const sourceVersion = 'fresh-source-localization-v1';
const id = (kind, coordinates) => `lme-${kind}-${createHash('sha256')
  .update(JSON.stringify([sourceVersion, kind, coordinates]))
  .digest('hex')}`;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

function longHatchNote() {
  const fieldChecks = Array.from({ length: 11 }, (_, index) =>
    `Inspection ${index + 1}: the crew checked the folding ladder, dry cloths, lens cap, storage crate, and sign-out sheet before closing the dome.`);
  return [
    'Community observatory maintenance log: the north and west hatches were inspected first. No parts were assigned to those hatches in this note.',
    ...fieldChecks.slice(0, 6),
    'For the east hatch of the telescope dome, use a 3 mm blue silicone gasket. This is the specified replacement part for that hatch.',
    ...fieldChecks.slice(6),
    'The team placed the ladder and cloths back in the locked equipment room.',
  ].join(' ');
}

const specs = [
  {
    sourceId: 'fresh_observatory_hatch_v1',
    question: 'What gasket material, color, and thickness did the observatory log specify for the east hatch?',
    dates: ['2025/06/02 (Mon) 09:00', '2025/06/09 (Mon) 09:00',
      '2025/06/16 (Mon) 09:00', '2025/06/23 (Mon) 09:00'],
    questionDate: '2025/06/24 (Tue) 10:00',
    facts: {
      '0:3': longHatchNote(),
      '1:8': 'The volunteer opened the observatory maintenance binder to check which hatches had separate entries; no new part was ordered in this session.',
      '3:9': 'The dome was closed after routine cleaning, and the equipment room inventory was signed.',
    },
    filler: (session, turn) => `Observatory work note ${session + 1}.${turn + 1}: volunteers checked visitor signs, cleaning cloths, ladder storage, and the dome booking calendar.`,
  },
  {
    sourceId: 'fresh_bookmobile_checkin_v1',
    question: 'Which check-in method did Imani ultimately adopt for the bookmobile, and what two reasons did she give?',
    dates: ['2025/06/02 (Mon) 09:00', '2025/06/09 (Mon) 09:00',
      '2025/06/16 (Mon) 09:00', '2025/06/23 (Mon) 09:00'],
    questionDate: '2025/06/24 (Tue) 10:00',
    facts: {
      '0:2': 'Imani chose printed number tickets for the bookmobile check-in desk because the first stop had a fixed waiting area.',
      '1:10': 'A volunteer proposed text-message check-in codes for the moving bookmobile. Imani said she would decide after the next route rehearsal.',
      '2:5': 'The rehearsal showed that the van could move between stops during the afternoon; this observation alone was not a decision.',
      '3:4': 'Imani: I am adopting text-message check-in codes instead of printed number tickets for the bookmobile. Volunteers can update the queue when the van moves, and they will not have to reprint tickets damaged by rain. Those are my two reasons.',
    },
    filler: (session, turn) => `Bookmobile operations note ${session + 1}.${turn + 1}: the crew checked shelf latches, return bins, route signs, and book carts before service.`,
  },
  {
    sourceId: 'fresh_field_recorder_v1',
    question: 'After the cold-weather battery measurement, what is the status of Leila’s recorder choice for the owl survey, and did she adopt the proposed Cedar R2?',
    dates: ['2025/06/02 (Mon) 09:00', '2025/06/09 (Mon) 09:00',
      '2025/06/16 (Mon) 09:00', '2025/06/23 (Mon) 09:00'],
    questionDate: '2025/06/24 (Tue) 10:00',
    facts: {
      '0:1': 'Leila decided to use the Lark R4 field recorder for the unattended winter owl survey. Her stated reason was the supplier claim that its battery would last 72 hours unattended.',
      '1:11': 'Leila kept the Lark R4 on the survey equipment list while the 72-hour unattended battery claim was still her planning assumption.',
      '2:7': 'At minus five degrees Celsius, the team measured only 18 hours of unattended battery operation from the Lark R4. This changes the battery-life premise Leila used for her recorder choice; Leila has made no replacement decision.',
      '3:2': 'A colleague proposed the Cedar R2 recorder. Leila replied that she would review it but had not adopted Cedar R2 or cancelled the owl survey.',
    },
    filler: (session, turn) => `Owl survey logistics note ${session + 1}.${turn + 1}: the team counted weather covers, marked observation stations, and packed blank field sheets.`,
  },
  {
    sourceId: 'fresh_river_photo_show_v1',
    question: '河口攝影展哪一天已確認開幕？七月二十日匯入紀錄與七月二十六日加場提議，各是什麼狀態？',
    dates: ['2025/07/07 (Mon) 09:00', '2025/07/14 (Mon) 09:00',
      '2025/07/21 (Mon) 09:00', '2025/07/28 (Mon) 09:00'],
    questionDate: '2025/07/29 (Tue) 10:00',
    facts: {
      '0:1': '河口攝影展的籌備會提到七月十二日開幕，但當時還在等展場回覆，沒有確認。',
      '1:6': '策展人確認：河口攝影展已於 2025 年 7 月 12 日開幕。這是已確認的展覽開幕日期。',
      '2:4': '資料管理員註記：2025 年 7 月 20 日是把 6 月 30 日舊會議筆記匯入資料庫的日期，不是攝影展開幕日期。',
      '2:11': '這份於 7 月 20 日匯入的舊筆記記載：有人提議 2025 年 7 月 26 日辦加場導覽；策展人尚未採納或確認。',
      '3:8': '志工整理照片與標籤；策展人表示目前沒有核准加場導覽的通知。',
    },
    filler: (session, turn) => `河口攝影展庶務 ${session + 1}.${turn + 1}：志工核對相框、展架、動線與借用清單；這筆紀錄沒有新增展期決定。`,
  },
];

function sourceCase(spec) {
  const questionId = opaqueQuestionId(spec.sourceId);
  return {
    history: { question_id: questionId,
      sessions: spec.dates.map((date, sessionIndex) => ({
        session_index: sessionIndex,
        session_id: id('session', [spec.sourceId, sessionIndex]), date,
        turns: Array.from({ length: 15 }, (_, turnIndex) => ({
          turn_id: id('turn', [spec.sourceId, sessionIndex, turnIndex]), role: 'user',
          content: spec.facts[`${sessionIndex}:${turnIndex}`]
            ?? spec.filler(sessionIndex, turnIndex),
        })),
      })),
    },
    question: { question_id: questionId, text: spec.question, date: spec.questionDate },
    namespace: { ownerId: 'fresh-localization-synthetic', scope: 'project', projectId: questionId },
  };
}

export const sourceCases = freeze(specs.map(sourceCase));
export const armOrders = freeze([
  ['cairn', 'mem0'], ['mem0', 'cairn'], ['cairn', 'mem0'], ['mem0', 'cairn'],
]);

// Canonical-window coordinates are fixed from the offline indexed-evidence planner.
// The cues are source substrings, never evaluator labels or expected answers.
export const sourceProbes = freeze([
  { batchIndex: 0, windowIndex: 4, routingCue: 'For the east hatch of the telescope dome, use a 3 mm blue silicone gasket.' },
  { batchIndex: 3, windowIndex: 4, routingCue: 'I am adopting text-message check-in codes instead of printed number tickets' },
  { batchIndex: 2, windowIndex: 7, routingCue: 'At minus five degrees Celsius, the team measured only 18 hours' },
  { batchIndex: 1, windowIndex: 6, routingCue: '河口攝影展已於 2025 年 7 月 12 日開幕' },
]);
