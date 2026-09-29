import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../longmemeval/prepare.mjs';

// Fresh authored operational histories. Nothing here is an evaluation answer or instruction to memory.
const identifiers = ['installed-phase-aster-lab-2026-v1', 'installed-phase-fog-harbor-2026-v1'];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const owners = ['Mara', 'Ivo', 'Leena', 'Pavel', 'Nia', 'Omar', 'Ruth', 'Sora'];
const zones = ['north bench', 'sample room', 'loading desk', 'reference cabinet'];
const shifts = ['morning', 'midday', 'late', 'weekend'];
const chineseOwners = ['怡君', '志明', '珮雯', '阿哲', '雨涵', '冠宇', '美玲', '書妍'];
const chineseRooms = ['西側展廳', '中庭', '教育室', '入口服務台'];
const chineseShifts = ['早班', '午班', '晚班', '週末班'];
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const dateAt = (firstMonth, firstDay, week, hour = '09:00') => {
  const date = new Date(Date.UTC(2026, firstMonth - 1, firstDay + week * 7));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day} (${weekdays[date.getUTCDay()]}) ${hour}`;
};

function asterNotes(week) {
  const owner = owners[week % owners.length];
  const next = owners[(week + 3) % owners.length];
  const zone = zones[week % zones.length];
  const shift = shifts[week % shifts.length];
  const tag = `week ${week + 1}`;
  return [
    `At the ${zone}, ${owner} checked the reference thermometer against the log; drift was ${week % 4 + 1} tenths of a degree.`,
    `${next} reserved the vibration table for ${shift} tests and left a handoff note with the bench lead.`,
    `The shipping shelf has ${12 + week} padded sleeves; replenishment is due after the next courier collection.`,
    `Calibration requests from the field team numbered ${3 + week % 5} in ${tag}; the dispatcher reconciled the count at noon.`,
    `${owner} marked two humidity probes for cleaning before their next scheduled comparison run.`,
    `The specimen drawer seal was intact at opening, with ${4 + week % 3} signed access entries since Friday.`,
    `A courier pickup for the south site moved to ${10 + week % 4}:30; ${next} updated the loading-desk card.`,
    `The north bench timer passed its ${15 + week % 6}-minute check without a battery warning.`,
    `${next} moved the spare cable reel away from the ${zone} walkway after the safety round.`,
    `The reference weights stayed in cabinet B; ${owner} initialed the chain-of-custody sheet.`,
    `A training pair practiced labeling a temperature logger without opening a live client job.`,
    `The ${shift} handoff listed ${2 + week % 4} instruments awaiting an external part, each with an expected delivery date.`,
    `One field unit arrived with an unreadable sticker; ${next} linked its serial number to the intake manifest.`,
    `The quality notebook now separates measurement readings from comments about equipment condition.`,
    `${owner} counted ${8 + week % 6} unused sample bags and reordered the small clear size.`,
    `The test fixture for model R${2 + week % 4} needs a new foam insert before another transport trial.`,
    `The ${zone} cabinet alarm was checked at opening and again before the ${shift} changeover.`,
    `${next} photographed a loose connector for maintenance, then returned the device to the quarantine shelf.`,
    `The batch label printer produced ${20 + week} legible labels during its monthly ribbon check.`,
    `A visiting technician asked for the latest torque table; ${owner} sent the controlled document link.`,
    `The transfer cart wheels were inspected after the morning run; no replacement was requested.`,
    `The lab's parcel list separates returning instruments from new trial equipment for ${tag}.`,
    `${next} set aside ${1 + week % 3} data loggers that need firmware verification before dispatch.`,
    `The air-filter monitor read ${41 + week % 9} percent at close, below its service threshold.`,
    `The weekly audit sampled ${5 + week % 4} completed certificates and found their serial fields populated.`,
    `${owner} asked facilities to repaint the floor line beside the loading desk before the next open house.`,
    `A packaging trial compared two sleeve thicknesses; the thinner stock bent near the connector cap.`,
    `The shared bench calendar shows ${3 + week % 5} reservations for next Tuesday and one open block.`,
    `${next} logged a repeat reading after a probe had rested at room temperature for an hour.`,
    `The spare-parts ledger records a replacement fuse but no change to the instrument's assigned owner.`,
    `A shelf count found ${6 + week % 5} unopened reagent bottles with labels facing outward.`,
    `The closing checklist says the ${zone} lights and extraction fan were switched off by ${owner}.`,
  ];
}

