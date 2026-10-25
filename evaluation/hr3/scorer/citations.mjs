import { normalizeText, stable } from './canonical.mjs';

const address = x => stable({ intent: x.intent, item: x.item, unit: x.unit, source: x.source });
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

// Offsets throughout are UTF-16 code units, matching product receipt slicing.
// A mapping group is indivisible: citing one letter of an expanded ligature
// does not claim the entire original character as supporting evidence.
const parts = p => p.parts ?? [p];
function renderSegments(segments, normalize) {
  let cursor = 0;
  const positioned = segments.map((s, i) => { const from = cursor; cursor += s.text.length; return { ...s, i, from, to: cursor }; });
  const points = [];
  for (const cluster of segmenter.segment(segments.map(s => s.text).join(''))) {
    const end = cluster.index + cluster.segment.length;
    const provenance = positioned.filter(s => s.from < end && s.to > cluster.index).map(s => {
      const from = Math.max(cluster.index, s.from) - s.from, to = Math.min(end, s.to) - s.from;
      return { origin: s.origin, start: s.start + from, end: s.start + to, rawText: s.text.slice(from, to), group: `${cluster.index}:${s.i}` };
    });
    const text = normalize ? cluster.segment.normalize('NFKC') : cluster.segment;
    for (let i = 0; i < text.length; i++) points.push({ char: text[i], parts: provenance });
  }
  return points;
}
export function materializeUnit(unit) {
  let points = renderSegments(unit.segments, unit.normalize);
  if (unit.normalize) {
    const collapsed = [];
    for (let i = 0; i < points.length;) {
      if (!/\s/u.test(points[i].char)) { collapsed.push(points[i++]); continue; }
      let j = i + 1;
      while (j < points.length && /\s/u.test(points[j].char)) j++;
      // Keep all contributing origins, including a whitespace run crossing an
      // elision boundary. No synthetic gap becomes a delivered source span.
      collapsed.push({ char: ' ', parts: points.slice(i, j).flatMap(parts) });
      i = j;
    }
    while (collapsed[0]?.char === ' ') collapsed.shift();
    while (collapsed.at(-1)?.char === ' ') collapsed.pop();
    points = collapsed;
    if (points.map(p => p.char).join('') !== normalizeText(unit.segments.map(s => s.text).join(''))) throw new RangeError('Unrecognized Unicode normalization boundary');
  }
  const fullMap = points;
  const limit = unit.truncate ?? points.length;
  points = points.slice(0, limit);
  return { ...unit, text: points.map(p => p.char).join(''), map: points, fullMap };
}
const validAddress = a => Number.isSafeInteger(a.item) && a.item >= 0 && (a.unit === 'body' ? a.source === null : a.unit === 'receipt' && Number.isSafeInteger(a.source) && a.source >= 0);
export function deliveredIndex(units) {
  const index = new Map();
  const materialized = units.map(materializeUnit);
  for (const unit of materialized) for (const alias of [unit, ...unit.aliases]) {
    if (!validAddress(alias)) throw new RangeError('Invalid body/receipt source address');
    const key = address(alias);
    if (index.has(key)) throw new RangeError('Ambiguous delivered address/alias');
    index.set(key, unit);
  }
  return { index, units: materialized };
}
export function resolveCitation(citation, delivery) {
  if (!validAddress(citation)) return { ok: false, error: 'invalid_unit_source' };
  const unit = delivery.index.get(address(citation));
  if (!unit) return { ok: false, error: 'not_delivered' };
  const quote = citation.quote; // A-4: verbatim delivered-language substring.
  if (!quote.length) return { ok: false, error: 'empty_quote' };
  function locate(overlap) {
    let start = -1;
    for (let i = 0; i < citation.occurrence; i++) {
      start = unit.text.indexOf(quote, i === 0 ? 0 : start + (overlap ? 1 : quote.length));
      if (start === -1) break;
    }
    return start;
  }
  const start = locate(true), nonoverlap = locate(false);
  // The protocol does not freeze overlapping-occurrence semantics. Do not
  // silently select an interpretation when it changes the submitted citation.
  if (start !== nonoverlap) return { ok: false, ambiguous: true, error: 'ambiguous_overlapping_occurrence' };
  if (start === -1) return { ok: false, error: 'quote_or_occurrence_not_delivered' };
  return { ok: true, unit, start, end: start + quote.length };
}
export function resolveCitations(citations, delivery) {
  return citations.map(c => resolveCitation(c, delivery));
}
export function coveredSpans(resolved) {
  const units = new Map();
  for (const r of resolved.filter(r => r.ok)) {
    if (!units.has(r.unit)) units.set(r.unit, new Set());
    for (let i = r.start; i < r.end; i++) units.get(r.unit).add(i);
  }
  const ranges = [];
  for (const [unit, covered] of units) {
    const groupIndices = new Map();
    unit.fullMap.forEach((p, i) => { for (const q of parts(p)) {
      if (!groupIndices.has(q.group)) groupIndices.set(q.group, { ...q, indices: new Set() });
      groupIndices.get(q.group).indices.add(i);
    } });
    for (const group of groupIndices.values()) if ([...group.indices].every(i => covered.has(i))) ranges.push({ origin: group.origin, start: group.start, end: group.end, text: group.rawText });
  }
  return ranges;
}
export function covers(span, ranges) {
  // Source quotations often include leading/trailing whitespace that product
  // normalization removes. It carries no requirement to cite absent trivia.
  const leading = span.text.match(/^\s*/u)[0].length;
  const trailing = span.text.match(/\s*$/u)[0].length;
  span = { ...span, start: span.start + leading, end: span.end - trailing, text: span.text.slice(leading, span.text.length - trailing) };
  if (span.start >= span.end) return false;
  let cursor = span.start;
  for (const r of ranges.filter(r => r.origin === span.origin).sort((a, b) => a.start - b.start || a.end - b.end)) {
    if (r.start > cursor) break;
    const start = Math.max(span.start, r.start), end = Math.min(span.end, r.end);
    if (end > start && span.text.slice(start - span.start, end - span.start) !== r.text.slice(start - r.start, end - r.start)) return false;
    if (r.end > cursor) cursor = r.end;
    if (cursor >= span.end) return true;
  }
  return false;
}

export function supportBundle(question, answer, delivery) {
  // Never accept gold or a correctness result as an argument here.
  return {
    pass: 'support', question, answer,
    delivered: delivery.units.map(u => ({ intent: u.intent, item: u.item, unit: u.unit, source: u.source, aliases: u.aliases, text: u.text })),
    rubric: 'Follow submitted citations only. Other delivered context can disambiguate or negate but cannot substitute uncited support. Require a complete quoted causal explanation: serial intermediates, conjunction language and sufficient alternatives; reject unrelated, speculative, negated or wrong-change clauses and broad over-citation. A bare deadline is insufficient without an explicit expiry cause. Do not add values, causal clauses or citations. Return unresolved if undecidable.',
  };
}
