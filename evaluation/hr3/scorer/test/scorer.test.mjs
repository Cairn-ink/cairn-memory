import test from 'node:test';
import assert from 'node:assert/strict';
import { correctnessGold, validateGold, SEED } from '../scorer.mjs';
import { citation, cited, copy, fixture, row, scoped, slot } from './fixtures.mjs';
import { scoreUnlicensed } from './unlicensed-fixtures.mjs';
const run = f => scoreUnlicensed(f.gold, f.submission);
const all = { C: 1, O: 1, R: 1, J: 1 };

test('closed slot answers select a complete serial path, deterministic per-family J', () => {
  const f = fixture();
  assert.deepEqual(run(f).scores, all);
  assert.deepEqual(run(f), run(f));
  assert.equal(run(f).seed, SEED);
  assert(!('nodes' in f.submission.answer.reason));
});
test('exact C slot values, status, scope and source-claimed time', () => {
  for (const edit of [a => a.current.rows[0].approval.value = false,
    a => a.current.rows[0].route.value = 'oak', a => a.current.rows[0].cap.value.decimal = '21',
    a => a.current.rows[0].scope = scoped(), a => a.current.rows[0].valid.to = '2027-01-01',
    a => a.current.status = 'unresolved', a => a.current.rows = []]) {
    const f = fixture(); edit(f.submission.answer);
    assert.deepEqual(run(f).scores, { ...all, C: 0, J: 0 });
  }
});
test('not_specified is a factual assertion; unavailable/unresolved do not fill known gold slots', () => {
  for (const state of ['not_specified', 'unavailable', 'unresolved']) {
    const f = fixture(); f.submission.answer.current.rows[0].approval = slot(null, state);
    assert.equal(run(f).scores.C, 0);
  }
  const f = fixture();
  f.gold.current.rows[0].approval = slot(null);
  f.submission.answer.current.rows[0].approval = slot(null);
  assert.equal(run(f).scores.C, 1);
  f.submission.answer.current.rows[0].approval = slot(null, 'unavailable');
  assert.equal(run(f).scores.C, 0);
});
test('scope partitions, aliases, duplicates and interval normalization preserve all three slots', () => {
  const f = fixture(), original = f.submission.answer.current.rows[0];
  f.submission.answer.current.rows = ['Taiwan', 'Japan', '美國'].map(c => ({ ...copy(original), scope: scoped(c) }));
  f.submission.answer.current.rows.push(copy(f.submission.answer.current.rows[0]));
  assert.equal(run(f).scores.C, 1);
  f.gold.current.rows[0].valid.from = '2026-10-25';
  f.submission.answer.current.rows.forEach(r => { r.valid.from = '2026-10-24T16:00:00Z'; r.cap.value.decimal = '20.000'; });
  assert.equal(run(f).scores.C, 1);
  f.submission.answer.current.rows.push({ ...copy(original), route: slot('contradiction') });
  assert.equal(run(f).scores.C, 0);
});
test('expiry keeps last-known values only in the requested expired historical record', () => {
  const f = fixture();
  f.gold.current = { status: 'no_active_decision', rows: [] };
  f.gold.old.records[0].status = 'expired';
  f.submission.answer.current = copy(f.gold.current);
  f.submission.answer.old.records[0].status = 'expired';
  assert.deepEqual(run(f).scores, all);
  f.submission.answer.current.rows = [cited(row())];
  assert.equal(run(f).scores.C, 0);
});
test('exact requested predecessor turns, historical labels, sets and rows', () => {
  for (const status of ['previously_adopted', 'erroneous', 'expired', 'unavailable', 'unresolved']) {
    const f = fixture();
    f.gold.old.records[0].status = status; f.submission.answer.old.records[0].status = status;
    assert.equal(run(f).scores.O, 1);
    f.submission.answer.old.records[0].predecessor_turn = 'another-public-turn';
    assert.equal(run(f).scores.O, 0);
  }
  for (const edit of [a => a.old.records = [], a => a.old.status = 'none', a => a.old.records[0].rows[0].route.value = 'cedar',
    a => a.old.records.push({ ...copy(a.old.records[0]), predecessor_turn: 'extra-turn' }), a => a.old.records[0].status = 'erroneous']) {
    const f = fixture(); edit(f.submission.answer); assert.equal(run(f).scores.O, 0);
  }
});
test('all missing, dangling, wrong unit/source and wrong occurrence R citations preserve factual C/O', () => {
  for (const edit of [s => s.answer.reason.support = [], s => s.delivered = [],
    s => s.answer.reason.support[0].item = 99,
    s => s.answer.reason.support[0].unit = 'body',
    s => s.answer.reason.support[0].source = null,
    s => s.answer.reason.support[0].source = 1,
    s => s.answer.reason.support[0].occurrence = 2,
    s => s.answer.reason.support[0].quote = 'uncited source text']) {
    const f = fixture(); edit(f.submission); const out = run(f);
    assert.equal(out.valid, true); assert.equal(out.componentValidity.R, false);
    assert.deepEqual(out.scores, { ...all, R: 0, J: 0 });
  }
});
test('C/O citations remain diagnostics even when invalid', () => {
  const f = fixture(); f.submission.answer.current.rows[0].citations = [citation(99)];
  f.submission.answer.old.records[0].rows[0].citations = [citation(0, 'A caused B.', { unit: 'body', source: 0 })];
  assert.deepEqual(run(f).scores, all);
  assert.equal(run(f).deliveredSupport.current[0].resolved, false);
  assert.deepEqual(run(f).deliveredSupport.old[0][0].errors, ['invalid_unit_source']);
});
test('serial intermediates cannot be skipped; endpoints or an unfamiliar shortcut refer', () => {
  const f = fixture(); f.submission.answer.reason.support.pop();
  assert.equal(run(f).scores.R, 0);
  f.submission.answer.reason.support = [citation(0, 'A')];
  assert.equal(run(f).scores.R, 0);
  f.submission.delivered[0].segments[0].text = 'A caused C.';
  f.submission.answer.reason.support = [citation(0, 'A caused C.')];
  assert.equal(run(f).scores.R, null);
});
function addSpan(f, id, text, edges) {
  const span = { id, origin: `eng-${id}`, start: 0, end: text.length, text };
  f.gold.supportSpans.push(span);
  const item = f.submission.delivered.length;
  f.submission.delivered.push({ intent: 'current', item, unit: 'receipt', source: 0, aliases: [], segments: [{ origin: span.origin, start: 0, text }], normalize: true, truncate: null });
  if (edges) f.gold.reason.acceptedGraphs.push({ edges });
  return citation(item, text);
}
test('OR graphs, edge OR-of-AND support, complete conjunction and supported unions', () => {
  const f = fixture();
  const additional = addSpan(f, 'extra', 'A plus D caused B.');
  f.gold.reason.acceptedGraphs[0].edges[0].support = [['ab', 'extra']];
  assert.equal(run(f).scores.R, 0);
  f.submission.answer.reason.support.push(additional);
  assert.equal(run(f).scores.R, 1);
  const alternative = addSpan(f, 'direct', 'A independently caused C.', [{ from: 'A', to: 'C', support: [['direct']] }]);
  f.submission.answer.reason.support = [alternative];
  assert.equal(run(f).scores.R, 1);
  f.submission.answer.reason.support.push(citation(), citation(1, 'B caused C.'), additional);
  assert.equal(run(f).scores.R, 1);
  f.gold.reason.acceptedGraphs[0].edges[0].support.push(['ab']);
  f.submission.answer.reason.support = [citation(), citation(1, 'B caused C.')];
  assert.equal(run(f).scores.R, 1);
});
test('partial paths from separate alternatives cannot be spliced into a complete explanation', () => {
  const f = fixture();
  f.gold.reason.nodes.push({ id: 'D', claim: copy(f.gold.reason.nodes[0].claim) });
  const ad = addSpan(f, 'ad', 'A caused D.');
  addSpan(f, 'dc', 'D caused C.', [{ from: 'A', to: 'D', support: [['ad']] }, { from: 'D', to: 'C', support: [['dc']] }]);
  f.submission.answer.reason.support = [citation(), ad];
  assert.equal(run(f).scores.R, 0);
});
test('over-citation, wrong-change, negated and speculative extra material never auto-passes', () => {
  for (const extra of [' Z was unrelated.', ' A did not cause B.', ' Maybe X caused C.', ' X caused another change.']) {
    const f = fixture();
    f.submission.delivered[0].segments[0].text += extra;
    f.submission.answer.reason.support[0].quote += extra;
    const result = run(f);
    assert.equal(result.scores.R, null);
    assert(result.referrals.some(r => r.pass === 'correctness' && r.components.includes('R')));
    assert(result.referrals.some(r => r.pass === 'support'));
  }
});
test('a correct selected path in unfamiliar delivered context requires a gold-blind support referral', () => {
  const f = fixture(); f.submission.delivered[0].segments[0].text += ' However this is speculative.';
  const result = run(f);
  assert.equal(result.reason.correctness, 1); assert.equal(result.scores.R, null);
  assert.deepEqual(result.referrals.map(r => r.pass), ['support']);
});
test('bare deadline cannot supply an explicit causal expiry clause', () => {
  const f = fixture();
  f.gold.supportSpans[0].text = 'A caused B.';
  f.submission.delivered[0].segments[0].text = 'Until noon.';
  f.submission.answer.reason.support = [citation(0, 'Until noon.')];
  assert.notEqual(run(f).scores.R, 1);
});
test('empty delivery: factual not_stated passes, stated explanation fails; negative support is N/A', () => {
  const f = fixture(); f.submission.delivered = [];
  assert.equal(run(f).scores.R, 0);
  f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
  f.submission.answer.reason = { status: 'not_stated', support: [] };
  const result = run(f);
  assert.deepEqual(result.scores, all);
  assert.equal(result.reason.support, 'not_applicable');
  assert.equal(result.reason.stratum, 'not_stated'); assert.equal(result.reason.denominator, 1);
  assert.equal(result.reason.noEvidenceBaseline.R, 1);
  f.submission.answer.reason.status = 'unavailable';
  assert.equal(run(f).scores.R, 0);
});
test('negative R forbids selected support, including explicit no-reason witnesses', () => {
  const f = fixture(); f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
  f.submission.answer.reason.status = 'not_stated';
  assert.deepEqual(run(f).scores, { ...all, R: 0, J: 0 });
  assert.equal(run(f).componentValidity.R, false);
});
test('unavailable is a factual status, never an automatic substitute for not_stated', () => {
  const f = fixture(); f.gold.reason = { status: 'unavailable', nodes: [], acceptedGraphs: [] };
  f.submission.answer.reason = { status: 'unavailable', support: [] };
  assert.equal(run(f).scores.R, 1);
  assert.equal(run(f).reason.noEvidenceBaseline.R, 0);
});
test('unknown C and O comparisons refer independently of R and of forced J=0', () => {
  const f = fixture();
  f.submission.answer.current.rows[0].cap.value.unit = '每日配額';
  f.submission.answer.old.records[0].rows[0].valid.from = 'unfamiliar datetime';
  f.submission.answer.reason.support = [];
  const result = run(f);
  assert.deepEqual(result.scores, { C: null, O: null, R: 0, J: 0 });
  assert.deepEqual(result.referrals.map(r => r.components), [['C'], ['O']]);
});
test('unknown representation-dependent partition counts refer; independent factual contradictions can determine zero', () => {
  const f = fixture(), original = f.submission.answer.current.rows[0];
  original.scope = scoped('Formosa');
  assert.equal(run(f).scores.C, null);
  original.cap.value.unit = 'daily-quota';
  assert.equal(run(f).scores.C, null);
  original.approval.value = false;
  assert.equal(run(f).scores.C, 0);
  original.scope = scoped('TW'); original.approval.value = true;
  assert.equal(run(f).scores.C, 0); // independent missing JP/US cells
});
test('closed schema malformations, obsolete graph endpoints and invalid slot content zero the whole answer', () => {
  for (const edit of [a => a.reason.edges = [{ from: 'dangling', to: 'missing', citations: [] }],
    a => delete a.old.records[0].predecessor_turn,
    a => a.current.rows[0].approval.value = 'true', a => a.current.rows[0].route.state = 'not_specified',
    a => a.current.rows[0].cap.value.decimal = '1x2']) {
    const f = fixture(); edit(f.submission.answer); const result = run(f);
    assert.equal(result.valid, false); assert.deepEqual(result.scores, { C: 0, O: 0, R: 0, J: 0 });
  }
});
test('dangling private graph endpoints and span IDs are authoring errors', () => {
  const f = fixture(); f.gold.reason.acceptedGraphs[0].edges[0].to = 'dangling';
  assert.throws(() => validateGold(f.gold), /Dangling/);
  f.gold.reason.acceptedGraphs[0].edges[0].to = 'B';
  f.gold.reason.acceptedGraphs[0].edges[0].support = [['missing']];
  assert.throws(() => validateGold(f.gold), /Unknown support/);
});
test('correctness and support bundles obey opposite boundaries and preserve submitted quotations', () => {
  const f = fixture();
  f.submission.answer.current.rows[0].cap.value.unit = 'unknown unit';
  f.submission.delivered[0].segments[0].text += ' Unfamiliar context.';
  const out = run(f);
  const correctness = out.referrals.find(r => r.pass === 'correctness');
  const support = out.referrals.find(r => r.pass === 'support');
  assert.deepEqual(correctness.answer, f.submission.answer);
  assert.deepEqual(support.answer, f.submission.answer);
  assert(!('supportSpans' in correctness.G_correct));
  assert(!JSON.stringify(correctness.G_correct).includes('A caused B.'));
  assert(!JSON.stringify(correctness.G_correct).includes('turn-1'));
  assert(!('delivered' in correctness)); assert(!('G_correct' in support)); assert(!('reason' in support));
  assert.deepEqual(correctnessGold(correctness.G_correct), correctness.G_correct);
  assert.equal(support.delivered[0].text, 'A caused B. Unfamiliar context.');
});
test('dependence keys include complete evidence context, slot answer and separate parent rules', () => {
  const f = fixture(); f.submission.answer.current.rows[0].cap.value.unit = 'unknown unit';
  f.submission.delivered[0].segments[0].text += ' Other context.';
  const first = run(f);
  assert.deepEqual(first.referrals, run(f).referrals);
  f.submission.delivered[0].segments[0].text += ' changed';
  const second = run(f);
  assert.equal(first.referrals.find(r => r.pass === 'correctness').key, second.referrals.find(r => r.pass === 'correctness').key);
  assert.notEqual(first.referrals.find(r => r.pass === 'support').key, second.referrals.find(r => r.pass === 'support').key);
  assert(first.referrals.every(r => r.parentRule.startsWith('a4.') || r.parentRule.startsWith('a6.')));
});

