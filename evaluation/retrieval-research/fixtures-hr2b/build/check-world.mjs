// W1 stage 1 only. Never loads queries, split, labels, rankings or assembly.
import { readFileSync, writeFileSync, readdirSync, lstatSync, openSync, closeSync, unlinkSync, fstatSync, readSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, relative, join } from 'node:path';
import { buildWorld, fixtureRoot, tokens, normalize, serialize, sha256 } from './build-world.mjs';
import { buildWorld as hr1PatternWorld } from '../../fixtures/build/build-world.mjs';
import { VERSION, CANDIDATE_SEEDS, DOMAINS, LANGS, BODY_BANDS, RECEIPT_BANDS, RECEIPT_COUNTS,
  PLACEMENTS, LANGUAGE_SHARES } from './config.mjs';
import { fillerSentences } from './filler.mjs';
// Only file-list/Git utilities are imported; the retained identity gate is not run.
import { OWNED_FILES, PREFIX, gitText, headBytes } from './check-identity.mjs';

const ROOT = fileURLToPath(fixtureRoot);
const PROTOCOL = {revision:'v1.1',freezeCommit:'d3a6e24f'};
const V1_REJECTION = '16 placement-quota errors: dev:first-receipt:groups_minimum_30, dev:first-receipt:families_minimum_12, dev:later-receipt:groups_minimum_30, dev:later-receipt:families_minimum_12, dev:guard:{C1,C2,C3,C4,C5,C7}:family_minimum, test:guard:{C1,C2,C4,C5,C6,C7}:family_minimum (later-receipt test families per category C1–C7 6/7/11/8/7/8/3); 81 memories with 5–6 receipts refused by the public-admission preflight (core admit cap 4)';
const V11_RESOLUTION = {
  exitCode:1,validationRecord:'build/candidate0-v11-identity/',
  placement_allocation_identical:false,fact_to_memory_plan_identical:false,
  fact_to_memory_plan_changed_from_memory_index:160,facts_view_bytes_identical:false,
  facts_view_difference:'facts view carries distractor coverage',
  facts_identical:true,families_identical:true,lexicon_identical:true,target_coverage_identical:true,
  provenance:'Coordinator resolution supplied in the seed-advance task; retained record was not opened.',
};
const GENERATOR_FILES = ['build/build-world.mjs','build/config.mjs','build/targets.mjs','build/distractors.mjs','build/foreign.mjs','build/filler.mjs','build/source.mjs'];
const count = values => Object.fromEntries([...new Set(values)].sort().map(key => [key, values.filter(value => value === key).length]));
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rounded = value => Math.round(value * 10000) / 10000;
const bandOf = (value, bands) => bands.findIndex(([lo, hi], index) => value >= lo && (value < hi || index === bands.length - 1 && value === hi));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function checkWorld(candidate = 0) {
  const errors = [], check = (condition, code, detail) => { if (!condition) errors.push({ code, ...(detail === undefined ? {} : { detail }) }); };
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const keys = (value, expected, label) => check(value && same(Object.keys(value).sort(), [...expected].sort()), 'schema:keys', label);
  const uniqueMap = (items, label) => {
    const map = new Map();
    for (const item of items) {
      check(typeof item.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(item.id), 'schema:ascii_id', `${label}:${item.id}`);
      check(!map.has(item.id), 'schema:duplicate_id', item.id); map.set(item.id, item);
    }
    return map;
  };
  const rawFacts = readFileSync(join(ROOT, 'hr1-facts.json'), 'utf8'), rawCorpus = readFileSync(join(ROOT, 'hr1-corpus.json'), 'utf8');
  const factsFile = JSON.parse(rawFacts), corpus = JSON.parse(rawCorpus), { families, facts } = factsFile, { memories } = corpus;
  const tokenizerVersion = JSON.parse(readFileSync(new URL('../../node_modules/tiktoken/package.json',import.meta.url),'utf8')).version;
  check(tokenizerVersion === '1.0.22','counter:version',tokenizerVersion);
  check(factsFile.version === VERSION && corpus.version === VERSION, 'schema:version');
  keys(factsFile, ['version','families','facts','forbiddenLexicon'], 'facts root');
  keys(corpus, ['version','memories','filler','topicalScaffolds'], 'corpus root');
  const fm = uniqueMap(families, 'family'), ff = uniqueMap(facts, 'fact'), mm = uniqueMap(memories, 'memory');
  const supports = new Map(facts.map(fact => [fact.id, []])), units = new Map(), normalizedBodies = new Set();
  const familyRole = fact => fm.get(fact.family)?.role;
  const roleScale = { target: 'S300', distractor: 'S1000-extra', foreign: 'foreign' };
  for (const family of families) {
    keys(family, ['id','role','domain','summary'], family.id);
    check(Object.hasOwn(roleScale, family.role) && DOMAINS.includes(family.domain) && text(family.summary), 'schema:family', family.id);
  }
  for (const fact of facts) {
    keys(fact, ['id','family','kind','state','supersedes','reasonFor','nearDuplicateOf','eventTime','entities','statementLang','statement','rendered','coverage'], fact.id);
    check(fm.has(fact.family), 'fact:family', fact.id);
    check(['fact','preference','decision','instruction','context','reason','event'].includes(fact.kind) && ['current','historical','rejected','proposed'].includes(fact.state), 'fact:enums', fact.id);
    check(LANGS.includes(fact.statementLang) && text(fact.statement) && time(fact.eventTime) && typeof fact.rendered === 'boolean', 'fact:metadata', fact.id);
    check(Array.isArray(fact.entities) && fact.entities.length && new Set(fact.entities).size === fact.entities.length && fact.entities.every(text), 'fact:entities', fact.id);
    check(familyRole(fact) === 'target' && fact.rendered ? ['body','span-only'].includes(fact.coverage) : fact.coverage === null, 'fact:coverage', fact.id);
    for (const field of ['supersedes','reasonFor','nearDuplicateOf']) check(fact[field] === null || ff.has(fact[field]) && fact[field] !== fact.id, `fact:${field}:reference`, fact.id);
    if (fact.supersedes) {
      const old = ff.get(fact.supersedes);
      check(old?.family === fact.family && old.kind === 'decision' && old.state === 'historical' && fact.kind === 'decision' && fact.state === 'current' && Date.parse(old.eventTime) < Date.parse(fact.eventTime), 'fact:supersession', fact.id);
    }
    if (fact.state === 'historical') check(facts.filter(next => next.supersedes === fact.id).length === 1, 'fact:historical_successor', fact.id);
    if (fact.reasonFor) check(fact.kind === 'reason' && ff.get(fact.reasonFor)?.family === fact.family && ff.get(fact.reasonFor)?.kind === 'decision' && Date.parse(ff.get(fact.reasonFor).eventTime) <= Date.parse(fact.eventTime), 'fact:reasonFor', fact.id);
    if (fact.kind === 'reason') check(fact.reasonFor !== null, 'fact:reason_link', fact.id);
    if (fact.nearDuplicateOf) {
      const target = ff.get(fact.nearDuplicateOf);
      check(familyRole(fact) === 'foreign' && familyRole(target) === 'target' && target.rendered && fact.statement !== target.statement && fact.entities.some(entity => target.entities.includes(entity)), 'fact:foreign_near_duplicate', fact.id);
    }
    const visited = new Set([fact.id]); let cursor = fact;
    while (cursor?.supersedes && ff.has(cursor.supersedes)) {
      if (visited.has(cursor.supersedes)) { check(false, 'fact:cycle', fact.id); break; }
      visited.add(cursor.supersedes); cursor = ff.get(cursor.supersedes);
    }
  }
  for (const memory of memories) {
    keys(memory, ['id','namespace','scale','lang','kind','state','supersedes','eventTime','domain','authoring','content','spans','expresses'], memory.id);
    check(['target','foreign'].includes(memory.namespace) && Object.values(roleScale).includes(memory.scale) && (memory.namespace === 'foreign') === (memory.scale === 'foreign'), 'memory:scale_namespace', memory.id);
    check(['fact','preference','decision','instruction','context'].includes(memory.kind) && ['current','historical'].includes(memory.state) && LANGS.includes(memory.lang) && DOMAINS.includes(memory.domain) && ['hand','template'].includes(memory.authoring) && time(memory.eventTime), 'memory:metadata', memory.id);
    check(text(memory.content) && memory.content.length <= 4000, 'memory:content', memory.id);
    const paragraphs = memory.content.split('\n\n');
    const sentences = memory.content.match(/[.!?。！？]/gu)?.length ?? 0;
    check(sentences >= 3 && sentences <= 8 && paragraphs.length >= 1 && paragraphs.length <= 2 && !paragraphs.some(paragraph => !paragraph.trim() || /\n/u.test(paragraph)), 'memory:sentences_paragraphs', memory.id);
    check(/[.!?。！？]$/u.test(memory.content), 'memory:whole_sentences', memory.id);
    const bodyKey = `${memory.namespace}:${normalize(memory.content)}`;
    check(!normalizedBodies.has(bodyKey), 'memory:duplicate_normalized_body', memory.id); normalizedBodies.add(bodyKey);
    units.set(`${memory.id}:body`, { memory, where: 'body', span: null, text: memory.content });
    check(memory.spans.length >= 1 && memory.spans.length <= 4, 'memory:receipt_count', memory.id);
    memory.spans.forEach((span, index) => {
      keys(span, ['id','role','eventTime','text'], span.id);
      check(index < 4 && span.id === `${memory.id}#s${index + 1}` && ['user','assistant'].includes(span.role) && time(span.eventTime) && text(span.text) && span.text.length <= 800, 'span:metadata', span.id);
      check(/[.!?。！？]$/u.test(span.text), 'span:whole_sentences', span.id);
      check(Date.parse(span.eventTime) <= Date.parse(memory.eventTime), 'span:future', span.id);
      const previous = memory.spans[index - 1];
      check(!previous || Date.parse(previous.eventTime) < Date.parse(span.eventTime) || Date.parse(previous.eventTime) === Date.parse(span.eventTime) && previous.id < span.id, 'span:chronological_order', span.id);
      units.set(span.id, { memory, where: 'span', span: span.id, text: span.text });
    });
    const seen = new Set();
    for (const expression of memory.expresses) {
      keys(expression, ['fact','where','span'], memory.id);
      const fact = ff.get(expression.fact), family = fm.get(fact?.family);
      check(fact?.rendered && ['body','span'].includes(expression.where) && (expression.where === 'body' ? expression.span === null : memory.spans.some(span => span.id === expression.span)), 'expression:reference', memory.id);
      check(!seen.has(expression.fact), 'expression:duplicate', memory.id); seen.add(expression.fact);
      if (!fact) continue;
      check(memory.scale === roleScale[family?.role] && memory.domain === family?.domain && Date.parse(memory.eventTime) >= Date.parse(fact.eventTime), 'expression:scope_time', memory.id);
      if (fact.kind === 'decision') check((fact.state === 'historical') === (memory.state === 'historical'), 'expression:lifecycle', memory.id);
      supports.get(fact.id).push({ memory, expression });
    }
    if (memory.scale !== 'foreign') check(seen.size >= 2 && seen.size <= 4 && new Set([...seen].map(id => ff.get(id)?.family)).size === 1, 'memory:fact_count_family', memory.id);
    check(memory.supersedes === null || mm.has(memory.supersedes), 'memory:supersedes_reference', memory.id);
    if (memory.supersedes) {
      const old = mm.get(memory.supersedes);
      check(old?.state === 'historical' && memory.state === 'current' && old.namespace === memory.namespace && old.scale === memory.scale && Date.parse(old.eventTime) < Date.parse(memory.eventTime), 'memory:supersession', memory.id);
      check(memory.expresses.some(expression => old.expresses.some(previous => ff.get(expression.fact)?.supersedes === previous.fact)), 'memory:supersession_fact_link', memory.id);
    }
    if (memory.state === 'historical') check(memories.some(next => next.supersedes === memory.id), 'memory:historical_successor', memory.id);
  }
  const placement = {}, actualPlacement = {};
  for (const role of ['target','distractor','foreign']) {
    const rendered = facts.filter(fact => familyRole(fact) === role && fact.rendered);
    for (const fact of rendered) {
      const placements = supports.get(fact.id).map(({ memory, expression }) => expression.where === 'body' ? 'body' : expression.span === memory.spans[0].id ? 'first-receipt' : 'later-receipt');
      check(placements.length > 0 && new Set(placements).size === 1, 'fact:inconsistent_placement', fact.id);
      actualPlacement[fact.id] = placements[0];
      if (placements[0] === 'later-receipt') check(supports.get(fact.id).every(({ memory }) => memory.spans.length >= 2), 'fact:later_single_receipt', fact.id);
      if (role === 'target') check(fact.coverage === (placements[0] === 'body' ? 'body' : 'span-only'), 'fact:actual_coverage', fact.id);
    }
    placement[role] = { facts: rendered.length, counts: count(rendered.map(fact => actualPlacement[fact.id])) };
    placement[role].shares = Object.fromEntries(PLACEMENTS.map(([key, share]) => {
      const actual = (placement[role].counts[key] ?? 0) / rendered.length;
      check(Math.abs(actual - share) <= .05 + 1e-12, 'fact:placement_share', `${role}/${key}`); return [key, rounded(actual)];
    }));
  }
  for (const fact of facts) {
    check(fact.rendered ? supports.get(fact.id).length > 0 : supports.get(fact.id).length === 0, 'fact:rendered_consistency', fact.id);
    if (fact.supersedes && fact.rendered) check(supports.get(fact.id).some(({ memory }) => supports.get(fact.supersedes).some(old => old.memory.id === memory.supersedes)), 'fact:missing_memory_supersession', fact.id);
  }
  const targetFamilies = families.filter(family => family.role === 'target');
  check(targetFamilies.length >= 40, 'family:target_minimum');
  check(families.filter(family => family.role === 'distractor').length === 40, 'family:distractor_count');
  for (const domain of DOMAINS) check(targetFamilies.some(family => family.domain === domain), 'family:missing_domain', domain);
  for (const family of families.filter(family => family.role !== 'foreign')) {
    const familyFacts = facts.filter(fact => fact.family === family.id), familyMemories = memories.filter(memory => memory.expresses.some(expression => ff.get(expression.fact)?.family === family.id));
    if (family.role === 'target') check(familyFacts.filter(fact => fact.rendered).length === 7 && familyFacts.filter(fact => !fact.rendered).length === 1, 'family:seven_plus_absent', family.id);
    const old = familyFacts.find(fact => fact.state === 'historical'), next = familyFacts.find(fact => fact.supersedes === old?.id), reason = familyFacts.find(fact => fact.reasonFor === next?.id);
    check(old && next && reason && !familyMemories.some(memory => memory.expresses.some(expression => expression.fact === next.id) && memory.expresses.some(expression => expression.fact === reason.id)), 'family:decision_reason_separation', family.id);
    const owner = familyFacts.find(fact => fact.id.endsWith('-05')), near = familyFacts.find(fact => fact.id.endsWith('-06'));
    check(owner && near && !familyMemories.some(memory => memory.expresses.some(expression => expression.fact === owner.id) && memory.expresses.some(expression => expression.fact === near.id)), 'family:assignment_near_miss_separation', family.id);
    for (const fact of familyFacts.filter(fact => fact.rendered)) check(familyMemories.some(memory => !memory.expresses.some(expression => expression.fact === fact.id)), 'family:missing_hard_negative', fact.id);
    check(familyFacts.some(fact => fact.state === 'rejected' || fact.state === 'proposed'), 'family:missing_option', family.id);
  }
  const nearDuplicates = facts.filter(fact => fact.nearDuplicateOf);
  check(nearDuplicates.length >= 20, 'foreign:near_duplicate_count');
  const anchors = facts.filter(fact => familyRole(fact) === 'foreign' && fact.entities.some(entity => /^[A-Z]+-\d{3}$/u.test(entity)));
  check(anchors.length === 10 && new Set(anchors.map(fact => fact.family)).size === 10, 'foreign:anchor_spread');
  for (const fact of anchors) for (const code of fact.entities.filter(entity => /^[A-Z]+-\d{3}$/u.test(entity)))
    check(![...units.values()].some(unit => unit.memory.namespace === 'target' && unit.text.includes(code)), 'foreign:anchor_leak', fact.id);

  const lexicon = factsFile.forbiddenLexicon;
  check(same(Object.keys(lexicon).sort(), facts.map(fact => fact.id).sort()), 'filler:lexicon_keys');
  const forbidden = [];
  for (const fact of facts) {
    const terms = lexicon[fact.id];
    check(Array.isArray(terms) && terms.length && terms.every(text), 'filler:lexicon_missing', fact.id);
    for (const entity of fact.entities) check(terms.includes(normalize(entity)), 'filler:entity_missing', `${fact.id}:${entity}`);
    for (const term of terms) forbidden.push({ fact: fact.id, term: normalize(term) });
  }
  const sentences = uniqueMap(corpus.filler.sentences, 'filler');
  const lexiconHits = [];
  for (const sentence of sentences.values()) {
    const normalized = normalize(sentence.text);
    for (const item of forbidden) if (normalized.includes(item.term)) lexiconHits.push({ sentence: sentence.id, ...item });
  }
  check(lexiconHits.length === 0, 'filler:forbidden_lexicon_hit', lexiconHits.slice(0, 30));
  const byUnit = new Map(), disclosedUnits = new Set(), clauseUse = new Map(), bankMetadata = new Map(fillerSentences.map(sentence=>[sentence.id,sentence]));
  for (const range of corpus.filler.ranges) {
    keys(range, ['sentence','memory','where','span','start','end'], 'filler range');
    const key = range.where === 'body' ? `${range.memory}:body` : range.span, unit = units.get(key), sentence = sentences.get(range.sentence);
    check(unit && unit.memory.id === range.memory && unit.where === range.where && unit.span === range.span && sentence && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end <= unit.text.length && unit.text.slice(range.start, range.end) === sentence.text, 'filler:range_mismatch', key);
    const prior = byUnit.get(key);
    check(!prior || prior <= range.start, 'filler:range_order_overlap', key); byUnit.set(key, range.end); disclosedUnits.add(key);
    if (!clauseUse.has(key)) clauseUse.set(key,{leads:new Set(),tails:new Set()});
    const used = clauseUse.get(key), metadata = bankMetadata.get(range.sentence);
    check(metadata && !used.leads.has(metadata.lead) && !used.tails.has(metadata.tail),'filler:repeated_clause',key);
    if (metadata) { used.leads.add(metadata.lead);used.tails.add(metadata.tail); }
  }
  for (const key of units.keys()) check(disclosedUnits.has(key), 'filler:undisclosed_unit', key);
  for (const range of corpus.topicalScaffolds) {
    const unit = units.get(range.where === 'body' ? `${range.memory}:body` : range.span);
    check(unit?.text.slice(range.start, range.end) === range.text, 'topic:range_mismatch', range.memory);
  }
  const scales = {}, bandLabel = bands => bands.map(([lo, hi]) => `${lo}-${hi}`);
  for (const [scale, expected] of [['S300',160],['S1000-extra',320],['foreign',60]]) {
    const rows = memories.filter(memory => memory.scale === scale), receipts = rows.flatMap(memory => memory.spans);
    const bodyTokens = rows.map(memory => tokens(memory.content)), receiptTokens = receipts.map(span => tokens(span.text));
    check(Math.abs(rows.length - expected) <= expected * .1 + 1e-12, 'corpus:count', scale);
    const bodyBands = count(bodyTokens.map(value => bandOf(value, BODY_BANDS))), receiptBands = count(receiptTokens.map(value => bandOf(value, RECEIPT_BANDS)));
    check(!Object.hasOwn(bodyBands, '-1') && !Object.hasOwn(receiptBands, '-1'), 'corpus:token_limits', scale);
    for (const [counts, bands, denominator, label] of [[bodyBands,BODY_BANDS,rows.length,'body'],[receiptBands,RECEIPT_BANDS,receipts.length,'receipt']])
      bands.forEach((band, index) => check(Math.abs((counts[index] ?? 0) / denominator - band[2]) <= .05 + 1e-12, 'corpus:token_band_share', `${scale}/${label}/${index}`));
    const histogram = count(rows.map(memory => memory.spans.length)), language = count(rows.map(memory => memory.lang));
    for (const [n, share] of RECEIPT_COUNTS) check(Math.abs((histogram[n] ?? 0) / rows.length - share) <= .05 + 1e-12, 'corpus:receipt_histogram', `${scale}/${n}`);
    for (const [lang, share] of LANGUAGE_SHARES) check(Math.abs((language[lang] ?? 0) / rows.length - share) <= .05 + 1e-12, 'corpus:language_share', `${scale}/${lang}`);
    scales[scale] = { count: rows.length, namespace: count(rows.map(memory => memory.namespace)), domain: count(rows.map(memory => memory.domain)), languages: language,
      memoryState: count(rows.map(memory => memory.state)), memoryKind: count(rows.map(memory => memory.kind)), authoring: count(rows.map(memory => memory.authoring)),
      bodyRoles: { assistant: rows.length }, receiptRoles: count(receipts.map(span => span.role)), receipts: receipts.length, receiptCountHistogram: histogram,
      bodyTokens: { bands: Object.fromEntries(bandLabel(BODY_BANDS).map((label, index) => [label,bodyBands[index] ?? 0])), mean: rounded(mean(bodyTokens)), min: Math.min(...bodyTokens), max: Math.max(...bodyTokens) },
      receiptTokens: { bands: Object.fromEntries(bandLabel(RECEIPT_BANDS).map((label, index) => [label,receiptBands[index] ?? 0])), mean: rounded(mean(receiptTokens)), min: Math.min(...receiptTokens), max: Math.max(...receiptTokens) },
      bodyUTF16Mean: rounded(mean(rows.map(memory => memory.content.length))), receiptUTF16Mean: rounded(mean(receipts.map(span => span.text.length))),
      meanTokensByLanguage: Object.fromEntries(LANGS.map(lang => [lang, rounded(mean(rows.filter(memory => memory.lang === lang).map(memory => tokens(memory.content) + memory.spans.reduce((sum,span) => sum + tokens(span.text),0))))])),
    };
  }
  const base = scales.S300, extra = scales['S1000-extra'];
  for (const [field, a, b] of [['body tokens',base.bodyTokens.mean,extra.bodyTokens.mean],['receipt tokens',base.receiptTokens.mean,extra.receiptTokens.mean],['body UTF16',base.bodyUTF16Mean,extra.bodyUTF16Mean],['receipt UTF16',base.receiptUTF16Mean,extra.receiptUTF16Mean]])
    check(Math.abs(b / a - 1) <= .15 + 1e-12, 'distractor:mean_match', { field, ratio: b/a });
  for (const [n] of RECEIPT_COUNTS) check(Math.abs(base.receiptCountHistogram[n]/base.count - extra.receiptCountHistogram[n]/extra.count) <= .05 + 1e-12, 'distractor:histogram_match', n);
  for (const domain of DOMAINS) check(Math.abs((base.domain[domain] ?? 0)/base.count - (extra.domain[domain] ?? 0)/extra.count) <= .05 + 1e-12, 'distractor:domain_match', domain);
  for (const lang of LANGS) check(Math.abs(extra.meanTokensByLanguage[lang]/base.meanTokensByLanguage[lang]-1) <= .15 + 1e-12,'distractor:language_mean_match',lang);
  for (const key of PLACEMENTS.map(([key]) => key)) check(Math.abs(placement.target.shares[key] - placement.distractor.shares[key]) <= .05 + 1e-12, 'distractor:placement_match', key);
  check((extra.authoring.template ?? 0) / extra.count <= .5, 'distractor:template_share');
  const oldStatements = new Set(hr1PatternWorld().facts.facts.map(fact => fact.statement));
  const overlaps = facts.filter(fact => oldStatements.has(fact.statement));
  check(overlaps.length === 0, 'world:hr1_statement_overlap', overlaps.map(fact => fact.id));
  const rebuilt = buildWorld(candidate);
  check(rawFacts === serialize(rebuilt.facts) && rawCorpus === serialize(rebuilt.corpus), 'world:deterministic_bytes');
  check(same(actualPlacement, rebuilt.diagnostics.placementAllocation), 'world:placement_allocation');
  let exactLeakage = 0;
  for (const fact of facts) for (const form of rebuilt.diagnostics.factualForms[fact.id]) for (const unit of units.values()) {
    if (!unit.text.includes(form)) continue;
    if (!unit.memory.expresses.some(expression => expression.fact === fact.id && expression.where === unit.where && expression.span === unit.span)) {
      exactLeakage++; check(false, 'world:unannotated_exact_fact', { fact: fact.id, memory: unit.memory.id, span: unit.span });
    }
  }
  for (const range of rebuilt.diagnostics.evidenceRanges) {
    const unit = units.get(range.where === 'body' ? `${range.memory}:body` : range.span);
    check(rebuilt.diagnostics.factualForms[range.fact].includes(unit.text.slice(range.start,range.end)), 'world:evidence_range', range.fact);
  }
  const forwardAnnotations = memories.reduce((sum, memory) => sum + memory.expresses.length, 0), reverseAnnotations = [...supports.values()].reduce((sum, entries) => sum + entries.length, 0);
  check(forwardAnnotations === reverseAnnotations, 'world:annotation_cross_check');
  const crossed = facts.filter(fact => familyRole(fact) === 'target' && fact.rendered && !supports.get(fact.id).some(({memory}) => memory.lang === fact.statementLang));
  const crossDirections = count(crossed.map(fact => `${fact.statementLang}->${supports.get(fact.id)[0].memory.lang}`));
  check((crossDirections['zh->en'] ?? 0) >= 10 && (crossDirections['en->zh'] ?? 0) >= 10, 'world:cross_language_spread');
  const statistics = {
    counter: { package:'tiktoken',version:tokenizerVersion,encoding:'o200k_base' },
    families: { total: families.length, byRole: count(families.map(family => family.role)), byRoleAndDomain: count(families.map(family => `${family.role}/${family.domain}`)) },
    facts: { total: facts.length, byRole: count(facts.map(fact => familyRole(fact))), byState: count(facts.map(fact => fact.state)), byKind: count(facts.map(fact => fact.kind)),
      absentByRole: count(facts.filter(fact => !fact.rendered).map(fact => familyRole(fact))) },
    scales, placement, memoryLanguages: count(memories.map(memory => memory.lang)),
    bodyRoles: { assistant: memories.length }, receiptRoles: count(memories.flatMap(memory => memory.spans.map(span => span.role))),
    crossLanguageDirections: crossDirections, foreignNearDuplicates: nearDuplicates.length, foreignAnchorFamilies: anchors.length,
    filler: { bankSentences: sentences.size, disclosedRanges: corpus.filler.ranges.length, disclosedUnits: disclosedUnits.size, lexiconTerms: forbidden.length, lexiconHits: lexiconHits.length,
      semanticAudit: 'pending independent W3 audit; no semantic acceptance claimed' },
    hr1ExactStatementOverlap: overlaps.length, unannotatedExactFactOccurrences: exactLeakage,
    annotationsCrossChecked: { forward: forwardAnnotations, reverse: reverseAnnotations },
  };
  return { ok: errors.length === 0, version: VERSION, candidateIndex: candidate, seed: CANDIDATE_SEEDS[candidate],
    errors, statistics, hashes: { 'hr1-facts.json':sha256(rawFacts),'hr1-corpus.json':sha256(rawCorpus) }, generation: rebuilt.diagnostics };
}

