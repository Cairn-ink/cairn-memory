import { countTokens } from '../assembly/counter.mjs';
import { compareIds } from './fixture.mjs';

export const BODY_BANDS = Object.freeze([[120, 180, .30], [180, 260, .40], [260, 400, .30]]);
export const RECEIPT_BANDS = Object.freeze([[40, 70, .35], [70, 130, .40], [130, 200, .25]]);
export const RECEIPT_HISTOGRAM = Object.freeze([.20, .25, .25, .15, .10, .05]);
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const near = (a, b, tolerance = .05) => Number.isFinite(a) && Math.abs(a - b) <= tolerance + 1e-12;

// W1 may call this before queries/labels exist. Ranges are UTF-16 [start,end),
// naming a disclosed sentence. Every long unit must disclose its filler.
export function checkHR2bWorld(fixture) {
  const errors = [], statistics = {};
  const check = (condition, code, detail) => { if (!condition) errors.push({ code, ...(detail === undefined ? {} : { detail }) }); };
  const { memories } = fixture.corpus, { facts, families } = fixture.facts;
  const familyMap = new Map(families.map(family => [family.id, family]));
  const factMap = new Map(facts.map(fact => [fact.id, fact]));
  const counts = { S300: 160, 'S1000-extra': 320, foreign: 60 };
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
    check(Math.abs(rows.length - count) <= count * .10 + 1e-12, 'hr2b:count', scale);
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
      check(expressed.length >= 2 && expressed.length <= 4 && new Set(expressed.map(id => factMap.get(id)?.family)).size === 1, 'hr2b:memory_facts', memory.id);
      const sentences = memory.content.match(/[^.!?。！？]+[.!?。！？]+(?:["'”’」』])?/gu) ?? [];
      check(sentences.length >= 3 && sentences.length <= 8 && memory.content.trim().split(/\n\s*\n/u).length <= 2, 'hr2b:body_sentences', memory.id);
    }
  }
  for (const field of ['bodyMean', 'receiptMean']) check(near(statistics['S1000-extra'][field], statistics.S300[field], statistics.S300[field] * .15), 'hr2b:mean_match', field);
  RECEIPT_HISTOGRAM.forEach((_, i) => check(near(statistics.S300.histogram[i], statistics['S1000-extra'].histogram[i]), 'hr2b:histogram_match', i + 1));
  for (const memory of memories) {
    check(memory.spans.length >= 1 && memory.spans.length <= 6, 'hr2b:receipt_count', memory.id);
    const sorted = [...memory.spans].sort((a, b) => compareIds(a.eventTime, b.eventTime) || compareIds(a.id, b.id));
    check(memory.spans.every((span, i) => span === sorted[i] && span.id === `${memory.id}#s${i + 1}`), 'hr2b:receipt_order', memory.id);
  }
  const targetFamilies = families.filter(family => family.role === 'target');
  check(targetFamilies.length >= 40, 'hr2b:target_families');
  for (const family of targetFamilies) {
    const rows = facts.filter(fact => fact.family === family.id);
    check(rows.filter(fact => fact.rendered).length === 7 && rows.filter(fact => !fact.rendered).length === 1, 'hr2b:family_facts', family.id);
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
        return [positions.includes(0) ? 'first-receipt' : 'later-receipt'];
      });
      check(locations.length > 0 && new Set(locations).size === 1, 'hr2b:inconsistent_fact_placement', fact.id);
      return locations[0];
    });
    statistics.placement[role] = Object.fromEntries(Object.entries({ body: .45, 'first-receipt': .25, 'later-receipt': .30 }).map(([placement, share]) => {
      const actual = placements.filter(value => value === placement).length / rendered.length;
      check(near(actual, share), 'hr2b:placement_share', { role, placement, actual });
      return [placement, actual];
    }));
  }
  const lexicon = fixture.facts.forbiddenLexicon;
  check(lexicon && typeof lexicon === 'object' && !Array.isArray(lexicon), 'hr2b:lexicon_required');
  const terms = [];
  for (const fact of facts.filter(fact => fact.rendered)) {
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
