import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { writeJson, readJson } from '../lib/fixture.mjs';
import { scoreRuns } from '../lib/metrics.mjs';
import { createSelection, decision, compareRuns, buildReport, a5Decision, reportMarkdown, reportEnvironment } from '../report.mjs';
import { toyFixture, rankingsFor } from './fixtures-tooling/toy.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';

const support = label => label.groups.flatMap(group => group.members.filter(member => member.namespace === 'target').map(member => member.memory));
const halfSupport = label => Number(label.id.slice(-2)) % 2 === 0 ? support(label) : [];
function devScores(fixture) {
  const inputs = ['A1', 'A1+'].map(arm => rankingsFor(fixture, { arm, config: arm, split: 'dev', ranking: halfSupport }));
  for (const model of ['e5-small', 'bge-m3', 'openai-3-small', 'openai-3-large']) for (const config of ['A3', 'F-RRF60', 'F-RRF10', 'F-MM']) {
    inputs.push(rankingsFor(fixture, { arm: config, config, model, split: 'dev', ranking: halfSupport }));
  }
  return scoreRuns(fixture, inputs);
}
function testScores(fixture, selection) {
  const inputs = [rankingsFor(fixture, { ...selection.comparator, ranking: halfSupport }),
    ...Object.values(selection.nominated).filter(Boolean).map(selected => rankingsFor(fixture, { ...selected, ranking: support }))];
  return scoreRuns(fixture, inputs, { withoutForeign: structuredClone(inputs) });
}
function latency(selected, scores, ms = 20) {
  return { format: 'hr1-latency-v1', run: { ...selected, split: 'test', scale: 'S1000' }, queryCacheEnabled: false,
    samples: Array.from({ length: 5 }, (_, pass) => scores.runs[0].queries.map(query => ({ queryId: query.id, pass, ms }))).flat(), threads: 1, device: 'cpu', peakRss: 100 };
}

test('dev selection obeys all tie orders, excludes exploratory configurations, and records family counts', () => {
  const fixture = toyFixture(), scores = devScores(fixture);
  const exploratory = scoreRuns(fixture, [rankingsFor(fixture, { arm: 'explore', config: 'grid-depth50', model: 'bge-m3', split: 'dev' })]);
  scores.runs.push(...exploratory.runs);
  const selection = createSelection(scores);
  assert.equal(selection.status, 'ready'); assert.equal(selection.comparator.arm, 'A1');
  assert.equal(selection.nominated.local.model, 'e5-small'); assert.equal(selection.nominated.hosted.model, 'openai-3-small');
  assert.equal(selection.lexical, 'A1'); assert.deepEqual(selection.contexts.local, { model: 'e5-small', fusion: 'A3' });
  assert.deepEqual(selection.models['bge-m3'], { fusion: 'A3' });
  assert.equal(Object.values(selection.configurations).every(config => config.menu === 'A3'), true);
  assert.deepEqual(selection.devFamilyCounts, Object.fromEntries(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(category => [category, 6])));
  assert.deepEqual(createSelection(scores), selection);
  scores.runs[1].summary.macroRecall12 = 0.6;
  assert.equal(createSelection(scores).comparator.arm, 'A1+');
  assert.throws(() => createSelection(testScores(fixture, selection)), /dev_only/);
});

