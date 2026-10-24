import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { hr2bToy, freeze } from './fixtures-tooling/hr2b.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';
import { HR2B, authenticateHR2bFixture, loadHR2bRankings, authenticateHR2bRanking, parseManifest } from '../assembly/hr2b-profile.mjs';
import { runAssembly } from '../assembly/run.mjs';
import { scoreDirectory, scoreCell } from '../assembly/score.mjs';
import { buildReport, reportMarkdown, statisticsRows } from '../assembly/report.mjs';
import { validateScoredCell } from '../assembly/provenance.mjs';
import { decisionHR2b, primaryHR2b, compareHR2bCells } from '../assembly/hr2b-report.mjs';
import { calibration } from '../assembly/calibrate-host-v2.mjs';
import { serializeRepresentationV2 } from '../assembly/representation-v2.mjs';
import { authenticateHostV2 } from '../assembly/host-v2.mjs';
import { countTokens } from '../assembly/counter.mjs';
import { validateOutputPath, validateOutputPaths } from '../assembly/output-paths.mjs';
import { sourceIdentity } from '../assembly/identity.mjs';
import { pooledGuardComparison, POOLED_GUARD_STATISTIC, evaluatePooledDraw, bootstrapPooledDraws } from '../lib/pooled-coverage.mjs';
import { seededRandom } from '../tools/split.mjs';
import { clusterBootstrap, percentile } from '../lib/stats.mjs';

const compare = (point, ci, status = 'ok') => ({ status, bootstrap: { status, point, ci } });
const guardCompare = (...args) => ({ ...compare(...args), statistic: POOLED_GUARD_STATISTIC });
const pooledOptions = { seed: HR2B.seed, resamples: 10000, minimumFamilies: 10, categories: ['C1', 'C2', 'C3'] };
function pooledToy(families = 2) {
  const baseline = Array.from({ length: families }, (_, i) => ({ id: `q${i}`, family: `f${String(i).padStart(2, '0')}`,
    category: i % 2 ? 'C3' : 'C1', groupCount: i % 2 ? 6 : 2, coveredGroups: i % 2 ? 1 : 2, ceiling: i % 2 ? 5 / 6 : 1 }));
  const candidate = baseline.map((row, i) => ({ ...row, coveredGroups: i % 2 ? 4 : 0 }));
  return { baseline, candidate };
}
function countedPooledToy(groupCount, coveredGroups, candidateCoveredGroups, ceiling, families = 10) {
  const baseline = Array.from({ length: families }, (_, i) => ({ id: `q${i}`, family: `f${i}`, category: 'C1', groupCount, coveredGroups, ceiling }));
  return { baseline, candidate: baseline.map(row => ({ ...row, coveredGroups: candidateCoveredGroups })) };
}
test('HR-2b primary selector and every §4 decision outcome and Inconclusive gate', () => {
  const gates = { quotasOK: true, guardCeiling: .1 }, main = compare(3, [.01, 6]), guard = guardCompare(-3, [-5, -1]);
  assert.equal(decisionHR2b(main, guard, gates), 'adopt');
  assert.equal(decisionHR2b(compare(0, [-2, 2.99]), guard, gates), 'keep');
  assert.equal(decisionHR2b(main, guardCompare(-7, [-9, -5.01]), gates), 'keep');
  for (const [p, g, gate] of [
    [compare(2.99, [1, 4]), guard, gates], [compare(3, [0, 6]), guard, gates],
    [compare(0, [-2, 3]), guard, gates], [main, guardCompare(-4, [-5.01, -1]), gates],
    [compare(1, [-2, 4]), guard, gates], [main, guard, { ...gates, quotasOK: false }],
    [main, guard, { ...gates, guardCeiling: 0 }], [main, guard, { ...gates, guardCeiling: null }],
    [compare(3, [1, 6], 'inconclusive'), guard, gates], [main, guardCompare(-1, [-2, 0], 'inconclusive'), gates],
    [null, guard, gates], [main, null, gates], [compare(NaN, [0, 1]), guard, gates],
    [main, guardCompare(-1, [null, 0]), gates], [compare(3, [4, 1]), guard, gates],
    [main, compare(-3, [-5, -1]), gates], [main, { ...guard, statistic: 'category-macro' }, gates],
  ]) assert.equal(decisionHR2b(p, g, gate), 'inconclusive');
  const run = { split: 'test', scale: 'S1000', ranking: 'A3--bge-m3', overhead: 'host-v2', budget: 1500 };
  assert.equal(primaryHR2b(run), true);
  for (const change of [{ split: 'dev' }, { scale: 'S300' }, { ranking: 'A1' }, { overhead: 0 }, { budget: 1000 }]) assert.equal(primaryHR2b({ ...run, ...change }), false);
});

