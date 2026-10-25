import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../../scorer/scorer.mjs';
import { fixture } from '../../scorer/test/fixtures.mjs';
import { adaptChallenge } from '../../integration/adapters.mjs';
import { a4Fixture } from '../../integration/test/fixtures-a4.mjs';
import { adaptScore, scoreVectors, absoluteEstimands, propagateJudgments } from '../adapter.mjs';
import { allocation } from '../design.mjs';
import { analyzeScores } from '../analyze.mjs';
const envelope = result => ({ family: 'f', lineage: 'l', type: 'correction', arm: 'T', checkpoint: 4, attempted: true, score: result });
test('A-4 scorer outputs map C/O/R/J without changing component validity or citation semantics', () => {
  const f = fixture(), r = score(f.gold, f.submission), adapted = adaptScore(envelope(r));
  assert.deepEqual(adapted.scores, { C: 1, O: 1, R: 1, J: 1 });
  f.submission.answer.reason.support = [];
  const failedR = adaptScore(envelope(score(f.gold, f.submission)));
  assert.deepEqual(failedR.scores, { C: 1, O: 1, R: 0, J: 0 });
});
test('real integration A-4 adapter referrals retain pass keys and parent-rule identities', () => {
  const f = a4Fixture(), a = adaptChallenge(f.row, f.world), r = score(a.gold, a.submission);
  assert.equal(r.scores.R, null); assert.throws(() => adaptScore(envelope(r)), /Unresolved/);
  const resolutions = Object.fromEntries(r.referrals.map(x => [x.key, 1]));
  const adapted = adaptScore(envelope(r), resolutions);
  assert.deepEqual(adapted.scores, { C: 1, O: 1, R: 1, J: 1 });
  assert.deepEqual(adapted.dependencies.map(x => x.key), r.referrals.map(x => x.key));
  assert.ok(adapted.dependencies.every(x => x.parentRule && x.pass));
  const u = { ...structuredClone(adapted), arm: 'U' };
  const perturbed = propagateJudgments([adapted, u], new Map(r.referrals.map(x => [x.key, 0])));
  assert.ok(perturbed.every(p => p.scores.R === 0 && p.scores.J === 0 && p.scores.C === 1));
});
test('forced-J-zero still requires resolution, malformed attempts stay zero, unexecuted never zero-filled', () => {
  const f = a4Fixture(), a = adaptChallenge(f.row, f.world);
  a.submission.answer.current.rows[0].route.value = 'wrong';
  const r = score(a.gold, a.submission); assert.equal(r.scores.J, 0); assert.ok(r.referrals.length);
  assert.throws(() => adaptScore(envelope(r)), /Unresolved/);
  const zeros = score(a.gold, { answer: {}, delivered: [] });
  assert.deepEqual(adaptScore(envelope(zeros)).scores, { C: 0, O: 0, R: 0, J: 0 });
  assert.throws(() => adaptScore({ ...envelope(zeros), attempted: false }), /Unexecuted/);
  assert.throws(() => adaptScore(envelope({ ...zeros, version: 'old' })), /A-4/);
});
test('not_stated empty-delivery factual R is retained separately from stated supported R', () => {
  const f = fixture(); f.gold.reason = { status: 'not_stated', nodes: [], acceptedGraphs: [] };
  f.submission.answer.reason = { status: 'not_stated', support: [] }; f.submission.delivered = [];
  const a = adaptScore(envelope(score(f.gold, f.submission)));
  assert.equal(a.scores.R, 1); assert.equal(a.reasonStratum.stratum, 'not_stated'); assert.equal(a.reasonStratum.denominator, 1);
  assert.equal(a.reasonStratum.noEvidenceBaseline.R, 1);
});
test('score vectors use planned allocations, paired family J, guard/type weights, missing data fail closed', () => {
  const planned = allocation('pilot').map(l => ({ ...l, families: [l.id + '/a', l.id + '/b'] }));
  const records = planned.flatMap(l => l.families.flatMap((family, i) => ['T', 'U', 'P'].map(arm => ({ family, lineage: l.id, type: l.type, arm, checkpoint: 4, attempted: true,
    scores: { C: i, O: 1 - i, R: 1, J: 0 } }))));
  const data = scoreVectors(records, { split: 'pilot', planned });
  assert.equal(data.lineages.length, 30); assert.equal(data.lineages[0].weights[0], 1 / 30); assert.equal(data.lineages[0].weights[4], 1 / 20);
  assert.equal(data.lineages[0].values[0][0], 0);
  const p = scoreVectors(records, { split: 'pilot', planned, estimands: absoluteEstimands('P', 'correction') });
  assert.equal(p.lineages[0].weights[0], 1 / 6);
  assert.throws(() => scoreVectors(records.slice(1), { split: 'pilot', planned }), /Missing/);
  assert.throws(() => scoreVectors([...records, records[0]], { split: 'pilot', planned }), /duplicate/);
  assert.throws(() => scoreVectors(records, { split: 'pilot', planned: planned.slice(1) }), /allocation/);
});
test('A-1.1 blocks engineering-pilot intervals; calibrated analysis derives O completion rather than trusting a claimed gate', () => {
  assert.throws(() => analyzeScores({}), /A-1.1/);
  const f = fixture(), result = score(f.gold, f.submission);
  const planned = allocation('pilot').map(l => ({ ...l, families: [l.id + '/0', l.id + '/1'] }));
  const observations = planned.flatMap(l => l.families.flatMap(family => ['T', 'U', 'P'].map(arm => ({ ...envelope(result), family, lineage: l.id, type: l.type, arm }))));
  const analysis = analyzeScores({ observations, split: 'pilot', planned, calibrated: true, draws: 8, engineeringSmoke: true });
  assert.equal(analysis.gates.validFinalShare.O, 0); assert.equal(analysis.decision, 'Inconclusive');
  assert.equal(analysis.panels.length, 6); assert.equal(analysis.panels[0].denominator, 60);
  assert.ok(Math.abs(analysis.panels[0].result.point[3] - 1) < 1e-12);
  const partial = analyzeScores({ observations: observations.slice(0, -1), split: 'pilot', planned, calibrated: true, draws: 8, engineeringSmoke: true });
  assert.equal(partial.panels[0].status, 'partial-no-completed-design-ci');
});
