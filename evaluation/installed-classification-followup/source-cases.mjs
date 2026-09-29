import { createHash } from 'node:crypto';

const digest = text => createHash('sha256').update(text).digest('hex');
const id = (kind, ...parts) => `lme-${kind}-${digest(['m1e-classification-followup-v1', ...parts].join(':'))}`;
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const workshopPrograms = [
  'autumn mug clinic', 'school tile day', 'community bowl class', 'repair-glaze lab',
  'beginner wheel night', 'raku sample clinic', 'studio open house', 'teen slab class',
  'teapot handle lab', 'holiday ornament day', 'surface-test clinic', 'porcelain cup class',
  'shared-kiln orientation', 'artist residency demo', 'family plate day', 'winter vase class',
];
const workshopMaterials = ['stoneware mugs', 'test tiles', 'serving bowls', 'repair samples',
  'wheel cylinders', 'raku cups', 'display vessels', 'slab trays'];
const workshopStations = ['north wheel row', 'west wash sink', 'glaze bench A', 'glaze bench B',
  'kiln staging shelf', 'tool return shelf', 'photo table', 'packing counter'];
const workshopActions = [
  (p, m, n) => `${p}: logged ${n} ${m} at intake and marked the makers' initials.`,
  (p, m, n) => `${p}: trimmed the foot rings on ${n} ${m} before the first shelf check.`,
  (p, m, n) => `${p}: set ${n} ${m} aside to dry under linen before bisque loading.`,
  (p, m, n) => `${p}: checked ${n} ${m} for handle cracks after the drying interval.`,
  (p, m, n) => `${p}: numbered ${n} ${m} for the cobalt line-width trial.`,
  (p, m, n) => `${p}: wiped dust from ${n} ${m} before applying sample glaze.`,
  (p, m, n) => `${p}: left a bare corner on ${n} ${m} to compare fired color.`,
  (p, m, n) => `${p}: placed ${n} ${m} in the test-tile photo register.`,
  (p, m, n) => `${p}: paired ${n} ${m} by rim diameter for the serving set.`,
  (p, m, n) => `${p}: checked the glaze thickness on ${n} ${m} with the dip timer.`,
  (p, m, n) => `${p}: removed wax residue from the feet of ${n} ${m}.`,
  (p, m, n) => `${p}: packed ${n} ${m} on padded boards for the kiln queue.`,
  (p, m, n) => `${p}: photographed the chipped edges of ${n} ${m} before repair.`,
  (p, m, n) => `${p}: mixed slip for ${n} ${m} and labeled the mixture cup.`,
  (p, m, n) => `${p}: applied a thin join coat to ${n} ${m} under supervision.`,
  (p, m, n) => `${p}: reserved ${n} ${m} for a post-fire bond inspection.`,
  (p, m, n) => `${p}: measured wall thickness on ${n} ${m} after throwing.`,
  (p, m, n) => `${p}: covered ${n} ${m} loosely to slow uneven rim drying.`,
  (p, m, n) => `${p}: moved ${n} ${m} to the labeled reclaim inspection tray.`,
  (p, m, n) => `${p}: recorded the weight of ${n} ${m} before a second trim.`,
  (p, m, n) => `${p}: checked ${n} ${m} for thermal-shock cracks after cooling.`,
  (p, m, n) => `${p}: counted ${n} ${m} with intact glaze before display.`,
  (p, m, n) => `${p}: marked the underside of ${n} ${m} with maker codes.`,
  (p, m, n) => `${p}: wrapped ${n} ${m} separately for the visitor handling shelf.`,
  (p, m, n) => `${p}: checked slab seams on ${n} ${m} before the first firing.`,
  (p, m, n) => `${p}: aligned the handles of ${n} ${m} for clearance on shelves.`,
  (p, m, n) => `${p}: noted which of ${n} ${m} need a second edge cleanup.`,
  (p, m, n) => `${p}: logged ${n} ${m} as ready for pickup after cooling.`,
  (p, m, n) => `${p}: verified the base stamps on ${n} ${m} against sign-in.`,
  (p, m, n) => `${p}: brushed kiln wash flecks from ${n} ${m}.`,
  (p, m, n) => `${p}: measured ${n} ${m} for the storage-bin dividers.`,
  (p, m, n) => `${p}: closed the handoff sheet for ${n} ${m} after final count.`,
];
const logisticsRoutes = ['north clinic shuttle', 'harbor pharmacy loop', 'hill hospital run',
  'university lab transfer', 'east dialysis route', 'airport vaccine relay',
  'coastal blood-bank run', 'downtown specimen sweep', 'west care-home route',
  'regional insulin delivery', 'overnight trial-sample run', 'south emergency relay',
  'island ferry handoff', 'central imaging route', 'rural clinic replenishment',
  'weekend ward replenishment'];