test('pooled guard hand example uses group occurrences and has descriptive categories without intervals', () => {
  const { baseline, candidate } = pooledToy();
  const result = pooledGuardComparison(baseline, candidate, pooledOptions);
  // A: 2 groups, 2 -> 0 covered. B: 6 groups, 1 -> 4 covered.
  // Delta = (4 - 3) / 8 * 100 = +12.5pp, rather than category macro -25pp.
  assert.equal(result.bootstrap.point, 12.5);
  assert.equal(result.absolute.baseline.coverage, 3 / 8);
  assert.equal(result.absolute.candidate.coverage, 4 / 8);
  assert.equal(result.absolute.baseline.ceilingCoveredGroups, 7);
  assert.equal(result.absolute.baseline.ceiling, 7 / 8);
  assert.equal(result.absolute.baseline.families, 2); assert.equal(result.absolute.baseline.categoryCount, 2);
  assert.deepEqual(result.absolute.baseline.categoryCounts, { C1: { queries: 1, groups: 2 }, C2: { queries: 0, groups: 0 }, C3: { queries: 1, groups: 6 } });
  assert.deepEqual(result.descriptive, [
    { category: 'C1', point: -100, groups: 2, families: 1 },
    { category: 'C2', point: null, groups: 0, families: 0 },
    { category: 'C3', point: 50, groups: 6, families: 1 },
  ]);
  assert.ok(result.descriptive.every(row => !Object.hasOwn(row, 'ci') && !Object.hasOwn(row, 'decision')));
  assert.equal(result.status, 'inconclusive'); assert.equal(result.bootstrap.reason, 'too_few_families');
  assert.equal(result.bootstrap.ci, null); assert.equal(result.bootstrap.accepted, 0);
});

test('pooled family bootstrap recomputes denominators with full family multiplicity, deterministically', () => {
  const { baseline, candidate } = pooledToy(10);
  baseline.push({ id: 'extra', family: 'f00', category: 'C3', groupCount: 4, coveredGroups: 2, ceiling: .75 });
  candidate.push({ ...baseline.at(-1), coveredGroups: 1 });
  const result = pooledGuardComparison(baseline, candidate, pooledOptions);
  assert.equal(result.status, 'ok'); assert.equal(result.statistic, POOLED_GUARD_STATISTIC);
  assert.equal(result.bootstrap.point, 4 / 44 * 100); assert.equal(result.bootstrap.families, 10);
  assert.equal(result.bootstrap.accepted, 10000); assert.equal(result.bootstrap.rejected, 0); assert.equal(result.bootstrap.attempts, 10000);
  assert.deepEqual(result.bootstrap.endpoints, [.025, .975]); assert.equal(result.bootstrap.confidence, .95);
  // Independent reference draws retain every query row of a selected family.
  const random = seededRandom('hr2b-bootstrap-v1'), samples = [];
  for (let draw = 0; draw < 10000; draw++) {
    let groups = 0, difference = 0;
    for (let i = 0; i < 10; i++) {
      const family = `f${String(Math.floor(random() * 10)).padStart(2, '0')}`;
      for (const row of baseline.filter(row => row.family === family)) {
        groups += row.groupCount; difference += candidate.find(other => other.id === row.id).coveredGroups - row.coveredGroups;
      }
    }
    samples.push(difference / groups * 100);
  }
  samples.sort((a, b) => a - b);
  assert.deepEqual(result.bootstrap.ci, [.025, .975].map(p => percentile(samples, p)));
  assert.deepEqual(pooledGuardComparison(baseline, candidate, pooledOptions), result);
  assert.deepEqual(pooledGuardComparison([...baseline].reverse(), [...candidate].reverse(), pooledOptions), result);
});

test('twelve-family reference interval and point remain equal to the pre-fix helper', () => {
  const { baseline, candidate } = pooledToy(12);
  baseline.push({ id: 'extra', family: 'f00', category: 'C3', groupCount: 4, coveredGroups: 2, ceiling: .75 });
  candidate.push({ ...baseline.at(-1), coveredGroups: 1 });
  const result = pooledGuardComparison(baseline, candidate, pooledOptions);
  assert.equal(result.status, 'ok'); assert.equal(result.bootstrap.point, 5 / 52 * 100);
  assert.deepEqual(result.bootstrap.ci, [-25, 35]);
  assert.equal(result.bootstrap.accepted, 10000); assert.equal(result.bootstrap.rejected, 0);
});

test('ceiling recovery refuses near-zero/near-integer ratios and exactly accepts scorer divisions', () => {
  for (const [groups, ratio] of [[1, 1e-10], [1, 1 - 1e-10], [3, (1 + 1e-10) / 3], [3, (2 - 1e-10) / 3], [3, 1 / 3 + Number.EPSILON], [3, -0]]) {
    const { baseline, candidate } = countedPooledToy(groups, 0, 0, ratio);
    assert.throws(() => pooledGuardComparison(baseline, candidate, pooledOptions), /^Error: invalid_pooled_ceiling:q0$/);
  }
  for (const covered of [0, 1, 2, 3]) {
    const { baseline, candidate } = countedPooledToy(3, 0, 0, covered / 3);
    const result = pooledGuardComparison(baseline, candidate, pooledOptions);
    assert.equal(result.status, 'ok'); assert.equal(result.absolute.baseline.ceiling, covered / 3);
    assert.equal(result.absolute.baseline.ceilingCoveredGroups, covered * 10);
  }
  // Multiplying an exact scorer ratio back by a large denominator can round
  // one integer away. Recovery still must match the original division exactly.
  for (const [groups, covered] of [[8256740327948287, 4295720279636052], [7623134517657599, 4388166870651392], [5625530923614207, 3894941932831209]]) {
    const { baseline, candidate } = countedPooledToy(groups, 0, 0, covered / groups, 1);
    const result = pooledGuardComparison(baseline, candidate, { ...pooledOptions, minimumFamilies: 1, resamples: 3 });
    assert.equal(result.status, 'ok'); assert.equal(result.absolute.baseline.ceilingCoveredGroups, covered);
    assert.equal(result.absolute.baseline.ceiling, covered / groups);
  }
});

