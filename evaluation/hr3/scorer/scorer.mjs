import { createHash } from 'node:crypto';
import { answerSchema, goldSchema, submissionSchema, validate } from './schema.mjs';
import { claim, stable, UnknownEquivalence, DICTIONARY_VERSION } from './canonical.mjs';
import { deliveredIndex, resolveCitations, coveredSpans, covers, supportBundle } from './citations.mjs';
import { conjunction as and, currentCorrect, oldCorrect, projectRows } from './slots.mjs';
import { consumeContract } from './contract.mjs';
import { SUPPORT_VERSION, compileTrivia, compileUnlicensedTrivia } from './support.mjs';

export const SEED = 'hr3-scorer-a6-v7';
export const KEY_VERSION = 'hr3-a6-slot-explanation-keys-v7';
const digest = value => createHash('sha256').update(SEED + '\n' + stable(value)).digest('hex');

export function correctnessGold(gold) {
  // This projection is deliberately idempotent; never copy support properties.
  return {
    current: gold.current, old: gold.old,
    reason: { status: gold.reason.status, nodes: gold.reason.nodes,
      acceptedGraphs: gold.reason.acceptedGraphs.map(g => ({ edges: g.edges.map(({ from, to }) => ({ from, to })) })) },
  };
}
export function correctnessBundle(question, answer, gold) {
  return { pass: 'correctness', question, answer, G_correct: correctnessGold(gold),
    rubric: 'Judge complete current slots and exact requested predecessor slots/statuses/scope/source-claimed intervals. Judge selected quoted explanation against accepted causal structure, including intermediates and conjunctions. No source registry, hidden span licenses or delivery verdict is supplied. Do not add values, causal clauses or citations. Unknown correspondence remains unresolved.' };
}
function anonymizedGold(gold) {
  const out = structuredClone(correctnessGold(gold));
  const names = new Map(out.reason.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  out.reason.nodes.forEach(n => { n.id = names.get(n.id); });
  out.reason.acceptedGraphs.forEach(g => g.edges.forEach(e => { e.from = names.get(e.from); e.to = names.get(e.to); }));
  return out;
}
export function validateGold(gold) {
  // Only the published explicit A-6 support version is supported here. Never
  // interpret stripped fields or a legacy/unknown string as a legacy envelope.
  const errors = validate(goldSchema, gold);
  if (errors.length) throw new TypeError('Invalid gold: ' + errors.join('; '));
  const ids = new Set();
  for (const node of gold.reason.nodes) {
    if (ids.has(node.id)) throw new RangeError('Duplicate reason node ID');
    ids.add(node.id);
    claim(node.claim);
  }
  if (gold.reason.status === 'stated' && !gold.reason.acceptedGraphs.length) throw new RangeError('Stated gold requires accepted graphs');
  if (gold.reason.status !== 'stated' && gold.reason.acceptedGraphs.length) throw new RangeError('Non-stated gold must have no causal graphs');
  if (gold.current.status === 'no_active_decision' && gold.current.rows.length) throw new RangeError('No active decision must have no rows');
  projectRows(gold.current.rows);
  gold.old.records.forEach(r => projectRows(r.rows));
  const predecessors = gold.old.records.map(r => r.predecessor_turn);
  if (new Set(predecessors).size !== predecessors.length) throw new RangeError('Duplicate requested predecessor');
  const spans = new Map();
  for (const span of gold.supportSpans) {
    if (spans.has(span.id) || span.start >= span.end || span.text.length !== span.end - span.start) throw new RangeError('Invalid/duplicate support span');
    spans.set(span.id, span);
  }
  for (const graph of gold.reason.acceptedGraphs) for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new RangeError('Dangling causal endpoint in gold');
    for (const alternative of edge.support) for (const id of alternative) if (!spans.has(id)) throw new RangeError('Unknown support span ID');
  }
  return spans;
}

const selectedPointsLicensed = (resolved, licenses) => resolved.every(r => r.unit.map.slice(r.start, r.end).every(point => (point.parts ?? [point]).every(part => licenses.some(s =>
  s.origin === part.origin && part.start >= s.start && part.end <= s.end && s.text.slice(part.start - s.start, part.end - s.start) === part.rawText))));
