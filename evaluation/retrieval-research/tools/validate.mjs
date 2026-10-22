import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openMemoryCore } from '../../../core/contract.mjs';
import { VERSION, CATEGORIES, unique, eligibleMemory, armDocuments, loadFixture, readJson, cliMain, requiredOption } from '../lib/fixture.mjs';
import { factsView } from './facts-view.mjs';
import { buildLabels, loadTokenizers } from './labels.mjs';
import { applyAudit } from './apply-audit.mjs';
import { splitSummary, splitViolations } from './split.mjs';

// "About" and "matched" have no numerical tolerance in the frozen protocol.
// These visible validation conventions use 10% count / 5 percentage-point
// distribution bands. Fixed protocol limits (15%, 35–45%, 50%) are exact.
export const DISTRIBUTION_POLICY = Object.freeze({ countTolerance: 0.1, distributionTolerance: 0.05,
  languages: { zh: 0.55, en: 0.30, mixed: 0.15 }, counts: { S300: 300, extras: 700, foreign: 100 } });
const DOMAINS = ['engineering', 'work-preferences', 'operations', 'finance', 'product', 'everyday'];
const KINDS = ['fact', 'preference', 'decision', 'instruction', 'context', 'reason', 'event'];
const LANGS = ['zh', 'en', 'mixed'];
const STATES = ['current', 'historical', 'rejected', 'proposed'];
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const distribution = (items, value, keys) => Object.fromEntries(keys.map(key => [key, items.length ? items.filter(item => value(item) === key).length / items.length : null]));

// Exercise the same public admission used by A0, in an ephemeral in-memory
// store. This also catches NFKC/whitespace/case/redaction deduplication without
// duplicating private normalization rules. Never persist corpus text in errors.
export function publicApiPreflight(memories) {
  const core = openMemoryCore({ path: ':memory:' }), seen = new Map(), incompatibilities = [];
  try {
    for (const memory of memories) {
      const result = core.admit({ namespace: { ownerId: `hr1-preflight-${memory.namespace}`, scope: 'personal', projectId: null },
        memory: { kind: 'context', content: memory.content }, receipts: memory.spans.map(span => ({ client: 'hr1-preflight', sessionId: 'synthetic',
          eventId: createHash('sha256').update(span.id).digest('hex'), role: 'user', excerpt: span.text })) });
      if (!result.ok) { incompatibilities.push({ code: 'public_admission_rejected', namespace: memory.namespace, memory: memory.id, reason: result.error.code }); continue; }
      const admittedId = result.value.memory.id;
      if (seen.has(admittedId)) incompatibilities.push({ code: 'duplicate_body', namespace: memory.namespace, memories: [seen.get(admittedId), memory.id] });
      else seen.set(admittedId, memory.id);
    }
  } finally { core.close(); }
  // Match run.mjs: A0 seeds target bodies from both intent projections at
  // each scale. Every history-only body consumes a distinct current body.
  const fixture = { corpus: { memories } }, namespace = 'target';
  for (const scale of ['S300', 'S1000']) {
    const history = armDocuments(fixture, { namespace, scale, intent: 'history', include: 'body' });
    const current = armDocuments(fixture, { namespace, scale, intent: 'current', include: 'body' });
    const currentIds = new Set(current.map(document => document.memoryId));
    const historicalCount = history.filter(document => !currentIds.has(document.memoryId)).length;
    if (historicalCount > current.length) {
      incompatibilities.push({ code: 'insufficient_current_replacements', namespace, scale, historicalCount, currentCount: current.length });
    }
  }
  return { ok: !incompatibilities.length, checkedMemories: memories.length, incompatibilities };
}

export function validateFixture(fixture, tokenizers, options) {
  try { return validate(fixture, tokenizers, options); }
  catch (error) { return { ok: false, errors: [{ code: 'schema:malformed_input', detail: error.message }], statistics: {}, policy: options?.policy ?? DISTRIBUTION_POLICY }; }
}

