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
import { buildReport, reportMarkdown } from '../assembly/report.mjs';
import { validateScoredCell } from '../assembly/provenance.mjs';
import { decisionHR2b, primaryHR2b, compareHR2bCells } from '../assembly/hr2b-report.mjs';
import { calibration } from '../assembly/calibrate-host-v2.mjs';
import { serializeRepresentationV2 } from '../assembly/representation-v2.mjs';
import { authenticateHostV2 } from '../assembly/host-v2.mjs';
import { countTokens } from '../assembly/counter.mjs';
import { validateOutputPath, validateOutputPaths } from '../assembly/output-paths.mjs';
import { sourceIdentity } from '../assembly/identity.mjs';

const compare = (point, ci, status = 'ok') => ({ status, bootstrap: { status, point, ci } });
test('HR-2b primary selector and every §4 decision outcome and Inconclusive gate', () => {
  const gates = { quotasOK: true, guardCeiling: .1 }, main = compare(3, [.01, 6]), guard = compare(-3, [-5, -1]);
  assert.equal(decisionHR2b(main, guard, gates), 'adopt');
  assert.equal(decisionHR2b(compare(0, [-2, 2.99]), guard, gates), 'keep');
  assert.equal(decisionHR2b(main, compare(-7, [-9, -5.01]), gates), 'keep');
  for (const [p, g, gate] of [
    [compare(2.99, [1, 4]), guard, gates], [compare(3, [0, 6]), guard, gates],
    [compare(0, [-2, 3]), guard, gates], [main, compare(-4, [-5.01, -1]), gates],
    [compare(1, [-2, 4]), guard, gates], [main, guard, { ...gates, quotasOK: false }],
    [main, guard, { ...gates, guardCeiling: 0 }], [main, guard, { ...gates, guardCeiling: null }],
    [compare(3, [1, 6], 'inconclusive'), guard, gates], [main, compare(-1, [-2, 0], 'inconclusive'), gates],
    [null, guard, gates], [main, null, gates], [compare(NaN, [0, 1]), guard, gates],
    [main, compare(-1, [null, 0]), gates], [compare(3, [4, 1]), guard, gates],
  ]) assert.equal(decisionHR2b(p, g, gate), 'inconclusive');
  const run = { split: 'test', scale: 'S1000', ranking: 'A3--bge-m3', overhead: 'host-v2', budget: 1500 };
  assert.equal(primaryHR2b(run), true);
  for (const change of [{ split: 'dev' }, { scale: 'S300' }, { ranking: 'A1' }, { overhead: 0 }, { budget: 1000 }]) assert.equal(primaryHR2b({ ...run, ...change }), false);
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
  assert.throws(() => calibration({ counts: [7] }), /invalid_probe_grid/);
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
  assert.deepEqual(authenticated.profile.budgets, [1000, 1500, 2000, 4000]); assert.equal(authenticated.profile.protocolCommit, 'c546bfc1');
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
  assert.deepEqual(contrast.bootstrap.ci, [-100, -100]);
  const report = buildReport(scores);
  assert.equal(report.ok, true); assert.equal(report.outcome, 'inconclusive'); assert.equal(report.outcomeReason, 'primary_cell_absent');
  assert.match(reportMarkdown(report), /later-receipt/);
  assert.equal(buildReport({ ...scores, cells: [...scores.cells, { ...scores.cells[0], run: { ...scores.cells[0].run, fixtureVersion: 'hr1-fixture-v2', protocol: 'HR-2 v1.1' } }] }).ok, false);
  const names = await readdir(config.out), raw = JSON.parse(await readFile(join(config.out, names[0])));
  assert.throws(() => scoreCell({ ...fixture, corpus: { ...fixture.corpus, version: 'hr1-fixture-v2' } }, raw), /mixed_fixture_profiles/);
  const bad = structuredClone(raw); bad.run.budget = 1536;
  assert.throws(() => scoreCell(fixture, bad), /invalid_hr2b_cell_run/);
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
  assert.throws(() => { FIXTURE_PROFILES[HR2B_VERSION].quotas.groups = 1; }, TypeError);
  assert.throws(() => { HR2B.primary.budget = 1; }, TypeError);
  assert.deepEqual(HR2B.quotas, FIXTURE_PROFILES[HR2B_VERSION].quotas);
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-profile-snapshot-' }), { dir } = await hr2bToy(workspace);
  const first = await authenticateHR2bFixture(dir); first.profile.primary.budget = 1; first.profile.quotas.groups = 1;
  const returned = await profileForDirectory(dir); returned.budgets[0] = 1;
  assert.equal((await authenticateHR2bFixture(dir)).profile.primary.budget, 1500);
  assert.equal((await authenticateHR2bFixture(dir)).profile.quotas.groups, 30);
  assert.deepEqual((await profileForDirectory(dir)).budgets, [1000, 1500, 2000, 4000]);
});
