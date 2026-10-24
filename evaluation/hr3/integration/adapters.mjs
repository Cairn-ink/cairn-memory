import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateGold } from '../scorer/scorer.mjs';
import { answerSchema, submissionSchema, validate } from '../scorer/schema.mjs';

export const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
export const hash = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : stable(v)).digest('hex');
const copy = structuredClone;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
const withoutCitations = c => { requireThat(Array.isArray(c.citations) && c.citations.length === 0, 'Gold citations cannot be discarded'); const { citations, ...rest } = c; return copy(rest); };
function project(answer) {
  requireThat(validate(answerSchema, answer).length === 0, 'Source gold Answer shape invalid');
  return { current: { ...copy(answer.current), claims: answer.current.claims.map(withoutCitations) },
    old: { ...copy(answer.old), records: answer.old.records.map(r => ({ status: r.status, claims: r.claims.map(withoutCitations) })) },
    reason: { status: answer.reason.status, nodes: answer.reason.nodes.map(n => ({ id: n.id, claim: withoutCitations(n.claim) })) } };
}
function finish(kind, source, gold, submission, extras) {
  validateGold(gold);
  if (submission) requireThat(validate(submissionSchema, submission).length === 0, 'Adapted submission schema invalid');
  // The scorer schema is closed. Keep the complete original in an audit sidecar;
  // never smuggle authoring metadata into scorer/judge input.
  return { gold, submission, audit: { version: 'hr3-integration-v1', kind, sourceHash: hash(source), source: copy(source), ...extras } };
}
export function restore(adapted) {
  requireThat(hash(adapted.audit.source) === adapted.audit.sourceHash, 'Audit source hash mismatch');
  return copy(adapted.audit.source);
}
function registry() {
  const spans = [], byContent = new Map();
  return { spans, add(origin, start, text) {
    requireThat(text.length > 0, 'Empty source span');
    const key = stable([origin, start, text]);
    if (byContent.has(key)) return byContent.get(key);
    const id = `s${spans.length + 1}`;
    spans.push({ id, origin, start, end: start + text.length, text }); byContent.set(key, id); return id;
  } };
}
export function adaptGenerator(family, goldRow, supportRow, batch) {
  requireThat(family.family_id === goldRow.family_id && family.family_id === supportRow.family_id, 'Family join mismatch');
  const one = (rows, key) => { const found = rows.filter(x => x.batch === batch); requireThat(found.length === 1, `Missing/duplicate ${key} checkpoint`); return found[0]; };
  const checkpoint = one(family.checkpoints, 'family'), gc = one(goldRow.checkpoints, 'gold'), sc = one(supportRow.checkpoints, 'support');
  const { acceptedGraphs, ...answer } = gc.G_correct;
  requireThat(answer.reason.edges.length === 0, 'Generator gold contains unexpected explicit edges');
  requireThat(isDeepStrictEqual(acceptedGraphs, sc.acceptedGraphs.map(g => ({ edges: g.edges.map(({ from, to }) => ({ from, to })) }))), 'Correctness/support graph mismatch');
  const turns = new Map(family.batches.flatMap(b => b.turns).map(t => [t.turn_id, t.text]));
  const r = registry();
  function span(s) {
    requireThat(s.offset_unit === 'utf16', 'Unsupported offset unit');
    requireThat(Number.isSafeInteger(s.start) && Number.isSafeInteger(s.end) && s.start >= 0 && s.end > s.start && turns.get(s.turn_id)?.slice(s.start, s.end) === s.quote, 'Source span mismatch');
    return r.add(s.turn_id, s.start, s.quote);
  }
  sc.assertion_spans.forEach(a => a.spans.forEach(span));
  const graphs = sc.acceptedGraphs.map(g => ({ edges: g.edges.map(e => ({ from: e.from, to: e.to, support: e.support.map(a => a.map(span)) })) }));
  const p = project(answer);
  const gold = { question: checkpoint.question, ...p, reason: { ...p.reason, acceptedGraphs: graphs }, supportSpans: r.spans };
  return finish('generator', { family, goldRow, supportRow, batch }, gold, null, {
    defects: [{ code: 'NON_SCORER_METADATA', fields: ['family authoring/control metadata', 'family_id', 'lineage_id', 'batch', 'assertion_spans.event_id', 'offset_unit'], disposition: 'retained verbatim in audit source; no scorer slot' }],
    conventions: ['Empty Claim citations and empty reason.edges are reversible gold placeholders.', 'Source span IDs allocated in stable encounter order; quotation/UTF-16 offsets verified against source turns.'],
  });
}
const addr = c => ({ intent: c.intent, item: c.item, unit: c.unit, source: c.source });
const unitKey = u => stable([u.item, u.unit, u.source]);
export function adaptChallenge(row, world) {
  requireThat(row.world_id === world.id && row.question === world.question && isDeepStrictEqual(row.gold, world.gold), 'Challenge world/gold join mismatch');
  requireThat(row.gold.answer.reason.edges.every(e => e.citations.length === 0), 'Challenge gold edge citations cannot be discarded');
  requireThat(row.gold.acceptedGraphs.some(g => isDeepStrictEqual(g, row.gold.answer.reason.edges.map(({ from, to }) => ({ from, to })))), 'Gold reason.edges is not an accepted graph');
  const p = project(row.gold.answer), r = registry();
  const base = new Map(), addresses = new Map();
  for (const u of world.delivered) {
    requireThat(!base.has(unitKey(u)), 'Duplicate source delivery address'); base.set(unitKey(u), u);
    r.add(`source:${unitKey(u)}`, 0, u.text);
  }
  for (const s of world.claims_support) addresses.set(unitKey(s.citation), addr(s.citation));
  for (const e of world.edge_support) for (const alternative of e.alternatives) for (const c of alternative) {
    const previous = addresses.get(unitKey(c));
    requireThat(!previous || isDeepStrictEqual(previous, addr(c)), 'Conflicting authored intent'); addresses.set(unitKey(c), addr(c));
  }
  function span(c) {
    const u = base.get(unitKey(c)); requireThat(u && c.occurrence === 1 && u.text === c.quote, 'Support citation is not an exact authored unit');
    return r.add(`source:${unitKey(u)}`, 0, u.text);
  }
  // Challenge uses [[]] for not_stated; canonical gold uses no accepted graphs.
  const acceptedGraphs = row.gold.acceptedGraphs.filter(g => g.length).map(g => ({ edges: g.map(e => {
    const plan = world.edge_support.filter(s => s.from === e.from && s.to === e.to);
    requireThat(plan.length === 1, 'Missing/duplicate edge support plan');
    return { ...e, support: plan[0].alternatives.map(a => a.map(span)) };
  }) }));
  const gold = { question: row.question, ...p, reason: { ...p.reason, acceptedGraphs }, supportSpans: r.spans };
  const delivered = row.delivered.map(u => {
    const original = base.get(unitKey(u));
    const address = addresses.get(unitKey(u)) ?? { intent: 'current', item: u.item, unit: u.unit, source: u.source };
    // New/changed extracted bodies are distinct local sources. Do not license
    // changed words with the original source offsets or a gold-guided alias.
    const origin = original?.text === u.text ? `source:${unitKey(u)}` : `modified:${unitKey(u)}`;
    return { ...address, aliases: [], segments: [{ origin, start: 0, text: u.text }], normalize: false, truncate: null };
  });
  return finish('challenge', { row, world }, gold, { answer: copy(row.candidate), delivered }, {
    defects: [{ code: 'NON_SCORER_METADATA', fields: ['row identity/set/language/style/labels/provenance/group/role/referral/representation/evidence_variant', 'world source_ast and authoring metadata', 'claims_support.section'], disposition: 'retained verbatim in audit source; excluded from scoring and judge bundles' },
      { code: 'DELIVERY_PROVENANCE_LIMIT', fields: ['delivered.text'], disposition: 'challenge supplies final text only; local identity map with normalize=false/truncate=null; cannot reconstruct product normalization/truncation ancestry' }],
    conventions: ['Gold reason.edges retained in sidecar; verified below against accepted graph.', 'Historical intent from world.claims_support; all other authored units use current; no inferred aliases.', 'All original source units retained as context spans; only edge_support licenses causal edges.'],
  });
}
// Synthetic gold witness: explicitly deliver exactly the authored spans as
// independent slices, and cite the first complete accepted graph. This is not
// a claim about an arm delivery or generated reader output.
export function goldWitness(gold) {
  const delivered = gold.supportSpans.map((s, item) => ({ intent: 'current', item, unit: 'body', source: null, aliases: [], segments: [{ origin: s.origin, start: s.start, text: s.text }], normalize: false, truncate: null }));
  const citation = id => { const item = gold.supportSpans.findIndex(s => s.id === id); requireThat(item >= 0, 'Unknown witness span'); return { intent: 'current', item, unit: 'body', source: null, quote: gold.supportSpans[item].text, occurrence: 1 }; };
  const claim = c => ({ ...copy(c), citations: [] });
  return { answer: { current: { ...copy(gold.current), claims: gold.current.claims.map(claim) }, old: { ...copy(gold.old), records: gold.old.records.map(r => ({ status: r.status, claims: r.claims.map(claim) })) },
    reason: { status: gold.reason.status, nodes: gold.reason.nodes.map(n => ({ id: n.id, claim: claim(n.claim) })), edges: (gold.reason.acceptedGraphs[0]?.edges ?? []).map(e => ({ from: e.from, to: e.to, citations: e.support[0].map(citation) })) } }, delivered };
}