function inventory() {
  const filesystem = [];
  const prohibited = new Set(['hr1-queries.json','hr1-labels.json','hr1-split.json','hr1-label-audit.json','hr1-facts-view.json','label-audit-report.md']);
  function visit(dir = '') {
    for (const name of readdirSync(join(ROOT,dir)).sort()) {
      const path = join(dir,name);
      if ((!dir && prohibited.has(name)) || ['build/candidate0-v1-validation','build/candidate0-v11-identity'].includes(path)) continue;
      const stat = lstatSync(join(ROOT,path));
      if (stat.isSymbolicLink()) throw new Error('inventory_symlink');
      if (stat.isDirectory()) visit(path); else if (stat.isFile()) filesystem.push(path); else throw new Error('inventory_special_file');
    }
  }
  visit(); filesystem.sort();
  const paths = OWNED_FILES.map(name=>PREFIX+name), lines = value=>value.trim().split('\n').filter(Boolean);
  const git = [...new Set(lines(gitText(['ls-files','--cached','--others','--',...paths])).map(path=>path.slice(PREFIX.length)))].sort();
  const diff = { filesystemOnly: filesystem.filter(path=>!git.includes(path)), gitOnly: git.filter(path=>!filesystem.includes(path)) };
  if (diff.filesystemOnly.length || diff.gitOnly.length) throw new Error(`inventory_mismatch:${JSON.stringify(diff)}`);
  const changedA = [...new Set([...lines(gitText(['diff','--name-only','HEAD','--',...paths])),...lines(gitText(['ls-files','--others','--',...paths]))].map(path=>path.slice(PREFIX.length)))].sort();
  const baselineNames = new Set(lines(gitText(['ls-tree','-r','--name-only','HEAD','--',...paths])).map(path=>path.slice(PREFIX.length)));
  const changedB = filesystem.filter(name=>!baselineNames.has(name)||readFileSync(join(ROOT,name),'utf8')!==headBytes(name));
  const changedDiff = {gitOnly:changedA.filter(name=>!changedB.includes(name)),byteComparisonOnly:changedB.filter(name=>!changedA.includes(name))};
  if (changedDiff.gitOnly.length || changedDiff.byteComparisonOnly.length) throw new Error(`changed_file_list_mismatch:${JSON.stringify(changedDiff)}`);
  return { count: filesystem.length, methodA:'filesystem walk with prohibited products pruned',methodB:'Git cached/untracked enumeration over W1 allowlist',gitExitCode:0,diff,files:filesystem,
    changed:{count:changedA.length,files:changedA,methodA:'git diff HEAD --name-only plus untracked',methodB:'filesystem file bytes versus HEAD blobs',diff:changedDiff} };
}

