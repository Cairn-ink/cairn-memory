#!/usr/bin/env node
// Local world-author checks only. Does not read queries, tooling, or results.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorld, fixtureRoot } from './build-world.mjs';

const errors = [];
function check(condition, message) { if (!condition) errors.push(message); }
const enumCheck = (value, choices, label) => check(choices.includes(value), `${label}: invalid ${JSON.stringify(value)}`);
const domains = ['engineering','work-preferences','operations','finance','product','everyday'];
const languages = ['zh','en','mixed'];
const factKinds = ['fact','preference','decision','instruction','context','reason','event'];
const memoryKinds = ['fact','preference','decision','instruction','context'];
const factStates = ['current','historical','rejected','proposed'];
const factKeys = ['id','family','kind','state','supersedes','reasonFor','nearDuplicateOf','eventTime','entities','statementLang','statement','rendered','coverage'];
const memoryKeys = ['id','namespace','scale','lang','kind','state','supersedes','eventTime','domain','authoring','content','spans','expresses'];
function keys(obj, expected, label) {
  check(obj !== null && typeof obj === 'object' && !Array.isArray(obj), `${label}: expected object`);
  if (obj === null || typeof obj !== 'object') return;
  check(JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...expected].sort()), `${label}: unexpected/missing fields`);
}
function id(value, label) { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value), `${label}: non-ASCII identifier`); }
function prose(value, max, label) { check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}: invalid text/length`); }
function date(value, label) {
  check(typeof value === 'string' && /^2026-(0[3-9]|10)-[0-3]\dT\d\d:\d\d:\d\dZ$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z','Z') === value, `${label}: invalid/out-of-range eventTime`);
}
function counts(items, get) {
  const result = {};
  for (const item of items) { const key = String(get(item)); result[key] = (result[key] || 0) + 1; }
  return result;
}
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const length = memory => memory.content.length + memory.spans.reduce((sum, span) => sum + span.text.length, 0);
const quantiles = values => {
  const s = [...values].sort((a,b) => a-b);
  return { mean: Number(mean(s).toFixed(3)), p10: s[Math.floor((s.length - 1)*.1)], median: s[Math.floor((s.length - 1)*.5)], p90: s[Math.floor((s.length - 1)*.9)] };
};

const rawFacts = readFileSync(new URL('hr1-facts.json', fixtureRoot), 'utf8');
const rawCorpus = readFileSync(new URL('hr1-corpus.json', fixtureRoot), 'utf8');
const factFile = JSON.parse(rawFacts), corpusFile = JSON.parse(rawCorpus);
keys(factFile, ['version','families','facts'], 'facts root');
keys(corpusFile, ['version','memories'], 'corpus root');
check(factFile.version === 'hr1-fixture-v2' && corpusFile.version === 'hr1-fixture-v2', 'wrong schema version');
assert(Array.isArray(factFile.families) && Array.isArray(factFile.facts) && Array.isArray(corpusFile.memories));
const { families, facts } = factFile, { memories } = corpusFile;
const familyById = new Map(), factById = new Map(), memoryById = new Map();
const bodyIndexes = new Map();
for (const m of memories) {
  if (!bodyIndexes.has(m.namespace)) bodyIndexes.set(m.namespace, { trimmed: new Map(), normalized: new Map() });
  if (typeof m.content !== 'string') continue;
  const trimmed = m.content.trim();
  const normalized = trimmed.replace(/\s+/gu, ' ').toLowerCase();
  const indexes = bodyIndexes.get(m.namespace);
  for (const [mode, key] of [['trimmed', trimmed], ['normalized', normalized]]) {
    const index = indexes[mode];
    check(!index.has(key), `${m.id}: duplicate ${mode} body in namespace ${m.namespace}; matches ${index.get(key)}`);
    if (!index.has(key)) index.set(key, m.id);
  }
}
for (const f of families) {
  keys(f, ['id','role','domain','summary'], `family ${f.id}`); id(f.id, 'family id');
  check(!familyById.has(f.id), `duplicate family ${f.id}`); familyById.set(f.id, f);
  enumCheck(f.role, ['target','distractor','foreign'], f.id); enumCheck(f.domain, domains, f.id); prose(f.summary, 1000, f.id);
}
const incomingFact = new Map(), incomingMemory = new Map(), supports = new Map();
for (const f of facts) {
  keys(f, factKeys, `fact ${f.id}`); id(f.id, 'fact id');
  check(!factById.has(f.id), `duplicate fact ${f.id}`); factById.set(f.id, f);
  check(familyById.has(f.family), `${f.id}: unknown family`);
  enumCheck(f.kind, factKinds, f.id); enumCheck(f.state, factStates, f.id); enumCheck(f.statementLang, languages, f.id);
  prose(f.statement, 4000, f.id); date(f.eventTime, f.id);
  check(Array.isArray(f.entities) && f.entities.length > 0 && new Set(f.entities).size === f.entities.length && f.entities.every(e => typeof e === 'string' && e.trim()), `${f.id}: invalid entities`);
  check(typeof f.rendered === 'boolean', `${f.id}: rendered must be boolean`);
  const role = familyById.get(f.family)?.role;
  if (role === 'target' && /rejected|拒絕|否決/i.test(f.statement)) check(f.state === 'rejected', `${f.id}: rejection wording/state mismatch`);
  if (role === 'target' && /remains proposed|still proposed|仍是提案|仍在提案|仍是.*提案|未獲核准/i.test(f.statement)) check(f.state === 'proposed', `${f.id}: proposal wording/state mismatch`);
  if (role === 'target' && f.rendered) enumCheck(f.coverage, ['body','span-only'], f.id);
  else check(f.coverage === null, `${f.id}: non-target/absent coverage must be null`);
  for (const k of ['supersedes','reasonFor','nearDuplicateOf']) if (f[k] !== null) id(f[k], `${f.id}.${k}`);
  supports.set(f.id, []);
}
for (const f of facts) {
  if (f.supersedes !== null) {
    const old = factById.get(f.supersedes);
    check(old && old.family === f.family && old.state === 'historical' && old.kind === 'decision' && f.kind === 'decision' && f.state === 'current' && f.rendered && old.rendered && old.eventTime < f.eventTime, `${f.id}: invalid fact supersession`);
    incomingFact.set(f.supersedes, (incomingFact.get(f.supersedes) || 0) + 1);
  }
  if (f.reasonFor !== null) {
    const d = factById.get(f.reasonFor);
    check(f.kind === 'reason' && d?.kind === 'decision' && d.family === f.family && d.eventTime <= f.eventTime && f.rendered && d.rendered, `${f.id}: invalid reasonFor`);
  } else check(f.kind !== 'reason', `${f.id}: reason missing reasonFor`);
  if (f.nearDuplicateOf !== null) {
    const t = factById.get(f.nearDuplicateOf);
    check(familyById.get(f.family)?.role === 'foreign' && t && familyById.get(t.family)?.role === 'target' && t.rendered && f.rendered && f.statement !== t.statement && f.entities.some(e => t.entities.includes(e)), `${f.id}: invalid nearDuplicateOf`);
  }
}
for (const m of memories) {
  keys(m, memoryKeys, `memory ${m.id}`); id(m.id, 'memory id');
  check(!memoryById.has(m.id), `duplicate memory ${m.id}`); memoryById.set(m.id, m);
  enumCheck(m.namespace, ['target','foreign'], m.id); enumCheck(m.scale, ['S300','S1000-extra','foreign'], m.id);
  enumCheck(m.lang, languages, m.id); enumCheck(m.kind, memoryKinds, m.id); enumCheck(m.state, ['current','historical'], m.id);
  enumCheck(m.domain, domains, m.id); enumCheck(m.authoring, ['hand','template'], m.id);
  check((m.scale === 'foreign') === (m.namespace === 'foreign'), `${m.id}: namespace/scale mismatch`);
  prose(m.content, 4000, m.id); date(m.eventTime, m.id);
  check(Array.isArray(m.spans) && m.spans.length >= 1 && m.spans.length <= 3, `${m.id}: invalid span count`);
  const spanById = new Map();
  for (const [i, s] of m.spans.entries()) {
    keys(s, ['id','role','eventTime','text'], `span ${s.id}`);
    check(s.id === `${m.id}#s${i+1}` && !spanById.has(s.id), `${m.id}: invalid span ID/order`);
    spanById.set(s.id, s); enumCheck(s.role, ['user','assistant'], s.id); date(s.eventTime, s.id); prose(s.text, 800, s.id);
    check(s.eventTime <= m.eventTime, `${s.id}: span later than memory`);
  }
  check(Array.isArray(m.expresses) && m.expresses.length > 0, `${m.id}: empty expresses`);
  const expressed = new Set();
  for (const e of m.expresses) {
    keys(e, ['fact','where','span'], `${m.id}.expresses`); enumCheck(e.where, ['body','span'], m.id);
    check(spanById.has(e.span), `${m.id}: dangling expresses.span`);
    check(!expressed.has(e.fact), `${m.id}: duplicate fact annotation`); expressed.add(e.fact);
    const f = factById.get(e.fact), family = familyById.get(f?.family);
    check(f?.rendered, `${m.id}: dangling/absent expressed fact`);
    if (!f) continue;
    check(family?.domain === m.domain, `${m.id}: fact/memory domain mismatch`);
    const expectedScale = { target: 'S300', distractor: 'S1000-extra', foreign: 'foreign' }[family?.role];
    check(m.scale === expectedScale, `${m.id}: fact role/scale mismatch`);
    check(m.state === (f.state === 'historical' ? 'historical' : 'current'), `${m.id}: fact/memory lifecycle mismatch`);
    check(m.eventTime >= f.eventTime, `${m.id}: memory predates fact`);
    if (family?.role === 'target') check(e.where === (f.coverage === 'span-only' ? 'span' : 'body'), `${m.id}: fidelity annotation mismatch`);
    supports.get(e.fact).push({ memory: m, where: e.where });
  }
}
for (const m of memories) {
  if (m.supersedes !== null) {
    id(m.supersedes, `${m.id}.supersedes`);
    const old = memoryById.get(m.supersedes);
    check(old && old.state === 'historical' && old.namespace === m.namespace && old.scale === m.scale && old.domain === m.domain && old.eventTime < m.eventTime && m.state === 'current', `${m.id}: invalid memory supersession`);
    check(m.expresses.some(e => factById.get(e.fact)?.supersedes && old?.expresses.some(p => p.fact === factById.get(e.fact).supersedes)), `${m.id}: memory/fact supersession mismatch`);
    incomingMemory.set(m.supersedes, (incomingMemory.get(m.supersedes) || 0) + 1);
  }
  if (m.state === 'historical') check(incomingMemory.get(m.id) === 1 || memories.some(n => n.supersedes === m.id), `${m.id}: historical memory not superseded`);
}
for (const f of facts) {
  const members = supports.get(f.id);
  check(f.rendered ? members.length > 0 : members.length === 0, `${f.id}: rendered/absent support mismatch`);
  if (f.state === 'historical') check(incomingFact.get(f.id) === 1, `${f.id}: historical fact not superseded exactly once`);
  if (familyById.get(f.family)?.role === 'target' && f.rendered) {
    const actual = members.some(e => e.where === 'body') ? 'body' : 'span-only';
    check(f.coverage === actual, `${f.id}: actual coverage disagrees`);
    check(members.some(e => e.memory.state === (f.state === 'historical' ? 'historical' : 'current')), `${f.id}: no lifecycle-eligible member`);
  }
}

