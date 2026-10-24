import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { get_encoding } from '../../node_modules/tiktoken/tiktoken.cjs';
import targets from './targets.mjs';
import distractors, { FABRICATION } from './distractors.mjs';
import { FOREIGN_NAMES, NEAR } from './foreign.mjs';
import { fillerSentences, bank } from './filler.mjs';
import { VERSION, PRNG, CANDIDATE_SEEDS, BODY_BANDS, RECEIPT_BANDS, RECEIPT_COUNTS,
  PLACEMENTS, LANGUAGE_SHARES, HAND_EPISODES, mulberry32, shuffle, apportioned } from './config.mjs';

export const fixtureRoot = new URL('../', import.meta.url);
const encoder = get_encoding('o200k_base');
const tokenCache = new Map();
export function tokens(text) {
  if (!tokenCache.has(text)) tokenCache.set(text, encoder.encode(text).length);
  return tokenCache.get(text);
}
export const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
export const serialize = value => JSON.stringify(value, null, 2) + '\n';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const stamp = (month, day, hour = 9, minute = 0) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
const canonicalLanguage = index => ['zh','zh','en','zh','mixed','en','zh','zh','en','zh','mixed','zh','en','zh','zh','en','zh','mixed','en','zh'][index % 20];
const factText = (row, lang, slot = 0) => lang === 'en' ? row.en : lang === 'zh' ? row.zh : slot % 2 ? row.en : row.zh;
const canonical = (row, lang) => lang === 'mixed' ? `團隊紀錄：${row.en}` : row[lang];
const histogram = values => Object.fromEntries([...new Set(values)].sort().map(key => [key, values.filter(value => value === key).length]));

function chineseNumber(value) {
  if (!value) return '零';
  if (value >= 10000) return chineseNumber(Math.floor(value / 10000)) + '萬' + (value % 10000 ? (value % 10000 < 1000 ? '零' : '') + chineseNumber(value % 10000) : '');
  let out = '', gap = false;
  for (const [power, unit] of [[1000,'千'],[100,'百'],[10,'十'],[1,'']]) {
    const digit = Math.floor(value / power) % 10;
    if (digit) { if (gap) out += '零'; out += '零一二三四五六七八九'[digit] + unit; gap = false; }
    else if (out) gap = true;
  }
  return out.replace(/^一十/u,'十');
}
function englishNumber(value) {
  const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  if (value < 20) return small[value];
  if (value < 100) return ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'][Math.floor(value/10)] + (value%10 ? ' '+small[value%10] : '');
  if (value < 1000) return small[Math.floor(value/100)]+' hundred'+(value%100 ? ' '+englishNumber(value%100) : '');
  return englishNumber(Math.floor(value/1000))+' thousand'+(value%1000 ? ' '+englishNumber(value%1000) : '');
}
function lexicon(row, entities, eventTime) {
  const date = eventTime.slice(0,10), [year, month, day] = date.split('-');
  const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][Number(month)-1];
  const terms = [...entities, ...row.terms, date, date.replaceAll('-', ''), date.replaceAll('-','/'),
    `${year}年${Number(month)}月${Number(day)}日`, `${chineseNumber(Number(month))}月${chineseNumber(Number(day))}日`,
    `${monthName} ${Number(day)}, ${year}`, `${Number(day)} ${monthName} ${year}`];
  for (const match of (row.zh + ' ' + row.en).matchAll(/\d[\d,]*(?:\.\d+)?/gu)) {
    const raw = match[0].replaceAll(',', ''), value = Number(raw);
    const zh = chineseNumber(value), en = englishNumber(value);
    terms.push(match[0], raw, `NT$${match[0]}`, `NTD ${match[0]}`, zh, zh.replaceAll('二','兩'), en,
      en.replace(/(?<=\w) (?=\w)/gu,'-'), [...raw].map(digit=>'零一二三四五六七八九'[Number(digit)]).join(''),
      [...raw].map(digit=>englishNumber(Number(digit))).join(' '));
  }
  return [...new Set(terms.map(normalize).filter(Boolean))].sort();
}

