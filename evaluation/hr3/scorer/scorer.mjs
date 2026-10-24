import { createHash } from 'node:crypto';
import { answerSchema, goldSchema, submissionSchema, validate } from './schema.mjs';
import { claim, stable, unique, knownAtom, UnknownEquivalence, DICTIONARY_VERSION } from './canonical.mjs';
import { deliveredIndex, resolveCitations, coveredSpans, covers, supportBundle } from './citations.mjs';

export const SEED = 'hr3-scorer-v1'; // No stochastic decision or model invocation.
const digest = value => createHash('sha256').update(SEED + '\n' + stable(value)).digest('hex');
const and = values => values.includes(0) ? 0 : values.includes(null) ? null : 1;
const or = values => values.includes(1) ? 1 : values.includes(null) ? null : 0;
const textEqual = (a, b) => a === b ? 1 : knownAtom(a) && knownAtom(b) ? 0 : null;

function valueEqual(a, b) {
  if (stable(a) === stable(b)) return 1;
  if (a.type !== b.type) return 0;
  if (a.type === 'Text') return textEqual(a.text, b.text);
  if (a.dimension !== b.dimension && (a.dimension?.startsWith('unknown:') || b.dimension?.startsWith('unknown:'))) return null;
  return 0;
}

// Set matching uses a bipartite perfect matching, never greedy pairing. Unknown
// equivalences can only yield a referral; they cannot be used as full credit.
function canMatch(rows, cols, compare, allowUnknown) {
  if (rows.length !== cols.length) return false;
  const assigned = new Map();
  function augment(i, seen) {
    for (let j = 0; j < cols.length; j++) {
      const verdict = compare(rows[i], cols[j]);
      if ((verdict !== 1 && !(allowUnknown && verdict === null)) || seen.has(j)) continue;
      seen.add(j);
      if (!assigned.has(j) || augment(assigned.get(j), seen)) { assigned.set(j, i); return true; }
    }
    return false;
  }
  return rows.every((_, i) => augment(i, new Set()));
}
function setEqual(a, b, compare) {
  a = unique(a); b = unique(b);
  if (canMatch(a, b, compare, false)) return 1;
  if (canMatch(a, b, compare, true)) return null;
  // Different counts might be equivalent duplicates unrecognized by the frozen
  // dictionary. Missing/extra known content remains a definite failure.
  if (a.length !== b.length && a.length && b.length) {
    const left = a.every(x => b.some(y => compare(x, y) !== 0));
    const right = b.every(y => a.some(x => compare(x, y) !== 0));
    if (left && right && a.some(x => b.some(y => compare(x, y) === null))) return null;
  }
  return 0;
}
function claimEqual(a, b) {
  return and([
    textEqual(a.subject, b.subject), textEqual(a.predicate, b.predicate), valueEqual(a.value, b.value),
    stable(a.scope) === stable(b.scope) ? 1 : 0,
    stable(a.valid) === stable(b.valid) ? 1 : 0,
    setEqual(a.qualifiers, b.qualifiers, (x, y) => and([textEqual(x.key, y.key), valueEqual(x.value, y.value)])),
  ]);
}
// Equivalent audience partitions denote the same assertions. Expanding first
// also preserves contradictory values on overlapping cells as separate claims.
const expandClaims = claims => unique(claims.flatMap(c => c.scope.map(cell => ({ ...c, scope: [cell] }))));
const claimsEqual = (a, b) => setEqual(expandClaims(a.map(claim)), expandClaims(b.map(claim)), claimEqual);
function currentCorrect(answer, gold) {
  return and([answer.status === gold.status ? 1 : 0, claimsEqual(answer.claims, gold.claims)]);
}
function oldCorrect(answer, gold) {
  return and([answer.status === gold.status ? 1 : 0, setEqual(
    answer.records.map(r => ({ status: r.status, claims: unique(r.claims.map(claim)) })),
    gold.records.map(r => ({ status: r.status, claims: unique(r.claims.map(claim)) })),
    (a, b) => and([a.status === b.status ? 1 : 0, setEqual(expandClaims(a.claims), expandClaims(b.claims), claimEqual)]),
  )]);
}
export function correctnessGold(gold) {
  return {
    current: gold.current, old: gold.old,
    reason: { status: gold.reason.status, nodes: gold.reason.nodes,
      acceptedGraphs: gold.reason.acceptedGraphs.map(g => ({ edges: g.edges.map(({ from, to }) => ({ from, to })) })) },
  };
}
export function correctnessBundle(question, answer, gold) {
  return { pass: 'correctness', question, answer, G_correct: correctnessGold(gold),
    rubric: 'Judge semantic correspondence only, including status, scope, qualifications, time and accepted directed graph structure. Do not judge delivered support or repair the submitted answer. Unknown equivalences remain unresolved.' };
}

