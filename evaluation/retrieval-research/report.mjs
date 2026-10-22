import { writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import { CATEGORIES, compareIds, readJson, writeJson, cliMain, requiredOption } from './lib/fixture.mjs';
import { average } from './lib/metrics.mjs';
import { clusterBootstrap, exactMcNemar, pairedQueries, familyCounts } from './lib/stats.mjs';

const MENU = ['A3', 'F-RRF60', 'F-RRF10', 'F-MM'];
const CONTEXTS = { local: ['e5-small', 'bge-m3'], hosted: ['openai-3-small', 'openai-3-large'] };
const configName = run => MENU.includes(run.run.config) ? run.run.config : MENU.includes(run.run.arm) ? run.run.arm : null;
const identity = result => ({ arm: result.run.arm, config: result.run.config ?? null, model: result.run.model ?? null });
const matches = (result, selected) => selected && result.run.arm === selected.arm && (result.run.config ?? null) === selected.config && (result.run.model ?? null) === selected.model;
const healthy = result => result.ok && result.summary?.macroRecall12 != null && result.summary.complete;
const scoredRows = result => result.queries.filter(query => CATEGORIES.includes(query.category));
const scoreDifference = (a, b) => Math.abs(a - b) < 1e-12 ? 0 : a - b;
const explicitFailure = result => ['failed', 'unavailable'].includes(result.run.status);
const bodyModelRun = result => result.run.arm === 'A2' || MENU.includes(configName(result)) && !/^A5/.test(result.run.arm);
function modelEvidence(runs, model) {
  const attempted = runs.filter(result => result.run.model === model && bodyModelRun(result));
  const failures = attempted.filter(explicitFailure).map(result => ({ ...identity(result), split: result.run.split, status: result.run.status }));
  const success = attempted.some(result => result.ok && !explicitFailure(result));
  return { status: success ? 'available' : failures.length ? 'failed' : attempted.length ? 'unresolved' : 'missing', failureEvidence: failures };
}
function rejectDiagnosticLabels(scores) {
  if (scores.labelProvenance?.mode === 'diagnostic' || scores.runs.some(result => result.labelProvenance?.mode === 'diagnostic')) throw new Error('diagnostic_labels_not_confirmatory');
}

function onlyOne(runs, predicate, name) {
  const found = runs.filter(predicate);
  if (found.length > 1) throw new Error(`ambiguous_run:${name}`);
  return found[0] ?? null;
}

export function createSelection(scores) {
  if (scores.format !== 'hr1-scores-v1') throw new Error('scores_format');
  rejectDiagnosticLabels(scores);
  // Fail closed on test input: a selection cannot be reconstructed after seeing
  // test quality, even if the caller also supplied dev runs.
  if (scores.runs.some(result => result.run.split !== 'dev')) throw new Error('selection_requires_dev_only');
  const dev = scores.runs.filter(result => result.run.scale === 'S1000');
  const lexical = ['A1', 'A1+'].map(arm => onlyOne(dev, result => result.run.arm === arm && !result.run.model, arm));
  if (lexical.some(result => !result || !healthy(result))) throw new Error('selection_requires_both_lexical_dev_runs');
  const comparator = scoreDifference(lexical[1].summary.macroRecall12, lexical[0].summary.macroRecall12) > 0 ? lexical[1] : lexical[0];
  const configurations = {};
  const modelAvailability = {};
  for (const model of Object.values(CONTEXTS).flat()) {
    const choices = MENU.map(config => onlyOne(dev, result => result.run.model === model && configName(result) === config && !/^A5/.test(result.run.arm), `${model}:${config}`));
    if (choices.some(result => healthy(result ?? {}) && result.run.lexical != null && result.run.lexical !== comparator.run.arm)) throw new Error(`fusion_lexical_comparator_mismatch:${model}`);
    const available = choices.filter(result => result && healthy(result));
    available.sort((a, b) => scoreDifference(b.summary.macroRecall12, a.summary.macroRecall12) || MENU.indexOf(configName(a)) - MENU.indexOf(configName(b)));
    const menuComplete = choices.every(result => result && healthy(result));
    configurations[model] = menuComplete ? { ...identity(available[0]), menu: configName(available[0]), devMacroRecall12: available[0].summary.macroRecall12, menuComplete } : null;
    modelAvailability[model] = { ...modelEvidence(dev, model), available: menuComplete, reason: menuComplete ? null : available.length ? 'incomplete_confirmatory_menu' : 'no_successful_confirmatory_menu' };
  }
  const nominated = Object.fromEntries(Object.entries(CONTEXTS).map(([context, models]) => {
    const choices = models.map(model => configurations[model]).filter(Boolean);
    choices.sort((a, b) => scoreDifference(b.devMacroRecall12, a.devMacroRecall12) || models.indexOf(a.model) - models.indexOf(b.model));
    return [context, choices[0] ?? null];
  }));
  const ease = CATEGORIES.every(category => comparator.summary.categories[category].recall12 >= 0.95);
  const counts = familyCounts(scoredRows(comparator));
  const enoughFamilies = Object.values(counts).every(count => count >= 4);
  return { format: 'hr1-selection-v1', fixtureHashes: scores.fixtureHashes, scale: 'S1000', sourceSplit: 'dev',
    // These fields are consumed directly by W4b's rankings/timing CLIs.
    lexical: comparator.run.arm,
    models: Object.fromEntries(Object.entries(configurations).filter(([, config]) => config).map(([model, config]) => [model, { fusion: config.menu }])),
    contexts: Object.fromEntries(Object.entries(nominated).filter(([, selected]) => selected).map(([context, selected]) => [context, { model: selected.model, fusion: selected.menu }])),
    comparator: { ...identity(comparator), devMacroRecall12: comparator.summary.macroRecall12 }, configurations, modelAvailability, nominated,
    easeCheck: { saturated: ease, categories: Object.fromEntries(CATEGORIES.map(category => [category, comparator.summary.categories[category].recall12])) },
    devFamilyCounts: counts, status: ease ? 'inconclusive' : enoughFamilies ? 'ready' : 'inconclusive',
    reason: ease ? 'suite_too_easy_revise_fixture_before_test' : !enoughFamilies ? 'too_few_dev_families' : null,
    tieOrders: { lexical: ['A1', 'A1+'], configuration: MENU, ...CONTEXTS } };
}

export function decision({ deltaMacro, deltaC3, ciLower, regressions, p95, context, enoughFamilies = true, valid = true }) {
  if (!valid || !enoughFamilies || [deltaMacro, deltaC3, ciLower, regressions].some(value => value == null || !Number.isFinite(value))) return 'inconclusive';
  if (deltaMacro < 3 - 1e-10 || regressions >= 2) return 'keep-optional';
  if (deltaMacro >= 5 - 1e-10 && deltaC3 >= 10 - 1e-10 && ciLower > 0 && regressions <= 1 && Number.isFinite(p95) && p95 < (context === 'local' ? 200 : 1000)) return 'continue';
  return 'inconclusive';
}

export function compareRuns(baseline, candidate, options = {}) {
  const paired = pairedQueries(scoredRows(baseline), scoredRows(candidate));
  const bootstrap = clusterBootstrap(scoredRows(baseline), scoredRows(candidate), options);
  const perCategory = Object.fromEntries(CATEGORIES.map(category => [category, average(paired.filter(row => row.category === category).map(row => row.delta))]));
  return { baseline: identity(baseline), candidate: identity(candidate), deltaMacro: bootstrap.point,
    deltaC3: perCategory.C3 == null ? null : perCategory.C3 * 100,
    categoryDeltas: Object.fromEntries(Object.entries(perCategory).map(([category, value]) => [category, value == null ? null : value * 100])),
    regressionGuard: { count: paired.filter(row => ['C1', 'C2'].includes(row.category) && row.delta < 0).length,
      queryIds: paired.filter(row => ['C1', 'C2'].includes(row.category) && row.delta < 0).map(row => row.id).sort(compareIds) },
    bootstrap, mcnemar: exactMcNemar(scoredRows(baseline), scoredRows(candidate)) };
}

export function a5Decision(baseline, candidate) {
  const values = {};
  for (const stratum of ['span-only', 'body-covered']) {
    const before = baseline?.strata[`fidelity:${stratum}`], after = candidate?.strata[`fidelity:${stratum}`];
    if (!before?.n || !after?.n || before.macroRecall12 == null || after.macroRecall12 == null) return { outcome: 'inconclusive', reason: 'empty_stratum' };
    try { pairedQueries(before.queries, after.queries); }
    catch { return { outcome: 'inconclusive', reason: 'stratum_query_set_mismatch' }; }
    values[stratum] = (after.macroRecall12 - before.macroRecall12) * 100;
  }
  return { outcome: values['span-only'] >= 5 - 1e-10 && values['body-covered'] >= -2 - 1e-10 ? 'review-indexing-retained-spans' : 'threshold-not-met',
    deltaSpanOnly: values['span-only'], deltaBodyCovered: values['body-covered'], unit: 'percentage-points' };
}

function latencyFor(latencies, nomination, queries, hashes) {
  const expanded = latencies.flatMap(record => Array.isArray(record.runs) ? record.runs.map(run => ({ ...run, format: record.format,
    run: { ...run, config: run.fusion ?? run.config ?? run.arm, scale: record.scale, split: record.split }, fixtureHashes: record.fixtureHashes })) : [record]);
  const records = expanded.filter(record => matches({ run: record.run ?? {} }, nomination));
  if (records.length !== 1) return { p95: null, reason: records.length ? 'ambiguous_latency' : 'missing_latency' };
  const record = records[0];
  const timingHashes = record.fixtureHashes ?? record.run?.fixtureHashes ?? {};
  if (JSON.stringify(Object.entries(timingHashes).sort()) !== JSON.stringify(Object.entries(hashes ?? {}).sort())) return { p95: null, reason: 'timing_fixture_hash_mismatch' };
  // Request-level warm observations only: do not treat pass means or cold load
  // as request samples. The harness records cache and pass metadata.
  const samples = record.samples?.filter(sample => sample.warm !== false) ?? [];
  const passes = new Set(samples.map(sample => sample.pass));
  if (record.format !== 'hr1-latency-v1' || record.run?.split !== 'test' || record.run?.scale !== 'S1000' || passes.size !== 5 ||
    samples.some(sample => !Number.isFinite(sample.ms) || sample.ms < 0 || !sample.queryId || sample.error) ||
    !(record.queryCacheEnabled === false || record.queryCache === 'bypassed') || record.error || record.failures) {
    return { p95: null, reason: 'invalid_latency_protocol' };
  }
  const queryIds = [...new Set(samples.map(sample => sample.queryId))];
  if (JSON.stringify([...queryIds].sort(compareIds)) !== JSON.stringify(queries.map(query => query.id).sort(compareIds))) return { p95: null, reason: 'timing_query_set_mismatch' };
  if ([...passes].some(pass => queryIds.some(id => samples.filter(sample => sample.pass === pass && sample.queryId === id).length !== 1))) return { p95: null, reason: 'incomplete_timing_pass' };
  const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b);
  const empirical = p => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
  return { p50: empirical(0.5), p95: empirical(0.95), percentileMethod: 'nearest-rank', requests: samples.length, passes: passes.size,
    coldLoad: record.coldLoadMs ?? record.coldLoad, threads: record.threads, device: record.device, peakRss: record.peakRssBytes ?? record.peakRss };
}