function topic(source, lang, mode) {
  if (mode === 'note') return lang === 'zh' ? `${source.name}這段討論的脈絡先留在筆記裡。` :
    lang === 'en' ? `This note concerns the discussion around ${source.alias}.` :
      `${source.name}的這段討論先記下，the surrounding conversation gives the context.`;
  if (mode === 'user') return lang === 'zh' ? `${source.name}這段我想再順著聊下去。` :
    lang === 'en' ? `I want to keep talking through the ${source.alias} discussion.` :
      `${source.name}這段我想再聊，let me keep the context together.`;
  return lang === 'zh' ? `${source.name}這段討論我會順著記。` :
    lang === 'en' ? `I can follow the thread of the ${source.alias} discussion here.` :
      `${source.name}這段討論我會接著記，I can follow the conversational thread.`;
}

function layout(segments, paragraphs) {
  let text = '';
  const ranges = [];
  const cut = paragraphs === 2 ? Math.ceil(segments.length / 2) : -1;
  for (const [i, segment] of segments.entries()) {
    if (i) text += i === cut ? '\n\n' : ' ';
    const start = text.length;
    text += segment.text;
    ranges.push({ ...segment, start, end: text.length });
  }
  return { text, ranges };
}

function fit(unit, [lower, upper], bandIndex) {
  const body = unit.where === 'body', cap = body ? 4000 : 800;
  const preferred = (body ? [148, 218, 300] : [54, 96, 143])[bandIndex];
  const coreCount = unit.core.length, maxFill = body ? 8 - coreCount : 6;
  const candidates = [];
  for (let n = 1; n <= maxFill; n++) {
    if (body && n + coreCount < 3) continue;
    for (let offset = 0; offset < unit.pool.length; offset++) {
      const fillers = [], usedLeads = new Set(), usedTails = new Set();
      for (let i = 0; i < unit.pool.length && fillers.length < n; i++) {
        const sentence = unit.pool[(offset + i) % unit.pool.length];
        if (usedLeads.has(sentence.lead) || usedTails.has(sentence.tail)) continue;
        fillers.push(sentence); usedLeads.add(sentence.lead); usedTails.add(sentence.tail);
      }
      if (fillers.length !== n) continue;
      // Mixed units always contain a substantive clause in each language.
      const segments = [...unit.core, ...fillers.map(sentence => ({ type: 'filler', sentence: sentence.id, text: sentence.text }))];
      const estimate = segments.reduce((sum, segment) => sum + tokens(segment.text), 0) + segments.length - 1;
      if (estimate < lower - 18 || estimate > upper + 18) continue;
      const rendered = layout(segments, unit.paragraphs);
      if (rendered.text.length > cap) continue;
      candidates.push({ rendered, distance: Math.abs(estimate - preferred), offset, n });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.n - b.n || a.offset - b.offset);
  for (const candidate of candidates) {
    const count = tokens(candidate.rendered.text);
    if (count >= lower && (count < upper || (bandIndex === 2 && count === upper)))
      return { ...candidate.rendered, tokens: count, band: bandIndex };
  }
  return null;
}

// Capacity matching chooses bands jointly with unit feasibility. This is only
// length allocation; it has no access to queries, labels, rankings or assembly.
function allocateBands(units, bands, random) {
  const counts = histogram(apportioned(units.length, bands.map((band, index) => [index, band[2]])));
  const order = shuffle(units, random);
  const buckets = [[], [], []];
  const assignments = new Map();
  const preferences = new Map(order.map(unit => [unit, shuffle([0, 1, 2], random)]));
  function assign(unit, seen) {
    for (const band of preferences.get(unit)) {
      if (!unit.fits[band] || seen.has(band)) continue;
      seen.add(band);
      if (buckets[band].length < (counts[band] || 0)) {
        buckets[band].push(unit); assignments.set(unit, band); return true;
      }
      for (let i = 0; i < buckets[band].length; i++) {
        const previous = buckets[band][i];
        if (assign(previous, seen)) {
          buckets[band][i] = unit; assignments.set(unit, band); return true;
        }
      }
    }
    return false;
  }
  for (const unit of order) if (!assign(unit, new Set())) throw new Error(`candidate_length_allocation:${unit.memory}:${unit.span ?? 'body'}:${unit.fits.map(Boolean)}`);
  return new Map(units.map(unit => [unit, unit.fits[assignments.get(unit)]]));
}

export function buildWorld(candidate = 0) {
  if (!Number.isInteger(candidate) || candidate < 0 || candidate >= CANDIDATE_SEEDS.length) throw new Error('invalid_candidate_index');
  const seed = CANDIDATE_SEEDS[candidate], random = mulberry32(seed);
  const families = [], facts = [], plans = [], forbiddenLexicon = {}, allocation = {};
  const sourceRows = new Map(), familySources = new Map();
  const factsByFamily = new Map();
  function addFamily(source, role) {
    const family = { id: source.id, role, domain: source.domain, summary: `${source.name}: ${source.alias}, an invented founder thread` };
    families.push(family); familySources.set(family.id, source); factsByFamily.set(family.id, []);
    return family;
  }
  function addFact(family, row, slot, options = {}) {
    const source = familySources.get(family.id), day = 1 + (Number(family.id.match(/\d+$/)?.[0] ?? 1) % 20);
    const mentionsPerson = source.person && (row.zh.includes(source.person) || row.en.includes(source.personAlias));
    const entities = [...new Set([source.name, source.alias, ...(mentionsPerson ? [source.person, source.personAlias] : []), ...(options.entities ?? [])].filter(Boolean))];
    const fact = {
      id: `B-${family.id}-${String(slot + 1).padStart(2, '0')}`, family: family.id,
      kind: options.kind ?? ['decision','decision','reason', family.domain === 'work-preferences' ? 'preference' : 'instruction','fact','fact','decision','fact'][slot],
      state: options.state ?? (slot === 0 ? 'historical' : slot === 6 ? /否決|rejected/iu.test(row.zh + row.en) ? 'rejected' : 'proposed' : 'current'),
      supersedes: options.supersedes ?? (slot === 1 ? `B-${family.id}-01` : null),
      reasonFor: options.reasonFor ?? (slot === 2 ? `B-${family.id}-02` : null),
      nearDuplicateOf: options.nearDuplicateOf ?? null,
      eventTime: options.eventTime ?? stamp([2,4,4,1,1,1,5,10][slot], day, slot === 2 ? 10 : 9),
      entities, statementLang: options.lang ?? canonicalLanguage(families.length - 1),
      statement: '', rendered: options.rendered ?? slot !== 7, coverage: null,
    };
    fact.statement = canonical(row, fact.statementLang);
    facts.push(fact); factsByFamily.get(family.id).push(fact); sourceRows.set(fact.id, row);
    forbiddenLexicon[fact.id] = lexicon(row, entities, fact.eventTime);
    return fact;
  }
  function addPlan(family, expressed, episode, authoring = 'hand') {
    const ordinal = plans.length;
    const id = `m-${sha256(`hr2b-world-v1:${family.id}:${episode}`).slice(0, 16)}`;
    const month = episode === 0 ? 2 : episode === 1 ? 4 : episode === 2 ? 5 : episode === 3 ? 6 : 7;
    const eventTime = stamp(month, 1 + Number(family.id.match(/\d+$/)?.[0] ?? 1) % 20, 12);
    const memory = {
      id, namespace: family.role === 'foreign' ? 'foreign' : 'target',
      scale: family.role === 'target' ? 'S300' : family.role === 'distractor' ? 'S1000-extra' : 'foreign',
      lang: null, kind: episode < 2 ? 'decision' : episode === 2 ? 'context' : 'fact',
      state: expressed.some(fact => fact.state === 'historical' && fact.kind === 'decision') ? 'historical' : 'current',
      supersedes: episode === 1 && family.role !== 'foreign' ? `m-${sha256(`hr2b-world-v1:${family.id}:0`).slice(0, 16)}` : null,
      eventTime, domain: family.domain, authoring, content: '', spans: [], expresses: [],
    };
    const plan = { ordinal, family, episode, expressed, memory, source: familySources.get(family.id) };
    plans.push(plan); return plan;
  }
  for (const [index, source] of targets.entries()) {
    const family = addFamily(source, 'target');
    const authored = source.rows.map((row, slot) => addFact(family, row, slot));
    HAND_EPISODES.forEach((slots, episode) => addPlan(family, slots.map(slot => authored[slot]), episode));
  }
  for (const [index, source] of distractors.entries()) {
    const family = addFamily(source, 'distractor');
    const authored = source.rows.map((row, slot) => addFact(family, row, slot, { entities: [targets[index].name, targets[index].alias] }));
    HAND_EPISODES.forEach((slots, episode) => addPlan(family, slots.map(slot => authored[slot]), episode));
    for (let episode = 4; episode < 8; episode++) {
      const pair = FABRICATION[family.domain].map(([zh, en, zhUnit, enUnit], attribute) => {
        const amount = 461 + index * 19 + (episode - 4) * 3 + attribute;
        const part = `加工樣件${String.fromCharCode(65 + episode - 4)}`, partEn = `fabrication piece ${String.fromCharCode(65 + episode - 4)}`;
        const row = { zh: `${source.name}的${part}${zh}是 ${amount} ${zhUnit}。`,
          en: `${source.alias}'s ${partEn} has a ${en} of ${amount} ${enUnit}.`,
          terms: [part, partEn, zh, en, String(amount)] };
        return addFact(family, row, 8 + (episode - 4) * 2 + attribute, {
          kind: 'fact', state: 'current', rendered: true, eventTime: stamp(7, 1 + (index + 1) % 20),
        });
      });
      addPlan(family, pair, episode, 'template');
    }
  }
  FOREIGN_NAMES.forEach(([name, alias, code], index) => {
    const domain = ['engineering','engineering','work-preferences','work-preferences','operations','operations','finance','finance','product','everyday'][index];
    const source = { id: `hr2b-f${String(index + 1).padStart(2, '0')}`, name, alias, domain };
    const family = addFamily(source, 'foreign');
    for (let episode = 0; episode < 6; episode++) {
      let row, nearDuplicateOf = null, entities = [], kind = 'fact';
      if (episode < 2) {
        const targetIndex = index * 2 + episode, target = targets[targetIndex];
        const [zh, en, terms] = NEAR[targetIndex];
        row = { zh: `${name}的獨立工作區記錄：${zh}`, en: `In ${alias}'s independent workspace, ${en[0].toLowerCase()}${en.slice(1)}`, terms: terms.split('~') };
        nearDuplicateOf = `B-${target.id}-02`; entities = [target.name, target.alias]; kind = 'decision';
      } else if (episode === 2) {
        row = { zh: `${name}的道具盒保管碼是 ${code}。`, en: `${alias}'s prop-box custody code is ${code}.`, terms: [code, code.replaceAll('-', ''), '道具盒保管碼', 'prop-box custody code'] };
        entities = [code];
      } else {
        const amount = 1281 + index * 13 + episode;
        const attributes = [['襯片寬度','liner width'],['掛環間距','hanging-loop spacing'],['底托深度','support depth']];
        const [zh, en] = attributes[episode - 3];
        row = { zh: `${name}的排練道具${zh}是 ${amount} 毫米。`, en: `${alias}'s rehearsal prop has a ${en} of ${amount} mm.`, terms: [zh, en, String(amount), '排練道具', 'rehearsal prop'] };
      }
      const fact = addFact(family, row, episode, { kind, state: 'current', rendered: true,
        nearDuplicateOf, entities, eventTime: stamp(6, index + 1), supersedes: null, reasonFor: null });
      // Explicit nulls override slot-based links below.
      fact.supersedes = null; fact.reasonFor = null;
      const plan = addPlan(family, [fact], episode + 10, episode < 3 ? 'hand' : 'template');
      plan.memory.kind = kind;
    }
  });
  for (const role of ['target','distractor','foreign']) {
    const rendered = facts.filter(fact => fact.rendered && families.find(family => family.id === fact.family).role === role);
    const placements = shuffle(apportioned(rendered.length, PLACEMENTS), random);
    rendered.forEach((fact, index) => {
      allocation[fact.id] = placements[index];
      if (role === 'target') fact.coverage = placements[index] === 'body' ? 'body' : 'span-only';
    });
    const group = plans.filter(plan => plan.family.role === role);
    let languagePool = apportioned(group.length, LANGUAGE_SHARES);
    // Twenty reason-only episodes support bidirectional translation eligibility;
    // their canonical wording is authored independently of rendering language.
    if (role === 'target') for (const plan of group.filter(plan => plan.episode === 2).slice(0, 20)) {
      const index = targets.findIndex(source => source.id === plan.family.id), lang = index < 10 ? 'en' : 'zh';
      plan.memory.lang = lang; languagePool.splice(languagePool.indexOf(lang), 1);
      const fact = plan.expressed.find(fact => fact.kind === 'reason');
      fact.statementLang = lang === 'en' ? 'zh' : 'en'; fact.statement = canonical(sourceRows.get(fact.id), fact.statementLang);
    }
    languagePool = shuffle(languagePool, random);
    for (const plan of group) plan.memory.lang ??= languagePool.shift();
    const countPool = apportioned(group.length, RECEIPT_COUNTS);
    const singles = countPool.filter(count => count === 1).length;
    const eligible = shuffle(group.filter(plan => !plan.expressed.some(fact => allocation[fact.id] === 'later-receipt')), random);
    if (eligible.length < singles) throw new Error(`candidate_single_receipt_capacity:${role}:${eligible.length}<${singles}`);
    const singleIds = new Set(eligible.slice(0, singles).map(plan => plan.memory.id));
    const remaining = shuffle(countPool.filter(count => count !== 1), random);
    for (const plan of group) {
      const count = singleIds.has(plan.memory.id) ? 1 : remaining.shift();
      const observed = Date.parse(plan.memory.eventTime);
      const raw = Array.from({ length: count }, (_, index) => ({
        key: `receipt-${String(index + 1).padStart(2, '0')}`,
        role: random() < .65 ? 'user' : 'assistant', eventTime: new Date(observed - (count - index) * 5 * 60_000).toISOString().replace('.000Z', 'Z'), text: '',
      }));
      // Sorting precedes ordinal ids and placement; never sort ordinal strings.
      plan.memory.spans = shuffle(raw, random).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime) || a.key.localeCompare(b.key, 'en')).map(({ key, ...span }, index) => ({ id: `${plan.memory.id}#s${index + 1}`, ...span }));
      for (const fact of plan.expressed) {
        const where = allocation[fact.id];
        const index = where === 'first-receipt' ? 0 : where === 'later-receipt' ? 1 + Math.floor(random() * (count - 1)) : null;
        plan.memory.expresses.push({ fact: fact.id, where: where === 'body' ? 'body' : 'span', span: index === null ? null : plan.memory.spans[index].id });
      }
    }
  }
  const units = [], fillerRanges = [], topicRanges = [], evidenceRanges = [], measurements = [];
  for (const plan of plans) {
    const { memory, source } = plan;
    for (const [where, span, mode] of [['body', null, 'note'], ...memory.spans.map(span => ['span', span.id, span.role])]) {
      const expressions = memory.expresses.filter(expression => expression.where === where && expression.span === span);
      const core = [{ type: 'topic', text: topic(source, memory.lang, mode) }, ...expressions.map(expression => {
        const fact = facts.find(fact => fact.id === expression.fact);
        return { type: 'evidence', fact: fact.id, text: factText(sourceRows.get(fact.id), memory.lang, Number(fact.id.slice(-2))) };
      })];
      const pool = shuffle(memory.lang === 'mixed' ? [...bank(memory.domain, 'zh', mode), ...bank(memory.domain, 'en', mode)] : bank(memory.domain, memory.lang, mode), random);
      const unit = { memory: memory.id, scale: memory.scale, where, span, mode, core, pool,
        paragraphs: where === 'body' && random() < .45 ? 2 : 1 };
      unit.fits = (where === 'body' ? BODY_BANDS : RECEIPT_BANDS).map((band, index) => fit(unit, band, index));
      units.push(unit);
    }
  }
  for (const scale of ['S300','S1000-extra','foreign']) for (const where of ['body','span']) {
    const group = units.filter(unit => unit.scale === scale && unit.where === where);
    const assigned = allocateBands(group, where === 'body' ? BODY_BANDS : RECEIPT_BANDS, random);
    for (const unit of group) {
      const rendered = assigned.get(unit), memory = plans.find(plan => plan.memory.id === unit.memory).memory;
      if (where === 'body') memory.content = rendered.text;
      else memory.spans.find(span => span.id === unit.span).text = rendered.text;
      const location = { memory: unit.memory, where, span: unit.span };
      for (const range of rendered.ranges) {
        const interval = { ...location, start: range.start, end: range.end };
        if (range.type === 'filler') fillerRanges.push({ sentence: range.sentence, ...interval });
        if (range.type === 'topic') topicRanges.push({ ...interval, text: range.text, template: `topic-${unit.mode}-${memory.lang}` });
        if (range.type === 'evidence') evidenceRanges.push({ fact: range.fact, ...interval });
      }
      measurements.push({ ...location, tokens: rendered.tokens, band: rendered.band, utf16: rendered.text.length });
    }
  }
  const factsFile = { version: VERSION, families, facts, forbiddenLexicon };
  const corpus = { version: VERSION, memories: plans.map(plan => plan.memory),
    filler: { sentences: fillerSentences.map(({ id, text }) => ({ id, text })), ranges: fillerRanges },
    topicalScaffolds: topicRanges };
  return { facts: factsFile, corpus, diagnostics: {
    version: VERSION, prng: PRNG, candidateIndex: candidate, seed, candidateSeedSequence: [...CANDIDATE_SEEDS],
    placementAllocation: allocation, measurements, evidenceRanges,
    factualForms: Object.fromEntries(facts.map(fact => [fact.id, [...new Set([fact.statement, sourceRows.get(fact.id).zh, sourceRows.get(fact.id).en])]])),
    templateDisclosure: { distractorHandMemories: 160, distractorTemplateMemories: 160,
      handEpisodes: HAND_EPISODES, numericTemplates: FABRICATION,
      fillerConstruction: 'ordered domain lead + authored role tail; full sentences disclosed',
      topicalScaffolds: 'role/language topic anchors disclosed separately, never support a canonical fact' },
  } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2), position = args.indexOf('--candidate');
    const candidate = position < 0 ? 0 : Number(args[position + 1]);
    if (args.some((arg, index) => arg !== '--check' && arg !== '--candidate' && !(position >= 0 && index === position + 1))) throw new Error('unsupported_build_option');
    const world = buildWorld(candidate), checking = args.includes('--check');
    for (const [filename, value] of [['hr1-facts.json', world.facts], ['hr1-corpus.json', world.corpus]]) {
      const bytes = serialize(value), path = new URL(filename, fixtureRoot);
      if (checking) {
        if (readFileSync(path, 'utf8') !== bytes) throw new Error(`deterministic_byte_mismatch:${filename}`);
      } else writeFileSync(path, bytes);
      console.log(JSON.stringify({ action: checking ? 'verified' : 'wrote', filename, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes), candidate }));
    }
  } catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
}
