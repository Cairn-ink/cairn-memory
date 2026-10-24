// Tiny hand-written synthetic examples, not the independent §8 challenge set.
export const copy = structuredClone;
export const text = text => ({ type: 'Text', text });
export const quantity = (decimal, unit = '1') => ({ type: 'Quantity', decimal, unit });
export const universal = () => ({ any: [{ all: [] }] });
export const scoped = (country = 'TW') => ({ any: [{ all: [{ field: 'country', values: [country] }] }] });
export function claim(value = { type: 'Boolean', value: true }) {
  return { subject: 'synthetic-policy', predicate: 'value', value, scope: universal(), valid: { from: null, to: null }, qualifiers: [] };
}
export const cited = c => ({ ...copy(c), citations: [] });
export const citation = (item = 0, quote = 'A caused B.', overrides = {}) => ({ intent: 'current', item, unit: 'receipt', source: 0, quote, occurrence: 1, ...overrides });
export function fixture() {
  const supportSpans = [
    { id: 'ab', origin: 'turn-1', start: 0, end: 11, text: 'A caused B.' },
    { id: 'bc', origin: 'turn-2', start: 0, end: 11, text: 'B caused C.' },
    { id: 'ac', origin: 'turn-3', start: 0, end: 11, text: 'A caused C.' },
    { id: 'dc', origin: 'turn-4', start: 0, end: 11, text: 'D caused C.' },
  ];
  const gold = {
    question: 'What is the synthetic policy, its requested predecessor, and why did it change?',
    current: { status: 'active', claims: [claim()] },
    old: { status: 'available', records: [{ status: 'previously_adopted', claims: [claim({ type: 'Boolean', value: false })] }] },
    reason: { status: 'stated', nodes: ['A', 'B', 'C'].map((id, i) => ({ id, claim: claim(quantity(String(i + 1))) })),
      acceptedGraphs: [{ edges: [{ from: 'A', to: 'B', support: [['ab']] }, { from: 'B', to: 'C', support: [['bc']] }] }] },
    supportSpans,
  };
  const answer = {
    current: { status: gold.current.status, claims: gold.current.claims.map(cited) },
    old: { status: gold.old.status, records: gold.old.records.map(r => ({ status: r.status, claims: r.claims.map(cited) })) },
    reason: { status: 'stated', nodes: gold.reason.nodes.map(n => ({ id: n.id, claim: cited(n.claim) })),
      edges: [{ from: 'A', to: 'B', citations: [citation()] }, { from: 'B', to: 'C', citations: [citation(1, 'B caused C.')] }] },
  };
  const delivered = supportSpans.map((s, item) => ({ intent: 'current', item, unit: 'receipt', source: 0, aliases: [], segments: [{ origin: s.origin, start: 0, text: s.text }], normalize: true, truncate: 800 }));
  return { gold, submission: { answer, delivered } };
}
