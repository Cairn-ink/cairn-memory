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

const ROOT = fileURLToPath(fixtureRoot), REPO = fileURLToPath(new URL('../../../../', import.meta.url));
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
    check(memory.spans.length >= 1 && memory.spans.length <= 6, 'memory:receipt_count', memory.id);
    memory.spans.forEach((span, index) => {
      keys(span, ['id','role','eventTime','text'], span.id);
      check(span.id === `${memory.id}#s${index + 1}` && ['user','assistant'].includes(span.role) && time(span.eventTime) && text(span.text) && span.text.length <= 800, 'span:metadata', span.id);
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
  function visit(dir = '') {
    for (const name of readdirSync(join(ROOT,dir)).sort()) {
      const path = join(dir,name), stat = lstatSync(join(ROOT,path));
      if (stat.isSymbolicLink()) throw new Error('inventory_symlink');
      if (stat.isDirectory()) visit(path); else if (stat.isFile()) filesystem.push(path); else throw new Error('inventory_special_file');
    }
  }
  visit(); filesystem.sort();
  const prefix = relative(REPO,ROOT), scratch = join(ROOT,'build/.inventory-git.tmp');
  let gitOutput;
  const fd = openSync(scratch,'wx+');
  // Keep an anonymous open file: it must not enumerate itself as a deliverable.
  unlinkSync(scratch);
  try {
    const child = spawnSync('git',['--no-optional-locks','ls-files','--cached','--others','--',prefix],{cwd:REPO,stdio:['ignore',fd,'inherit']});
    if (child.error || child.status !== 0) throw new Error(`inventory_git_failed:${child.status}:${child.error?.message ?? child.signal}`);
    const bytes = Buffer.alloc(fstatSync(fd).size);
    readSync(fd,bytes,0,bytes.length,0); gitOutput = bytes.toString('utf8');
  } finally { closeSync(fd); }
  const git = [...new Set(gitOutput.trim().split('\n').filter(Boolean).map(path=>relative(prefix,path)))].sort();
  const diff = { filesystemOnly: filesystem.filter(path=>!git.includes(path)), gitOnly: git.filter(path=>!filesystem.includes(path)) };
  if (diff.filesystemOnly.length || diff.gitOnly.length) throw new Error(`inventory_mismatch:${JSON.stringify(diff)}`);
  return { count: filesystem.length, methodA:'recursive filesystem walk',methodB:'git ls-files --cached --others (includes ignored files)', gitExitCode:0,diff,files:filesystem };
}

function report(result, exits, files) {
  const s = result.statistics, scales = s.scales;
  const rows = Object.entries(scales).map(([scale,v]) => `| ${scale} | ${v.count} | ${v.languages.zh}/${v.languages.en}/${v.languages.mixed} | ${v.receiptRoles.user}/${v.receiptRoles.assistant} | ${Object.values(v.receiptCountHistogram).join('/')} | ${Object.values(v.bodyTokens.bands).join('/')} | ${Object.values(v.receiptTokens.bands).join('/')} | ${v.bodyTokens.mean}/${v.receiptTokens.mean} |`).join('\n');
  const domainRows = DOMAINS.map(domain=>`| ${domain} | ${scales.S300.domain[domain] ?? 0} | ${scales['S1000-extra'].domain[domain] ?? 0} | ${scales.foreign.domain[domain] ?? 0} |`).join('\n');
  return `# HR-2b W1 delivery report

Synthetic stage-1 world; candidate ${result.candidateIndex}, seed ${result.seed}, mulberry32. Stage 2 quota validation and W3 semantic audit remain pending. No queries, labels, retrieval, rankings, assembly runs, network access or commits were used.

Actual exits: build-world.mjs **${exits.build}**; build-world.mjs --check **${exits.buildCheck}**; check-world.mjs **${result.ok ? 0 : 1}**. Structural errors: ${result.errors.length}.

There are ${s.families.total} families (${s.families.byRole.target} target, ${s.families.byRole.distractor} distractor, ${s.families.byRole.foreign} foreign), ${s.facts.total} facts and ${Object.values(scales).reduce((sum,value)=>sum+value.count,0)} memories. Target facts: 280 rendered plus 40 absent; distractors: 600 rendered plus 40 absent; foreign: 60 rendered, including ${s.foreignNearDuplicates} near-duplicates and ${s.foreignAnchorFamilies} unique custody anchors. All bodies are assistant notes. Receipt roles total user ${s.receiptRoles.user}, assistant ${s.receiptRoles.assistant}.

| Scale | Memories | zh/en/mixed | Receipt user/assistant | Receipts 1/2/3/4/5/6 | Body bands | Receipt bands | Mean body/receipt tokens |
| --- | ---: | --- | --- | --- | --- | --- | --- |
${rows}

Body bands are [120,180), [180,260), [260,400]; receipt bands [40,70), [70,130), [130,200]. Counts and means use tiktoken@${s.counter.version}, o200k_base. Namespace target contains S300 plus S1000-extra; namespace foreign contains foreign. Overall languages are ${s.memoryLanguages.zh}/${s.memoryLanguages.en}/${s.memoryLanguages.mixed}. Distractor authoring is ${scales['S1000-extra'].authoring.hand} hand/${scales['S1000-extra'].authoring.template} template.

| Domain | Target memories | Distractors | Foreign |
| --- | ---: | ---: | ---: |
${domainRows}

Distinct-fact placements (body/first/later): targets ${Object.values(s.placement.target.counts).join('/')} (${JSON.stringify(s.placement.target.shares)}); distractors ${Object.values(s.placement.distractor.counts).join('/')} (${JSON.stringify(s.placement.distractor.shares)}). Full allocations, exact measurements and evidence ranges are retained in build/world-stats.json.

Filler disclosure: ${s.filler.bankSentences} complete bank sentences, ${s.filler.disclosedRanges} UTF-16 ranges across ${s.filler.disclosedUnits} units; ${s.filler.lexiconTerms} per-fact terms scanned, ${s.filler.lexiconHits} hits. HR-1 exact-statement overlaps: ${s.hr1ExactStatementOverlap}; exact unannotated facts: ${s.unannotatedExactFactOccurrences}. Annotation totals independently agree (${s.annotationsCrossChecked.forward} forward/${s.annotationsCrossChecked.reverse} reverse).

Declared decisions: four target episodes express three facts each; 2–4 facts means the entire memory including receipts. Historical notes may also contain still-valid bounds or nearby attributes with current support elsewhere. Changed decisions/reasons and primary/nearby assignments never share a memory. Body allocation uses body-only support with span:null. Non-supporting units have entity-bearing topical anchors disclosed apart from fact-free padding, since their entity references intentionally belong to the forbidden lexicon. Authored filler is factored by domain and role; every resulting sentence is disclosed, and opening/ending clauses cannot repeat within a unit. Mixed units contain substantive English and Chinese clauses. Distractors use four hand-authored adjacent-artifact episodes and four disclosed fabrication-template episodes; only those 160 memories count as template. Seeded capacity matching assigns whole-sentence constructions to token bands; endpoints follow the coordinator convention.

Candidate diagnostics: ${JSON.stringify(result.candidateHistory)}. Rejected-candidate diagnostics: ${JSON.stringify(result.rejectedCandidates)}. Later candidates are unattempted. The coordinator must complete stage 2 in frozen seed order, retaining any quota rejection. W1 cannot establish query quotas or semantic entailment. No -o destination was supplied; this report uses W1-REPORT.md inside the authorized directory.

Development diagnostics are retained separately: an import-entry failure (exit 1), sixteen timestamp errors (checker exit 1), and sandbox-only piped-child EPERM plus transient inventory self-enumeration (exit 1). These implementation issues were corrected before acceptance; see build/development-diagnostics.json. No seed was discarded to improve results.

Inventory: ${files.count} files, filesystem walk versus Git cached/untracked enumeration, mechanically diffed; filesystem-only ${files.diff.filesystemOnly.length}, Git-only ${files.diff.gitOnly.length}; Git exit ${files.gitExitCode}. Whitespace checks include every listed file, including untracked files.

${files.files.map(path=>`- \`${path}\``).join('\n')}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2), option = (name, fallback) => args.includes(name) ? args[args.indexOf(name)+1] : fallback;
    const candidate = Number(option('--candidate','0')), record = args.includes('--record'), output = option('-o',null), verify = args.includes('--verify-builds');
    const exits = { build: null, buildCheck: null };
    if (verify) {
      for (const [key, extra] of [['build',[]],['buildCheck',['--check']]]) {
        const child = spawnSync(process.execPath,[fileURLToPath(new URL('./build-world.mjs',import.meta.url)),'--candidate',String(candidate),...extra],{stdio:'inherit'});
        exits[key] = child.error ? null : child.status;
        console.log(JSON.stringify({ command:key,actualExitCode:child.status,signal:child.signal,error:child.error?.message }));
        if (child.error || child.status !== 0) throw new Error(`build_subprocess_failed:${key}:${child.status}:${child.error?.message ?? child.signal}`);
      }
    }
    const result = checkWorld(candidate);
    let history = [], previousRecord = null;
    const statsPath = join(ROOT,'build/world-stats.json');
    if (record) {
      try { previousRecord = JSON.parse(readFileSync(statsPath,'utf8'));history = previousRecord.candidateHistory ?? []; } catch(error) { if(error.code !== 'ENOENT') throw error; }
      const old = history.find(row=>row.candidateIndex === candidate);
      const attempt = { stage1:result.ok?'pass':'fail',errors:result.errors,hashes:result.hashes };
      const attempts = old?.stage1Attempts ?? (old ? [{stage1:old.stage1,errors:old.stage1Errors,hashes:previousRecord.candidateIndex === candidate ? previousRecord.hashes : old.hashes}] : []);
      if (!same(attempts.at(-1),attempt)) attempts.push(attempt);
      const row = { ...old,candidateIndex:candidate,seed:CANDIDATE_SEEDS[candidate],stage1:attempt.stage1,stage1Errors:result.errors,stage1Attempts:attempts,stage2:old?.stage2 ?? 'pending-coordinator' };
      history = [...history.filter(row=>row.candidateIndex !== candidate),row].sort((a,b)=>a.candidateIndex-b.candidateIndex);
      result.candidateHistory = history; result.rejectedCandidates = history.filter(row=>row.stage1 === 'fail' || row.stage2 === 'rejected');
      result.actualExitCodes = { ...exits,checkWorld:result.ok?0:1 }; result.stage2 = 'pending coordinator quota validation after W3';
      result.developmentDiagnostics = JSON.parse(readFileSync(join(ROOT,'build/development-diagnostics.json'),'utf8'));
      writeFileSync(statsPath,serialize(result));
    }
    if (output) {
      if (!record || !verify) throw new Error('report_requires_record_and_verify_builds');
      const path = resolve(ROOT,output), within = relative(ROOT,path);
      if (!within || within.startsWith('..') || path === statsPath) throw new Error('report_outside_authorized_directory');
      writeFileSync(path,'');
      result.inventory = inventory();
      writeFileSync(statsPath,serialize(result));
      const reportText = report(result,exits,result.inventory), words = reportText.trim().split(/\s+/u).length;
      if (words > 900) throw new Error(`report_word_limit:${words}`);
      writeFileSync(path,reportText);
      const whitespaceErrors = [];
      for (const filename of result.inventory.files) {
        const bytes = readFileSync(join(ROOT,filename),'utf8');
        if (/[\t ]+$/mu.test(bytes) || bytes.includes('\r') || !bytes.endsWith('\n')) whitespaceErrors.push(filename);
      }
      if (whitespaceErrors.length) throw new Error(`delivery_whitespace:${whitespaceErrors.join(',')}`);
      result.deliveryVerification = { reportWords:words,reportMaximumWords:900,whitespaceFilesChecked:result.inventory.count,whitespaceErrors };
      // Re-enumerate after delivery writes; both independent lists must agree.
      const finalInventory = inventory();
      if (!same(finalInventory,result.inventory)) throw new Error('delivery_inventory_changed');
      writeFileSync(statsPath,serialize(result));
      console.log(JSON.stringify({ inventoryCrossCheck:result.inventory.methodA+' == '+result.inventory.methodB,count:result.inventory.count,diff:result.inventory.diff }));
      console.log(JSON.stringify({ deliveryVerification:result.deliveryVerification }));
    }
    console.log(JSON.stringify({ ok:result.ok,actualExitCode:result.ok?0:1,candidateIndex:candidate,errors:result.errors,statistics:result.statistics },null,2));
    process.exitCode = result.ok?0:1;
  } catch(error) { console.error(JSON.stringify({ ok:false,error:error.message }));process.exitCode=1; }
}
