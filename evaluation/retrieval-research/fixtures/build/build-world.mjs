import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import engineering from './engineering.mjs';
import preferences from './work-preferences.mjs';
import operations from './operations.mjs';
import finance from './finance.mjs';
import productEveryday from './product-everyday.mjs';
import engineeringExtras from './extras-engineering.mjs';
import preferenceExtras from './extras-work-preferences.mjs';
import operationExtras from './extras-operations.mjs';
import financeExtras from './extras-finance.mjs';
import productEverydayExtras from './extras-product-everyday.mjs';
import { extras } from './source.mjs';
import { crossLanguage, replays, replayBodies, foreignPairs, foreignAnchors } from './variants.mjs';

export const fixtureRoot = new URL('../', import.meta.url);
const version = 'hr1-fixture-v2';
const sourceFamilies = [...engineering, ...preferences, ...operations, ...finance, ...productEveryday];
const extraSources = { ...engineeringExtras, ...preferenceExtras, ...operationExtras, ...financeExtras, ...productEverydayExtras };
const opaque = key => 'm-' + createHash('sha256').update(`hr1-world-v2:${key}`).digest('hex').slice(0, 14);
const spanCounts = [1, 1, 2, 1, 2, 1, 3, 1, 2, 1];
const time = (month, day, hour = 1) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`;
const acknowledgements = {
  zh: ['好，這條我另外記。', '嗯，這段先保留原話。'],
  en: ["Okay, I'll record this separately.", 'Yes, please keep the original wording.'],
  mixed: ['好，這條 note 另外留。', '嗯，保留這段 chat 原話。'],
};

// These are substantive templates, disclosed as such. No template renders a
// target fact. Each domain uses an explicitly distinct adjacent artifact or ledger.
const templateAttributes = [
  ['裁切線','trim guide','trim guide'], ['下邊界','lower margin','bottom margin'],
  ['裝訂孔距','binding-hole pitch','binding pitch'], ['圖框間距','frame gap','frame gap'],
  ['索引片寬度','index-tab width','tab width'], ['封套摺線','sleeve fold','sleeve fold'],
  ['頁碼框寬度','page-number box width','page box width'], ['尺標起點','ruler offset','ruler offset'],
  ['角落留白','corner clearance','corner space'],
];
const adjacentProfiles = {
  engineering: ['測試器','test tool','test tool', [
    ['追蹤樣本數','retained trace samples','筆','records'], ['重播封包數','replay packets','個','packets'],
    ['假帳號數','mock accounts','個','accounts'], ['診斷檔數','diagnostic files','份','files'],
    ['錯誤樣本數','error samples','筆','records'], ['假附件數','dummy attachments','份','files'],
    ['演練步數','drill steps','步','steps'], ['探測次數','probe attempts','次','attempts'], ['種子筆數','seed records','筆','records'],
  ]],
  'work-preferences': ['練習稿','practice digest','practice digest', [
    ['標題字數上限','maximum title characters','字','chars'], ['摘要字數上限','maximum summary characters','字','chars'],
    ['註腳字數上限','maximum footnote characters','字','chars'], ['檔名字數上限','maximum filename characters','字','chars'],
    ['留言字數上限','maximum comment characters','字','chars'], ['標籤字數上限','maximum label characters','字','chars'],
    ['附件簡介字數','attachment-description characters','字','chars'], ['小節字數上限','maximum section characters','字','chars'], ['警語字數上限','maximum caution characters','字','chars'],
  ]],
  operations: ['活動備品單','event supplies list','event kit', [
    ['備用名牌數','spare badges','張','badges'], ['備用杯數','spare cups','個','cups'],
    ['鉛筆數','pencils','支','pencils'], ['空白表單數','blank forms','張','forms'],
    ['備用袋數','spare bags','個','bags'], ['束帶數','cable ties','條','ties'],
    ['寄物牌數','coat tokens','張','tokens'], ['貼紙數','stickers','張','stickers'], ['資料夾數','folders','個','folders'],
  ]],
  finance: ['課程活動帳','training-event ledger','event ledger', [
    ['茶點費','dollars of snack expense','元','NTD'], ['掃描費','dollars of scanning expense','元','NTD'],
    ['郵資','dollars of postage expense','元','NTD'], ['文具費','dollars of stationery expense','元','NTD'],
    ['轉帳費','dollars of transfer fees','元','NTD'], ['退款額','dollars refunded','元','NTD'],
    ['現金找零額','dollars of change','元','NTD'], ['運費','dollars of shipping expense','元','NTD'], ['影印費','dollars of copying expense','元','NTD'],
  ]],
  product: ['教學小程式','tutorial app','tutorial app', [
    ['範例筆數','example records','筆','records'], ['提示字數上限','maximum hint characters','字','chars'],
    ['標籤字數上限','maximum label characters','字','chars'], ['假帳號數','mock accounts','個','accounts'],
    ['練習任務數','practice tasks','個','tasks'], ['教學卡數','tutorial cards','張','cards'],
    ['預設假資料數','default dummy rows','筆','rows'], ['範例頁數','example pages','頁','pages'], ['導覽字數上限','maximum tour characters','字','chars'],
  ]],
  everyday: ['郊遊備品單','outing supplies list','outing kit', [
    ['濕紙巾數','wet wipes','張','wipes'], ['備用袋數','spare bags','個','bags'],
    ['防水貼數','waterproof patches','片','patches'], ['紙杯數','paper cups','個','cups'],
    ['面紙數','tissues','張','tissues'], ['夾鏈袋數','zip bags','個','bags'],
    ['束帶數','ties','條','ties'], ['姓名貼數','name stickers','張','stickers'], ['零食包數','snack packs','包','packs'],
  ]],
};
function calibration(f, index) {
  const [scopeZh, scopeEn, scopeMixed, attrs] = adjacentProfiles[f.domain];
  const [zh, en, unitZh, unitEn] = attrs[index];
  const n = 11 + Number(f.id.slice(-3)) * 2 + index;
  const entity = f.entities[0];
  if (f.lang === 'en') {
    const statement = en.startsWith('maximum ') ? `${entity}'s ${scopeEn} allows up to ${n} ${en.slice(8)}.` : `${entity}'s ${scopeEn} has ${n} ${en}.`;
    return { lang: 'en', statement, content: statement,
      span: `For the ${entity} ${scopeEn}, use ${n} ${en.replace(/^maximum /, '')}${en.startsWith('maximum ') ? ' at most' : ''}. Record this separately.` };
  }
  if (f.lang === 'mixed') {
    const statement = `${entity} ${scopeMixed} 的${zh}為 ${n} ${unitEn}。`;
    return { lang: 'mixed', statement, content: statement,
      span: `${entity} ${scopeMixed} 的${zh}設 ${n} ${unitEn}，另記這份。` };
  }
  const statement = `${entity}${scopeZh}的${zh}為${n}${unitZh}。`;
  return { lang: 'zh', statement, content: statement,
    span: `${entity}${scopeZh}${zh}設${n}${unitZh}，這份另記。` };
}

function foreignCalibration(name, index, lang) {
  const [zh, en, mixed] = templateAttributes[index];
  const n = 101 + index * 3 + name.length;
  if (lang === 'en') {
    const statement = `${name}'s display card has a ${en} of ${n} mm.`;
    return { lang, statement, content: statement, span: `For ${name}'s display card, use ${n} mm for the ${en}. It's the exhibition drawing.` };
  }
  if (lang === 'mixed') {
    const statement = `${name}展示卡的 ${mixed} 為 ${n} mm。`;
    return { lang, statement, content: statement, span: `${name}展示卡 ${mixed} 定 ${n} mm，這是 display 圖稿。` };
  }
  const statement = `${name}展示卡的${zh}為${n}毫米。`;
  return { lang, statement, content: statement, span: `${name}展示卡${zh}就${n}毫米，這份展示圖稿先照這樣。` };
}

