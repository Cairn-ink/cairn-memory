import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateGold } from '../scorer/scorer.mjs';
import { answerSchema, submissionSchema, validate } from '../scorer/schema.mjs';

export const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
export const hash = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : stable(v)).digest('hex');
const copy = structuredClone;
function requireThat(ok, message) { if (!ok) throw new Error(message); }
const withoutCitations = row => { requireThat(Array.isArray(row.citations) && row.citations.length === 0, 'Gold citations cannot be discarded'); const { citations, ...rest } = row; return copy(rest); };
function project(answer, causal) {
  requireThat(validate(answerSchema, answer).length === 0, 'Source gold A-4 slot Answer shape invalid');
  requireThat(answer.reason.support.length === 0, 'Gold support citations cannot be discarded');
  requireThat(causal && Array.isArray(causal.reason?.nodes), 'Private causal nodes required');
  return { current: { status: answer.current.status, rows: answer.current.rows.map(withoutCitations) },
    old: { status: answer.old.status, records: answer.old.records.map(r => ({ predecessor_turn: r.predecessor_turn, status: r.status, rows: r.rows.map(withoutCitations) })) },
    reason: { status: answer.reason.status, nodes: causal.reason.nodes.map(n => ({ id: n.id, claim: withoutCitations(n.claim) })) } };
}
function finish(kind, source, gold, submission, extras) {
  validateGold(gold);
  if (submission) requireThat(validate(submissionSchema, submission).length === 0, 'Adapted A-4 submission schema invalid');
  return { gold, submission, audit: { version: 'hr3-integration-a4-v2', kind, sourceHash: hash(source), source: copy(source), ...extras } };
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
  requireThat(isDeepStrictEqual(acceptedGraphs, sc.acceptedGraphs.map(g => ({ edges: g.edges.map(({ from, to }) => ({ from, to })) }))), 'Correctness/support graph mismatch');
  const turns = new Map(family.batches.flatMap(b => b.turns).map(t => [t.turn_id, t.text])), r = registry();
  function span(s) {
    requireThat(s.offset_unit === 'utf16', 'Unsupported offset unit');
    requireThat(Number.isSafeInteger(s.start) && Number.isSafeInteger(s.end) && s.start >= 0 && s.end > s.start && turns.get(s.turn_id)?.slice(s.start, s.end) === s.quote, 'Source span mismatch');
    return r.add(s.turn_id, s.start, s.quote);
  }
  sc.assertion_spans.forEach(a => a.spans.forEach(span));
  const graphs = sc.acceptedGraphs.map(g => ({ edges: g.edges.map(e => ({ from: e.from, to: e.to, support: e.support.map(a => a.map(span)) })) }));
  const p = project(answer, gc.private_causal);
  const gold = { question: checkpoint.question, ...p, reason: { ...p.reason, acceptedGraphs: graphs }, supportSpans: r.spans };
  return finish('generator', { family, goldRow, supportRow, batch }, gold, null, {
    defects: [{ code: 'NON_SCORER_METADATA', fields: ['family authoring/control metadata', 'family_id', 'lineage_id', 'batch', 'assertion_spans.event_id', 'offset_unit'], disposition: 'retained verbatim in audit source; no scorer slot' }],
    conventions: ['Slot citations and quoted-support placeholders must be empty in source gold.', 'Private causal nodes remain gold only; verified quotation/UTF-16 source spans are interned in stable encounter order.'],
  });
}
const addr = c => ({ intent: c.intent, item: c.item, unit: c.unit, source: c.source });
const unitKey = u => stable([u.item, u.unit, u.source]);
// Only A-4 challenge input is accepted. The superseded graph-answer bank must
// be replaced by its owner; it is never reinterpreted as slot/quotation input.
export function adaptChallenge(row, world) {
  requireThat(row.world_id === world.id && row.question === world.question && isDeepStrictEqual(row.gold, world.gold), 'Challenge world/gold join mismatch');
  requireThat(validate(answerSchema, row.candidate).length === 0, 'Candidate requires an A-4 slot answer');
  const p = project(row.gold.answer, row.gold.private_causal), r = registry();
  const base = new Map(), addresses = new Map();
  for (const u of world.delivered) {
    requireThat(!base.has(unitKey(u)), 'Duplicate source delivery address'); base.set(unitKey(u), u);
    r.add(`source:${unitKey(u)}`, 0, u.text);
  }
  const remember = c => { const previous = addresses.get(unitKey(c)); requireThat(!previous || isDeepStrictEqual(previous, addr(c)), 'Conflicting authored intent'); addresses.set(unitKey(c), addr(c)); };
  for (const s of world.row_support) remember(s.citation);
  for (const e of world.edge_support) for (const alternative of e.alternatives) for (const c of alternative) remember(c);
  function span(c) {
    const u = base.get(unitKey(c)); requireThat(u && c.occurrence === 1 && u.text === c.quote, 'Support citation is not an exact authored unit');
    return r.add(`source:${unitKey(u)}`, 0, u.text);
  }
  const acceptedGraphs = row.gold.acceptedGraphs.map(g => ({ edges: g.edges.map(e => {
    const plan = world.edge_support.filter(s => s.from === e.from && s.to === e.to);
    requireThat(plan.length === 1, 'Missing/duplicate edge support plan');
    return { from: e.from, to: e.to, support: plan[0].alternatives.map(a => a.map(span)) };
  }) }));
  const gold = { question: row.question, ...p, reason: { ...p.reason, acceptedGraphs }, supportSpans: r.spans };
  const delivered = row.delivered.map(u => {
    const original = base.get(unitKey(u)), address = addresses.get(unitKey(u));
    requireThat(address, 'Missing authored delivery intent');
    // Modified text has a new origin; original source offsets never license it.
    const origin = original?.text === u.text ? `source:${unitKey(u)}` : `modified:${unitKey(u)}`;
    return { ...address, aliases: [], segments: [{ origin, start: 0, text: u.text }], normalize: false, truncate: null };
  });
  return finish('challenge', { row, world }, gold, { answer: copy(row.candidate), delivered }, {
    defects: [{ code: 'NON_SCORER_METADATA', fields: ['row labels/provenance/group/referral/representation', 'world authoring metadata'], disposition: 'retained verbatim in audit; excluded from scoring/judge bundles' },
      { code: 'DELIVERY_PROVENANCE_LIMIT', fields: ['delivered.text'], disposition: 'final authored text only; no normalization/truncation ancestry inferred' }],
    conventions: ['A-4 slot rows, predecessor identities and quotation choices pass unchanged.', 'Private graph/support plans are gold-only; all delivery intents are explicitly authored.'],
  });
}
// A diagnostic gold witness delivers authored spans and selects the complete
// first accepted path/union. It is never a live reader or arm fallback.
export function goldWitness(gold) {
  const acceptedIds = new Set(gold.reason.acceptedGraphs.flatMap(g=>g.edges.flatMap(e=>e.support.flat())));
  const witnessSpans = gold.supportSpans.filter(s=>acceptedIds.has(s.id));
  const delivered = witnessSpans.map((s, item) => ({ intent: 'current', item, unit: 'body', source: null, aliases: [], segments: [{ origin: s.origin, start: s.start, text: s.text }], normalize: false, truncate: null }));
  const citation = id => { const item = witnessSpans.findIndex(s => s.id === id); requireThat(item >= 0, 'Unknown witness span'); return { intent: 'current', item, unit: 'body', source: null, quote: witnessSpans[item].text, occurrence: 1 }; };
  const row = r => ({ ...copy(r), citations: [] });
  const support = [...new Set((gold.reason.acceptedGraphs[0]?.edges ?? []).flatMap(e => e.support[0]))].map(citation);
  return { answer: { current: { status: gold.current.status, rows: gold.current.rows.map(row) }, old: { status: gold.old.status, records: gold.old.records.map(r => ({ predecessor_turn: r.predecessor_turn, status: r.status, rows: r.rows.map(row) })) },
    reason: { status: gold.reason.status, support } }, delivered };
}