const targets = families.filter(f => f.role === 'target');
const targetFacts = facts.filter(f => familyById.get(f.family)?.role === 'target');
const rendered = targetFacts.filter(f => f.rendered), absent = targetFacts.filter(f => !f.rendered);
const s300 = memories.filter(m => m.scale === 'S300'), extra = memories.filter(m => m.scale === 'S1000-extra'), foreign = memories.filter(m => m.scale === 'foreign');
check(targets.length >= 40, 'fewer than 40 target families');
for (const domain of domains) check(targets.some(f => f.domain === domain), `no target families in ${domain}`);
for (const family of targets) {
  const ff = targetFacts.filter(f => f.family === family.id);
  check(ff.length >= 5 && ff.length <= 10, `${family.id}: outside 5–10 facts`);
  const fm = s300.filter(m => m.expresses.some(e => factById.get(e.fact)?.family === family.id));
  for (const f of ff.filter(f => f.rendered)) {
    const alternative = fm.some(m => !m.expresses.some(e => e.fact === f.id) && m.expresses.some(e => factById.get(e.fact).entities.some(entity => f.entities.includes(entity))));
    check(alternative, `${f.id}: lacks same-family, same-entity hard negative`);
  }
  const d = ff.find(f => f.kind === 'decision' && f.state === 'current');
  const reason = ff.find(f => f.reasonFor === d?.id);
  check(d && reason && !fm.some(m => m.expresses.some(e => e.fact === d.id) && m.expresses.some(e => e.fact === reason.id)), `${family.id}: decision/reason not in separate memories`);
}
const spanOnly = rendered.filter(f => f.coverage === 'span-only').length;
for (const f of rendered.filter(f=>f.coverage==='span-only')) {
  const numericTerms = [...f.statement.matchAll(/(?:NT\$|US\$)?\d[\d,.]*(?:\s?(?:MB|seconds|minutes|days|mm))?/g)].map(m=>m[0]);
  for (const term of numericTerms) check(supports.get(f.id).some(({memory})=>memory.spans.some(s=>s.text.includes(term))), `${f.id}: distinctive numeric term missing verbatim from spans: ${term}`);
}
check(spanOnly/rendered.length >= .35 && spanOnly/rendered.length <= .45, 'target span-only coverage outside 35–45%');
check(absent.length >= 14 && absent.length <= 16 && new Set(absent.map(f => f.family)).size >= 10, 'absent fact count/spread out of range');
const changes = new Set(targetFacts.filter(f => f.supersedes).map(f => f.family));
check(changes.size >= 12, 'fewer than twelve supersession families');
for (const family of changes) check(targetFacts.some(f => f.family === family && f.reasonFor && factById.get(f.reasonFor)?.supersedes), `${family}: changed decision missing reason`);
const nearDuplicates = facts.filter(f => f.nearDuplicateOf);
check(nearDuplicates.length >= 20, 'fewer than twenty foreign near-duplicates');
const foreignAnchors = facts.filter(f=>familyById.get(f.family)?.role==='foreign' && !f.nearDuplicateOf && f.entities.some(e=>/^[A-Z]+-\d{3}$/.test(e)));
check(foreignAnchors.length === 10 && new Set(foreignAnchors.map(f=>f.family)).size === 10, 'foreign-only anchors must span ten families');
for (const f of foreignAnchors) for (const term of f.entities.filter(e=>/^[A-Z]+-\d{3}$/.test(e))) {
  check(memories.some(m=>m.namespace==='foreign' && m.expresses.some(e=>e.fact===f.id) && m.spans.some(s=>s.text.includes(term))), `${f.id}: anchor code has no foreign evidence`);
  check(!memories.some(m=>m.namespace==='target' && [m.content,...m.spans.map(s=>s.text)].some(t=>t.includes(term))), `${f.id}: foreign anchor code leaked to target namespace`);
}
check(s300.length === 300 && extra.length === 700 && foreign.length === 100, 'world must contain exactly 300 / 700 / 100 memories');
check(extra.filter(m => m.authoring === 'template').length <= extra.length/2, 'over half of extras are templates');

