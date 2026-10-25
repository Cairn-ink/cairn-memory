import { SUPPORT_VERSION, TRIVIA_VERSION } from '../support.mjs';
// Independently written synthetic engineering examples, never calibration data.
export const copy = structuredClone;
export const text = text => ({ type: 'Text', text });
export const quantity = (decimal, unit = '1') => ({ type: 'Quantity', decimal, unit });
export const universal = () => ({ any: [{ all: [] }] });
export const scoped = (country = 'TW') => ({ any: [{ all: [{ field: 'country', values: [country] }] }] });
export function claim(value = { type: 'Boolean', value: true }) {
  return { subject: 'synthetic-policy', predicate: 'value', value, scope: universal(), valid: { from: null, to: null }, qualifiers: [] };
}
export const slot = (value, state = value === null ? 'not_specified' : 'value') => ({ state, value });
export function row(route = 'cedar') {
  return { scope: universal(), valid: { from: null, to: null }, route: slot(route), approval: slot(true), cap: slot({ decimal: '20', unit: 'requests/day' }) };
}
export const cited = c => ({ ...copy(c), citations: [] });
export const citation = (item = 0, quote = 'A caused B.', overrides = {}) => ({ intent: 'current', item, unit: 'receipt', source: 0, quote, occurrence: 1, ...overrides });
export function fixture() {
  const supportSpans = [
    { id: 'ab', origin: 'turn-1', start: 0, end: 11, text: 'A caused B.' },
    { id: 'bc', origin: 'turn-2', start: 0, end: 11, text: 'B caused C.' },
  ];
  const gold = {
    supportVersion: SUPPORT_VERSION, supportTrivia: { version: TRIVIA_VERSION, producer: null, rules: [], positions: [] },
    question: 'At the checkpoint, give route, approval and cap for all cells, predecessor turn-old with its historical label, and the complete explanation for turn-2.',
    current: { status: 'active', rows: [row()] },
    old: { status: 'available', records: [{ predecessor_turn: 'turn-old', status: 'previously_adopted', rows: [row('birch')] }] },
    reason: { status: 'stated', nodes: ['A', 'B', 'C'].map((id, i) => ({ id, claim: claim(quantity(String(i + 1))) })),
      acceptedGraphs: [{ edges: [{ from: 'A', to: 'B', support: [['ab']] }, { from: 'B', to: 'C', support: [['bc']] }] }] },
    supportSpans,
  };
  const answer = {
    current: { status: gold.current.status, rows: gold.current.rows.map(cited) },
    old: { status: gold.old.status, records: gold.old.records.map(r => ({ predecessor_turn: r.predecessor_turn, status: r.status, rows: r.rows.map(cited) })) },
    reason: { status: 'stated', support: [citation(), citation(1, 'B caused C.')] },
  };
  const delivered = supportSpans.map((s, item) => ({ intent: 'current', item, unit: 'receipt', source: 0, aliases: [], segments: [{ origin: s.origin, start: 0, text: s.text }], normalize: true, truncate: 800 }));
  return { gold, submission: { answer, delivered } };
}