test('pooled totals and family reductions enforce safe-integer boundaries without losing small differences', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const single = countedPooledToy(maximum, maximum - 1, maximum, 1, 1);
  const options = { ...pooledOptions, minimumFamilies: 1, resamples: 3 };
  const result = pooledGuardComparison(single.baseline, single.candidate, options);
  assert.equal(result.status, 'ok'); assert.equal(result.absolute.baseline.groupCount, maximum);
  assert.equal(result.bootstrap.point, 1 / maximum * 100); assert.ok(result.bootstrap.point > 0);
  const boundary = countedPooledToy(maximum - 1, maximum - 2, maximum - 1, 1, 1);
  boundary.baseline.push({ id: 'extra', family: 'f0', category: 'C1', groupCount: 1, coveredGroups: 0, ceiling: 1 });
  boundary.candidate.push({ ...boundary.baseline.at(-1), coveredGroups: 1 });
  const family = pooledGuardComparison(boundary.baseline, boundary.candidate, options);
  assert.equal(family.status, 'ok'); assert.equal(family.absolute.baseline.groupCount, maximum);
  assert.equal(family.bootstrap.point, 2 / maximum * 100);
  boundary.baseline[0].groupCount++; boundary.candidate[0].groupCount++;
  assert.throws(() => pooledGuardComparison(boundary.baseline, boundary.candidate, options), /^Error: unsafe_pooled_aggregate$/);
  const unsafe = countedPooledToy(maximum, maximum - 1, maximum, 1);
  assert.throws(() => pooledGuardComparison(unsafe.baseline, unsafe.candidate, pooledOptions), /^Error: unsafe_pooled_aggregate$/);
});

test('accepted safe totals can produce unsafe family resamples, which are Inconclusive without redraw', () => {
  const { baseline, candidate } = countedPooledToy(Number.MAX_SAFE_INTEGER - 1, 0, 0, 1, 1);
  baseline.push({ id: 'q1', family: 'f1', category: 'C1', groupCount: 1, coveredGroups: 0, ceiling: 1 });
  candidate.push({ ...baseline.at(-1) });
  const result = pooledGuardComparison(baseline, candidate, { ...pooledOptions, minimumFamilies: 2, resamples: 25 });
  assert.equal(result.absolute.baseline.groupCount, Number.MAX_SAFE_INTEGER);
  assert.equal(result.status, 'inconclusive'); assert.equal(result.bootstrap.reason, 'invalid_bootstrap_draw');
  assert.ok(result.bootstrap.rejected > 0); assert.ok(result.bootstrap.accepted > 0);
  assert.equal(result.bootstrap.accepted + result.bootstrap.rejected, 25); assert.equal(result.bootstrap.attempts, 25);
  assert.equal(result.bootstrap.ci, null);
});

test('checked draw evaluation rejects zero, nonfinite and unsafe arithmetic with injected draws and no redraw', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  for (const invalid of [
    [], [{ groups: 0, delta: 0 }], [{ groups: -1, delta: 0 }],
    [{ groups: NaN, delta: 0 }], [{ groups: Infinity, delta: 0 }], [{ groups: maximum + 1, delta: 0 }],
    [{ groups: 1, delta: NaN }], [{ groups: 1, delta: Infinity }], [{ groups: 1, delta: maximum + 1 }],
    [{ groups: maximum, delta: 0 }, { groups: 1, delta: 0 }],
    [{ groups: 1, delta: maximum }, { groups: 1, delta: 1 }],
    [{ groups: 1, delta: -maximum }, { groups: 1, delta: -1 }],
    [{ groups: 1, delta: maximum }, { groups: 1, delta: 1 }, { groups: 1, delta: -1 }],
  ]) {
    assert.equal(evaluatePooledDraw(invalid), null);
    const calls = [];
    const result = bootstrapPooledDraws({ requested: 3, endpoints: [.025, .975], point: 0 }, index => {
      calls.push(index);
      return index === 1 ? invalid : [{ groups: 2, delta: index ? 1 : -1 }];
    });
    assert.deepEqual(calls, [0, 1, 2]); assert.equal(result.status, 'inconclusive');
    assert.equal(result.reason, 'invalid_bootstrap_draw'); assert.equal(result.accepted, 2); assert.equal(result.rejected, 1);
    assert.equal(result.attempts, 3); assert.equal(result.rejectionFrequency, 1 / 3); assert.equal(result.ci, null);
  }
  let consumed = 0;
  function* invalidFamilyDraw() { for (const delta of [Infinity, 0, 0]) { consumed++; yield { groups: 1, delta }; } }
  assert.equal(evaluatePooledDraw(invalidFamilyDraw()), null); assert.equal(consumed, 3);
  assert.equal(evaluatePooledDraw([{ groups: maximum, delta: maximum }]), 100);
  assert.equal(evaluatePooledDraw([{ groups: maximum, delta: -maximum }]), -100);
  const valid = bootstrapPooledDraws({ requested: 3, endpoints: [.025, .975], point: 0 }, index => [{ groups: 2, delta: index - 1 }]);
  assert.equal(valid.status, 'ok'); assert.deepEqual(valid.ci, [-47.5, 47.5]);
  assert.equal(valid.accepted, 3); assert.equal(valid.rejected, 0);
});