export function buildReport(scores, selection, { latencies = [], seed = 'hr1-bootstrap-v2', resamples = 10000, environment } = {}) {
  if (scores.format !== 'hr1-scores-v1' || selection?.format !== 'hr1-selection-v1') throw new Error('report_formats');
  rejectDiagnosticLabels(scores);
  if (selection.sourceSplit !== 'dev' || selection.scale !== 'S1000' || !['A1', 'A1+'].includes(selection.comparator?.arm) || selection.lexical !== selection.comparator.arm) throw new Error('selection_contract_mismatch');
  for (const [context, nominated] of Object.entries(selection.nominated)) if (nominated &&
    (!CONTEXTS[context]?.includes(nominated.model) || selection.contexts[context]?.model !== nominated.model || selection.contexts[context]?.fusion !== nominated.menu ||
      selection.models[nominated.model]?.fusion !== nominated.menu || !MENU.includes(nominated.menu))) throw new Error(`selection_nomination_mismatch:${context}`);
  if (JSON.stringify(Object.entries(scores.fixtureHashes ?? {}).sort()) !== JSON.stringify(Object.entries(selection.fixtureHashes ?? {}).sort())) throw new Error('selection_fixture_hash_mismatch');
  const test = scores.runs.filter(result => result.run.split === 'test' && result.run.scale === 'S1000');
  const baseline = onlyOne(test, result => matches(result, selection.comparator), 'test_comparator');
  const contexts = {};
  for (const context of Object.keys(CONTEXTS)) {
    const nomination = selection.nominated[context];
    const candidate = onlyOne(test, result => matches(result, nomination), `${context}_nomination`);
    if (selection.status !== 'ready' || selection.easeCheck.saturated) { contexts[context] = { outcome: 'inconclusive', reason: selection.reason ?? 'selection_not_ready' }; continue; }
    const evidence = Object.fromEntries(CONTEXTS[context].map(model => {
      const tested = modelEvidence(test, model), dev = selection.modelAvailability?.[model];
      const fromDev = tested.status === 'missing' && dev?.status === 'failed' && dev.failureEvidence?.some(failure => failure.model === model && ['failed', 'unavailable'].includes(failure.status));
      return [model, fromDev ? { status: 'failed', failureEvidence: dev.failureEvidence } : tested];
    }));
    if (Object.values(evidence).every(model => model.status === 'failed')) {
      contexts[context] = { outcome: 'unavailable', reason: 'both_context_models_explicitly_failed', modelEvidence: evidence }; continue;
    }
    if (!nomination) { contexts[context] = { outcome: 'inconclusive', reason: 'unresolved_nomination', modelEvidence: evidence }; continue; }
    if (!baseline || !healthy(baseline) || !candidate || !healthy(candidate)) {
      contexts[context] = { outcome: 'inconclusive', reason: !baseline || !healthy(baseline) ? 'missing_or_failed_comparator' : 'missing_or_failed_nomination', modelEvidence: evidence };
      continue;
    }
    const comparison = compareRuns(baseline, candidate, { seed, resamples });
    const latency = latencyFor(latencies, nomination, candidate.queries, candidate.run.fixtureHashes);
    const enoughDevFamilies = Object.values(selection.devFamilyCounts).every(count => count >= 4);
    const isolationVerified = baseline.isolation?.ok === true && candidate.isolation?.ok === true;
    const frozenLexical = candidate.run.lexical == null || candidate.run.lexical === selection.comparator.arm;
    contexts[context] = { ...comparison, latency, isolationVerified, modelEvidence: evidence,
      outcome: decision({ deltaMacro: comparison.deltaMacro, deltaC3: comparison.deltaC3, ciLower: comparison.bootstrap.ci?.[0],
        regressions: comparison.regressionGuard.count, p95: latency.p95, context, enoughFamilies: enoughDevFamilies && comparison.bootstrap.status === 'ok', valid: baseline.ok && candidate.ok && isolationVerified && frozenLexical }),
      ...(comparison.bootstrap.status !== 'ok' ? { reason: comparison.bootstrap.reason } : !isolationVerified ? { reason: 'foreign_isolation_not_verified' } : !frozenLexical ? { reason: 'frozen_lexical_comparator_mismatch' } : {}) };
  }
  const local = onlyOne(test, result => matches(result, selection.nominated.local), 'a5_local_comparator');
  const a5 = onlyOne(test, result => result.run.arm === 'A5-both' && result.run.model === selection.nominated.local?.model &&
    (result.run.config === selection.nominated.local?.config || result.run.config === selection.nominated.local?.menu), 'a5_both');
  const secondary = selection.status !== 'ready' || !local?.ok || !a5?.ok || local.isolation?.ok !== true || a5.isolation?.ok !== true ||
    [local, a5].some(result => result.run.lexical != null && result.run.lexical !== selection.comparator.arm) ? { outcome: 'inconclusive', reason: 'missing_valid_frozen_local_pair' } : a5Decision(local, a5);
  const exploratory = [];
  for (const scale of ['S300', 'S1000']) {
    const atScale = scores.runs.filter(result => result.run.split === 'test' && result.run.scale === scale);
    const comparator = onlyOne(atScale, result => matches(result, selection.comparator), `exploratory_comparator_${scale}`);
    if (!comparator?.ok) continue;
    for (const candidate of atScale.filter(result => result !== comparator && result.ok && !/^A0-/.test(result.run.arm))) {
      if (!(scale === 'S1000' && Object.values(selection.nominated).some(nomination => matches(candidate, nomination)))) {
        exploratory.push({ ...compareRuns(comparator, candidate, { seed, resamples, exploratory: true }), scale, label: 'exploratory' });
      }
      for (const [stratum, before] of Object.entries(comparator.strata)) {
        const after = candidate.strata[stratum];
        if (!before.n || !after?.n) continue;
        const categories = CATEGORIES.filter(category => before.categories[category]?.n && after.categories[category]?.n);
        if (!categories.length) continue;
        exploratory.push({ baseline: identity(comparator), candidate: identity(candidate), scale, stratum, label: 'exploratory',
          bootstrap: clusterBootstrap(before.queries, after.queries, { seed, resamples, exploratory: true, categories }) });
      }
    }
  }
  return { format: 'hr1-report-v1', fixtureHashes: scores.fixtureHashes, environment: environment ?? scores.runs[0]?.run.env ?? {}, selection, contexts, a5: secondary, exploratory,
    ok: scores.ok, failures: scores.runs.flatMap(result => result.failures), a0: scores.a0,
    runs: scores.runs.map(result => ({ run: result.run, ok: result.ok, isolation: result.isolation, summary: result.summary, queries: result.queries, strata: result.strata, diagnostics: result.diagnostics, costs: result.costs })),
    conventions: { unit: 'percentage-points', macro: 'equal-category-C1-C7', bootstrap: 'whole-test-families-with-category-redraw',
      percentile: 'linear-interpolation-(n-1)p', spanCount: 'groups-with-any-member-of-count; whole-group-reachability',
      diagnosticScores: 'required channelScores maps; no legacy score fallback' } };
}

