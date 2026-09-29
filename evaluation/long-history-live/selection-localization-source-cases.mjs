// Fresh synthetic submitted histories only. Importing this module does no I/O.
import { createHash } from 'node:crypto';

import { opaqueQuestionId } from '../longmemeval/prepare.mjs';

const sourceVersion = 'fresh-selection-localization-v1';
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

// One session per week. Each pair is two distinct operational statements, not
// a repeated answer or padding. Every statement is shorter than one window.
const specs = [
  {
    sourceId: 'fresh_harbor_beacon_h7_v1',
    question: 'For Beacon H7, what upload cadence was adopted, why was it originally chosen, and what is its status after shore-gateway availability changed?',
    turns: [
      ['Beacon H7 is the harbor-mouth buoy used for wave-height alerts; Pier C staff own its daily operations log.',
        'A west-channel buoy has a separate salinity feed; its records must not be filed under Beacon H7.'],
      ['H7 wave alerts trigger when the measured height exceeds 2.4 metres for three readings.',
        'The dashboard archives raw H7 packets as CSV alongside an operator-readable alert summary.'],
      ['The patrol launch visits H7 at dawn to check the antenna seal and again near sunset to check its light.',
        'An H7 calibration check showed a 0.1-metre offset; technicians recorded the correction without changing alert thresholds.'],
      ['For Beacon H7, the team adopted uploads at 06:00 and 18:00 because the shore gateway was available only during those patrol windows.',
        'Pier C assigned the communications operator to confirm each H7 upload receipt in the shift log.'],
      ['The battery crew scheduled H7 cell swaps for the first Wednesday of each month.',
        'A separate dashboard ticket tracks alert latency from receipt to the duty officer display.'],
      ['Harbor control marked the north access ladder as closed during heavy swell warnings.',
        'The wave sensor enclosure passed a spray test, but its outer label needs replacement.'],
      ['The duty officer asked for an H7 alert escalation call when three consecutive packets are absent.',
        'The patrol inventory lists one spare antenna seal and two weatherproof cable glands.'],
      ['A storm drill used simulated H7 packets and did not change the live upload configuration.',
        'The harbor map now marks the safe approach line for the buoy-maintenance skiff.'],
      ['Archive staff kept the original timestamp and receipt timestamp in separate CSV columns.',
        'The shore team found one duplicate alert in the drill export and flagged it for review.'],
      ['The communications lease covers the gateway cabinet through the end of the year.',
        'A shoreline sample check compared H7 readings with a handheld gauge at Pier C.'],
      ['The duty roster assigns weekend dashboard acknowledgment to the morning watch.',
        'The H7 equipment register links the antenna serial to its calibration certificate.'],
      ['The shore gateway passed a new continuous-availability test and is now available throughout the day, not just at patrol times.',
        'Engineering will monitor the gateway uptime counter for two weeks before proposing any schedule change.'],
      ['The vessel crew moved its spare battery box to the upper pier locker.',
        'A dashboard export failure affected the west-channel salinity feed but not H7 receipts.'],
      ['No replacement H7 upload cadence has been approved; the adopted 06:00 and 18:00 schedule remains in use pending review.',
        'The review agenda asks operations to compare gateway uptime with H7 packet delay.'],
      ['The weather desk added a fog note to the next H7 maintenance visit.',
        'Audit staff requested a copy of the shift-log receipt checks for the month.'],
      ['The Pier C handoff lists who acknowledges missing H7 packets overnight.',
        'Technicians stored the updated buoy access chart with the maintenance binder.'],
    ],
  },
  {
    sourceId: 'fresh_community_pantry_tokens_v1',
    question: '社區食物站目前採用哪種領取憑證？最初為何選紙本號碼牌，後來為何改變，紙本現在是什麼狀態？',
    turns: [
      ['青禾社區食物站每週二與週五開放；志工依預約時段整理領取名單。',
        '冷藏櫃的溫度紀錄由早班填寫，晚班只核對異常標記。'],
      ['食物站把過敏原標籤貼在每份餐袋外側，不寫領取者姓名。',
        '供應商的蔬菜箱須在開站前按批號清點，短缺另填補貨單。'],
      ['志工先試行依時段分流排隊，避免領取桌前擁擠。',
        '青禾食物站採用紙本號碼牌作為領取憑證，因為領取室當時沒有可用網路。'],
      ['領取清冊只記預約代碼與時段，公開桌面不放聯絡方式。',
        '倉庫員將即期乾糧放在前排，並記錄每箱到期日。'],
      ['冷鏈交接表增加「取出時間」欄，方便核對餐袋暴露時間。',
        '週五的志工交班改在側門進行，以免擋住領取隊伍。'],
      ['食物站決定把素食餐袋放在藍色架上，降低錯拿機會。',
        '倉庫盤點發現兩箱米的外袋破損，已另行隔離。'],
      ['匿名領取者可向值班主管報預約代碼，主管不在隊伍旁念出姓名。',
        '志工訓練加入冷藏櫃門未關緊時的回報步驟。'],
      ['雨天排隊線改畫在走廊內側，出入口仍須保持淨空。',
        '回收箱分開收紙袋與保冷材，晚班清點可再用數量。'],
      ['食物站盤點平板的保管位置，交班時要把裝置鎖回辦公室。',
        '例外領取須由兩位志工共同核對預約代碼，不可口頭代領。'],
      ['領取室的新本地終端完成離線掃碼與稍後同步測試，值班主管記下測試結果。',
        '設備組把終端放在領取桌內側，螢幕不朝向等候區。'],
      ['志工示範如何在掃碼失敗時通知主管，不自行修改領取紀錄。',
        '月底稽核會比對出庫餐袋數與完成領取的代碼數。'],
      ['主管正式改採 QR 碼作為青禾食物站的主要領取憑證，因本地終端能離線掃碼並在恢復連線後同步；紙本號碼牌保留作為故障備援。',
        '志工交班表增加終端電量與同步狀態兩欄。'],
      ['食物站進行斷線演練，主管記錄哪些掃碼紀錄等待同步。',
        '週二的餐袋數量與領取完成數在結束後由不同志工核對。'],
      ['紙本備援箱放在上鎖櫃內，只有主管可領出。',
        '供應商延遲送達的水果改放進下一個開站時段，不提前發放。'],
      ['主管檢查終端權限，離職志工的帳號已從設備名單移除。',
        '廚餘秤重表區分可捐贈餘量與不可食用損耗。'],
      ['新的值班表標出 QR 終端的充電責任人。',
        '食物站把上季的冷鏈異常單移到封存資料夾。'],
    ],
  },
  {
    sourceId: 'fresh_ridge_shuttle_last_trip_v1',
    question: 'For the Ridge Shuttle festival service, was a 20:30 last departure adopted, why was it proposed, and what is the status after the festival end time changed?',
    turns: [
      ['Ridge Shuttle serves the east gate, library stop, and upper trailhead during festival week.',
        'The operator roster assigns two licensed drivers to the evening route and one on-call relief driver.'],
      ['The library stop has a level boarding pad; the upper trailhead still needs a temporary ramp sign.',
        'The service desk will post route notices at the east gate forty-eight hours before any approved timetable change.'],
      ['The reserve shuttle passed its brake inspection and is available if the primary vehicle fails.',
        'A fuel log records each vehicle separately so the festival service can be reconciled after the week.'],
      ['Ticket staff will accept the regular route pass at the festival gate.',
        'Rain closures on the upper road are decided by transport control, not by the event organizer.'],
      ['The transport planner proposed a 20:30 Ridge Shuttle last departure because the festival was expected to end at 20:00; the board had not adopted the proposal.',
        'The proposal would require a driver relief handoff near the library stop.'],
      ['Security will keep the east-gate queue inside marked barriers after dusk.',
        'The incident log distinguishes missed stops from late departures.'],
      ['The school bus overlap ends before the afternoon shuttle peak.',
        'The permit office received the draft festival route map but has not issued a timetable notice.'],
      ['A temporary sign at the upper trailhead directs wheelchair riders to the level boarding point.',
        'The reserve vehicle carries a spare fare reader and first-aid kit.'],
      ['Transport control tested radio coverage along the ridge bend and found one weak spot.',
        'The event team assigned a marshal to guide the library-stop queue.'],
      ['The driver relief checklist includes keys, fuel level, and any open incident reports.',
        'Lost-property bags are sealed at the end of each shift and logged at the depot.'],
      ['The festival organizer changed the published event end time to 19:00.',
        'The service desk asked the board whether the draft late timetable still needs a hearing.'],
      ['The depot confirmed that the primary shuttle can complete its current route without a fuel stop.',
        'A roadworks notice moves the temporary pickup marker five metres toward the library.'],
      ['The board clerk circulated the revised event program to transport members.',
        'Security updated the post-event crowd plan for the east gate.'],
      ['The board deferred the 20:30 last-departure proposal; it has not adopted a later last departure or changed the current shuttle timetable.',
        'The clerk will place a new timetable item on a future agenda only if transport requests it.'],
      ['The depot returned the reserve fare reader to its labeled cabinet.',
        'The operator checked the ramp sign after wind moved its temporary stand.'],
      ['The service desk printed the current route timetable for the festival information booth.',
        'The last shift logged no lost-property claims from the library stop.'],
    ],
  },
];