test('pooled minimum counts stratum families, with no category floor or category redraw', () => {
  const { baseline, candidate } = pooledToy(10);
  for (const rows of [baseline, candidate]) rows.forEach((row, i) => { row.category = i ? 'C3' : 'C1'; });
  const result = pooledGuardComparison(baseline, candidate, pooledOptions);
  assert.equal(result.status, 'ok'); assert.deepEqual(result.bootstrap.familyCounts, { C1: 1, C2: 0, C3: 9 });
  assert.equal(result.bootstrap.accepted, 10000); assert.equal(result.bootstrap.attempts, 10000); assert.equal(result.bootstrap.rejected, 0);
  const small = pooledGuardComparison(baseline.slice(0, 9), candidate.slice(0, 9), pooledOptions);
  assert.equal(small.bootstrap.reason, 'too_few_families'); assert.equal(small.bootstrap.families, 9);
});

test('pooled guard refuses malformed pairs, nonfinite/count/ceiling inputs and category trimming', () => {
  for (const change of [
    (a, b) => { b.pop(); }, (a, b) => { b[0].family = 'other'; },
    (a, b) => { b[0].groupCount++; }, (a, b) => { b[0].coveredGroups = NaN; },
    (a, b) => { a[0].groupCount = b[0].groupCount = Infinity; },
    (a, b) => { a[0].groupCount = b[0].groupCount = 0; a[0].coveredGroups = b[0].coveredGroups = 0; },
    (a, b) => { b[0].coveredGroups = -1; }, (a, b) => { b[0].coveredGroups = .5; },
    (a, b) => { b[0].coveredGroups = 3; }, (a, b) => { a[0].ceiling = NaN; },
    (a, b) => { a[0].ceiling = b[0].ceiling = .3; }, (a, b) => { b[0].ceiling = 0; },
  ]) {
    const { baseline, candidate } = pooledToy(10); change(baseline, candidate);
    assert.throws(() => pooledGuardComparison(baseline, candidate, pooledOptions), /paired_query|invalid_pooled|pooled_ceiling_mismatch/);
  }
  const { baseline, candidate } = pooledToy(10);
  assert.throws(() => pooledGuardComparison(baseline, candidate, { ...pooledOptions, categories: ['C1'] }), /invalid_pooled_counts/);
  for (const options of [{ resamples: 0 }, { minimumFamilies: 0 }, { seed: '' }, { categories: ['C1', 'C1'] }])
    assert.throws(() => pooledGuardComparison(baseline, candidate, { ...pooledOptions, ...options }), /invalid_pooled_bootstrap_options/);
});

test('decision consumes a pooled guard CI and pooled ceiling while retaining every outcome', () => {
  const baseline = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, family: `f${i}`, category: 'C1', groupCount: 1000, coveredGroups: 30, ceiling: 1 }));
  const candidate = baseline.map(row => ({ ...row, coveredGroups: 0 }));
  const guard = pooledGuardComparison(baseline, candidate, pooledOptions);
  const gates = { quotasOK: true, guardCeiling: guard.absolute.baseline.ceiling };
  assert.equal(decisionHR2b(compare(3, [1, 5]), guard, gates), 'adopt');
  assert.equal(decisionHR2b(compare(0, [-1, 2]), guard, gates), 'keep');
  const loss = pooledGuardComparison(baseline.map(row => ({ ...row, coveredGroups: 70 })), candidate, pooledOptions);
  assert.equal(decisionHR2b(compare(4, [1, 6]), loss, gates), 'keep');
  assert.equal(decisionHR2b(compare(2, [1, 5]), guard, gates), 'inconclusive');
  const zero = pooledGuardComparison(baseline.map(row => ({ ...row, coveredGroups: 0, ceiling: 0 })), candidate.map(row => ({ ...row, ceiling: 0 })), pooledOptions);
  assert.equal(decisionHR2b(compare(4, [1, 6]), zero, { ...gates, guardCeiling: zero.absolute.baseline.ceiling }), 'inconclusive');
});