const embeddedFamilies = new Set();
for (const f of rendered) for (const term of f.entities.filter(e => /^\p{Script=Han}{2,4}$/u.test(e))) {
  for (const { memory } of supports.get(f.id)) {
    const texts = [memory.content, ...memory.spans.map(s => s.text)];
    if (texts.some(t => [...t.matchAll(/\p{Script=Han}+/gu)].some(([run]) => run.length > term.length && run.includes(term)))) embeddedFamilies.add(f.family);
  }
}
check(embeddedFamilies.size >= 14, 'insufficient independent families with embedded Chinese entity terms');
const crossed = rendered.filter(f => !supports.get(f.id).some(({ memory }) => memory.lang === f.statementLang));
check(new Set(crossed.map(f => f.family)).size >= 20, 'fewer than twenty families with cross-language canonical/rendered facts');
const crossDirections = counts(crossed, f => `${f.statementLang}->${supports.get(f.id)[0].memory.lang}`);
check((crossDirections['en->zh'] || 0) >= 10 && (crossDirections['zh->en'] || 0) >= 10, 'cross-language directions underrepresented');

const scaleStats = {};
for (const [scale, rows] of [['S300',s300],['S1000-extra',extra],['S1000',[...s300,...extra]],['foreign',foreign]]) {
  const language = counts(rows, m => m.lang), spanCount = counts(rows, m => m.spans.length);
  for (const [lang, proportion] of [['zh',.55],['en',.30],['mixed',.15]]) check(Math.abs((language[lang] || 0)/rows.length-proportion) <= .025, `${scale}: language distribution off`);
  scaleStats[scale] = { count: rows.length, namespace: counts(rows,m=>m.namespace), language, domain: counts(rows,m=>m.domain), authoring: counts(rows,m=>m.authoring), state: counts(rows,m=>m.state), spanCount,
    lengthUTF16: quantiles(rows.map(length)), bodyUTF16: quantiles(rows.map(m=>m.content.length)), spanTextUTF16: quantiles(rows.map(m=>m.spans.reduce((a,s)=>a+s.text.length,0))),
    lengthByLanguage: Object.fromEntries(languages.map(lang => [lang,quantiles(rows.filter(m=>m.lang===lang).map(length))])),
  };
}
const lengthRatio = mean(extra.map(length))/mean(s300.map(length));
check(lengthRatio >= .85 && lengthRatio <= 1.15, `extra mean length ratio ${lengthRatio.toFixed(4)} outside 15%`);
for (const lang of languages) {
  const ratio = mean(extra.filter(m=>m.lang===lang).map(length))/mean(s300.filter(m=>m.lang===lang).map(length));
  check(ratio >= .85 && ratio <= 1.15, `${lang}: extra mean length ratio ${ratio.toFixed(4)} outside 15%`);
}
for (const n of [1,2,3]) check(Math.abs(s300.filter(m=>m.spans.length===n).length/s300.length-extra.filter(m=>m.spans.length===n).length/extra.length) < .01, 'span-count distributions differ');
for (const domain of domains) check(Math.abs(s300.filter(m=>m.domain===domain).length/s300.length-extra.filter(m=>m.domain===domain).length/extra.length) < .01, `domain distribution mismatch: ${domain}`);

