import { countTokens } from '../assembly/counter.mjs';
import { compareIds, FIXTURE_PROFILES, HR2B_VERSION } from './fixture.mjs';

const PROFILE = FIXTURE_PROFILES[HR2B_VERSION];
export const BODY_BANDS = PROFILE.bodyBands;
export const RECEIPT_BANDS = PROFILE.receiptBands;
export const RECEIPT_HISTOGRAM = PROFILE.receiptHistogram;
export const compareReceipts = (a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime) || compareIds(a.id, b.id);
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const near = (a, b, tolerance = PROFILE.distributionTolerance) => Number.isFinite(a) && Math.abs(a - b) <= tolerance + 1e-12;

// W1 may call this before queries/labels exist. Ranges are UTF-16 [start,end),
// naming a disclosed sentence. Every long unit must disclose its filler.
export function checkHR2bWorld(fixture) {
  const errors = [], statistics = {};
  const check = (condition, code, detail) => { if (!condition) errors.push({ code, ...(detail === undefined ? {} : { detail }) }); };
  const { memories } = fixture.corpus, { facts, families } = fixture.facts;
  const familyMap = new Map(families.map(family => [family.id, family]));
  const factMap = new Map(facts.map(fact => [fact.id, fact]));
  const counts = Object.fromEntries(Object.entries(PROFILE.counts).map(([scale, count]) => [scale === 'extras' ? 'S1000-extra' : scale, count]));
  const bands = (lengths, ranges, label) => {
    check(lengths.length > 0 && lengths.every(n => n >= ranges[0][0] && n <= ranges.at(-1)[1]), 'hr2b:length_range', label);
    return ranges.map(([low, high, share], i) => {
      const actual = lengths.filter(n => n >= low && (i === ranges.length - 1 ? n <= high : n < high)).length / lengths.length;
      check(near(actual, share), 'hr2b:length_band', { label, low, high, actual });
      return actual;
    });
  };
  for (const [scale, count] of Object.entries(counts)) {
    const rows = memories.filter(memory => memory.scale === scale);
    check(Math.abs(rows.length - count) <= count * PROFILE.countTolerance + 1e-12, 'hr2b:count', scale);
    if (scale === 'foreign') continue;
    const bodies = rows.map(memory => countTokens(memory.content)), receipts = rows.flatMap(memory => memory.spans.map(span => countTokens(span.text)));
    const histogram = RECEIPT_HISTOGRAM.map((share, i) => {
      const actual = rows.filter(memory => memory.spans.length === i + 1).length / rows.length;
      check(near(actual, share), 'hr2b:receipt_histogram', { scale, count: i + 1, actual });
      return actual;
    });
    statistics[scale] = { bodyMean: mean(bodies), receiptMean: mean(receipts), histogram,
      bodyBands: bands(bodies, BODY_BANDS, `${scale}:body`), receiptBands: bands(receipts, RECEIPT_BANDS, `${scale}:receipt`) };
    for (const memory of rows) {
      const expressed = [...new Set(memory.expresses.map(expression => expression.fact))];
      check(expressed.length >= PROFILE.memoryFactBand[0] && expressed.length <= PROFILE.memoryFactBand[1] && new Set(expressed.map(id => factMap.get(id)?.family)).size === 1, 'hr2b:memory_facts', memory.id);
      const sentences = memory.content.match(/[^.!?。！？]+[.!?。！？]+(?:["'”’」』])?/gu) ?? [];
      check(sentences.length >= PROFILE.bodySentenceBand[0] && sentences.length <= PROFILE.bodySentenceBand[1] && memory.content.trim().split(/\n\s*\n/u).length <= PROFILE.maxParagraphs, 'hr2b:body_sentences', memory.id);
    }
  }
  for (const field of ['bodyMean', 'receiptMean']) check(near(statistics['S1000-extra'][field], statistics.S300[field], statistics.S300[field] * PROFILE.meanTolerance), 'hr2b:mean_match', field);
  RECEIPT_HISTOGRAM.forEach((_, i) => check(near(statistics.S300.histogram[i], statistics['S1000-extra'].histogram[i]), 'hr2b:histogram_match', i + 1));
  for (const memory of memories) {
    check(memory.spans.length >= PROFILE.minSpans && memory.spans.length <= PROFILE.maxSpans, 'hr2b:receipt_count', memory.id);
    check(memory.spans.every(span => typeof span.eventTime === 'string' && Number.isFinite(Date.parse(span.eventTime))), 'hr2b:receipt_time', memory.id);
    const sorted = [...memory.spans].sort(compareReceipts);
    check(memory.spans.every((span, i) => span === sorted[i] && span.id === `${memory.id}#s${i + 1}`), 'hr2b:receipt_order', memory.id);
  }
  const targetFamilies = families.filter(family => family.role === 'target');
  check(targetFamilies.length >= PROFILE.minimumTargetFamilies, 'hr2b:target_families');
  for (const family of targetFamilies) {
    const rows = facts.filter(fact => fact.family === family.id);
    check(rows.filter(fact => fact.rendered).length === PROFILE.renderedFactsPerFamily && rows.filter(fact => !fact.rendered).length === PROFILE.absentFactsPerFamily, 'hr2b:family_facts', family.id);
  }
  statistics.placement = {};
  for (const role of ['target', 'distractor']) {
    const rendered = facts.filter(fact => fact.rendered && familyMap.get(fact.family)?.role === role);
    const placements = rendered.map(fact => {
      const locations = memories.flatMap(memory => {
        const expressions = memory.expresses.filter(expression => expression.fact === fact.id);
        if (!expressions.length) return [];
        if (expressions.some(expression => expression.where === 'body')) return ['body'];
        const positions = expressions.map(expression => memory.spans.findIndex(span => span.id === expression.span));
        check(positions.every(position => position >= 0 && (position === 0 || memory.spans.length >= 2)), 'hr2b:later_receipt', fact.id);
        // Builder placement is exclusive. Audited group precedence is a
        // separate rule in placementOf(), and intentionally remains unchanged.
        if (positions.includes(0) && positions.some(position => position > 0)) {
          check(false, 'hr2b:mixed_receipt_placement', { fact: fact.id, memory: memory.id });
          return [null];
        }
        return [positions.includes(0) ? 'first-receipt' : 'later-receipt'];
      });
      check(locations.length > 0 && new Set(locations).size === 1, 'hr2b:inconsistent_fact_placement', fact.id);
      return locations[0];
    });
    statistics.placement[role] = Object.fromEntries(Object.entries(PROFILE.placementShares).map(([placement, share]) => {
      const actual = placements.filter(value => value === placement).length / rendered.length;
      check(near(actual, share), 'hr2b:placement_share', { role, placement, actual });
      return [placement, actual];
    }));
  }
  const lexicon = fixture.facts.forbiddenLexicon;
  check(lexicon && typeof lexicon === 'object' && !Array.isArray(lexicon), 'hr2b:lexicon_required');
  const terms = [];
  for (const fact of facts) {
    const values = lexicon?.[fact.id];
    check(Array.isArray(values) && values.length > 0 && values.every(value => typeof value === 'string' && normalize(value)), 'hr2b:fact_lexicon', fact.id);
    for (const term of values ?? []) terms.push([fact.id, normalize(term)]);
  }
  const filler = fixture.corpus.filler;
  check(Array.isArray(filler?.sentences) && Array.isArray(filler?.ranges), 'hr2b:filler_disclosure_required');
  const sentences = new Map();
  for (const sentence of filler?.sentences ?? []) {
    check(typeof sentence.id === 'string' && !sentences.has(sentence.id) && typeof sentence.text === 'string' && sentence.text.trim(), 'hr2b:filler_sentence', sentence.id);
    sentences.set(sentence.id, sentence.text);
    const normalized = normalize(sentence.text);
    for (const [fact, term] of terms) check(!normalized.includes(term), 'hr2b:forbidden_lexicon_hit', { sentence: sentence.id, fact });
  }
  const disclosed = new Set(), memoryMap = new Map(memories.map(memory => [memory.id, memory]));
  const previousEnd = new Map();
  for (const range of filler?.ranges ?? []) {
    const memory = memoryMap.get(range.memory), key = `${range.memory}:${range.where}:${range.span ?? ''}`;
    const text = range.where === 'body' && range.span === null ? memory?.content : range.where === 'span' ? memory?.spans.find(span => span.id === range.span)?.text : null;
    const sentence = sentences.get(range.sentence);
    check(typeof text === 'string' && typeof sentence === 'string' && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
      range.start >= (previousEnd.get(key) ?? 0) && range.end > range.start && range.end <= text.length && text.slice(range.start, range.end) === sentence, 'hr2b:filler_range', range.memory);
    previousEnd.set(key, range.end); disclosed.add(key);
  }
  for (const memory of memories.filter(memory => memory.scale !== 'foreign')) {
    check(disclosed.has(`${memory.id}:body:`), 'hr2b:undisclosed_unit', `${memory.id}#body`);
    for (const span of memory.spans) check(disclosed.has(`${memory.id}:span:${span.id}`), 'hr2b:undisclosed_unit', span.id);
  }
  statistics.filler = { sentences: sentences.size, ranges: filler?.ranges?.length ?? 0, semanticAudit: 'W3-required' };
  return { ok: !errors.length, errors, statistics };
}