function report(result, exits, files) {
  const s = result.statistics, scales = s.scales;
  const roles = {S300:'target','S1000-extra':'distractor',foreign:'foreign'};
  const rows = Object.entries(scales).map(([scale,v]) => `| ${scale} | ${v.count} | ${v.languages.zh}/${v.languages.en}/${v.languages.mixed} | ${Object.values(v.receiptCountHistogram).join('/')} | ${Object.values(s.placement[roles[scale]].counts).join('/')} | ${Object.values(v.bodyTokens.bands).join('/')} | ${Object.values(v.receiptTokens.bands).join('/')} | ${v.bodyTokens.mean}/${v.receiptTokens.mean} |`).join('\n');
  const domainRows = DOMAINS.map(domain=>`| ${domain} | ${scales.S300.domain[domain] ?? 0} | ${scales['S1000-extra'].domain[domain] ?? 0} | ${scales.foreign.domain[domain] ?? 0} |`).join('\n');
  const attempted = result.candidateHistory.filter(row=>row.protocolRevision===PROTOCOL.revision&&row.candidateIndex>=1);
  const attemptedRows = attempted.map(row=> {
    const exit = row.actualExitCodes ?? {}, diagnostics = row.stage1Errors.length ? row.stage1Errors.map(error=>`${error.code}:${typeof error.detail==='string'?error.detail:'see retained diagnostics'}`).join('; ') : 'none';
    return `| ${row.candidateIndex} | ${row.seed} | ${exit.build ?? 'not-run'}/${exit.buildCheck ?? 'not-run'}/${exit.checkWorld ?? 'not-run'} | ${row.stage1} | ${diagnostics} |`;
  }).join('\n');
  return `# HR-2b v1.1 W1 seed-advance report

Protocol v1.1, frozen at d3a6e24f. Candidate in use: **${result.candidateIndex}**, seed **${result.seed}**, mulberry32; structural stage 1 **${result.ok?'pass':'fail'}**. New-candidate identity comparisons are inapplicable and were not run. No W2/W3 products, retained validator contents, tests, retrieval/assembly runs, network or commits were used.

Actual exits for every candidate attempted in this advance round, ordered as build-world.mjs / build-world.mjs --check / check-world.mjs:

| Candidate | Seed | Exits | Stage 1 | Diagnostics |
| --- | ---: | --- | --- | --- |
${attemptedRows}

The frozen sequence was followed from candidate 1 and stopped at its first stage-1 pass. Later candidates are unattempted. The selected command exits are ${exits.build}/${exits.buildCheck}/${result.ok?0:1}.

There are ${s.families.total} families (40 target/40 distractor/10 foreign), ${s.facts.total} facts and ${Object.values(scales).reduce((sum,v)=>sum+v.count,0)} memories. Target facts: 280 rendered/40 absent; distractors: 600 rendered/40 absent; foreign: 60 rendered, including 20 near-duplicates. All 540 bodies are assistant notes; receipt roles are ${s.receiptRoles.user} user/${s.receiptRoles.assistant} assistant.

| Scale | Memories | zh/en/mixed | Receipts 1/2/3/4 | Placement body/first/later | Body bands | Receipt bands | Mean body/receipt tokens |
| --- | ---: | --- | --- | --- | --- | --- | --- |
${rows}

Every scale realizes receipt-count shares **20/25/25/30%** and distinct-fact placement shares **45/25/30%**, exactly matching their targets. Language shares per scale are 55/30/15%; overall counts ${s.memoryLanguages.zh}/${s.memoryLanguages.en}/${s.memoryLanguages.mixed}. Body bands: [120,180), [180,260), [260,400]; receipt bands: [40,70), [70,130), [130,200]. Counter: tiktoken@${s.counter.version}, o200k_base. Distractors remain 160 hand/160 template.

| Domain | Target memories | Distractors | Foreign |
| --- | ---: | ---: | ---: |
${domainRows}

Filler disclosure: ${s.filler.bankSentences} complete bank sentences, ${s.filler.disclosedRanges} UTF-16 ranges across ${s.filler.disclosedUnits} units; ${s.filler.lexiconTerms} per-fact terms scanned with ${s.filler.lexiconHits} hits. Exact HR-1 statement overlaps and unannotated exact facts: ${s.hr1ExactStatementOverlap}/${s.unannotatedExactFactOccurrences}. Independent annotation totals: ${s.annotationsCrossChecked.forward}/${s.annotationsCrossChecked.reverse}. Full measurements, evidence ranges and per-attempt diagnostics remain in build/world-stats.json.

Declared decisions: the seven generator files, including four-bin config, are byte-identical to HEAD; only the authorized candidate index changed. Families, factual sources, filler, lexicon, seed sequence and band logic were not edited. Facts-view coverage and placement can differ for a new candidate. Four target episodes express three facts each across body/receipts; decision/reason and primary/nearby assignments stay separated. Body-only support uses span:null; topical anchors remain separately disclosed.

Preserved history: v1 candidate 0 stage-2 rejection (quota failures and admission cap); v1.1 candidate 0 duplicate normalized body m-9e1321fab528a943, identity failure and coordinator rejection. References point to build/candidate0-v1-validation/ and build/candidate0-v11-identity/; neither directory was traversed or modified. Earlier development diagnostics are retained.

${result.ok?'W1 stage 1 is complete. Stage-2 quotas and W3 semantic re-audit remain pending with their owners.':'No candidate is accepted; the recorded failure requires the next frozen seed, without generator edits.'}

Owned inventory: ${files.count} files, filesystem/Git diff empty. Changed files: **${files.changed.count}**, independently derived from Git diff plus untracked paths and filesystem bytes versus HEAD blobs; diff ${JSON.stringify(files.changed.diff)}; Git exits 0. Whitespace checks cover all owned files, including untracked files.

${files.changed.files.map(path=>`- \`${path}\``).join('\n')}
`;
}

function frozenGenerator() {
  const files = Object.fromEntries(GENERATOR_FILES.map(name=> {
    const before = headBytes(name), after = readFileSync(join(ROOT,name),'utf8');
    if (before !== after) throw new Error(`generator_changed:${name}`);
    return [name,sha256(after)];
  }));
  return {ok:true,headCommit:gitText(['rev-parse','HEAD']).trim(),files};
}

function runBuild(candidate, extra) {
  const script = fileURLToPath(new URL('./build-world.mjs',import.meta.url));
  const args = [script,'--candidate',String(candidate),...extra];
  const scratch = join(ROOT,'build/.w1-build.tmp'), fd = openSync(scratch,'wx+');
  unlinkSync(scratch);
  try {
    const child = spawnSync(process.execPath,args,{stdio:['ignore',fd,fd]});
    const bytes = Buffer.alloc(fstatSync(fd).size);
    for (let offset=0;offset<bytes.length;) {
      const length = readSync(fd,bytes,offset,bytes.length-offset,offset);
      if (!length) throw new Error('build_capture_short_read');
      offset += length;
    }
    const output = bytes.toString('utf8');process.stdout.write(output);
    return {command:[process.execPath,...args],exitCode:child.error?null:child.status,
      signal:child.signal,error:child.error?.message ?? null,output};
  } finally {closeSync(fd);}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
    const candidate = Number(option('--candidate','0')), record = args.includes('--record'), output = option('-o',null), verify = args.includes('--verify-builds'), reportOnly = args.includes('--report-only');
    if (reportOnly && verify) throw new Error('report_only_cannot_rebuild');
    const statsPath = join(ROOT,'build/world-stats.json');
    let previousRecord = null;
    try {previousRecord = JSON.parse(readFileSync(statsPath,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
    let history = previousRecord?.candidateHistory ?? [];
    if (!reportOnly) {
      if (!Number.isInteger(candidate) || candidate<1 || candidate>=CANDIDATE_SEEDS.length) throw new Error('seed_advance_requires_candidate_1_through_15');
      for(let prior=1;prior<candidate;prior++) {
        const row = history.find(row=>row.protocolRevision===PROTOCOL.revision&&row.candidateIndex===prior);
        if (!row || (row.stage1!=='fail'&&row.stage2!=='rejected')) throw new Error(`candidate_sequence_not_ready:${prior}`);
      }
    }
    const exits = { build: null, buildCheck: null };
    const commands = [], generatorIntegrity = reportOnly ? previousRecord?.generatorIntegrity : frozenGenerator();
    let buildFailure = null;
    if (verify) {
      for (const [key, extra] of [['build',[]],['buildCheck',['--check']]]) {
        const child = runBuild(candidate,extra);commands.push({...child,key});exits[key]=child.exitCode;
        console.log(JSON.stringify({command:key,actualExitCode:child.exitCode,signal:child.signal,error:child.error}));
        if (child.error || child.exitCode!==0) {buildFailure={code:'candidate:build_failed',detail:child};break;}
      }
    }
    const result = reportOnly ? previousRecord : buildFailure ? {
      ok:false,version:VERSION,candidateIndex:candidate,seed:CANDIDATE_SEEDS[candidate],errors:[buildFailure],hashes:{},statistics:null,generation:null,
    } : checkWorld(candidate);
    if (reportOnly) {
      if (result.candidateIndex !== candidate) throw new Error('report_candidate_mismatch');
      Object.assign(exits,result.actualExitCodes);
    } else {
      result.protocol = PROTOCOL;
      result.structuralOk = result.ok;
      result.structuralErrors = [...result.errors];
      result.identity = {status:'not-applicable',reason:'New candidate authorized after candidate 0 rejection; no candidate-0 identity gate was run.'};
      result.generatorIntegrity = generatorIntegrity;
    }
    if (record && !reportOnly) {
      const legacy = history.find(row=>row.candidateIndex === 0 && (row.protocolRevision ?? 'v1') === 'v1');
      const rejectedV1 = {...legacy,protocolRevision:'v1',protocolCommit:'c546bfc1',candidateIndex:0,seed:CANDIDATE_SEEDS[0],stage2:'rejected',validationRecord:'build/candidate0-v1-validation/',coordinatorDiagnostics:V1_REJECTION};
      const zero = history.find(row=>row.candidateIndex===0&&row.protocolRevision===PROTOCOL.revision);
      const rejectedV11 = {...zero,protocolRevision:PROTOCOL.revision,protocolCommit:PROTOCOL.freezeCommit,candidateIndex:0,seed:CANDIDATE_SEEDS[0],stage1:'fail',identity:'fail',stage2:'rejected',
        validationRecord:V11_RESOLUTION.validationRecord,coordinatorResolution:V11_RESOLUTION};
      if (previousRecord?.candidateIndex===0&&previousRecord.protocol?.revision===PROTOCOL.revision) {
        rejectedV11.identityDiagnostics ??= previousRecord.identity;
        rejectedV11.statistics ??= previousRecord.statistics;
        rejectedV11.hashes ??= previousRecord.hashes;
        rejectedV11.actualExitCodes ??= previousRecord.actualExitCodes;
      }
      const old = history.find(row=>row.candidateIndex === candidate && row.protocolRevision === PROTOCOL.revision);
      const actualExitCodes = {...exits,checkWorld:result.ok?0:1};
      const attempt = {stage1:result.structuralOk?'pass':'fail',errors:result.structuralErrors,hashes:result.hashes,identity:'not-applicable',actualExitCodes,commands};
      const attempts = old?.stage1Attempts ?? [];
      if (!same(attempts.at(-1),attempt)) attempts.push(attempt);
      const row = {...old,protocolRevision:PROTOCOL.revision,protocolCommit:PROTOCOL.freezeCommit,candidateIndex:candidate,seed:CANDIDATE_SEEDS[candidate],stage1:attempt.stage1,stage1Errors:result.structuralErrors,stage1Attempts:attempts,identity:attempt.identity,
        stage2:result.ok?'pending-coordinator':'not-run-stage1-rejected',actualExitCodes,statistics:result.statistics,hashes:result.hashes,generatorIntegrity};
      history = [...history.filter(row=>row.candidateIndex!==0 && !(row.candidateIndex === candidate && row.protocolRevision === PROTOCOL.revision)),rejectedV1,rejectedV11,row]
        .sort((a,b)=>(a.protocolRevision ?? 'v1').localeCompare(b.protocolRevision ?? 'v1','en') || a.candidateIndex-b.candidateIndex);
      result.candidateHistory = history; result.rejectedCandidates = history.filter(row=>row.stage1 === 'fail' || row.stage2 === 'rejected');
      result.actualExitCodes = actualExitCodes;result.stage2 = row.stage2;
      result.chosenCandidate = result.ok?{candidateIndex:candidate,seed:result.seed,stage1:'pass',stage2:'pending-coordinator'}:null;
      result.developmentDiagnostics = JSON.parse(readFileSync(join(ROOT,'build/development-diagnostics.json'),'utf8'));
      writeFileSync(statsPath,serialize(result));
      console.log(JSON.stringify({candidateAttempt:{candidateIndex:candidate,seed:result.seed,stage1:row.stage1,actualExitCodes,errors:row.stage1Errors}}));
    }
    if (output) {
      if (!record || (!verify && !reportOnly)) throw new Error('report_requires_record_and_verify_builds_or_saved_results');
      const path = resolve(ROOT,output), within = relative(ROOT,path);
      if (!within || within.startsWith('..') || path === statsPath) throw new Error('report_outside_authorized_directory');
      writeFileSync(path,'');
      result.inventory = inventory();
      writeFileSync(statsPath,serialize(result));
      const reportText = report(result,exits,result.inventory), words = reportText.trim().split(/\s+/u).length;
      if (words > 600) throw new Error(`report_word_limit:${words}`);
      writeFileSync(path,reportText);
      const whitespaceErrors = [];
      for (const filename of result.inventory.files) {
        const bytes = readFileSync(join(ROOT,filename),'utf8');
        if (/[\t ]+$/mu.test(bytes) || bytes.includes('\r') || !bytes.endsWith('\n')) whitespaceErrors.push(filename);
      }
      if (whitespaceErrors.length) throw new Error(`delivery_whitespace:${whitespaceErrors.join(',')}`);
      result.deliveryVerification = {reportWords:words,reportMaximumWords:600,whitespaceFilesChecked:result.inventory.count,whitespaceErrors};
      // Re-enumerate after delivery writes; both independent lists must agree.
      const finalInventory = inventory();
      if (!same(finalInventory,result.inventory)) throw new Error('delivery_inventory_changed');
      writeFileSync(statsPath,serialize(result));
      console.log(JSON.stringify({ inventoryCrossCheck:result.inventory.methodA+' == '+result.inventory.methodB,count:result.inventory.count,diff:result.inventory.diff }));
      console.log(JSON.stringify({changedFileCrossCheck:result.inventory.changed}));
      console.log(JSON.stringify({ deliveryVerification:result.deliveryVerification }));
    }
    console.log(JSON.stringify({ ok:result.ok,actualExitCode:result.ok?0:1,candidateIndex:candidate,errors:result.errors,statistics:result.statistics },null,2));
    process.exitCode = result.ok?0:1;
  } catch(error) { console.error(JSON.stringify({ ok:false,error:error.message }));process.exitCode=1; }
}