test('ease and insufficient dev families block interpretation; incomplete model menus stay in their context', () => {
  const fixture = toyFixture(), scores = devScores(fixture);
  for (const category of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']) scores.runs[0].summary.categories[category].recall12 = 0.95;
  assert.equal(createSelection(scores).reason, 'suite_too_easy_revise_fixture_before_test');
  const incomplete = devScores(fixture); incomplete.runs.pop();
  assert.equal(createSelection(incomplete).modelAvailability['openai-3-large'].reason, 'incomplete_confirmatory_menu');
  assert.equal(createSelection(incomplete).nominated.local.model, 'e5-small');
  assert.equal(createSelection(incomplete).status, 'ready');
  const few = devScores(fixture);
  for (const row of few.runs[0].queries) row.family = 'one';
  assert.equal(createSelection(few).reason, 'too_few_dev_families');
});

test('remaining fusion ties follow F-RRF60, F-RRF10, F-MM, and higher dev quality wins model nomination', () => {
  const fixture = toyFixture(), scores = devScores(fixture);
  const model = 'bge-m3';
  const set = (config, value) => { scores.runs.find(result => result.run.model === model && result.run.config === config).summary.macroRecall12 = value; };
  set('A3', 0.4);
  assert.equal(createSelection(scores).configurations[model].menu, 'F-RRF60');
  set('F-RRF60', 0.4);
  assert.equal(createSelection(scores).configurations[model].menu, 'F-RRF10');
  set('F-RRF10', 0.4);
  assert.equal(createSelection(scores).configurations[model].menu, 'F-MM');
  set('F-MM', 0.6);
  scores.runs.find(result => result.run.model === 'openai-3-large' && result.run.config === 'A3').summary.macroRecall12 = 0.6;
  assert.equal(createSelection(scores).nominated.local.model, 'bge-m3');
  assert.equal(createSelection(scores).nominated.hosted.model, 'openai-3-large');
});

test('confirmatory decision table uses strict CI/latency boundaries and observed C1∪C2 query counts', () => {
  const input = { deltaMacro: 5, deltaC3: 10, ciLower: 0.001, regressions: 1, p95: 199.99, context: 'local' };
  assert.equal(decision(input), 'continue');
  assert.equal(decision({ ...input, p95: 200 }), 'inconclusive');
  assert.equal(decision({ ...input, context: 'hosted', p95: 999.99 }), 'continue');
  assert.equal(decision({ ...input, context: 'hosted', p95: 1000 }), 'inconclusive');
  assert.equal(decision({ ...input, ciLower: 0 }), 'inconclusive');
  assert.equal(decision({ ...input, deltaMacro: 3 }), 'inconclusive');
  assert.equal(decision({ ...input, deltaMacro: 2.99 }), 'keep-optional');
  assert.equal(decision({ ...input, regressions: 2 }), 'keep-optional');
  assert.equal(decision({ ...input, enoughFamilies: false }), 'inconclusive');
  assert.equal(decision({ ...input, valid: false }), 'inconclusive');
  const fixture = toyFixture(), base = scoreRuns(fixture, [rankingsFor(fixture)]).runs[0];
  const candidate = structuredClone(base);
  for (const row of candidate.queries.filter(row => ['q-C1-06', 'q-C2-06'].includes(row.id))) { row.recall12 = 0.5; row.allRequired12 = false; }
  const comparison = compareRuns(base, candidate, { resamples: 20 });
  assert.equal(comparison.regressionGuard.count, 2); assert.deepEqual(comparison.regressionGuard.queryIds, ['q-C1-06', 'q-C2-06']);
});

test('reports compare only frozen nominated pairs; model failure is isolated by context', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture)), scores = testScores(fixture, selection);
  const report = buildReport(scores, selection, { resamples: 100, latencies: Object.values(selection.nominated).map(selected => latency(selected, scores)), environment: { cpu: 'synthetic' } });
  assert.equal(report.contexts.local.outcome, 'continue'); assert.equal(report.contexts.hosted.outcome, 'continue');
  assert.equal(report.contexts.local.bootstrap.confidence, 0.975);
  assert.equal(report.contexts.local.deltaMacro, 50); assert.equal(report.contexts.local.deltaC3, 50);
  assert.match(reportMarkdown(report), /97.5% CI/); assert.match(reportMarkdown(report), /McNemar/);
  scores.runs[2].ok = false;
  const failed = buildReport(scores, selection, { resamples: 20, latencies: [latency(selection.nominated.local, scores)] });
  assert.equal(failed.contexts.local.outcome, 'continue'); assert.equal(failed.contexts.hosted.outcome, 'unavailable');
  const saturated = structuredClone(selection); saturated.easeCheck.saturated = true; saturated.status = 'inconclusive'; saturated.reason = 'suite_too_easy_revise_fixture_before_test';
  assert.equal(buildReport(scores, saturated, { resamples: 20 }).contexts.local.outcome, 'inconclusive');
  const changedHash = structuredClone(selection); changedHash.fixtureHashes = { changed: 'hash' };
  assert.throws(() => buildReport(scores, changedHash), /hash_mismatch/);
});

test('too few test families yields inconclusive and reports category counts', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture)), scores = testScores(fixture, selection);
  for (const run of scores.runs) for (const row of run.queries.filter(row => row.category === 'C3')) row.family = 'one';
  const report = buildReport(scores, selection, { resamples: 20 });
  assert.equal(report.contexts.local.outcome, 'inconclusive'); assert.equal(report.contexts.local.bootstrap.familyCounts.C3, 1);
  assert.equal(report.contexts.local.reason, 'too_few_families');
});

test('latency gate requires five complete uncached request passes', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture)), scores = testScores(fixture, selection);
  const timed = latency(selection.nominated.local, scores);
  timed.queryCacheEnabled = true;
  assert.equal(buildReport(scores, selection, { resamples: 20, latencies: [timed] }).contexts.local.outcome, 'inconclusive');
  timed.queryCacheEnabled = false; timed.samples.pop();
  assert.equal(buildReport(scores, selection, { resamples: 20, latencies: [timed] }).contexts.local.latency.reason, 'incomplete_timing_pass');
});