const contextLicensed = (delivery, licenses) => delivery.units.every(unit => selectedPointsLicensed([{ unit, start: 0, end: unit.map.length }], licenses));
function reasonScore(reason, gold, spans, delivery, optionalTrivia) {
  if (reason.status !== gold.status) return { correctness: 0, support: 'not_applicable', verdict: 0, valid: true, error: 'reason_status_mismatch' };
  if (reason.status !== 'stated') {
    const empty = reason.support.length === 0;
    return { correctness: empty ? 1 : 0, support: 'not_applicable', verdict: empty ? 1 : 0, valid: empty,
      error: empty ? null : 'non_stated_reason_has_selected_support' };
  }
  const selected = resolveCitations(reason.support, delivery);
  if (!selected.length || selected.some(c => !c.ok && !c.ambiguous)) return {
    correctness: null, support: 0, verdict: 0, valid: false, error: 'missing_or_invalid_submitted_citation',
  };
  if (selected.some(c => c.ambiguous)) return { correctness: null, support: null, verdict: null, valid: true, error: 'ambiguous_overlapping_occurrence' };
  const ranges = coveredSpans(selected);
  const acceptedIds = new Set(gold.acceptedGraphs.flatMap(g => g.edges.flatMap(e => e.support.flat())));
  const licenses = [...acceptedIds].map(id => spans.get(id));
  const onlyAccepted = selectedPointsLicensed(selected, licenses);
  const graphs = gold.acceptedGraphs.map(g => ({ edges: g.edges.map(e => ({
    from: e.from, to: e.to,
    covered: e.support.some(conjunction => conjunction.every(id => covers(spans.get(id), ranges, optionalTrivia))),
  })) }));
  const complete = graphs.some(g => g.edges.every(e => e.covered));
  // Partial known support cannot supply omitted mediators/conjunctions. An
  // unfamiliar clause might be equivalent, so never turn it into a false zero.
  if (!complete && onlyAccepted) return { correctness: 0, support: 0, verdict: 0, valid: true, graphs, error: 'incomplete_required_support' };
  // Extra fragmentary clauses do not become accepted explanations merely by
  // sharing a source address with an accepted branch.
  const fullyCovered = licenses.filter(s => covers(s, ranges, optionalTrivia));
  const completeSelections = selectedPointsLicensed(selected, fullyCovered);
  const correctness = complete && onlyAccepted && completeSelections ? 1 : null;
  const support = correctness === 1 && contextLicensed(delivery, licenses) ? 1 : null;
  return { correctness, support, verdict: and([correctness, support]), valid: true, graphs,
    error: correctness !== 1 ? 'unrecognized_or_broad_causal_selection' : support !== 1 ? 'unrecognized_evidence_context' : null };
}
function citationDiagnostics(answer, delivery) {
  const report = rows => rows.map(row => {
    const citations = resolveCitations(row.citations, delivery);
    return { cited: citations.length > 0, resolved: citations.length > 0 && citations.every(c => c.ok), errors: citations.filter(c => !c.ok).map(c => c.error) };
  });
  return { current: report(answer.current.rows), old: answer.old.records.map(r => report(r.rows)),
    note: 'Citation resolution is separate from factual C/O and is not a semantic support verdict.' };
}
export function score(gold, submission, options = {}) {
  const spans = validateGold(gold);
  const ambiguousBinding = Object.hasOwn(options, 'triviaCase') && Object.hasOwn(options, 'unlicensedCase');
  const optionalTrivia = Object.hasOwn(options, 'unlicensedCase') ? compileUnlicensedTrivia(gold, options.unlicensedCase) :
    compileTrivia(gold.supportTrivia, spans, options.triviaCase, gold.question);
  // Binding failures are authoring/configuration errors, before reader-response
  // validation. Never silently turn an unauthenticated license into an R zero.
  // Every valid gold is explicitly A-6. Empty candidate metadata cannot select
  // unlicensed mode; only a separately pinned exact-target capability can.
  if (ambiguousBinding || !['authenticated', 'authenticated_unlicensed'].includes(optionalTrivia.authentication.status)) {
    const error = new TypeError('Trivia case binding required: ' + (ambiguousBinding ? 'conflicting_trusted_bindings' : optionalTrivia.authentication.reason));
    error.code = 'ERR_HR3_TRIVIA_BINDING';
    throw error;
  }
  const contract = consumeContract(options.contractPath);
  const contractReport = { status: contract.status, ...(contract.status === 'validated' ? { version: contract.version, sha256: contract.sha256 } : {}) };
  const reasonStratum = { stratum: gold.reason.status, denominator: 1, noEvidenceBaseline: { status: 'not_stated', support: [], R: gold.reason.status === 'not_stated' ? 1 : 0 } };
  const base = { reasonStratum, version: SEED, protocol: 'v0.3.4+A-6', supportVersion: SUPPORT_VERSION, supportAuthentication: optionalTrivia.authentication, seed: SEED, dictionary: DICTIONARY_VERSION, keyVersion: KEY_VERSION, contract: contractReport };
  const errors = validate(submissionSchema, submission);
  if (errors.length) return { ...base, valid: false, componentValidity: { C: false, O: false, R: false }, errors, scores: { C: 0, O: 0, R: 0, J: 0 }, referrals: [] };
  const answer = submission.answer;
  // Preserve the existing factual shape rules for impossible scopes/intervals;
  // unknown textual representations stay referrals, never malformed answers.
  try { projectRows([...answer.current.rows, ...answer.old.records.flatMap(r => r.rows)], contract); }
  catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { ...base, valid: false, componentValidity: { C: false, O: false, R: false }, errors: [error.message], scores: { C: 0, O: 0, R: 0, J: 0 }, referrals: [] };
  }
  let delivery;
  try { delivery = deliveredIndex(submission.delivered); } catch (error) { throw new TypeError('Invalid delivery: ' + error.message); }
  const validity = { C: true, O: true, R: true }, componentErrors = {};
  const evaluate = (component, fn) => {
    try { return fn(); } catch (error) {
      if (error instanceof UnknownEquivalence) return null;
      if (!(error instanceof RangeError)) throw error;
      validity[component] = false; componentErrors[component] = error.message; return 0;
    }
  };
  const C = evaluate('C', () => currentCorrect(answer.current, gold.current, contract));
  const O = evaluate('O', () => oldCorrect(answer.old, gold.old, contract));
  const reason = reasonScore(answer.reason, gold.reason, spans, delivery, optionalTrivia);
  validity.R = reason.valid;
  const R = reason.verdict;
  const scores = { C, O, R, J: and([C, O, R]) };
  const referrals = [];
  const correctnessComponents = [...(C === null ? ['C'] : []), ...(O === null ? ['O'] : []), ...(R === null && reason.correctness === null ? ['R'] : [])];
  const provenance = { version: KEY_VERSION, supportVersion: SUPPORT_VERSION, authentication: optionalTrivia.authentication, contract: contractReport, dictionary: DICTIONARY_VERSION };
  // Separate component keys allow the judgment-error adapter to propagate C/O/R
  // consistently without making a sibling component's referral change identity.
  for (const component of correctnessComponents) {
    const bundle = correctnessBundle(gold.question, structuredClone(answer), anonymizedGold(gold));
    referrals.push({ key: digest({ provenance, component, bundle }), parentRule: `${component === 'R' ? 'a6' : 'a4'}.correctness.${component}`, components: [component], ...bundle });
  }
  if (R === null && reason.support === null) {
    const bundle = supportBundle(gold.question, structuredClone(answer), delivery);
    referrals.push({ key: digest({ provenance, supportRegistry: { spans: gold.supportSpans, trivia: gold.supportTrivia, graphs: gold.reason.acceptedGraphs }, component: 'R', bundle }), parentRule: 'a6.support.quoted_explanation', components: ['R'], ...bundle });
  }
  return { ...base, valid: true, componentValidity: validity, componentErrors, scores,
    pendingAdjudication: referrals.length > 0, mechanicallyForcedJZero: scores.J === 0,
    reason: { ...reason, ...reasonStratum },
    deliveredSupport: citationDiagnostics(answer, delivery), referrals };
}
export { answerSchema };
