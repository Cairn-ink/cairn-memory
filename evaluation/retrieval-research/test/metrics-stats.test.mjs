import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterBootstrap, exactMcNemar, pairedQueries, percentile } from '../lib/stats.mjs';

const row = (id, family, category, recall12) => ({ id, family, category, recall12, allRequired12: recall12 === 1 });

test('hand-computed two-family bootstrap: percentile CI is [0,100] pp and seed is deterministic', () => {
  const before = [row('q1', 'f1', 'C1', 0), row('q2', 'f2', 'C1', 0)];
  const after = [row('q1', 'f1', 'C1', 0), row('q2', 'f2', 'C1', 1)];
  // Two draws with replacement yield deltas 0, 50, 100 with probabilities
  // 1/4, 1/2, 1/4. Both specified equal-tail intervals are [0,100].
  const options = { categories: ['C1'], minimumFamilies: 1, seed: 'hand-example' };
  const result = clusterBootstrap(before, after, options);
  assert.equal(result.point, 50); assert.deepEqual(result.ci, [0, 100]); assert.equal(result.accepted, 10000);
  assert.deepEqual(result.endpoints, [0.0125, 0.9875]); assert.equal(result.rejected, 0);
  assert.deepEqual(clusterBootstrap(before, after, options), result);
  const exploratory = clusterBootstrap(before, after, { ...options, exploratory: true });
  assert.deepEqual(exploratory.endpoints, [0.025, 0.975]); assert.deepEqual(exploratory.ci, [0, 100]);
});

test('bootstrap samples whole families jointly and redraws empty categories', () => {
  const before = [row('q1', 'f1', 'C1', 0), row('q2', 'f1', 'C1', 0), row('q3', 'f2', 'C2', 0)];
  const after = before.map(record => ({ ...record, recall12: 1, allRequired12: true }));
  const result = clusterBootstrap(before, after, { categories: ['C1', 'C2'], minimumFamilies: 1, resamples: 100, seed: 7 });
  assert.equal(result.rejected > 0, true); assert.equal(result.attempts, result.accepted + result.rejected);
  assert.equal(result.rejectionFrequency, result.rejected / result.attempts);
  assert.deepEqual(result.familyCounts, { C1: 1, C2: 1 }); assert.equal(result.point, 100); assert.deepEqual(result.ci, [100, 100]);
  const limit = clusterBootstrap(before, after, { categories: ['C1', 'C2'], minimumFamilies: 1, resamples: 100, maxAttempts: 100, seed: 7 });
  assert.equal(limit.reason, 'bootstrap_redraw_limit');
});

test('confirmatory bootstrap is inconclusive for a category with fewer than ten test families', () => {
  const rows = [row('q1', 'f1', 'C1', 1)];
  const result = clusterBootstrap(rows, rows);
  assert.equal(result.status, 'inconclusive'); assert.equal(result.reason, 'too_few_families'); assert.equal(result.ci, null);
  assert.equal(result.familyCounts.C1, 1); assert.equal(result.familyCounts.C2, 0);
  assert.equal(clusterBootstrap([], []).status, 'inconclusive');
});

test('exact McNemar hand calculation: discordants 1 versus 3 give p=10/16', () => {
  const before = [row('q1', 'f1', 'C1', 1), row('q2', 'f2', 'C1', 0), row('q3', 'f3', 'C1', 0), row('q4', 'f4', 'C1', 0)];
  const after = before.map((record, i) => ({ ...record, recall12: i ? 1 : 0, allRequired12: Boolean(i) }));
  // A second query in f1 would reverse its result, but is not preregistered.
  before.push(row('q9', 'f1', 'C2', 0)); after.push(row('q9', 'f1', 'C2', 1));
  const result = exactMcNemar(before, after);
  assert.equal(result.baselineOnly, 1); assert.equal(result.candidateOnly, 3); assert.equal(result.discordant, 4);
  assert.ok(Math.abs(result.p - 0.625) < 1e-14); assert.equal(result.families, 4); assert.equal(result.queryIds.includes('q9'), false);
  assert.equal(exactMcNemar(before, before).p, 1);
  assert.equal(exactMcNemar([], []).p, 1);
});

test('pairing rejects inconsistent identities and quantiles use declared linear interpolation', () => {
  assert.throws(() => pairedQueries([row('q1', 'f1', 'C1', 1)], []), /set_mismatch/);
  assert.throws(() => pairedQueries([row('q1', 'f1', 'C1', 1)], [row('q1', 'f2', 'C1', 1)]), /metadata_mismatch/);
  assert.equal(percentile([0, 10], 0.25), 2.5); assert.equal(percentile([], 0.5), null);
});