test('calibration uses exact v2 probes, counts long text, models completeness transitions and does not retune', async t => {
  const original = await readFile(new URL('../assembly/overhead-host-v2.json', import.meta.url)), model = authenticateHostV2();
  const item = { ns: 0, type: 'memory', ref: { memoryId: '00000000-0000-4000-8000-000000000001', revision: 1 }, fence: 'AbCdEfGh', rank: 1,
    text: 'assembly one two three four five six seven eight nine ten eleven twelve thirteen fourteen', sourceAccess: 'available', sourcesComplete: true,
    metadata: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 }, sources: [] };
  const constants = JSON.parse(original);
  assert.equal(serializeRepresentationV2([], new Map()), constants.probes.zero);
  item.sources = [{ index: 0, role: 'user', excerpt: item.text }];
  assert.equal(serializeRepresentationV2([item], new Map([[item, item.sources]])), constants.probes.one);
  assert.equal(serializeRepresentationV2([item], new Map([[item, []]])), constants.probes.bodyOnlyOne);
  item.sources[0].excerpt = item.text.replace('assembly', 'source');
  assert.equal(serializeRepresentationV2([item], new Map([[item, item.sources]])), constants.probes.concrete);
  const second = structuredClone(item); second.ref.memoryId = 'second'; second.rank = 2;
  const dedup = JSON.parse(serializeRepresentationV2([item, second], new Map([[item, item.sources], [second, second.sources]])));
  assert.deepEqual(dedup.value.items[1].sources[0], { index: 0, sameAs: { item: 0, source: 0 } });
  item.metadata.kind = 'context'; item.sourceAccess = 'unavailable';
  const metadata = JSON.parse(serializeRepresentationV2([item], new Map([[item, []]]))).value.items[0];
  assert.deepEqual(metadata.metadata, { kind: 'context' }); assert.equal(metadata.sourcesComplete, false); assert.equal(metadata.sourceAccess, 'unavailable');
  const result = calibration({ bodies: [120], receipts: [40], counts: [2], itemCounts: [1] });
  assert.equal(result.probes.length, 6); assert.deepEqual(result.model, model);
  for (const probe of result.probes) {
    assert.equal(probe.measured, countTokens(probe.serialized)); assert.equal(probe.error, probe.modelled - probe.measured);
    const wire = JSON.parse(probe.serialized).value.items[0];
    assert.equal(countTokens(wire.body), 120); assert.equal(wire.sources.length, probe.delivered);
    assert.equal(wire.sourcesComplete ?? true, probe.sourcesComplete && probe.delivered === 2);
  }
  const defaultCounts = calibration({ bodies: [120], receipts: [40], itemCounts: [1] });
  assert.deepEqual([...new Set(defaultCounts.probes.map(probe => probe.receiptCount))], [1, 2, 3, 4]);
  for (const count of [5, 6, 7]) assert.throws(() => calibration({ counts: [count] }), /invalid_probe_grid/);
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-calibration-cli-' });
  const args = ['evaluation/retrieval-research/assembly/calibrate-host-v2.mjs', '--bodies', '120', '--receipts', '40', '--counts', '2', '--items', '1', '--out', join(workspace.path, 'calibration.json')];
  const ran = await runCli(workspace, args);
  assert.equal(ran.code, 0, ran.stderr); assert.deepEqual(JSON.parse(await readFile(args.at(-1))), result);
  assert.equal((await runCli(workspace, args)).code, 1);
  assert.deepEqual(await readFile(new URL('../assembly/overhead-host-v2.json', import.meta.url)), original);
});

test('HR-2b authenticated dev pipeline, placements, source identity, strict budgets and mixed-profile refusals', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-pipeline-' });
  const { fixture, dir, rankingsDir } = await hr2bToy(workspace);
  const authenticated = await authenticateHR2bFixture(dir);
  assert.deepEqual(authenticated.profile.budgets, [1000, 1500, 2000, 4000]); assert.equal(authenticated.profile.protocolCommit, 'd3a6e24f');
  assert.equal(authenticated.profile.protocol, 'HR-2b v1.1');
  assert.equal(authenticated.profile.guard.statistic, POOLED_GUARD_STATISTIC);
  const config = { 'fixture-dir': dir, rankings: rankingsDir, split: 'dev', scale: 'S1000', arms: 'P-top,P-top-s1', 'rankings-select': 'A3--bge-m3', budgets: '1500', out: join(workspace.path, 'cells') };
  const result = await runAssembly(config);
  assert.equal(result.cells, 4); assert.equal(result.expectedCells, 4);
  const scores = await scoreDirectory(dir, config.out);
  assert.equal(scores.cells.length, 4);
  scores.cells.forEach(validateScoredCell);
  const full = scores.cells.find(cell => cell.run.arm === 'P-top' && cell.run.overhead === 'host-v2');
  const first = scores.cells.find(cell => cell.run.arm === 'P-top-s1' && cell.run.overhead === 'host-v2');
  assert.equal(full.strata['placement:later-receipt'].macroCoverage, 1);
  assert.equal(first.strata['placement:later-receipt'].macroCoverage, 0);
  assert.deepEqual(first.strata['placement:later-receipt'].representedCategories, ['C1']);
  assert.equal(first.strata['placement:later-receipt'].families, 12);
  const contrast = compareHR2bCells(full, first, 'placement:later-receipt');
  assert.equal(contrast.bootstrap.seed, 'hr2b-bootstrap-v1'); assert.equal(contrast.bootstrap.requested, 10000);
  assert.equal(contrast.statistic, POOLED_GUARD_STATISTIC);
  assert.equal(contrast.absolute.baseline.coverage, 1); assert.equal(contrast.absolute.candidate.coverage, 0);
  assert.equal(contrast.absolute.baseline.ceiling, 1);
  assert.deepEqual(contrast.bootstrap.ci, [-100, -100]);
  for (const stratum of [undefined, 'placement:first-receipt', 'fidelity:span-only']) {
    const before = statisticsRows(stratum ? full.strata[stratum].queries : full.queries);
    const after = statisticsRows(stratum ? first.strata[stratum].queries : first.queries);
    const categories = stratum ? ['C1'] : ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    assert.deepEqual(compareHR2bCells(full, first, stratum).bootstrap,
      clusterBootstrap(before, after, { seed: HR2B.seed, resamples: 10000, minimumFamilies: 10, exploratory: true, categories }));
  }
  const report = buildReport(scores);
  assert.equal(report.ok, true); assert.equal(report.outcome, 'inconclusive'); assert.equal(report.outcomeReason, 'primary_cell_absent');
  assert.match(reportMarkdown(report), /later-receipt/);
  assert.deepEqual(report.comparisons[0].guard.descriptive, [{ category: 'C1', point: -100, groups: 36, families: 12 }]);
  assert.match(reportMarkdown(report), /per-category deltas are descriptive/);
  assert.match(reportMarkdown(report), /Pooled guard coverage baseline\/candidate/);
  assert.equal(buildReport({ ...scores, cells: [...scores.cells, { ...scores.cells[0], run: { ...scores.cells[0].run, fixtureVersion: 'hr1-fixture-v2', protocol: 'HR-2 v1.1' } }] }).ok, false);
  const names = await readdir(config.out), raw = JSON.parse(await readFile(join(config.out, names[0])));
  assert.throws(() => scoreCell({ ...fixture, corpus: { ...fixture.corpus, version: 'hr1-fixture-v2' } }, raw), /mixed_fixture_profiles/);
  const bad = structuredClone(raw); bad.run.budget = 1536;
  assert.throws(() => scoreCell(fixture, bad), /invalid_hr2b_cell_run/);
  for (const pin of [{ protocol: 'HR-2b v1' }, { protocolCommit: 'c546bfc1' }])
    assert.throws(() => scoreCell(fixture, { ...raw, run: { ...raw.run, ...pin } }), /invalid_hr2b_cell_run/);
  for (const override of [{ budgets: '1536' }, { overheads: '8' }, { 'rankings-select': 'F-RRF10--openai-3-small' }, { scale: 'S300' }, { 'overhead-model': 'unknown' }, { 'overhead-model': 'host-v2', overheads: '0' }])
    await assert.rejects(runAssembly({ ...config, ...override, out: join(workspace.path, 'bad') }));
  const identity = await sourceIdentity();
  for (const name of ['../run.mjs', '../lib/fixture.mjs', '../tools/facts-view.mjs', '../tools/split.mjs', '../tools/labels.mjs', '../tools/validate.mjs', '../tools/apply-audit.mjs']) assert.ok(identity.sourceFiles.includes(name), name);
  // Hash and configuration tampering cannot pass the dynamic freeze manifest.
  const rankPath = join(rankingsDir, 'dev/A1.json'), ranking = JSON.parse(await readFile(rankPath));
  ranking.run.configuration.horizon = 25;
  assert.throws(() => authenticateHR2bRanking(authenticated, ranking, { selection: 'A1', split: 'dev', scale: 'S1000' }), /fixed_configuration/);
  await writeFile(rankPath, JSON.stringify(ranking));
  await assert.rejects(loadHR2bRankings(rankingsDir, authenticated), /ranking_member_hash_mismatch/);
  assert.throws(() => parseManifest('| `../bad` | `' + 'a'.repeat(64) + '` |'), /manifest_files/);
});