test('W4b bundled latency format is accepted, including cache bypass and nearest-rank percentiles', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture)), scores = testScores(fixture, selection);
  const timed = latency(selection.nominated.local, scores);
  const bundle = { format: 'hr1-latency-v1', fixtureHashes: {}, split: 'test', scale: 'S1000', runs: [{
    arm: selection.nominated.local.arm, model: selection.nominated.local.model, fusion: selection.nominated.local.menu,
    samples: timed.samples, queryCache: 'bypassed', failures: 0, peakRssBytes: 1234, coldLoadMs: 4, threads: 1, device: 'cpu',
  }] };
  const report = buildReport(scores, selection, { resamples: 20, latencies: [bundle] });
  assert.equal(report.contexts.local.outcome, 'continue'); assert.equal(report.contexts.local.latency.peakRss, 1234);
  assert.equal(report.contexts.local.latency.percentileMethod, 'nearest-rank');
  bundle.runs[0].samples[0].error = 'provider request failed';
  assert.equal(buildReport(scores, selection, { resamples: 20, latencies: [bundle] }).contexts.local.outcome, 'inconclusive');
});

test('reports require paired isolation evidence and never rescue a failed nomination with a test winner', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture)), scores = testScores(fixture, selection);
  scores.runs[1].isolation = { status: 'not-checked', ok: null };
  assert.equal(buildReport(scores, selection, { resamples: 20 }).contexts.local.reason, 'foreign_isolation_not_verified');
  scores.runs[1].ok = false;
  const other = scoreRuns(fixture, [rankingsFor(fixture, { arm: 'F-MM', config: 'F-MM', model: 'bge-m3' })]).runs[0];
  scores.runs.push(other);
  const result = buildReport(scores, selection, { resamples: 20 });
  assert.equal(result.contexts.local.outcome, 'inconclusive'); assert.equal(result.contexts.local.reason, 'missing_or_failed_nomination');
  assert.equal(result.exploratory.some(comparison => comparison.candidate.model === 'bge-m3'), true);
});

test('A5 secondary requires +5 pp span-only, at most 2 pp loss body-covered, and nonempty matched strata', () => {
  const stratum = recall => ({ n: 1, macroRecall12: recall, queries: [{ id: 'q1', family: 'f1', category: 'C1', recall12: recall }] });
  const baseline = { strata: { 'fidelity:span-only': stratum(0.4), 'fidelity:body-covered': stratum(0.8) } };
  const candidate = { strata: { 'fidelity:span-only': stratum(0.45), 'fidelity:body-covered': stratum(0.78) } };
  assert.equal(a5Decision(baseline, candidate).outcome, 'review-indexing-retained-spans');
  candidate.strata['fidelity:body-covered'] = stratum(0.779);
  assert.equal(a5Decision(baseline, candidate).outcome, 'threshold-not-met');
  candidate.strata['fidelity:span-only'] = { n: 0, macroRecall12: null };
  assert.equal(a5Decision(baseline, candidate).reason, 'empty_stratum');
});

test('A5-both report uses the frozen local model/config and group-based fidelity denominators', () => {
  const fixture = toyFixture(), selection = createSelection(devScores(fixture));
  const local = selection.nominated.local;
  const inputs = [rankingsFor(fixture, { ...selection.comparator, ranking: halfSupport }),
    rankingsFor(fixture, { ...local, ranking: label => label.groups.flatMap(group => group.members.filter(member => member.namespace === 'target' && member.where === 'body').map(member => member.memory)) }),
    rankingsFor(fixture, { arm: 'A5-both', config: local.menu, model: local.model })];
  const scores = scoreRuns(fixture, inputs, { withoutForeign: inputs });
  const report = buildReport(scores, selection, { resamples: 20 });
  assert.equal(report.a5.outcome, 'review-indexing-retained-spans');
  assert.equal(report.a5.deltaSpanOnly, 100); assert.equal(report.a5.deltaBodyCovered, 0);
  scores.runs[2].run.config = 'F-MM';
  assert.equal(buildReport(scores, selection, { resamples: 20 }).a5.outcome, 'inconclusive');
});

test('selection and report CLIs produce JSON and Markdown with machine metadata', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-report-' }), fixture = toyFixture();
  const dev = devScores(fixture), devPath = join(workspace.path, 'dev.json'), selectionPath = join(workspace.path, 'selection.json');
  await writeJson(devPath, dev);
  const selected = await runCli(workspace, ['evaluation/retrieval-research/report.mjs', '--scores', devPath, '--create-selection', selectionPath]);
  assert.equal(selected.code, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).ok, true);
  const selection = await readJson(selectionPath), scores = testScores(fixture, selection), scorePath = join(workspace.path, 'scores.json');
  await writeJson(scorePath, scores);
  const jsonPath = join(workspace.path, 'report.json'), mdPath = join(workspace.path, 'report.md');
  const result = await runCli(workspace, ['evaluation/retrieval-research/report.mjs', '--scores', scorePath, '--selection', selectionPath, '--out', jsonPath, '--markdown', mdPath]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal((await readJson(jsonPath)).environment.node, process.version);
  assert.match(await readFile(mdPath, 'utf8'), /HR-1 retrieval report/);
  const environment = await reportEnvironment();
  for (const key of ['cpu', 'cores', 'threads', 'ramBytes', 'os', 'node']) assert.equal(Object.hasOwn(environment, key), true);
});