function validateGraph(reason, isGold) {
  const ids = new Set();
  for (const n of reason.nodes) {
    if (ids.has(n.id)) throw new RangeError('Duplicate reason node ID');
    ids.add(n.id);
  }
  const graphs = isGold ? reason.acceptedGraphs : [{ edges: reason.edges }];
  for (const g of graphs) {
    for (const e of g.edges) if (!ids.has(e.from) || !ids.has(e.to)) throw new RangeError('Dangling causal endpoint');
    if (reason.status !== 'stated' && g.edges.length) throw new RangeError('Non-stated reason must have no causal edges');
  }
  if (isGold && reason.status === 'stated' && !graphs.length) throw new RangeError('Stated gold requires accepted graphs');
}

export function validateGold(gold) {
  const errors = validate(goldSchema, gold);
  if (errors.length) throw new TypeError('Invalid gold: ' + errors.join('; '));
  validateGraph(gold.reason, true);
  [...gold.current.claims, ...gold.old.records.flatMap(r => r.claims), ...gold.reason.nodes.map(n => n.claim)].forEach(claim);
  const spans = new Map();
  for (const span of gold.supportSpans) {
    if (spans.has(span.id) || span.start >= span.end || span.text.length !== span.end - span.start) throw new RangeError('Invalid/duplicate support span');
    spans.set(span.id, span);
  }
  for (const g of gold.reason.acceptedGraphs) for (const e of g.edges) for (const alternative of e.support) for (const id of alternative) {
    if (!spans.has(id)) throw new RangeError('Unknown support span ID');
  }
  return spans;
}

// Full-credit causal correspondence is evaluated on canonical endpoint claims,
// not node identifiers. Alternative graphs can share or rename nodes.
function causalContent(answer, gold) {
  const answerNodes = new Map(answer.nodes.map(n => [n.id, claim(n.claim)]));
  const goldNodes = new Map(gold.nodes.map(n => [n.id, claim(n.claim)]));
  const accepted = gold.acceptedGraphs.flatMap(g => g.edges).map(e => ({ ...e, a: goldNodes.get(e.from), b: goldNodes.get(e.to) }));
  const grouped = new Map();
  for (const e of answer.edges) {
    const a = answerNodes.get(e.from), b = answerNodes.get(e.to), key = stable([a, b]);
    if (grouped.has(key)) grouped.get(key).citations.push(...e.citations);
    else grouped.set(key, { ...e, citations: [...e.citations], a, b });
  }
  const submitted = [...grouped.values()];
  const equalEdge = (a, b) => and([claimEqual(a.a, b.a), claimEqual(a.b, b.b)]);
  // Every node must belong to an accepted causal structure. Extra assertions
  // are not rescued merely because one complete accepted graph is present.
  const nodeVerdict = and([...answerNodes.values()].map(n => or([...goldNodes.values()].map(g => claimEqual(n, g)))));
  const noExtras = and(submitted.map(e => or(accepted.map(g => equalEdge(e, g)))));
  const complete = or(gold.acceptedGraphs.map(g => and(g.edges.map(e => or(submitted.map(a => equalEdge(a, { a: goldNodes.get(e.from), b: goldNodes.get(e.to) })))))));
  const status = answer.status === gold.status ? 1 : 0;
  const content = gold.status === 'stated' ? and([nodeVerdict, noExtras, complete])
    : and([answer.edges.length ? 0 : 1, claimsEqual(answer.nodes.map(n => n.claim), gold.nodes.map(n => n.claim))]);
  return { verdict: and([status, content]), edges: submitted.map(e => ({ submitted: e, matches: accepted.map(g => ({ edge: g, verdict: equalEdge(e, g) })).filter(m => m.verdict !== 0) })) };
}

function edgeSupport(causal, spans, delivery) {
  // Exact source licenses decide support only in a fully recognized context.
  // Unlicensed surrounding/distractor text could negate or disambiguate a
  // citation. Its semantics belong to the isolated, gold-blind support pass.
  const contextLicensed = delivery.units.every(unit => unit.map.every(point => (point.parts ?? [point]).every(r => [...spans.values()].some(s => s.origin === r.origin && r.start >= s.start && r.end <= s.end && s.text.slice(r.start - s.start, r.end - s.start) === r.rawText))));
  const details = causal.edges.map(({ submitted, matches }) => {
    const citations = resolveCitations(submitted.citations, delivery);
    if (!citations.length || citations.some(c => !c.ok && !c.ambiguous)) return { from: submitted.from, to: submitted.to, verdict: 0, error: 'missing_or_invalid_submitted_citation' };
    if (citations.some(c => c.ambiguous)) return { from: submitted.from, to: submitted.to, verdict: null, error: 'ambiguous_overlapping_occurrence' };
    const ranges = coveredSpans(citations);
    const licensed = matches.filter(m => m.verdict === 1).some(m => m.edge.support.some(conjunction => conjunction.every(id => covers(spans.get(id), ranges))));
    // A delivered citation outside the frozen accepted span alternatives might
    // express an unrecognized causal equivalence; only §8 can decide it.
    const knownSpans = matches.filter(m => m.verdict === 1).flatMap(m => m.edge.support.flatMap(ids => ids.map(id => spans.get(id))));
    const onlyKnownFragments = matches.every(m => m.verdict === 1) && ranges.length > 0 && ranges.every(r => knownSpans.some(s => s.origin === r.origin && r.start >= s.start && r.end <= s.end));
    return { from: submitted.from, to: submitted.to, verdict: licensed && contextLicensed ? 1 : !licensed && onlyKnownFragments ? 0 : null,
      error: licensed && contextLicensed ? null : !licensed && onlyKnownFragments ? 'incomplete_required_support' : licensed ? 'unrecognized_evidence_context' : 'unrecognized_causal_support' };
  });
  return { verdict: and(details.map(d => d.verdict)), edges: details };
}