function validate(fixture, tokenizers, { policy = DISTRIBUTION_POLICY, view } = {}) {
  const errors = [], statistics = {};
  const check = (condition, code, detail) => { if (!condition) errors.push({ code, ...(detail === undefined ? {} : { detail }) }); };
  const array = (value, code) => { check(Array.isArray(value), code); return Array.isArray(value) ? value : []; };
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const ids = (items, prefix) => {
    const map = new Map();
    for (const item of items) {
      check(item && typeof item === 'object' && !Array.isArray(item), `${prefix}:object`);
      if (!item || typeof item !== 'object') continue;
      check(typeof item.id === 'string' && /^[\x21-\x7E]+$/.test(item.id), `${prefix}:ascii_id`, item.id);
      check(!map.has(item.id), `${prefix}:duplicate_id`, item.id);
      map.set(item.id, item);
    }
    return map;
  };
  for (const key of ['facts', 'corpus', 'queries', 'labels']) check(fixture[key]?.version === VERSION, `${key}:version`);
  check(fixture.split && typeof fixture.split === 'object' && !Array.isArray(fixture.split), 'split:object');
  check(fixture.audit && Array.isArray(fixture.audit.overrides), 'audit:overrides');
  const families = array(fixture.facts?.families, 'families:array'), facts = array(fixture.facts?.facts, 'facts:array');
  const memories = array(fixture.corpus?.memories, 'memories:array'), queries = array(fixture.queries?.queries, 'queries:array');
  const labels = array(fixture.labels?.queries, 'labels:queries');
  const familyMap = ids(families, 'family'), factMap = ids(facts, 'fact'), memoryMap = ids(memories, 'memory');
  const queryMap = ids(queries, 'query'), labelMap = ids(labels, 'label');
  const allSpans = new Set();
  if (view !== undefined) check(isDeepStrictEqual(view, factsView(fixture)), 'facts_view:generated_mismatch');
  check(families.filter(family => family.role === 'target').length >= 40, 'families:target_minimum_40');
  for (const family of families) {
    check(['target', 'distractor', 'foreign'].includes(family.role), 'family:role', family.id);
    check(DOMAINS.includes(family.domain) && nonempty(family.summary), 'family:metadata', family.id);
  }
  for (const fact of facts) {
    const family = familyMap.get(fact.family);
    check(Boolean(family), 'fact:family', fact.id);
    check(KINDS.includes(fact.kind) && STATES.includes(fact.state) && LANGS.includes(fact.statementLang), 'fact:enums', fact.id);
    check(nonempty(fact.statement) && time(fact.eventTime) && typeof fact.rendered === 'boolean', 'fact:metadata', fact.id);
    check(Array.isArray(fact.entities) && fact.entities.every(nonempty) && unique(fact.entities).length === fact.entities.length, 'fact:entities', fact.id);
    check(family?.role !== 'target' || (fact.rendered === false ? fact.coverage === null : ['body', 'span-only'].includes(fact.coverage)), 'fact:coverage', fact.id);
    for (const field of ['supersedes', 'reasonFor', 'nearDuplicateOf']) {
      check(fact[field] === null || factMap.has(fact[field]), `fact:${field}:reference`, fact.id);
      check(fact[field] !== fact.id, `fact:${field}:self`, fact.id);
    }
    if (fact.supersedes) {
      const previous = factMap.get(fact.supersedes);
      check(previous?.family === fact.family && previous?.state === 'historical' && previous?.kind === 'decision' && fact.kind === 'decision', 'fact:supersession', fact.id);
    }
    if (fact.state === 'historical' && fact.kind === 'decision') check(facts.some(next => next.supersedes === fact.id), 'fact:historical_without_successor', fact.id);
    if (fact.reasonFor) check(fact.kind === 'reason' && factMap.get(fact.reasonFor)?.kind === 'decision' && factMap.get(fact.reasonFor)?.family === fact.family, 'fact:reasonFor', fact.id);
    if (fact.nearDuplicateOf) check(family?.role === 'foreign' && familyMap.get(factMap.get(fact.nearDuplicateOf)?.family)?.role === 'target', 'fact:foreign_near_duplicate', fact.id);
    const visited = new Set([fact.id]);
    let cursor = fact;
    while (cursor?.supersedes && factMap.has(cursor.supersedes)) {
      if (visited.has(cursor.supersedes)) { check(false, 'fact:supersedes_cycle', fact.id); break; }
      visited.add(cursor.supersedes); cursor = factMap.get(cursor.supersedes);
    }
  }
  for (const memory of memories) {
    check(['target', 'foreign'].includes(memory.namespace) && ['S300', 'S1000-extra', 'foreign'].includes(memory.scale) &&
      (memory.namespace === 'foreign') === (memory.scale === 'foreign'), 'memory:namespace_scale', memory.id);
    check(LANGS.includes(memory.lang) && KINDS.slice(0, 5).includes(memory.kind) && ['current', 'historical'].includes(memory.state), 'memory:enums', memory.id);
    check(DOMAINS.includes(memory.domain) && ['hand', 'template'].includes(memory.authoring) && time(memory.eventTime), 'memory:metadata', memory.id);
    check(nonempty(memory.content) && memory.content.length <= 4000, 'memory:content', memory.id);
    const spans = array(memory.spans, `memory:${memory.id}:spans`), expressions = array(memory.expresses, `memory:${memory.id}:expresses`);
    check(spans.length >= 1 && spans.length <= 3, 'memory:span_count', memory.id);
    spans.forEach((span, i) => {
      check(span.id === `${memory.id}#s${i + 1}` && !allSpans.has(span.id), 'span:id', span.id);
      allSpans.add(span.id);
      check(['user', 'assistant', 'system', 'tool'].includes(span.role) && time(span.eventTime) && nonempty(span.text) && span.text.length <= 800, 'span:metadata', span.id);
    });
    const seen = new Set();
    for (const expression of expressions) {
      const fact = factMap.get(expression.fact), family = familyMap.get(fact?.family);
      check(Boolean(fact) && fact.rendered, 'expression:fact', memory.id);
      check(['body', 'span'].includes(expression.where) && spans.some(span => span.id === expression.span), 'expression:location', memory.id);
      const key = `${expression.fact}:${expression.where}:${expression.span}`;
      check(!seen.has(key), 'expression:duplicate', memory.id); seen.add(key);
      check(memory.namespace === 'foreign' ? family?.role === 'foreign' : memory.scale === 'S300' ? family?.role === 'target' : family?.role === 'distractor', 'expression:family_role', memory.id);
      if (fact?.kind === 'decision') check((fact.state === 'historical') === (memory.state === 'historical'), 'expression:lifecycle', memory.id);
    }
    check(memory.supersedes === null || memoryMap.has(memory.supersedes), 'memory:supersedes_reference', memory.id);
    if (memory.supersedes) {
      const previous = memoryMap.get(memory.supersedes);
      check(previous?.state === 'historical' && previous?.namespace === memory.namespace && previous?.id !== memory.id, 'memory:supersession', memory.id);
      check(expressions.some(expression => factMap.get(expression.fact)?.supersedes && previous?.expresses?.some(old => old.fact === factMap.get(expression.fact).supersedes)), 'memory:supersedes_fact_link', memory.id);
    }
  }
  for (const fact of facts) {
    const supports = memories.filter(memory => memory.expresses?.some(expression => expression.fact === fact.id));
    check(fact.rendered ? supports.length > 0 : supports.length === 0, 'fact:rendered_consistency', fact.id);
    if (fact.rendered && familyMap.get(fact.family)?.role === 'target') {
      const body = supports.some(memory => memory.expresses.some(expression => expression.fact === fact.id && expression.where === 'body'));
      check(fact.coverage === (body ? 'body' : 'span-only'), 'fact:actual_coverage', fact.id);
    }
    if (fact.supersedes && fact.rendered) {
      const previous = memories.filter(memory => memory.expresses?.some(expression => expression.fact === fact.supersedes));
      check(supports.some(memory => previous.some(old => old.id === memory.supersedes)), 'fact:missing_memory_supersession_link', fact.id);
    }
  }
  if (!errors.length) {
    statistics.publicApi = publicApiPreflight(memories);
    for (const detail of statistics.publicApi.incompatibilities) check(false, `fixture_incompatibility:${detail.code}`, detail);
  }
  for (const query of queries) {
    const family = familyMap.get(query.family);
    check(Boolean(family) && family.role === (query.category === 'FOREIGN' ? 'foreign' : 'target'), 'query:family', query.id);
    check([...CATEGORIES, 'C8', 'FOREIGN'].includes(query.category) && LANGS.includes(query.lang) && ['current', 'history'].includes(query.intent), 'query:enums', query.id);
    check(nonempty(query.text) && nonempty(query.note) && Array.isArray(query.secondaryTags) && query.secondaryTags.every(tag => [...CATEGORIES, 'C8'].includes(tag)), 'query:metadata', query.id);
    check(Array.isArray(query.requiredFacts) && query.requiredFacts.length > 0 && unique(query.requiredFacts).length === query.requiredFacts.length &&
      query.requiredFacts.every(id => factMap.get(id)?.family === query.family), 'query:required_facts', query.id);
    if (['C1', 'C2'].includes(query.category)) check(nonempty(query.keyTerm), 'query:key_term', query.id);
    check(['dev', 'test'].includes(fixture.split?.[query.family]), 'query:split', query.id);
    check(labelMap.has(query.id), 'query:missing_label', query.id);
  }
  for (const [family, split] of Object.entries(fixture.split ?? {})) check(familyMap.has(family) && ['dev', 'test'].includes(split), 'split:entry', family);
  for (const label of labels) check(queryMap.has(label.id), 'label:unknown_query', label.id);

  // Deep checking after schema validation prevents malformed JSON from crashing
  // the validator and ensures audit results / overlap / category flags are fresh.
  if (!errors.length) {
    try {
      let expected = buildLabels(fixture, tokenizers);
      if (fixture.audit.overrides.length || fixture.labels.original) expected = applyAudit({ ...fixture, labels: expected }, fixture.audit, tokenizers);
      check(isDeepStrictEqual(fixture.labels, expected), 'labels:join_or_audit_mismatch');
    } catch (error) { check(false, 'labels:recompute_failed', error.message); }
  }
  const active = labels.filter(label => !label.dropped);
  for (const label of active) {
    check(label.checks?.[label.category]?.pass === true, 'category:check_failed', { query: label.id, category: label.category });
    if (label.category !== 'C8') check(label.groups?.length > 0 && label.groups.every(group => group.members.some(member => member.scale === 'S300' || label.category === 'FOREIGN')), 'group:no_S300_support', label.id);
    for (const group of label.groups ?? []) for (const member of group.members ?? []) {
      const memory = memoryMap.get(member.memory);
      check(eligibleMemory(memory ?? { deleted: true }, label.intent), 'group:ineligible_member', label.id);
      check(!Object.hasOwn(member, 'span') && Array.isArray(member.spans) && unique(member.spans).length === member.spans.length &&
        member.spans.every(id => memory?.spans.some(span => span.id === id)) && (member.where === 'body' || member.spans.length > 0), 'group:supporting_spans', label.id);
    }
  }
  const activeQueries = active.map(label => ({ ...queryMap.get(label.id), category: label.category }));
  statistics.split = splitSummary(activeQueries, fixture.split ?? {});
  for (const error of splitViolations(statistics.split)) check(false, `split:${error}`);
  for (const category of CATEGORIES) check(activeQueries.filter(query => query.category === category).length === 20, 'queries:category_total', category);
  check(activeQueries.filter(query => query.category === 'C8').length === 10, 'queries:C8_count');
  check(activeQueries.filter(query => query.category === 'FOREIGN').length >= 8 && activeQueries.filter(query => query.category === 'FOREIGN').length <= 12, 'queries:FOREIGN_count');

  const buckets = { S300: memories.filter(memory => memory.scale === 'S300'), extras: memories.filter(memory => memory.scale === 'S1000-extra'), foreign: memories.filter(memory => memory.namespace === 'foreign') };
  statistics.corpus = {};
  const near = (a, b, tolerance) => a != null && b != null && Math.abs(a - b) <= tolerance + 1e-12;
  for (const [name, bucket] of Object.entries(buckets)) {
    const languages = distribution(bucket, memory => memory.lang, LANGS);
    statistics.corpus[name] = { count: bucket.length, languages, domains: distribution(bucket, memory => memory.domain, DOMAINS),
      bodyMeanLength: mean(bucket.map(memory => memory.content?.length ?? 0)), spanMeanLength: mean(bucket.flatMap(memory => (memory.spans ?? []).map(span => span.text?.length ?? 0))),
      spans: distribution(bucket, memory => memory.spans?.length, [1, 2, 3]) };
    check(near(bucket.length, policy.counts[name], policy.counts[name] * policy.countTolerance), 'corpus:count', name);
    for (const lang of LANGS) check(near(languages[lang], policy.languages[lang], policy.distributionTolerance), 'corpus:language_distribution', { name, lang });
  }
  statistics.byNamespaceScale = Object.fromEntries(['S300', 'S1000'].flatMap(scale => ['target', 'foreign'].map(namespace => {
    const bucket = memories.filter(memory => memory.namespace === namespace && (namespace === 'foreign' || memory.scale === 'S300' || scale === 'S1000'));
    return [`${namespace}:${scale}`, { count: bucket.length, languages: distribution(bucket, memory => memory.lang, LANGS),
      bodyMeanLength: mean(bucket.map(memory => memory.content?.length ?? 0)), spans: distribution(bucket, memory => memory.spans?.length, [1, 2, 3]) }];
  })));
  for (const field of ['bodyMeanLength', 'spanMeanLength']) {
    const base = statistics.corpus.S300[field], extra = statistics.corpus.extras[field];
    check(base > 0 && near(extra, base, base * 0.15), 'extras:length_match', field);
  }
  for (const field of ['languages', 'domains']) for (const key of Object.keys(statistics.corpus.S300[field])) {
    check(near(statistics.corpus.S300[field][key], statistics.corpus.extras[field][key], policy.distributionTolerance), 'extras:distribution_match', { field, key });
  }
  statistics.templateShare = buckets.extras.length ? buckets.extras.filter(memory => memory.authoring === 'template').length / buckets.extras.length : null;
  check(statistics.templateShare != null && statistics.templateShare <= 0.5, 'extras:template_share');
  const scored = active.filter(label => CATEGORIES.includes(label.category));
  const groups = scored.flatMap(label => label.groups ?? []).map(group => group.members.filter(member => member.scale === 'S300' && member.namespace === 'target'));
  statistics.spanOnlyGroupShare = groups.length ? groups.filter(members => members.length && members.every(member => member.where === 'span')).length / groups.length : null;
  check(statistics.spanOnlyGroupShare >= 0.35 && statistics.spanOnlyGroupShare <= 0.45, 'groups:span_only_band');
  const supportingIds = new Set(groups.flat().map(member => member.memory));
  const targets = buckets.S300.filter(memory => supportingIds.has(memory.id)), distractors = buckets.S300.filter(memory => !supportingIds.has(memory.id));
  statistics.spanCountMatch = { targets: distribution(targets, memory => memory.spans.length, [1, 2, 3]), distractors: distribution(distractors, memory => memory.spans.length, [1, 2, 3]) };
  for (const count of [1, 2, 3]) check(near(statistics.spanCountMatch.targets[count], statistics.spanCountMatch.distractors[count], policy.distributionTolerance), 'spans:distribution_match', count);
  const ordinary = activeQueries.filter(query => CATEGORIES.includes(query.category) && !['C2', 'C4'].includes(query.category));
  statistics.queryLanguages = distribution(ordinary, query => query.lang, LANGS);
  for (const lang of LANGS) check(near(statistics.queryLanguages[lang], policy.languages[lang], policy.distributionTolerance), 'queries:language_distribution', lang);
  const cross = activeQueries.filter(query => query.category === 'C4');
  check(cross.every(query => query.lang === 'zh' || query.lang === 'en') && Math.abs(cross.filter(query => query.lang === 'zh').length - cross.filter(query => query.lang === 'en').length) <= 1, 'queries:C4_balanced_directions');
  check(facts.some(fact => fact.nearDuplicateOf && memories.some(memory => memory.namespace === 'foreign' && memory.expresses?.some(expression => expression.fact === fact.id))), 'foreign:no_rendered_near_duplicate');
  return { ok: errors.length === 0, errors, statistics, policy };
}

await cliMain(import.meta.url, async options => {
  const dir = requiredOption(options, 'fixture');
  const result = validateFixture(await loadFixture(dir), await loadTokenizers(), { view: await readJson(join(dir, 'hr1-facts-view.json')) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
});
