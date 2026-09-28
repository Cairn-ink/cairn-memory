// Synthetic submitted histories only. Importing this module performs no I/O or dispatch.
import { createHash } from 'node:crypto';

import { opaqueQuestionId } from '../longmemeval/prepare.mjs';

const id = (kind, coordinates) => `lme-${kind}-${createHash('sha256')
  .update(JSON.stringify(['long-history-live-v1', kind, coordinates]))
  .digest('hex')}`;
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const dates = {
  january: ['2024/01/01 (Mon) 09:00', '2024/01/08 (Mon) 09:00',
    '2024/01/15 (Mon) 09:00', '2024/01/22 (Mon) 09:00'],
  april: ['2025/04/07 (Mon) 09:00', '2025/04/14 (Mon) 09:00',
    '2025/05/05 (Mon) 09:00', '2025/05/12 (Mon) 09:00'],
};

function longArchiveNote() {
  const context = (part) => Array.from({ length: 9 }, (_, index) =>
    `Archive ${part} shelf ${index + 1}: the volunteer compared envelope stock, drying racks, label spacing, and the courier's ordinary packing sequence.`).join(' ');
  return [
    'Field note, FRONT checkpoint: the dawn drawer uses the moss-green ceramic key.',
    context('north'),
    'Field note, MIDDLE checkpoint: the noon drawer uses the brass spiral clip.',
    context('central'),
    'Field note, TAIL checkpoint: the dusk drawer uses the violet wax seal.',
  ].join(' ');
}

const cases = [
  {
    sourceId: 'lh_live_archive_drawers_v1',
    question: 'For the dawn, noon, and dusk archive drawers, which three objects were specified, in that order?',
    dates: dates.january,
    facts: { '0:0': longArchiveNote(),
      '1:7': 'The drawer inventory still uses dawn, noon, and dusk as distinct labels; the packing checklist did not rename them.',
      '3:14': 'The archive drawer handoff was logged. This note does not revise the three checkpoint objects.' },
    filler: (session, turn) => `Archive logistics note ${session + 1}.${turn + 1}: the team checked shelf spacing, paper sleeves, drying time, and numbered trays for the community exhibit.`,
  },
  {
    sourceId: 'lh_live_gallery_route_v1',
    question: 'Which route did Mara ultimately adopt for the gallery audio tour, and what two stated reasons supported that decision?',
    dates: dates.january,
    facts: {
      '0:0': 'Mara decided to use the Harbor Loop for the gallery audio tour because its printed map was already prepared. This is the initial route decision.',
      '1:6': 'The staff measured the Harbor Loop and the newer Orchard Walk; the measurements alone do not change Mara’s route choice.',
      '2:8': 'A guide proposed switching the tour to Orchard Walk. Mara said she would decide after reviewing the accessibility notes; this was a proposal, not approval.',
      '3:4': 'Mara: I am adopting Orchard Walk for the gallery audio tour instead of Harbor Loop. The quieter crossing makes spoken directions audible, and the ramp stays open during the evening program. These are my reasons for the change.',
      '3:14': 'The final route packet labels Orchard Walk as Mara’s adopted tour route; no subsequent route change is recorded.',
    },
    filler: (session, turn) => `Gallery operations note ${session + 1}.${turn + 1}: docents checked headset charging, wall labels, visitor flow, and microphone storage before the next public tour.`,
  },
  {
    sourceId: 'lh_live_seed_library_v1',
    question: 'After the room update, what is the status of Niko’s Saturday seed-library plan, and was Ferry Hall adopted?',
    dates: dates.january,
    facts: {
      '0:0': 'Niko decided on a Saturday seed-library pop-up at Alder Hall. The decision relied on Alder Hall being available without a room fee.',
      '1:11': 'Niko reaffirmed the Saturday seed-library pop-up at Alder Hall while its no-fee room booking was still expected.',
      '2:6': 'The Alder Hall coordinator reported that the no-fee room is unavailable for that Saturday. This changes the premise behind Niko’s venue decision; Niko has not issued a replacement decision.',
      '3:2': 'A neighbor suggested Ferry Hall as an alternative. Niko replied: I will review it, but I have not chosen Ferry Hall or cancelled the pop-up.',
      '3:14': 'Volunteers completed the seed-packet inventory and marked the venue signage draft as pending.',
    },
    filler: (session, turn) => `Seed-library preparation note ${session + 1}.${turn + 1}: volunteers sorted envelopes, counted blank labels, checked tables, and drafted a nonbinding supply list.`,
  },
  {
    sourceId: 'lh_live_lanbridge_walk_v1',
    question: '蘭橋步道導覽哪一天已確認舉行？五月三日的匯入紀錄，以及四月十九日的提議，各代表什麼狀態？',
    dates: dates.april,
    facts: {
      '0:0': '蘭橋步道導覽的初步討論提到四月十二日，但當時尚未確認；工作小組正在等場地回覆。',
      '1:9': '主辦人確認：蘭橋步道導覽的活動日期是 2025 年 4 月 12 日。這是已確認的活動日期。',
      '2:3': '資料管理員記錄：2025 年 5 月 3 日是把舊活動紀錄匯入資料庫的日期，並非導覽舉行日期。',
      '2:10': '於 2025 年 5 月 3 日匯入的 4 月 9 日會議筆記記載：有人提議 2025 年 4 月 19 日再辦一場延伸導覽；主辦人當時尚未決定。',
      '3:14': '主辦人確認目前沒有第二場導覽的核定通知；志工仍在整理導覽路線照片。',
    },
    filler: (session, turn) => `蘭橋步道工作筆記 ${session + 1}.${turn + 1}：志工核對指示牌、集合點、導覽耳機與無障礙路線；這筆庶務紀錄沒有新增活動日期。`,
  },
];

function sourceCase(spec, caseIndex) {
  const questionId = opaqueQuestionId(spec.sourceId);
  const sessions = spec.dates.map((date, sessionIndex) => ({
    session_index: sessionIndex,
    session_id: id('session', [spec.sourceId, sessionIndex]),
    date,
    turns: Array.from({ length: 15 }, (_, turnIndex) => ({
      turn_id: id('turn', [spec.sourceId, sessionIndex, turnIndex]),
      role: 'user',
      content: spec.facts[`${sessionIndex}:${turnIndex}`]
        ?? spec.filler(sessionIndex, turnIndex),
    })),
  }));
  return { history: { question_id: questionId, sessions },
    question: { question_id: questionId, text: spec.question,
      date: caseIndex === 3 ? '2025/05/13 (Tue) 10:00' : '2024/01/23 (Tue) 10:00' },
    namespace: { ownerId: 'long-history-live-synthetic', scope: 'project',
      projectId: questionId } };
}

export const sourceCases = freeze(cases.map(sourceCase));
export const armOrders = Object.freeze([
  Object.freeze(['cairn', 'mem0']), Object.freeze(['mem0', 'cairn']),
  Object.freeze(['cairn', 'mem0']), Object.freeze(['mem0', 'cairn']),
]);