test('four-family dev strata authenticate with a frozen category absent from dev and a descriptive zero row', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-v11-dev-' });
  const { dir, rankingsDir } = await hr2bToy(workspace, { devFamilies: 4, categoryFor: (split, i) => split === 'test' && i === 0 ? 'C3' : 'C1' });
  const fixture = await authenticateHR2bFixture(dir);
  assert.equal(fixture.profile.placement.ok, true);
  assert.deepEqual(fixture.profile.placement.guardCategories, ['C1', 'C3']);
  assert.deepEqual(fixture.profile.placement.splits.dev['later-receipt'], { groups: 12, families: 4, categories: { C1: 4, C3: 0 } });
  const out = join(workspace.path, 'cells');
  await runAssembly({ 'fixture-dir': dir, rankings: rankingsDir, split: 'dev', scale: 'S1000', arms: 'P-top,P-top-s1', 'rankings-select': 'A1', budgets: '1500', out });
  const scores = await scoreDirectory(dir, out);
  scores.cells.forEach(validateScoredCell);
  const report = buildReport(scores);
  assert.equal(report.ok, true, report.error);
  for (const comparison of report.comparisons) {
    assert.equal(comparison.guard.statistic, POOLED_GUARD_STATISTIC);
    assert.equal(comparison.guard.bootstrap.reason, 'too_few_families');
    assert.equal(comparison.guard.bootstrap.families, 4);
    assert.deepEqual(comparison.guard.descriptive.find(row => row.category === 'C3'), { category: 'C3', point: null, groups: 0, families: 0 });
  }
  const invalid = structuredClone(scores.cells[0]); invalid.run.protocolProfile.placement.guardCategories.pop();
  assert.throws(() => validateScoredCell(invalid), /hr2b_placement_snapshot/);
});