// Exact-text leakage is a useful guard, not a semantic entailment proof.
for (const f of rendered) {
  for (const m of memories) {
    if (m.expresses.some(e=>e.fact===f.id)) continue;
    const complete = f.statement.replace(/[。.]$/, '');
    check(![m.content,...m.spans.map(s=>s.text)].some(t=>t.includes(complete)), `${m.id}: unannotated exact target statement ${f.id}`);
  }
}
const rebuilt = buildWorld();
check(rawFacts === JSON.stringify(rebuilt.facts,null,2)+'\n', 'facts not byte-identical to deterministic build');
check(rawCorpus === JSON.stringify(rebuilt.corpus,null,2)+'\n', 'corpus not byte-identical to deterministic build');

// Independent aggregation: reverse-index membership versus flat expresses scan.
const reverseCount = [...supports.values()].reduce((n, members)=>n+members.length,0);
const forwardCount = memories.reduce((n,m)=>n+m.expresses.length,0);
check(reverseCount === forwardCount, 'forward/reverse annotation counts disagree');
const stats = {
  families: { total: families.length, byRole: counts(families,f=>f.role), byRoleAndDomain: counts(families,f=>`${f.role}/${f.domain}`) },
  facts: { total: facts.length, byKind: counts(facts,f=>f.kind), byState: counts(facts,f=>f.state), byCoverage: counts(facts,f=>f.coverage),
    target: { total: targetFacts.length, rendered: rendered.length, absent: absent.length, byKind: counts(targetFacts,f=>f.kind), byState: counts(targetFacts,f=>f.state), byCoverage: counts(targetFacts,f=>f.coverage), spanOnlyFraction: spanOnly/rendered.length } },
  memories: scaleStats, changes: changes.size, absentFamilies: new Set(absent.map(f=>f.family)).size,
  foreignNearDuplicates: nearDuplicates.length, foreignAnchorFamilies: new Set(foreignAnchors.map(f=>f.family)).size,
  embeddedChineseFamilies: embeddedFamilies.size, crossLanguageDirections: crossDirections,
  extraToTargetMeanLengthRatio: Number(lengthRatio.toFixed(5)), annotationsCrossChecked: forwardCount,
  bodyUniqueness: Object.fromEntries([...bodyIndexes].map(([namespace, indexes])=>[namespace, {
    memories: memories.filter(m=>m.namespace===namespace).length,
    trimmed: indexes.trimmed.size, normalized: indexes.normalized.size,
  }])),
};
console.log(JSON.stringify({ ...stats, checksPassed: errors.length === 0 },null,2));
if (errors.length) {
  console.error(`FAIL: ${errors.length} checks failed`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (!process.argv.includes('--json')) console.log('PASS: schema, references, lifecycle, coverage, counts, distributions, namespace body uniqueness, exact-text leakage and deterministic rebuild; semantic entailment requires W3 audit.');