export function buildWorld() {
  const families = [], facts = [], memories = [];
  const byFamily = new Map();
  const ordinals = new Map();
  const addFamily = (id, role, domain, summary) => families.push({ id, role, domain, summary });
  const addFact = data => {
    const fact = { id: `F-${String(facts.length + 1).padStart(6, '0')}`, ...data };
    facts.push(fact);
    return fact;
  };
  function addMemory({ key, f, row, fact, scale, authoring = 'hand', supersedes = null, observedTime = fact.eventTime }) {
    const ordinal = ordinals.get(scale) || 0;
    ordinals.set(scale, ordinal + 1);
    const id = opaque(key);
    const spans = Array.from({ length: spanCounts[ordinal % 10] }, (_, i) => ({
      id: `${id}#s${i + 1}`, role: i === 1 ? 'assistant' : 'user',
      eventTime: observedTime, text: i === 0 ? row.span : acknowledgements[row.lang][i - 1],
    }));
    const m = {
      id, namespace: scale === 'foreign' ? 'foreign' : 'target', scale,
      lang: row.lang, kind: ['reason','event'].includes(fact.kind) ? (fact.kind === 'reason' ? 'context' : 'fact') : fact.kind,
      state: fact.state === 'historical' ? 'historical' : 'current', supersedes,
      eventTime: observedTime, domain: f.domain, authoring, content: row.content, spans,
      expresses: [{ fact: fact.id, where: fact.coverage === 'span-only' ? 'span' : 'body', span: spans[0].id }],
    };
    memories.push(m);
    return m;
  }
  function entitiesFor(f, row) {
    const combined = [row.statement, row.content, row.span].join(' ');
    return f.entities.filter(entity => combined.includes(entity));
  }
  for (const f0 of sourceFamilies) {
    // Clone because repeated builds must not mutate imported authored records.
    const f = extras(structuredClone(f0), extraSources[f0.id]);
    addFamily(f.id, 'target', f.domain, f.summary);
    const currentFacts = [], currentMemories = [];
    for (const [index, original] of f.rows.entries()) {
      const row = { ...original };
      if (index === 4 && crossLanguage[f.id]) [row.lang, row.content, row.span] = crossLanguage[f.id];
      let kind = ['decision','decision','reason','instruction','fact','fact','decision'][index];
      if (index === 3 && f.domain === 'work-preferences') kind = 'preference';
      if (index === 3 && ['fam-001','fam-003','fam-007'].includes(f.id)) kind = 'context';
      if (index === 5 && ['fam-005','fam-023','fam-026','fam-031'].includes(f.id)) kind = 'event';
      const state = index === 0 ? (f.changed ? 'historical' : 'rejected') : index === 6 ? f.optionState : 'current';
      const decisionMonth = ['fam-009','fam-031'].includes(f.id) ? 10 : 8;
      const eventMonth = index === 0 ? 3 : index <= 2 ? decisionMonth : index === 3 ? 9 : 10;
      const eventDay = (index === 1 || index === 2) && decisionMonth === 8 ? 20 + (Number(f.id.slice(-3)) % 6) : 1 + (Number(f.id.slice(-3)) % 6);
      const eventTime = time(eventMonth, eventDay, index === 2 ? 2 : 1);
      const fact = addFact({ family: f.id, kind, state,
        supersedes: index === 1 && f.changed ? currentFacts[0].id : null,
        reasonFor: index === 2 ? currentFacts[1].id : null, nearDuplicateOf: null,
        eventTime, entities: entitiesFor(f, row), statementLang: original.lang === 'mixed' && !/[A-Za-z]/.test(row.statement) ? 'zh' : original.lang,
        statement: row.statement, rendered: true, coverage: row.coverage,
      });
      const memory = addMemory({ key: `${f.id}:target:${index}`, f, row, fact, scale: 'S300',
        supersedes: index === 1 && f.changed ? currentMemories[0].id : null });
      currentFacts.push(fact); currentMemories.push(memory);
    }
    if (f.absent) addFact({ family: f.id, kind: 'fact', state: 'current', supersedes: null, reasonFor: null,
      nearDuplicateOf: null, eventTime: time(10, 12), entities: [f.entities[0]],
      statementLang: f.lang === 'mixed' && !/[A-Za-z]/.test(f.absent) ? 'zh' : f.lang, statement: f.absent, rendered: false, coverage: null });
    byFamily.set(f.id, { f, facts: currentFacts, memories: currentMemories });
  }
  for (const [familyId, span] of Object.entries(replays)) {
    const { f, facts: familyFacts } = byFamily.get(familyId);
    if (!replayBodies[familyId]) throw new Error(`${familyId}: missing authored confirmation body`);
    const row = { ...f.rows[5], content: replayBodies[familyId], span };
    // Replays are current; none replay a historical decision.
    addMemory({ key: `${familyId}:replay`, f, row, fact: familyFacts[5], scale: 'S300', observedTime: time(10,14) });
  }
  for (const { f } of byFamily.values()) {
    const familyId = f.id.replace('fam-', 'dist-');
    addFamily(familyId, 'distractor', f.domain, `${f.entities[0]} adjacent tests, practice materials, event operations and separate accounts`);
    const rows = [...f.handExtras, ...Array.from({ length: 8 + (replays[f.id] ? 1 : 0) }, (_, i) => calibration(f, i))];
    for (const [index, row] of rows.entries()) {
      const kind = f.domain === 'work-preferences' && /偏好|prefer|should/i.test(row.statement) ? 'preference' : 'fact';
      const fact = addFact({ family: familyId, kind, state: 'current', supersedes: null, reasonFor: null,
        nearDuplicateOf: null, eventTime: index < 9 ? time(10,14+(index%7)) : time(4+(index%7),10+(Number(f.id.slice(-3))%12)),
        entities: [...new Set([f.entities[0], ...entitiesFor(f, row)])], statementLang: row.lang,
        statement: row.statement, rendered: true, coverage: null });
      addMemory({ key: `${familyId}:${index}`, f, row, fact, scale: 'S1000-extra', authoring: index < 9 ? 'hand' : 'template' });
    }
  }
  // The 70 generated foreign records fill these language quotas, after the 30
  // authored near-duplicates and anchors. Namespace is the only eligibility wall.
  const foreignLangs = ['zh','en','zh','mixed','zh','en','zh','en','zh','mixed'];
  let generatedOrdinal = 0;
  for (const [pairIndex, [domain, pairs]] of foreignPairs.entries()) {
    const familyId = `foreign-${String(pairIndex + 1).padStart(3, '0')}`;
    const [anchorLang, anchorStatement, anchorSpan, name, code] = foreignAnchors[pairIndex];
    const f = { domain };
    addFamily(familyId, 'foreign', domain, `${name}: an independent founder's workspace, including namespace-confusable decisions`);
    for (const [index, [sourceFamily, lang, statement, content, span]] of pairs.entries()) {
      const targetFact = byFamily.get(sourceFamily).facts[1];
      const fact = addFact({ family: familyId, kind: 'decision', state: 'current', supersedes: null, reasonFor: null,
        nearDuplicateOf: targetFact.id, eventTime: targetFact.eventTime,
        entities: targetFact.entities, statementLang: lang, statement, rendered: true, coverage: null });
      addMemory({ key: `${familyId}:near:${index}`, f, row: { lang, content, span }, fact, scale: 'foreign' });
    }
    const anchor = addFact({ family: familyId, kind: 'fact', state: 'current', supersedes: null, reasonFor: null,
      nearDuplicateOf: null, eventTime: time(7, 17), entities: [name, code], statementLang: anchorLang,
      statement: anchorStatement, rendered: true, coverage: null });
    addMemory({ key: `${familyId}:anchor`, f, row: { lang: anchorLang, content: anchorStatement, span: anchorSpan }, fact: anchor, scale: 'foreign' });
    for (let index = 0; index < 7; index++) {
      // 40 zh / 22 en / 8 mixed; authored rows bring totals to 55 / 30 / 15.
      let lang = foreignLangs[generatedOrdinal % 10];
      if (generatedOrdinal === 3) lang = 'en';
      if ([13,23,33,43,53].includes(generatedOrdinal)) lang = 'zh';
      generatedOrdinal++;
      const row = foreignCalibration(name, index, lang);
      const fact = addFact({ family: familyId, kind: 'fact', state: 'current', supersedes: null, reasonFor: null,
        nearDuplicateOf: null, eventTime: time(9, 18), entities: [name], statementLang: lang,
        statement: row.statement, rendered: true, coverage: null });
      addMemory({ key: `${familyId}:local:${index}`, f, row, fact, scale: 'foreign', authoring: 'template' });
    }
  }
  return { facts: { version, families, facts }, corpus: { version, memories } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const world = buildWorld();
  for (const [file, value] of [['hr1-facts.json', world.facts], ['hr1-corpus.json', world.corpus]]) {
    const serialized = JSON.stringify(value, null, 2) + '\n';
    const url = new URL(file, fixtureRoot);
    if (process.argv.includes('--check')) {
      if (readFileSync(url, 'utf8') !== serialized) throw new Error(`${file} differs from deterministic build`);
    } else writeFileSync(url, serialized);
    console.log(`${process.argv.includes('--check') ? 'verified' : 'wrote'} ${file}: ${Buffer.byteLength(serialized)} bytes; sha256 ${createHash('sha256').update(serialized).digest('hex')}`);
  }
}