function citationDiagnostics(answer, delivery) {
  const report = claims => claims.map(c => {
    const citations = resolveCitations(c.citations, delivery);
    return { cited: citations.length > 0, resolved: citations.length > 0 && citations.every(c => c.ok), errors: citations.filter(c => !c.ok).map(c => c.error) };
  });
  return { current: report(answer.current.claims), old: answer.old.records.map(r => report(r.claims)),
    note: 'Citation resolution is reported separately from factual C/O and is not a semantic support verdict.' };
}

function anonymize(answer, gold) {
  // Inputs carry no arm/lineage metadata. Replace arbitrary node and source
  // identities with deterministic local identifiers before referral export.
  const renamed = input => {
    const out = structuredClone(input);
    const names = new Map(out.reason.nodes.map((n, i) => [n.id, `n${i + 1}`]));
    out.reason.nodes.forEach(n => { n.id = names.get(n.id); });
    if (out.reason.edges) out.reason.edges.forEach(e => { e.from = names.get(e.from); e.to = names.get(e.to); });
    if (out.reason.acceptedGraphs) out.reason.acceptedGraphs.forEach(g => g.edges.forEach(e => { e.from = names.get(e.from); e.to = names.get(e.to); }));
    return out;
  };
  return { answer: renamed(answer), gold: renamed(correctnessGold(gold)) };
}

export function score(gold, submission) {
  const spans = validateGold(gold); // Invalid authoring input is a CLI error.
  const base = { version: 'hr3-scorer-v1', protocol: 'v0.3.4', seed: SEED, dictionary: DICTIONARY_VERSION };
  const errors = validate(submissionSchema, submission);
  if (errors.length) return { ...base, valid: false, errors, scores: { C: 0, O: 0, R: 0, J: 0 }, referrals: [] };
  const answer = submission.answer;
  let delivery;
  try { delivery = deliveredIndex(submission.delivered); } catch (error) { throw new TypeError('Invalid delivery: ' + error.message); }
  try {
    validateGraph(answer.reason, false);
    // Invalid source-claimed time/ranges or empty scopes are malformed answers.
    for (const c of [...answer.current.claims, ...answer.old.records.flatMap(r => r.claims), ...answer.reason.nodes.map(n => n.claim)]) {
      try { claim(c); } catch (e) { if (!(e instanceof UnknownEquivalence)) throw e; }
    }
  } catch (error) { return { ...base, valid: false, errors: [error.message], scores: { C: 0, O: 0, R: 0, J: 0 }, referrals: [] }; }
  const safely = fn => { try { return fn(); } catch (e) { if (e instanceof UnknownEquivalence) return null; throw e; } };
  const C = safely(() => currentCorrect(answer.current, gold.current));
  const O = safely(() => oldCorrect(answer.old, gold.old));
  let causal = safely(() => causalContent(answer.reason, gold.reason));
  if (causal === null) causal = { verdict: null, edges: answer.reason.edges.map(e => ({ submitted: e, matches: [] })) };
  const support = edgeSupport(causal, spans, delivery);
  const R = and([causal.verdict, support.verdict]);
  const scores = { C, O, R, J: and([C, O, R]) };
  const anonymous = anonymize(answer, gold);
  const referrals = [];
  const correctnessComponents = [...(C === null ? ['C'] : []), ...(O === null ? ['O'] : []), ...(causal.verdict === null ? ['R'] : [])];
  if (correctnessComponents.length) {
    const bundle = correctnessBundle(gold.question, anonymous.answer, anonymous.gold);
    referrals.push({ key: digest({ components: correctnessComponents, bundle }), components: correctnessComponents, ...bundle });
  }
  if (support.verdict === null) {
    const bundle = supportBundle(gold.question, anonymous.answer, delivery);
    referrals.push({ key: digest(bundle), components: ['R'], ...bundle });
  }
  return { ...base, valid: true, scores, pendingAdjudication: referrals.length > 0, mechanicallyForcedJZero: scores.J === 0,
    reason: { correctness: causal.verdict, support: support.verdict, edges: support.edges },
    deliveredSupport: citationDiagnostics(answer, delivery), referrals };
}

export { answerSchema };