function sourceCase(spec) {
  const questionId = opaqueQuestionId(spec.sourceId);
  return {
    history: { question_id: questionId,
      sessions: spec.turns.map((pair, sessionIndex) => {
        const date = new Date(Date.UTC(2025, 0, 6 + sessionIndex * 7));
        const dateText = `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')} (Mon) 09:00`;
        return { session_index: sessionIndex,
          session_id: id('session', [spec.sourceId, sessionIndex]), date: dateText,
          turns: pair.map((content, turnIndex) => ({
            turn_id: id('turn', [spec.sourceId, sessionIndex, turnIndex]),
            role: 'user', content,
          })) };
      }) },
    question: { question_id: questionId, text: spec.question, date: '2025/04/22 (Tue) 10:00' },
    namespace: { ownerId: 'fresh-selection-localization-synthetic',
      scope: 'project', projectId: questionId },
  };
}

export const sourceCases = freeze(specs.map(sourceCase));
// Odd N deliberately gives a 2:1 first-arm imbalance.
export const armOrders = freeze([
  ['cairn', 'mem0'], ['mem0', 'cairn'], ['cairn', 'mem0'],
]);

// Original reason windows, prospectively fixed before any model output.
// Canonical coordinates are asserted by inspection and fixture tests.
export const sourceProbes = freeze([
  { batchIndex: 3, windowIndex: 0,
    routingCue: 'the shore gateway was available only during those patrol windows' },
  { batchIndex: 2, windowIndex: 1, routingCue: '領取室當時沒有可用網路' },
  { batchIndex: 4, windowIndex: 0,
    routingCue: 'the festival was expected to end at 20:00' },
]);