const asterMilestones = new Map([
  ['0:3', 'The operations council approved the shared email inbox as the pilot intake record for field calibration requests, with a review after the first quarter.'],
  ['2:14', 'Mara expected only four or five calibration requests a week, so a mailbox seemed manageable at the beginning of the pilot.'],
  ['4:7', 'Two technicians answered the same emailed calibration request yesterday because neither could see an assigned owner in the thread.'],
  ['5:17', 'Mara said the duplicate replies show that the next intake method must display one accountable owner for each calibration request.'],
  ['6:20', 'The weekend handoff missed a waiting calibration request: its email subject did not show whether a reference weight or a reviewer was needed.'],
  ['7:23', 'Leena asked that the replacement workflow show whether each request is blocked or ready, so the late and weekend shifts can hand work over safely.'],
  ['8:11', 'Ivo opened a trial ticket for each new calibration request; the board gave each ticket a number and an owner field.'],
  ['10:25', 'Leena could tell from the board which calibration requests were blocked on parts and which were ready for review during the late shift.'],
  ['12:4', 'At today\'s operations council, Mara recorded approval to replace shared-inbox intake with the numbered ticket board from 6 April; the minutes accepted the owner and request-state requirements raised during the pilot.'],
  ['15:19', 'The shared inbox still receives outside notifications, but the dispatcher now puts incoming calibration work onto the board before assigning a technician.'],
]);

function harborNotes(week) {
  const owner = chineseOwners[week % chineseOwners.length];
  const next = chineseOwners[(week + 3) % chineseOwners.length];
  const room = chineseRooms[week % chineseRooms.length];
  const shift = chineseShifts[week % chineseShifts.length];
  return [
    `${owner}檢查${room}的展品標籤，發現${week % 3 + 1}張字體太小，已交給設計組重排。`,
    `${next}為${shift}準備${8 + week % 5}支語音導覽機，並逐一確認耳機插孔。`,
    `本週${room}的照度記錄介於${48 + week}到${53 + week}勒克斯，仍在館內設定範圍。`,
    `入口服務台收到一箱新摺頁，${owner}先核對版本日期再上架。`,
    `雨天動線標示移到中庭靠牆一側，推車仍可通過主要走道。`,
    `${next}把教育室的活動椅排成四列，每列保留一處輪椅迴轉空間。`,
    `志工交接表記錄了${2 + week % 4}件遺失物，沒有物品被直接交給陌生訪客。`,
    `下午的團體參觀比預約少${1 + week % 3}人，導覽員依實到人數調整耳機。`,
    `${owner}清點展櫃密封條，${room}有一條需要下次保養時更換。`,
    `館外告示牌的箭頭被風吹歪，${next}已通知總務固定底座。`,
    `售票紀錄顯示${34 + week * 2}張一般票與${7 + week % 6}張團體票，月底再對帳。`,
    `${shift}的值班鑰匙由${owner}簽收；閉館後要放回服務台保管盒。`,
    `教育組為手作課補充紙膠帶、鉛筆與四種不同尺寸的卡紙。`,
    `${next}測試${room}的字幕播放器，影片結束時能回到待機畫面。`,
    `中庭盆栽移離排水口，避免雨水沿著入口地墊倒流。`,
    `今日導覽先介紹地方地圖再進入模型展區，路線未穿越維修中的側門。`,
    `${owner}把走失協尋卡放在服務台抽屜，並提醒志工不要公開兒童姓名。`,
    `海報輸出店確認${week + 2}號批次可於週五送到，收件人是${next}。`,
    `志工訓練增加一段關於觸摸展品界線的示範，避免口頭規則各說各話。`,
    `${room}的溫溼度感測器更換電池後，資料同步時間縮短到${5 + week % 4}分鐘。`,
    `無障礙坡道的止滑條局部鬆動，總務已安排在開館前補強。`,
    `${next}把工作坊報名表改用較大字級，讓家長能清楚看見集合地點。`,
    `寄物櫃共有${18 + week % 5}格可用，滿櫃時由服務台提供紙本編號。`,
    `新採購的展示布料先在後場測試褪色，尚未鋪進正式展區。`,
    `${owner}核對借展物件的保險清單，序號與入庫照片相符。`,
    `音響工程師量測教育室後排音量，建議把左側喇叭降低一格。`,
    `餐飲攤位週末會提前備餐，但不使用展廳內的插座。`,
    `${next}整理${shift}的訪客提問，常見項目是停車場出口與廁所位置。`,
    `週報附上${room}的清潔簽到表，玻璃內側仍由保護專員處理。`,
    `團體預約窗口提醒學校帶隊者，集合時不要堵住公車站牌前的通道。`,
    `${owner}確認緊急出口旁的手電筒可亮，備用電池另放在防潮盒。`,
    `閉館巡查在${room}找到一本筆記本，交服務台登記而非直接丟棄。`,
  ];
}