const logisticsCargo = ['疫苗箱', '檢體箱', '胰島素箱', '血品保冷箱', '試驗藥箱', '冷藏敷料箱', '校驗樣本箱', '溫控備品箱'];
const logisticsChecks = [
  (r, c, n) => `${r}的${c}共${n}箱，收貨時逐箱掃描封條號碼。`,
  (r, c, n) => `${r}的${c}共${n}箱，檢查外箱與貨單上的品項代碼。`,
  (r, c, n) => `${r}的${c}共${n}箱，確認接收端簽收人名單。`,
  (r, c, n) => `${r}的${c}共${n}箱，安排與常溫貨分開暫存。`,
  (r, c, n) => `${r}的${c}共${n}箱，裝車前核對溫度記錄器電量。`,
  (r, c, n) => `${r}的${c}共${n}箱，替換電量不足的記錄器。`,
  (r, c, n) => `${r}的${c}共${n}箱，記下保冷箱預冷完成時間。`,
  (r, c, n) => `${r}的${c}共${n}箱，將記錄器編號貼進交接單。`,
  (r, c, n) => `${r}的${c}共${n}箱，交接單記下外箱完整狀態。`,
  (r, c, n) => `${r}的${c}共${n}箱，確認箱角沒有受潮痕跡。`,
  (r, c, n) => `${r}的${c}共${n}箱，把破損標籤重新貼在外袋。`,
  (r, c, n) => `${r}的${c}共${n}箱，複核箱蓋鎖扣已閉合。`,
  (r, c, n) => `${r}的${c}共${n}箱，交班時比對保冷材封裝批次。`,
  (r, c, n) => `${r}的${c}共${n}箱，記錄冰排裝入箱體的數量。`,
  (r, c, n) => `${r}的${c}共${n}箱，隔開回收冰排與未使用冰排。`,
  (r, c, n) => `${r}的${c}共${n}箱，確認保冷材沒有碰觸裸露內袋。`,
  (r, c, n) => `${r}的${c}共${n}箱，依收貨時段排出車順序。`,
  (r, c, n) => `${r}的${c}共${n}箱，核對路線表上的卸貨站序。`,
  (r, c, n) => `${r}的${c}共${n}箱，預留臨時退件的隔離位置。`,
  (r, c, n) => `${r}的${c}共${n}箱，通知司機第一站卸貨窗口。`,
  (r, c, n) => `${r}的${c}共${n}箱，逐箱確認條碼能由手持機讀取。`,
  (r, c, n) => `${r}的${c}共${n}箱，整理無法掃描條碼的人工紀錄。`,
  (r, c, n) => `${r}的${c}共${n}箱，比對車載系統與紙本箱數。`,
  (r, c, n) => `${r}的${c}共${n}箱，完成發車前的差異簽註。`,
  (r, c, n) => `${r}的${c}共${n}箱，檢查備用封條是否足量。`,
  (r, c, n) => `${r}的${c}共${n}箱，清點可用的空保冷箱。`,
  (r, c, n) => `${r}的${c}共${n}箱，交還上一班的溫度記錄卡。`,
  (r, c, n) => `${r}的${c}共${n}箱，登記下班前尚待回覆的異常單。`,
  (r, c, n) => `${r}的${c}共${n}箱，確認收貨點的聯絡電話仍有效。`,
  (r, c, n) => `${r}的${c}共${n}箱，傳送到貨預報給接收端。`,
  (r, c, n) => `${r}的${c}共${n}箱，檢視雨天轉運用的防水罩。`,
  (r, c, n) => `${r}的${c}共${n}箱，完成本班次的路線交接摘要。`,
];

