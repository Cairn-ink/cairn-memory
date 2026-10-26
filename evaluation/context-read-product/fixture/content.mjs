// All actors and projects below are invented. No inference is used for labels.
import { readFileSync } from 'node:fs';
export const readJSON = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
export const parameters = readJSON('parameters.json');
export const seed = readJSON('seed.json');
export const scenarios = readJSON('scenarios.json').records;
export const namespaces = parameters.projects.map(projectId => ({ ownerId: parameters.ownerId,
  scope: projectId === null ? 'personal' : 'project', projectId }));
export const key = (cohort, n, type, i) => `c${cohort}/n${n}/${type}${i}`;
export function fact(n, i, current = false) {
  const variants = [
    ['週二', '週三', '火曜', '水曜', 'Tuesday', 'Wednesday'],
    ['週三', '週四', '水曜', '木曜', 'Wednesday', 'Thursday'],
    ['週四', '週五', '木曜', '金曜', 'Thursday', 'Friday'],
    ['週五', '週六', '金曜', '土曜', 'Friday', 'Saturday'],
  ][n];
  const old = !current;
  const rows = [
    [`舊版巡檢日是${variants[0]}。`, `旧版の点検日は${variants[2]}。`, `Previous inspection day: ${variants[4]}.`],
    [`舊版保留期是${7 + n}天。`, `旧版の保存期間は${7 + n}日。`, `Previous retention: ${7 + n} days.`],
    [`舊版重試上限是${2 + n}次。`, `旧版の再試行上限は${2 + n}回。`, `Previous retry limit: ${2 + n}.`],
    [`決議使用琥珀佇列，容量${40 + n * 10}筆。`, `琥珀キューの容量は${40 + n * 10}件。`, `Amber queue capacity: ${40 + n * 10} items.`],
    [`備援演練由虛構員偶${['甲', '乙', '丙', '丁'][n]}負責，代號羽砂。`, `予備訓練の担当は架空の員偶${['甲', '乙', '丙', '丁'][n]}、符号は羽砂。`, `Fallback drill code: FeatherSand.`],
    [`離線匯出採用雨紋格式，版本${3 + n}。`, `オフライン出力は雨紋形式、版${3 + n}。`, `Offline export format: RainPattern version ${3 + n}.`],
    [`批次確認門檻是${12 + n}筆，代號苔鐘。`, `一括確認の閾値は${12 + n}件、符号は苔鐘。`, `Batch confirmation threshold: ${12 + n}, MossBell.`],
    [`封存採用霜匣方案，冷卻${20 + n}分鐘。`, `保管は霜匣方式、待機${20 + n}分。`, `FrostBox archive cooldown: ${20 + n} minutes.`],
    [`色彩標籤使用珊石，顯示👩‍🔬與 café。`, `色ラベルは珊石、表示は👩‍🔬と café。`, `Color label: CoralStone, 👩‍🔬, café.`],
    [`發布前需${2 + n}位虛構審核員同意，代號弧燈。`, `公開前に架空の審査員${2 + n}名の承認、符号は弧燈。`, `ArcLamp release approval: ${2 + n} reviewers.`],
  ];
  if (i < 3 && !old) return [
    [`現行巡檢日是${variants[1]}。`, `現在の点検日は${variants[3]}。`, `Current inspection day: ${variants[5]}.`],
    [`現行保留期是${30 + n}天。`, `現在の保存期間は${30 + n}日。`, `Current retention: ${30 + n} days.`],
    [`現行重試上限是${6 + n}次。`, `現在の再試行上限は${6 + n}回。`, `Current retry limit: ${6 + n}.`],
  ][i].join(' ') + ` 變更理由：${changeReason(n, i)}。`;
  return rows[i].join(' ');
}
export function changeReason(n, i) {
  return ['樣片送達時間後移，需要等同一輪資料齊備再巡檢',
    '需要跨週比較樣片，較短保存期使對照資料不足',
    '短暫斷線使驗證需要更多輪，原有次數不足'][i] + `；核對範圍為${parameters.names[n]}`;
}
export const scenarioFor = (n, type, i) => scenarios.find(row => row.namespaceIndex === n && row.type === type && row.slot === i);
export function cardFact(n, i) {
  if (i < 6) return fact(n, i + 3);
  return [
    `白礫手冊規定先檢查鏡盒，再解鎖松扣。白礫手順は鏡盒を確認して松扣を解除。WhitePebble runbook: inspect MirrorCase, then release PineLatch.`,
    `月苔卡片規定逾時${90 + n * 10}秒才切換。月苔カードは${90 + n * 10}秒後に切替。MoonMoss timeout: ${90 + n * 10} seconds.`,
    `砂羽驗收卡要求${18 + n}個樣本。砂羽検収カードは${18 + n}標本。SandFeather acceptance: ${18 + n} samples.`,
    `霧鈴卡片將預備額度設為${200 + n * 25}格。霧鈴カードの予備枠は${200 + n * 25}。MistBell reserve: ${200 + n * 25} slots.`,
  ][i - 6];
}
export function fit(text, units) {
  if (text.length > units) throw Error(`text exceeds frozen length ${units}`);
  return text + '合成附記。'.repeat(Math.ceil((units - text.length) / 5)).slice(0, units - text.length);
}
export function bodyUnits(type, i) {
  const distribution = parameters.perNamespacePerCohort[type === 'm' ? 'memoryBodyUnits' : 'cardBodyUnits'];
  let end = 0;
  for (const [length, count] of Object.entries(distribution)) { end += count; if (i < end) return Number(length); }
  throw Error('length slot outside distribution');
}
export function memoryContent(c, n, i) {
  const scenario = scenarioFor(n, 'memory', i);
  const statement = scenario ? scenario.statement : i < 10 ? fact(n, i) : i >= 275 ? fact(n, i - 275, true)
    : `合成觀測第${i}格：石芽樣片在第${10 + i % 19}輪通過尺寸核對。架空の石芽試片の寸法確認。Synthetic StoneBud sample dimension check.`;
  const truth = `${parameters.names[n]} cohort ${c} memory ${i}。 ${statement}`;
  const groundTruth = scenario?.groundTruth ?? (i >= 275 ? { adopted: true, adoptionStatus: 'adopted',
    changeReason: changeReason(n, i - 275), previousSlot: i - 275 } : null);
  return { truth, groundTruth, submitted: (i % 17 === 0 ? '  \n\t' : '') + fit(truth.normalize('NFKC'), bodyUnits('m', i)) };
}
export function cardContent(c, n, i) {
  const scenario = scenarioFor(n, 'card', i);
  const statement = scenario ? scenario.statement : i < 10 ? cardFact(n, i) : `合成燧葉卡第${i}格：整理第${i + 2}組樣片。架空の燧葉カード、標本整理。Synthetic FlintLeaf sample arrangement.`;
  const truth = `${parameters.names[n]} cohort ${c} card ${i}。 ${statement}`;
  // Cards preserve leading whitespace and decomposed combining marks verbatim.
  return { truth, groundTruth: scenario?.groundTruth ?? null, submitted: fit((i % 7 === 0 ? '  \n' : '') + truth, bodyUnits('k', i)) };
}
export function receipts(c, n, i) {
  const p = parameters.perNamespacePerCohort;
  return Array.from({ length: p.receiptCountCycle[i % p.receiptCountCycle.length] }, (_, j) => ({
    client: 'synthetic-p2', sessionId: `cohort-${c}-space-${n}`, eventId: `memory-${i}-receipt-${j}`,
    role: j === 1 ? 'assistant' : 'user',
    excerpt: fit(`合成收據 ${c}/${n}/${i}/${j}，虛構員偶記錄已核對樣片。 Synthetic receipt.`,
      p.receiptExcerptUnitsCycle[(i + j) % p.receiptExcerptUnitsCycle.length]),
  }));
}