const harborMilestones = new Map([
  ['0:10', '企劃會上有人提議週四展館延長開放到二十一時，先蒐集交通與志工排班資料再表決。'],
  ['2:21', '交通組查到海灣接駁車目前週四末班是二十一時三十分，從展館步行到站牌約八分鐘。'],
  ['4:6', '營運委員會依據交通組記錄的週四二十一時三十分末班接駁可載晚間訪客回程，今天表決通過週四開放到二十一時，自三月九日起排入正式開館表。'],
  ['7:16', '三月的週四晚班已有志工簽到，服務台按二十一時閉館的排班表交接鑰匙。'],
  ['10:27', '接駁車營運處來函：四月二十日起，週四末班改為十九時十分；其他日子的班次不在這次公告內。'],
  ['12:9', '交通組提醒館方，原先估算的週四晚間接駁時間已不適用，需要重新核對延長開放的交通條件。'],
  ['14:18', '五月營運會議只把週四交通議題列為待討論事項，沒有就新的閉館時段進行表決。'],
  ['15:29', '服務台的舊版週四時刻牌仍寫二十一時；行政組要求更新前先核對委員會紀錄。'],
]);

function buildCase(sourceId, firstMonth, firstDay, questionText, notes, milestones) {
  const questionId = opaqueQuestionId(sourceId);
  const sessions = Array.from({ length: 16 }, (_, sessionIndex) => {
    const lines = notes(sessionIndex);
    if (lines.length !== 32) throw new Error('invalid_installed_phase_fixture');
    const turns = lines.map((content, turnIndex) => ({
      turn_id: stableTurnIdV2(sourceId, sessionIndex, turnIndex), role: 'user',
      content: milestones.get(`${sessionIndex}:${turnIndex}`) ?? content,
    }));
    return { session_index: sessionIndex,
      session_id: opaqueSessionId(sourceId, sessionIndex),
      date: dateAt(firstMonth, firstDay, sessionIndex), turns };
  });
  return { history: { question_id: questionId, sessions },
    question: { question_id: questionId, text: questionText,
      date: dateAt(firstMonth, firstDay, 16) },
    namespace: { ownerId: 'installed-phase-synthetic', scope: 'project', projectId: questionId } };
}

export const sourceCases = freeze([
  buildCase(identifiers[0], 1, 5,
    'By late April, which calibration-request intake method had Aster Field Lab adopted in place of its earlier method, and what recorded operational reasons led to that change?',
    asterNotes, asterMilestones),
  buildCase(identifiers[1], 2, 2,
    '接駁車週四末班改為十九時十分後，霧港展館原本延長到二十一時的決議應如何描述？紀錄中有沒有採納新的閉館時段？',
    harborNotes, harborMilestones),
]);

export const armOrders = freeze([['cairn', 'mem0'], ['mem0', 'cairn']]);
