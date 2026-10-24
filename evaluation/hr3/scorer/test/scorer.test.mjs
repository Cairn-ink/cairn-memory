import test from 'node:test';
import assert from 'node:assert/strict';
import { score, correctnessGold, validateGold } from '../scorer.mjs';
import { claim, cited, citation, copy, fixture, quantity, scoped, text } from './fixtures.mjs';

const run = f => score(f.gold, f.submission);
const all = { C: 1, O: 1, R: 1, J: 1 };
test('exact C/O/R and family-level J; deterministic seed and output', () => {
  const f = fixture();
  assert.deepEqual(run(f).scores, all);
  assert.deepEqual(run(f), run(f));
  assert.equal(run(f).seed, 'hr3-scorer-v1');
});
test('C ignores delivered support; missing citation only defeats R', () => {
  const f = fixture();
  f.submission.delivered = [];
  f.submission.answer.current.claims[0].citations = [citation()];
  assert.deepEqual(run(f).scores, { ...all, R: 0, J: 0 });
  assert.equal(run(f).deliveredSupport.current[0].resolved, false);
});
test('current exact value, qualifiers, scope, temporal applicability and status', () => {
  const changes = [
    a => { a.current.claims[0].value.value = false; },
    a => { a.current.claims[0].qualifiers.push({ key: 'mode', value: text('free') }); },
    a => { a.current.claims[0].scope = scoped(); },
    a => { a.current.claims[0].valid.to = '2026-11-01'; },
    a => { a.current.status = 'unresolved'; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.submission.answer);
    assert.equal(run(f).scores.C, 0);
    assert.equal(run(f).scores.J, 0);
    assert.equal(run(f).scores.O, 1);
  }
});
test('expiry has no active successor; no inferred fallback', () => {
  const f = fixture();
  f.gold.current = { status: 'no_active_decision', claims: [] };
  f.gold.old.records[0].status = 'expired';
  f.submission.answer.current = copy(f.gold.current);
  f.submission.answer.old.records[0].status = 'expired';
  assert.deepEqual(run(f).scores, all);
  f.submission.answer.current = { status: 'active', claims: [cited(f.gold.old.records[0].claims[0])] };
  assert.equal(run(f).scores.C, 0);
});
test('unresolved current, none/unavailable history and unavailable reason statuses', () => {
  for (const status of ['none', 'unavailable']) {
    const f = fixture();
    f.gold.current = { status: 'unresolved', claims: [] };
    f.gold.old = { status, records: [] };
    f.gold.reason = { status: 'unavailable', nodes: [], acceptedGraphs: [] };
    f.submission.answer = { current: copy(f.gold.current), old: copy(f.gold.old), reason: { status: 'unavailable', nodes: [], edges: [] } };
    assert.deepEqual(run(f).scores, all);
  }
});
test('exact requested predecessor set and historical labels', () => {
  for (const status of ['previously_adopted', 'erroneous', 'expired']) {
    const f = fixture();
    f.gold.old.records[0].status = status;
    f.submission.answer.old.records[0].status = status;
    assert.equal(run(f).scores.O, 1);
    f.submission.answer.old.records[0].status = status === 'erroneous' ? 'previously_adopted' : 'erroneous';
    assert.equal(run(f).scores.O, 0);
  }
  const f = fixture();
  f.gold.old.records.push({ status: 'erroneous', claims: [claim(quantity('8'))] });
  assert.equal(run(f).scores.O, 0);
  f.submission.answer.old.records.push({ status: 'erroneous', claims: [cited(claim(quantity('8')))] });
  f.submission.answer.old.records.reverse();
  assert.equal(run(f).scores.O, 1);
  f.submission.answer.old.records.push({ status: 'expired', claims: [cited(claim(quantity('9')))] });
  assert.equal(run(f).scores.O, 0);
});
test('dropping predecessor qualifications is an O error', () => {
  const f = fixture();
  f.gold.old.records[0].claims[0].qualifiers = [{ key: 'commitment', value: text('pro') }];
  assert.equal(run(f).scores.O, 0);
});
test('equivalent duplicates collapse across current, history, qualifiers and edges', () => {
  const f = fixture();
  f.submission.answer.current.claims.push(copy(f.submission.answer.current.claims[0]));
  f.submission.answer.old.records.push(copy(f.submission.answer.old.records[0]));
  f.submission.answer.reason.edges.push(copy(f.submission.answer.reason.edges[0]));
  assert.deepEqual(run(f).scores, all);
  f.submission.answer.current.claims.push(cited(claim({ type: 'Boolean', value: false })));
  assert.equal(run(f).scores.C, 0);
});
test('false-negative traps: bilingual value/alias, scope DNF and equivalent dates', () => {
  const f = fixture();
  f.gold.current.claims[0].value = text('TW');
  f.gold.current.claims[0].scope = scoped();
  f.gold.current.claims[0].valid = { from: '2026-10-24T16:00:00Z', to: '2026-10-26T16:00:00Z' };
  const c = f.submission.answer.current.claims[0];
  c.value = text('臺灣');
  c.scope = { any: ['free', '專業'].map(plan => ({ all: [{ field: 'country', values: ['Taiwan'] }, { field: 'plan', values: [plan] }] })) };
  c.valid = { from: '2026-10-25', to: '2026-10-27T00:00:00+08:00' };
  assert.equal(run(f).scores.C, 1);
});
test('equivalent partitioned claims are equal, but overlapping contradictions fail', () => {
  const f = fixture();
  const c = f.submission.answer.current.claims[0];
  f.submission.answer.current.claims = ['TW', 'JP', 'US'].map(country => ({ ...copy(c), scope: scoped(country) }));
  assert.equal(run(f).scores.C, 1);
  f.submission.answer.current.claims.push({ ...copy(c), scope: scoped('TW'), value: { type: 'Boolean', value: false } });
  assert.equal(run(f).scores.C, 0);
});
test('unknown text/scope/date/unit equivalences refer, never adjudicate', () => {
  const changes = [
    [g => { g.value = text('monthly'); }, a => { a.value = text('per month'); }],
    [() => {}, a => { a.scope = scoped('Formosa'); }],
    [() => {}, a => { a.valid.from = 'October 25, 2026'; }],
    [g => { g.value = quantity('1', 'dozen'); }, a => { a.value = quantity('12', 'count'); }],
  ];
  for (const [changeGold, changeAnswer] of changes) {
    const f = fixture(); changeGold(f.gold.current.claims[0]); changeAnswer(f.submission.answer.current.claims[0]);
    const out = run(f);
    assert.equal(out.scores.C, null);
    assert.equal(out.scores.J, null);
    assert.equal(out.pendingAdjudication, true);
    assert(out.referrals.some(r => r.pass === 'correctness' && r.components.includes('C')));
  }
});
test('unrecognized predecessor paraphrases and scope wording are referred', () => {
  const f = fixture();
  f.gold.old.records[0].claims[0].value = text('monthly');
  f.submission.answer.old.records[0].claims[0].value = text('per month');
  f.submission.answer.current.claims[0].scope = scoped('Taiwan customers');
  const out = run(f);
  assert.equal(out.scores.C, null);
  assert.equal(out.scores.O, null);
  assert.deepEqual(out.referrals.find(r => r.pass === 'correctness').components, ['C', 'O']);
});
test('normalized cited evidence and a delivered alias support the same graph', () => {
  const f = fixture(), raw = '  Ａ　caused  Ｂ.  ';
  Object.assign(f.gold.supportSpans[0], { text: raw, end: raw.length });
  f.submission.delivered[0].segments[0].text = raw;
  const alias = { intent: 'history', item: 8, unit: 'body', source: null };
  f.submission.delivered[0].aliases.push(alias);
  Object.assign(f.submission.answer.reason.edges[0].citations[0], alias);
  assert.equal(run(f).scores.R, 1);
});
test('elided delivery can support separate required spans without filling a gap', () => {
  const f = fixture();
  f.gold.reason.acceptedGraphs[0].edges[0].support = [['ab', 'ac']];
  Object.assign(f.gold.supportSpans[2], { origin: 'turn-1', start: 20, end: 31, text: 'A led to B.' });
  f.submission.delivered.splice(2, 1);
  f.submission.delivered[0].segments.push({ origin: 'turn-1', start: 20, text: 'A led to B.' });
  f.submission.answer.reason.edges[0].citations = [citation(0, 'A caused B.A led to B.')];
  assert.equal(run(f).scores.R, 1);
});
test('overlapping-occurrence ambiguity produces a support referral', () => {
  const f = fixture();
  f.submission.delivered[0].segments[0].text = 'aaaa';
  f.submission.answer.reason.edges[0].citations = [citation(0, 'aa', { occurrence: 2 })];
  const result = run(f);
  assert.equal(result.reason.support, null);
  assert(result.referrals.some(r => r.pass === 'support'));
});
test('three-edge serial AND cannot omit any intermediate edge', () => {
  const f = fixture();
  f.gold.reason.nodes.push({ id: 'D', claim: claim(quantity('4')) });
  f.submission.answer.reason.nodes.push({ id: 'D', claim: cited(claim(quantity('4'))) });
  f.gold.reason.acceptedGraphs[0].edges.push({ from: 'D', to: 'A', support: [['dc']] });
  f.gold.supportSpans[3].text = 'D caused A.';
  f.submission.delivered[3].segments[0].text = 'D caused A.';
  f.submission.answer.reason.edges.push({ from: 'D', to: 'A', citations: [citation(3, 'D caused A.')] });
  assert.equal(run(f).scores.R, 1);
  f.submission.answer.reason.edges.splice(1, 1);
  assert.equal(run(f).scores.R, 0);
});
test('OR alternatives and supported unions are accepted', () => {
  const f = fixture();
  f.gold.reason.acceptedGraphs.push({ edges: [{ from: 'A', to: 'C', support: [['ac']] }] });
  f.submission.answer.reason.edges.push({ from: 'A', to: 'C', citations: [citation(2, 'A caused C.')] });
  assert.equal(run(f).scores.R, 1);
  f.submission.answer.reason.edges = f.submission.answer.reason.edges.slice(2);
  f.submission.answer.reason.nodes = f.submission.answer.reason.nodes.filter(n => n.id !== 'B');
  assert.equal(run(f).scores.R, 1);
});
test('transitive shortcuts require explicit acceptance', () => {
  const f = fixture();
  f.submission.answer.reason.edges = [{ from: 'A', to: 'C', citations: [citation(2, 'A caused C.')] }];
  assert.equal(run(f).scores.R, 0);
  f.gold.reason.acceptedGraphs.push({ edges: [{ from: 'A', to: 'C', support: [['ac']] }] });
  assert.equal(run(f).scores.R, 1);
});
test('a causal direction error and an extra submitted edge fail full credit', () => {
  const f = fixture();
  f.submission.answer.reason.edges[0].from = 'B';
  f.submission.answer.reason.edges[0].to = 'A';
  assert.equal(run(f).scores.R, 0);
  const g = fixture();
  g.submission.answer.reason.edges.push({ from: 'A', to: 'C', citations: [] });
  assert.equal(run(g).scores.R, 0);
});
test('endpoint mentions and node citations cannot supply missing causal edges', () => {
  const f = fixture();
  f.submission.answer.reason.nodes[0].claim.citations = [citation()];
  f.submission.answer.reason.edges = [];
  assert.equal(run(f).scores.R, 0);
  const g = fixture();
  g.submission.answer.reason.nodes[0].claim.citations = [citation()];
  g.submission.answer.reason.edges[0].citations = [];
  assert.equal(run(g).scores.R, 0);
  // Even when the whole causal sentence is delivered, citing just its endpoint
  // does not license the uncited causal words in that same unit.
  g.submission.answer.reason.edges[0].citations = [citation(0, 'A')];
  assert.equal(run(g).scores.R, 0);
});
test('conjunctive mediated graph requires both branches', () => {
  const f = fixture();
  f.gold.reason.nodes.push({ id: 'D', claim: claim(quantity('4')) });
  f.submission.answer.reason.nodes.push({ id: 'D', claim: cited(claim(quantity('4'))) });
  f.gold.reason.acceptedGraphs[0].edges.push({ from: 'D', to: 'B', support: [['dc']] });
  f.gold.supportSpans[3].text = 'D caused B.';
  f.submission.delivered[3].segments[0].text = 'D caused B.';
  f.submission.answer.reason.edges.push({ from: 'D', to: 'B', citations: [citation(3, 'D caused B.')] });
  assert.equal(run(f).scores.R, 1);
  f.submission.answer.reason.edges.pop();
  assert.equal(run(f).scores.R, 0);
});
test('OR-of-AND edge support; split duplicate citations form a supported union', () => {
  const f = fixture();
  for (const [index, phrase] of [[2, 'A led to B.'], [3, 'A drove B. ']]) {
    f.gold.supportSpans[index].text = phrase;
    f.submission.delivered[index].segments[0].text = phrase;
  }
  f.gold.reason.acceptedGraphs[0].edges[0].support = [['ab', 'ac'], ['dc']];
  assert.equal(run(f).scores.R, 0);
  f.submission.answer.reason.edges.push({ from: 'A', to: 'B', citations: [citation(2, 'A led to B.')] });
  assert.equal(run(f).scores.R, 1);
  f.submission.answer.reason.edges = f.submission.answer.reason.edges.slice(0, 2);
  // The alternate span excludes trailing normalization whitespace.
  f.gold.supportSpans[3].text = 'A drove B.';
  f.gold.supportSpans[3].end = 10;
  f.submission.answer.reason.edges[0].citations = [citation(3, 'A drove B.')];
  assert.equal(run(f).scores.R, 1);
});
test('not_stated requires no causal edges; claiming it for a stated reason fails', () => {
  const f = fixture();
  f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
  f.submission.answer.reason = { status: 'not_stated', nodes: [], edges: [] };
  assert.equal(run(f).scores.R, 1);
  const g = fixture(); g.submission.answer.reason = copy(f.submission.answer.reason);
  assert.equal(run(g).scores.R, 0);
  f.submission.answer.reason.nodes = fixture().submission.answer.reason.nodes;
  f.submission.answer.reason.edges = fixture().submission.answer.reason.edges;
  assert.deepEqual(run(f).scores, { C: 0, O: 0, R: 0, J: 0 });
});
test('truncated, removed and source-substituted support cannot receive R credit', () => {
  const f = fixture();
  f.submission.delivered[0].truncate = 5;
  assert.equal(run(f).scores.R, 0);
  f.submission.answer.reason.edges[0].citations[0].quote = 'A cau';
  assert.equal(run(f).scores.R, 0);
  const g = fixture(); g.submission.delivered[0].segments[0].text = 'B caused A.';
  g.submission.answer.reason.edges[0].citations[0].quote = 'B caused A.';
  assert.equal(run(g).scores.R, 0);
});
test('uncited delivered support never rescues an endpoint-only citation', () => {
  const f = fixture();
  f.submission.delivered.push({ ...copy(f.submission.delivered[0]), item: 9, segments: [{ origin: 'endpoint-turn', start: 0, text: 'A and B' }] });
  f.submission.answer.reason.edges[0].citations = [citation(9, 'A and B')];
  const result = run(f);
  assert.equal(result.scores.R, null);
  assert.equal(result.reason.support, null);
  assert(result.referrals.some(r => r.pass === 'support'));
});
test('a negation outside a licensed quotation triggers gold-blind support referral', () => {
  const f = fixture();
  f.submission.delivered[0].segments.unshift({ origin: 'context-turn', start: 0, text: 'The following statement is false: ' });
  const result = run(f);
  assert.equal(result.scores.R, null);
  assert.equal(result.reason.edges[0].error, 'unrecognized_evidence_context');
  const bundle = result.referrals.find(r => r.pass === 'support');
  assert(bundle.delivered[0].text.includes('false'));
  assert(!('G_correct' in bundle));
});
test('causal endpoint paraphrases refer both undecided passes without dropping citations', () => {
  const f = fixture();
  f.gold.reason.nodes[0].claim.value = text('monthly');
  f.submission.answer.reason.nodes[0].claim.value = text('per month');
  const result = run(f);
  assert.equal(result.scores.R, null);
  assert(result.referrals.some(r => r.pass === 'correctness' && r.components.includes('R')));
  assert(result.referrals.some(r => r.pass === 'support'));
});
test('correctness and support referral bundles enforce the gold boundary', () => {
  const f = fixture();
  f.gold.current.claims[0].value = text('monthly');
  f.submission.answer.current.claims[0].value = text('per month');
  f.submission.delivered.push({ ...copy(f.submission.delivered[0]), item: 9, segments: [{ origin: 'private-raw-name', start: 0, text: 'unknown reason phrasing' }] });
  f.submission.answer.reason.edges[0].citations = [citation(9, 'unknown reason phrasing')];
  const { referrals } = run(f), correctness = referrals.find(r => r.pass === 'correctness'), support = referrals.find(r => r.pass === 'support');
  assert(correctness && support);
  assert(!('delivered' in correctness));
  assert(!('G_correct' in support));
  assert(!('supportSpans' in correctness.G_correct));
  assert(!JSON.stringify(correctness.G_correct).includes('caused'));
  assert(!JSON.stringify(support).includes('private-raw-name'));
  assert(!JSON.stringify(support).includes('acceptedGraphs'));
  assert(!('scores' in support));
  assert.equal(correctness.answer.reason.nodes[0].id, 'n1');
  assert.equal(correctness.key.length, 64);
  assert.deepEqual(Object.keys(correctnessGold(f.gold)).sort(), ['current', 'old', 'reason']);
});
test('forced J zero remains separate from unresolved component judgments', () => {
  const f = fixture();
  f.gold.current.claims[0].value = text('monthly');
  f.submission.answer.current.claims[0].value = text('per month');
  f.submission.answer.old.records = [];
  const out = run(f);
  assert.deepEqual(out.scores, { C: null, O: 0, R: 1, J: 0 });
  assert.equal(out.mechanicallyForcedJZero, true);
  assert(out.referrals.length > 0);
});
test('malformed/exhausted reader outputs score all zero', () => {
  const f = fixture();
  for (const answer of [null, {}, { ...f.submission.answer, unexpected: true }]) {
    const out = score(f.gold, { answer, delivered: [] });
    assert.equal(out.valid, false);
    assert.deepEqual(out.scores, { C: 0, O: 0, R: 0, J: 0 });
  }
  delete f.submission.answer.current.claims[0].valid;
  assert.equal(run(f).valid, false);
});
test('invalid source dates/empty scopes/dangling node IDs are malformed', () => {
  const changes = [
    a => { a.current.claims[0].valid.from = '2026-02-30'; },
    a => { a.current.claims[0].scope = { any: [{ all: [{ field: 'country', values: ['TW'] }, { field: 'country', values: ['JP'] }] }] }; },
    a => { a.reason.edges[0].to = 'missing'; },
    a => { a.reason.nodes.push(copy(a.reason.nodes[0])); },
  ];
  for (const change of changes) { const f = fixture(); change(f.submission.answer); assert.equal(run(f).valid, false); }
});
test('invalid gold and ambiguous delivery are authoring errors, not scored losses', () => {
  const f = fixture(); f.gold.leaked = 'text';
  assert.throws(() => validateGold(f.gold), /Invalid gold/);
  const g = fixture(); g.gold.supportSpans[0].end++;
  assert.throws(() => run(g), /support span/);
  const h = fixture(); h.submission.delivered.push(copy(h.submission.delivered[0]));
  assert.throws(() => run(h), /Invalid delivery/);
});