test('impossible source-claimed interval retains existing whole-answer malformed semantics', () => {
  const f = fixture(); f.submission.answer.current.rows[0].valid = { from: '2026-10-25', to: '2026-10-25' };
  const result = run(f);
  assert.deepEqual(result.scores, { C: 0, O: 0, R: 0, J: 0 });
  assert.equal(result.valid, false);
});
test('R follows exact delivered addresses and explicit aliases without source or occurrence substitution', () => {
  const f = fixture(), first = f.submission.delivered[0];
  first.aliases.push({ intent: 'history', item: 8, unit: 'body', source: null });
  f.submission.answer.reason.support[0] = citation(8, 'A caused B.', { intent: 'history', unit: 'body', source: null });
  assert.equal(run(f).scores.R, 1);
  first.aliases = [];
  assert.equal(run(f).scores.R, 0);
});
test('ambiguous overlapping reader occurrences refer only R; malformed attempts retain negative-stratum denominator', () => {
  const f = fixture();
  f.submission.delivered[0].segments[0].text = 'aaaa';
  f.submission.answer.reason.support[0] = citation(0, 'aa', { occurrence: 2 });
  const result = run(f);
  assert.equal(result.scores.C, 1); assert.equal(result.scores.O, 1); assert.equal(result.scores.R, null);
  assert.equal(result.reason.error, 'ambiguous_overlapping_occurrence');
  f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
  const malformed = scoreUnlicensed(f.gold, null);
  assert.equal(malformed.reasonStratum.denominator, 1);
  assert.equal(malformed.reasonStratum.noEvidenceBaseline.R, 1);
});