export async function reportEnvironment() {
  const cpus = os.cpus();
  let physicalCores = null;
  try {
    const info = await readFile('/proc/cpuinfo', 'utf8');
    const cores = info.trim().split(/\n\n+/).map(block => {
      const physical = block.match(/^physical id\s*:\s*(.+)$/m)?.[1], core = block.match(/^core id\s*:\s*(.+)$/m)?.[1];
      return physical != null && core != null ? `${physical}:${core}` : null;
    });
    if (cores.every(Boolean)) physicalCores = new Set(cores).size;
  } catch { /* Physical core metadata is unavailable on non-Linux hosts. */ }
  return { cpu: cpus[0]?.model ?? null, cores: physicalCores, threads: cpus.length, ramBytes: os.totalmem(),
    os: `${os.type()} ${os.release()} ${os.arch()}`, node: process.version };
}

export function reportMarkdown(report) {
  const lines = ['# HR-1 retrieval report', '', `Environment: ${JSON.stringify(report.environment)}`, '',
    '| Context | Outcome | Δ macro (pp) | Δ C3 (pp) | 97.5% CI (pp) | C1∪C2 losses | Warm p95 (ms) |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: |'];
  const number = value => value == null ? 'unavailable' : Number(value).toFixed(3);
  for (const [context, result] of Object.entries(report.contexts)) lines.push(`| ${context} | ${result.outcome} | ${number(result.deltaMacro)} | ${number(result.deltaC3)} | ${result.bootstrap?.ci?.map(number).join(' – ') ?? result.reason ?? 'unavailable'} | ${result.regressionGuard?.count ?? 'unavailable'} | ${number(result.latency?.p95)} |`);
  lines.push('', `A5 secondary: ${JSON.stringify(report.a5)}`, '', `Run validation: ${report.ok ? 'passed' : 'failed'}.`, '');
  for (const [context, result] of Object.entries(report.contexts)) if (result.bootstrap) {
    lines.push(`## ${context} statistics`, '', `Bootstrap: ${JSON.stringify(result.bootstrap)}`, '', `McNemar: ${JSON.stringify(result.mcnemar)}`, '');
  }
    lines.push('## Exploratory comparisons (95% CIs)', '', ...report.exploratory.map(result => `- ${JSON.stringify({ candidate: result.candidate, scale: result.scale, stratum: result.stratum, deltaMacro: result.deltaMacro, bootstrap: result.bootstrap, mcnemar: result.mcnemar })}`), '',
    '## Run metrics and strata', '', ...report.runs.flatMap(result => [`### ${result.run.arm} / ${result.run.model ?? 'lexical'} / ${result.run.scale} / ${result.run.split}`, '',
      `Summary: ${JSON.stringify(result.summary)}`, '', `Strata: ${JSON.stringify(Object.fromEntries(Object.entries(result.strata).map(([key, value]) => [key, { ...value, queries: undefined }])) )}`, '',
      `Diagnostics: ${JSON.stringify(result.diagnostics)}`, '', `Costs: ${JSON.stringify(result.costs)}`, '']),
    `A0 stores: ${JSON.stringify(report.a0)}`, '', `Failures: ${JSON.stringify(report.failures)}`, '');
  return lines.join('\n');
}

await cliMain(import.meta.url, async options => {
  const scores = await readJson(requiredOption(options, 'scores'));
  if (options['create-selection']) {
    const selection = createSelection(scores);
    await writeJson(options['create-selection'], selection);
    console.log(JSON.stringify({ ok: selection.status === 'ready', status: selection.status, reason: selection.reason }));
    if (selection.status !== 'ready') process.exitCode = 1;
    return;
  }
  const selection = await readJson(requiredOption(options, 'selection'));
  const latencies = options._.length ? await Promise.all(options._.map(readJson)) : [];
  const report = buildReport(scores, selection, { latencies, seed: options.seed, environment: await reportEnvironment() });
  await writeJson(requiredOption(options, 'out'), report);
  await writeFile(requiredOption(options, 'markdown'), reportMarkdown(report));
  console.log(JSON.stringify({ ok: report.ok, contexts: Object.fromEntries(Object.entries(report.contexts).map(([context, result]) => [context, result.outcome])), a5: report.a5 }));
  if (!report.ok) process.exitCode = 1;
});