test('HR-2b protected output roots are checked dynamically and through symlinks', async t => {
  const research = fileURLToPath(new URL('../', import.meta.url));
  // Toy scratch aliases inside an owned workspace exercise the same physical
  // roots without ever creating fixtures-hr2b or repository result directories.
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-paths-' });
  for (const path of ['fixtures', 'results/hr2-final', 'results/test-final']) {
    await symlink(join(research, path), join(workspace.path, path.replaceAll('/', '-')));
    assert.throws(() => validateOutputPath(join(workspace.path, path.replaceAll('/', '-'), 'new.json')), /protected_output_path/);
  }
  const { protectedHR2bRoots } = await import('../assembly/output-paths.mjs');
  const toyResearch = join(workspace.path, 'research'); await mkdir(toyResearch);
  for (const name of ['fixtures-hr2b', 'results/hr2b-rankings', 'results/hr2b-final']) {
    assert.equal(protectedHR2bRoots(toyResearch).length, 0);
    await mkdir(join(toyResearch, name), { recursive: true });
    assert.deepEqual(protectedHR2bRoots(toyResearch), [join(toyResearch, name)]);
    await (await import('node:fs/promises')).rmdir(join(toyResearch, name));
  }
  assert.throws(() => validateOutputPaths([join(workspace.path, 'a'), join(workspace.path, 'a/b')]), /protected_output_path/);
});

test('dynamic HR-2b protection follows a protected root that is itself a symlink', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-root-symlink-' });
  const { protectedHR2bRoots } = await import('../assembly/output-paths.mjs');
  const root = join(workspace.path, 'research'), target = join(workspace.path, 'target');
  await mkdir(root); await mkdir(target);
  await symlink(target, join(root, 'fixtures-hr2b'));
  assert.deepEqual(protectedHR2bRoots(root), [target]);
});

test('HR-2b reports scalar budget pressure while the legacy scalar return stays unchanged', async () => {
  const { assemble, ARMS } = await import('../assembly/arms.mjs');
  const items = [{ id: 'big', body: { id: 'big#body', text: 'long', tokens: 2001 }, spans: [] },
    { id: 'small', body: { id: 'small#body', text: 'small', tokens: 10 }, spans: [{ id: 'small#s1', text: 'receipt', tokens: 1500 }] }];
  for (const arm of ARMS) {
    const options = { arm, budget: 1000, overhead: 0 };
    const legacy = assemble(items, ['big', 'small'], options);
    const current = assemble(items, ['big', 'small'], { ...options, diagnostics: true });
    assert.equal(legacy.budgetRejected, undefined);
    assert.equal(current.budgetRejected, true);
    assert.deepEqual(current.admitted, legacy.admitted); assert.equal(current.used, legacy.used);
  }
});

for (const mode of ['drop', 'recategorize']) test(`audited authoring pipeline reaches ranking authentication, scoring and report: ${mode}`, async t => {
  const { auditedPipelineToy } = await import('./fixtures-tooling/hr2b.mjs');
  const { auditedHR2bQueries } = await import('../lib/hr2b-queries.mjs');
  const workspace = createTestWorkspace(t, { prefix: `hr2b-audited-${mode}-` });
  const { fixture, dir, rankingsDir, originalQueries, beforePlacement, generated, auditIds } = await auditedPipelineToy(workspace, mode);
  assert.deepEqual(fixture.queries, originalQueries, 'W2 authoring records remain intact');
  for (const id of auditIds) assert.equal(fixture.split[originalQueries.queries.find(query => query.id === id).family], 'dev', 'audit changes must exercise the executed dev split');
  assert.equal(fixture.labels.placement.ok, true, JSON.stringify(fixture.labels.placement));
  if (mode === 'recategorize') {
    assert.deepEqual(fixture.labels.placement, beforePlacement, 'paired swap preserves structural quotas and category/family counts');
    const totals = entries => ['C1', 'C3'].map(category => entries.filter(query => query.category === category).length);
    assert.deepEqual(totals(auditedHR2bQueries(fixture)), totals(originalQueries.queries));
  }
  for (const label of fixture.labels.queries.filter(label => !label.dropped)) assert.equal(label.checks[label.category].pass, true, label.id);
  const authenticated = await authenticateHR2bFixture(dir);
  for (const output of generated.outputs) {
    assert.equal(output.run.status, 'complete');
    const selection = output.run.arm === 'A1' ? 'A1' : 'A3--bge-m3';
    const queries = authenticateHR2bRanking(authenticated, output, { selection, split: 'dev', scale: 'S1000' });
    assert.deepEqual(queries.map(query => query.id), auditedHR2bQueries(fixture, { split: 'dev', scored: true }).map(query => query.id));
    if (mode === 'drop') {
      assert.equal(Object.hasOwn(output.queries, auditIds[0]), false);
      const { authenticateRanking } = await import('../assembly/auth.mjs');
      assert.throws(() => authenticateRanking(authenticated, output, { selection, split: 'dev', scale: 'S1000' }), /rankings_query_set/, 'legacy selector reproduces the original HR-2b bug');
    }
  }
  const out = join(workspace.path, 'cells');
  await runAssembly({ 'fixture-dir': dir, rankings: rankingsDir, split: 'dev', scale: 'S1000', arms: 'P-top,P-top-s1', 'rankings-select': 'A1', budgets: '1500', out });
  const scores = await scoreDirectory(dir, out);
  scores.cells.forEach(validateScoredCell);
  const report = buildReport(scores);
  assert.equal(report.ok, true, report.error);
  if (mode === 'drop') assert.ok(scores.cells.every(cell => cell.queries.every(query => query.id !== auditIds[0])));
  else for (const cell of scores.cells) for (const id of auditIds) assert.notEqual(cell.queries.find(row => row.id === id).category, originalQueries.queries.find(query => query.id === id).category);
  for (const cell of scores.cells) for (const row of cell.queries) assert.equal(row.category, fixture.labels.queries.find(label => label.id === row.id).category);
});