// Deliberately source-only: no retrieval prompt, expected answer, or rubric in this module.
const workshopOverrides = new Map([
  ['1:5', 'Studio lead Mara adopted the east-wall fixed rack for wet-glaze drying at the kiln workshop. The reason was to keep wet pieces clear of the firing-cart route.'],
  ['9:5', 'Facilities found an HVAC drip above the east-wall rack; two test tiles were damp beneath it. That location no longer keeps glaze work dry.'],
  ['12:5', 'Mara adopted rolling rack bay C instead of the east-wall fixed rack for wet-glaze drying. Bay C avoids the HVAC drip while leaving the firing-cart route clear.'],
  ['14:5', 'At the shared-kiln check, Mara confirmed that rolling rack bay C remains the adopted wet-glaze drying location. The east-wall rack is for dry tools only.'],
]);
const logisticsOverrides = new Map([
  ['2:5', '值班主管雅雯決定夜間冷鏈出貨使用四號月台，理由是該月台當時有獨立備援電源，可讓待裝貨的冷藏車維持供電。'],
  ['11:5', '設施組確認四號月台的獨立備援電源已拆除；原先以備援供電為由選用四號月台的前提，現在不再成立。'],
  ['13:5', '有人提議改用六號月台，但雅雯只要求評估電源與車流，尚未決定採用六號月台或任何替代月台。'],
  ['15:5', '雅雯表示四號月台是先前已採用的安排，現因備援電源變動需要重新確認；目前沒有核准新的夜間出貨月台。'],
]);

function dateAt(index) {
  const date = new Date(Date.UTC(2026, 3, index + 1));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')} (${day}) 09:00`;
}

function workshopTurn(sessionIndex, turnIndex) {
  const special = workshopOverrides.get(`${sessionIndex}:${turnIndex}`);
  if (special) return special;
  const program = workshopPrograms[sessionIndex];
  const material = workshopMaterials[Math.floor(turnIndex / 4)];
  const station = workshopStations[Math.floor(turnIndex / 4)];
  const count = 4 + ((sessionIndex * 7 + turnIndex * 3) % 19);
  return `${workshopActions[turnIndex](program, material, count)} ${station} recorded lot W${String(sessionIndex + 1).padStart(2, '0')}-${String(turnIndex + 1).padStart(2, '0')}.`;
}

function logisticsTurn(sessionIndex, turnIndex) {
  const special = logisticsOverrides.get(`${sessionIndex}:${turnIndex}`);
  if (special) return special;
  const route = logisticsRoutes[sessionIndex];
  const cargo = logisticsCargo[Math.floor(turnIndex / 4)];
  const count = 2 + ((sessionIndex * 5 + turnIndex * 7) % 14);
  const temperature = 3 + ((sessionIndex + turnIndex) % 4) / 10;
  return `${logisticsChecks[turnIndex](route, cargo, count)} 批次 L${String(sessionIndex + 1).padStart(2, '0')}-${String(turnIndex + 1).padStart(2, '0')} 的讀值為 ${temperature.toFixed(1)}°C。`;
}

function makeCase(key, questionText, turnText) {
  const questionId = id('case', key);
  const sessions = Array.from({ length: 16 }, (_, sessionIndex) => ({
    session_index: sessionIndex,
    session_id: id('session', key, sessionIndex),
    date: dateAt(sessionIndex),
    turns: Array.from({ length: 32 }, (_, turnIndex) => ({
      turn_id: id('turn', key, sessionIndex, turnIndex),
      role: 'user',
      content: turnText(sessionIndex, turnIndex),
    })),
  }));
  return { history: { question_id: questionId, sessions },
    question: { question_id: questionId, text: questionText, date: '2026/04/17 (Fri) 09:00' },
    namespace: { ownerId: 'synthetic-m1e-evaluation', scope: 'project', projectId: questionId } };
}

export const sourceCases = freeze([
  makeCase('workshop-drying-rack',
    'For the kiln workshop wet-glaze drying location, what was adopted first, what is adopted now, and what recorded reason explains the change?', workshopTurn),
  makeCase('cold-chain-dock',
    '夜間冷鏈出貨的月台決策，先前採用什麼、當時理由是什麼、現在應如何描述其狀態？', logisticsTurn),
]);
export const armOrders = freeze([['cairn', 'mem0'], ['mem0', 'cairn']]);