test('placement evidence refuses omissions, additions, changed group denominators and metrics in either model', async t => {
  const { summarize } = await import('../assembly/score.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-evidence-auth-' }), { dir, rankingsDir } = await hr2bToy(workspace);
  const out = join(workspace.path, 'cells');
  await runAssembly({ 'fixture-dir': dir, rankings: rankingsDir, split: 'dev', scale: 'S1000', arms: 'P-top,P-top-s1', 'rankings-select': 'A1', budgets: '1500', out });
  const scores = await scoreDirectory(dir, out);
  const refresh = stratum => {
    const rows = stratum.queries;
    Object.assign(stratum, summarize(rows), { families: new Set(rows.map(row => row.family)).size,
      familyCounts: Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(category => [category, new Set(rows.filter(row => row.category === category).map(row => row.family)).size])) });
  };
  for (const overhead of [0, 'host-v2']) {
    const pair = scores.cells.filter(cell => cell.run.overhead === overhead);
    pair.forEach(validateScoredCell);
    for (const placement of ['body', 'first-receipt', 'later-receipt']) for (const change of ['omit', 'add', 'denominator', 'coverage', 'ceiling', 'summary']) {
      const bad = structuredClone(pair);
      for (const cell of bad) {
        const stratum = cell.strata[`placement:${placement}`];
        if (change === 'omit') stratum.queries = stratum.queries.slice(0, -2);
        if (change === 'add') stratum.queries.push({ ...structuredClone(stratum.queries[0]), id: 'not-a-frozen-query', family: 'extra-family' });
        if (change === 'denominator') stratum.queries[0].groupCount++;
        if (change === 'coverage') { stratum.queries[0].coverage = .5; stratum.queries[0].allRequired = false; }
        if (change === 'ceiling') stratum.queries[0].ceiling = .25;
        refresh(stratum);
        if (change === 'summary') stratum.families++;
        assert.throws(() => validateScoredCell(cell), /hr2b_evidence_mismatch/, `${overhead}/${placement}/${change}`);
      }
      assert.equal(buildReport({ ...scores, cells: bad }).ok, false);
    }
  }
});

for (const change of ['body', 'receipt', 'tokens']) test(`host replay binds ${change} to authenticated corpus bytes`, async t => {
  const { assemble } = await import('../assembly/arms.mjs');
  const { hostV2Cost } = await import('../assembly/cost.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-corpus-auth-' }), { dir, rankingsDir } = await hr2bToy(workspace);
  const out = join(workspace.path, 'cells');
  await runAssembly({ 'fixture-dir': dir, rankings: rankingsDir, split: 'dev', scale: 'S1000', arms: 'P-top', 'rankings-select': 'A1', budgets: '1500', 'overhead-model': 'host-v2', out });
  const scores = await scoreDirectory(dir, out), bad = structuredClone(scores.cells[0]);
  validateScoredCell(bad);
  const item = bad.assemblyItems[0], unit = change === 'receipt' ? item.spans[0] : item.body;
  if (change === 'tokens') unit.tokens++;
  else { unit.text = 'substituted synthetic text'; unit.tokens = countTokens(unit.text); }
  const cost = hostV2Cost(authenticateHostV2());
  for (const row of bad.queries) Object.assign(row, assemble(bad.assemblyItems, row.ranked, { arm: bad.run.arm, budget: bad.run.budget, cost }));
  assert.throws(() => validateScoredCell(bad), /hr2b_corpus_items_mismatch/);
});

test('fixed configuration and protocol snapshots cannot mutate later authentication', async t => {
  const { HR2B_FIXED, hr2bConfiguration, checkHR2bConfiguration } = await import('../lib/hr2b-configuration.mjs');
  const { FIXTURE_PROFILES, HR2B_VERSION } = await import('../lib/fixture.mjs');
  const { profileForDirectory } = await import('../assembly/hr2b-profile.mjs');
  const hashes = { toy: 'original' }, configuration = hr2bConfiguration(hashes);
  configuration.fusion.depth = 99; configuration.fixtureHashes.toy = 'changed';
  assert.equal(hashes.toy, 'original');
  assert.throws(() => checkHR2bConfiguration(configuration, hashes), /fixed_configuration_mismatch/);
  assert.equal(hr2bConfiguration(hashes).fusion.depth, 12);
  assert.throws(() => { HR2B_FIXED.fusion.depth = 99; }, TypeError);
  assert.throws(() => { FIXTURE_PROFILES[HR2B_VERSION].quotas.test.groups = 1; }, TypeError);
  assert.throws(() => { HR2B.primary.budget = 1; }, TypeError);
  assert.deepEqual(HR2B.quotas, FIXTURE_PROFILES[HR2B_VERSION].quotas);
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-profile-snapshot-' }), { dir } = await hr2bToy(workspace);
  const first = await authenticateHR2bFixture(dir); first.profile.primary.budget = 1; first.profile.quotas.test.groups = 1;
  const returned = await profileForDirectory(dir); returned.budgets[0] = 1;
  assert.equal((await authenticateHR2bFixture(dir)).profile.primary.budget, 1500);
  assert.equal((await authenticateHR2bFixture(dir)).profile.quotas.test.groups, 30);
  assert.deepEqual((await profileForDirectory(dir)).budgets, [1000, 1500, 2000, 4000]);
});
