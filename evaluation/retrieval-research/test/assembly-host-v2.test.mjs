import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';
import { ARMS, assemble } from '../assembly/arms.mjs';
import { scalarCost, hostV2Cost } from '../assembly/cost.mjs';
import { authenticateHostV2, HOST_V2_SHA256, EXTENSION_COMMIT } from '../assembly/host-v2.mjs';
import { scoreCell } from '../assembly/score.mjs';
import { validateScoredCell, FROZEN_INPUTS } from '../assembly/provenance.mjs';
import { compareCells, buildReport, reportMarkdown, budgetSaturation } from '../assembly/report.mjs';
import { runAssembly } from '../assembly/run.mjs';
import { BUDGETS, expectedCellCount } from '../assembly/grid.mjs';
import { PROTOCOL, PROTOCOL_COMMIT, FILES, RANKINGS } from '../assembly/auth.mjs';
import { COUNTER_ID } from '../assembly/counter.mjs';
import { prepareItems } from '../assembly/units.mjs';

const model = authenticateHostV2(), cost = hostV2Cost(model);
const unit = (id, tokens, text = id) => ({ id, tokens, text });
const items = [
  { id: 'a', body: unit('a#body', 4, 'alpha'), spans: [unit('a#concrete', 6), unit('a#alias', 4, 'alpha')] },
  { id: 'b', body: unit('b#body', 3), spans: [unit('b#span', 3)] },
  { id: 'c', body: unit('c#body', 2), spans: [] },
];
const ranked = ['a', 'b', 'c'];
const a = ['a#body', 62], ac = ['a#concrete', 13], aa = ['a#alias', 10], b = ['b#body', 60], bs = ['b#span', 10], c = ['c#body', 59];
const cases = {
  43: Object.fromEntries(ARMS.map(arm => [arm, []])),
  104: Object.fromEntries(ARMS.map(arm => [arm, [['b#body', 61]]])),
  128: { 'P-top': [a, ac, aa], 'P-top-s1': [a, ac], 'P-cover': [a, ac, aa], 'P-cover-s1': [a, ac], 'P-top+tail': [a, ac, aa] },
  165: { 'P-top': [a, ac, aa], 'P-top-s1': [a, ac], 'P-cover': [a, b], 'P-cover-s1': [a, b], 'P-top+tail': [a, ac, aa] },
  188: { 'P-top': [a, ac, aa, b], 'P-top-s1': [a, ac, b, bs], 'P-cover': [a, b, ac, aa], 'P-cover-s1': [a, b, ac, bs], 'P-top+tail': [a, ac, aa, b] },
  257: { 'P-top': [a, ac, aa, b, bs, c], 'P-top-s1': [a, ac, b, bs, c], 'P-cover': [a, b, c, ac, aa, bs], 'P-cover-s1': [a, b, c, ac, bs], 'P-top+tail': [a, ac, aa, b, bs, c] },
};
for (const [budget, expected] of Object.entries(cases)) for (const arm of ARMS) test(`host-v2 ${arm}, hand-computed B=${budget}`, () => {
  const result = assemble(items, ranked, { arm, budget: Number(budget), cost });
  assert.deepEqual(result.admitted.map(unit => [unit.id, unit.cost]), expected[arm]);
  assert.equal(result.used, 43 + expected[arm].reduce((sum, [, value]) => sum + value, 0));
  assert.equal(result.bodyEqualSpanCount, expected[arm].filter(([id]) => id === 'a#alias').length);
  assert.equal(result.budgetRejected, Number(budget) < 257);
});

test('host-v2 envelope refusal and rejected first-body trials preserve h1 in every arm', () => {
  const oversized = [{ id: 'x', body: unit('x#body', 100), spans: [unit('x#span', 0)] }, items[1]];
  for (const arm of ARMS) {
    assert.throws(() => assemble(items, ranked, { arm, budget: 42, cost }), /context_item_too_large/);
    assert.deepEqual(assemble([], [], { arm, budget: 43, cost }), { admitted: [], used: 43, budgetRejected: false, bodyEqualSpanCount: 0 });
    assert.equal(assemble(oversized, ['x', 'b'], { arm, budget: 103, cost }).used, 43);
    assert.equal(assemble(oversized, ['x', 'b'], { arm, budget: 104, cost }).admitted[0].cost, 61);
  }
});

test('host-v2 bundles are tentative, exact-fit atomic, and never resume after tail begins', () => {
  for (const [budget, expected] of [[105, [a]], [127, [a]], [128, [a, ac, aa]]]) {
    const actual = assemble(items, ranked, { arm: 'P-top+tail', budget, cost });
    assert.deepEqual(actual.admitted.map(unit => [unit.id, unit.cost]), expected);
  }
  const tail = assemble(items, ranked, { arm: 'P-top+tail', budget: 224, cost });
  assert.deepEqual(tail.admitted.map(unit => unit.id), ['a#body', 'a#concrete', 'a#alias', 'b#body', 'b#span']);
  // A failed first bundle must not charge hN when its body-only tail is tried.
  assert.equal(assemble(items, ['a'], { arm: 'P-top+tail', budget: 105, cost }).used, 105);
  const failed = [{ ...items[0], spans: [unit('a#huge', 100)] }, items[1]];
  const neverResume = assemble(failed, ['a', 'b'], { arm: 'P-top+tail', budget: 180, cost });
  assert.deepEqual(neverResume.admitted.map(unit => [unit.id, unit.cost]), [a, b]);
  assert.equal(neverResume.used, 165); // b's whole bundle would fit after a's failed bundle.
});

// Independent frozen scalar schedule, deliberately unaware of cost models.
function frozenScalar(items, ranking, { arm, budget, overhead }) {
  const byId = new Map(items.map(item => [item.id, item])), ordered = ranking.map(id => byId.get(id));
  let used = 0;
  const admitted = [], bodies = new Set();
  function visit(unit) {
    const value = unit.tokens + overhead;
    if (used + value <= budget) { admitted.push({ id: unit.id, tokens: unit.tokens, cost: value }); used += value; bodies.add(unit.id); }
  }
  if (arm === 'P-top+tail') {
    let tail = false;
    for (const item of ordered) {
      const units = [item.body, ...item.spans];
      tail ||= units.reduce((sum, unit) => sum + unit.tokens + overhead, 0) > budget - used;
      if (tail) visit(item.body); else units.forEach(visit);
    }
  } else {
    const deepen = item => { if (bodies.has(item.body.id)) (arm.endsWith('-s1') ? item.spans.slice(0, 1) : item.spans).forEach(visit); };
    if (arm.startsWith('P-cover')) { ordered.forEach(item => visit(item.body)); ordered.forEach(deepen); }
    else ordered.forEach(item => { visit(item.body); deepen(item); });
  }
  return { admitted, used };
}
test('scalar cost abstraction is byte-identical to the frozen scalar algorithm', () => {
  for (const arm of ARMS) for (const overhead of [0, 8]) for (let budget = 0; budget <= 100; budget++) {
    const options = { arm, budget, overhead }, expected = JSON.stringify(frozenScalar(items, ['b', 'a', 'c'], options));
    assert.equal(JSON.stringify(assemble(items, ['b', 'a', 'c'], options)), expected);
    assert.equal(JSON.stringify(assemble(items, ['b', 'a', 'c'], { arm, budget, cost: scalarCost(overhead) })), expected);
  }
  // Preserve the old tail behavior even when a rejected bundle's sum exceeds
  // the safe-integer range, or an unvisited span's surcharge would overflow.
  for (const overhead of [0, 8]) {
    const large = [{ id: 'x', body: unit('x#body', 1), spans: [unit('x#span', Number.MAX_SAFE_INTEGER)] }];
    const options = { arm: 'P-top+tail', budget: Number.MAX_SAFE_INTEGER, overhead };
    assert.equal(JSON.stringify(assemble(large, ['x'], options)), JSON.stringify(frozenScalar(large, ['x'], options)));
  }
});

function example(arm = 'P-top', budget = 128, overhead = 'host-v2') {
  const memories = [{ id: 'a', content: 'hello', spans: [{ id: 'a#alias', text: 'hello' }, { id: 'a#concrete', text: 'world' }] },
    { id: 'b', content: 'hello world', spans: [{ id: 'b#alias', text: 'hello world' }] }];
  const queries = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, family: `f${i}`, category: `C${i + 1}`, lang: 'en', intent: 'current',
    groups: ['a', 'b'].map(memory => ({ members: [{ memory, where: 'body', spans: [], namespace: 'target', scale: 'S300' }] })) }));
  const fixture = { hashes: Object.fromEntries(FILES.map(name => [name, 'f'.repeat(64)])), corpus: { memories }, queries: { queries },
    split: Object.fromEntries(queries.map(query => [query.family, 'dev'])), labels: { queries: queries.map(query => ({ ...query, split: 'dev' })) } };
  const implementation = { format: 'hr2-implementation-v1', commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), sourceFiles: ['arms.mjs'], dirty: false, detached: true };
  const run = { protocol: PROTOCOL, protocolCommit: PROTOCOL_COMMIT, counter: COUNTER_ID, status: 'complete', commit: implementation.commit,
    implementation: { assembly: implementation }, fixtureHashes: fixture.hashes, arm, ranking: 'A1', split: 'dev', scale: 'S1000', budget, overhead,
    rankingHash: 'c'.repeat(64), rankingMember: RANKINGS.A1.dev,
    rankingRun: { ...RANKINGS.A1, split: 'dev', scale: 'S1000', status: 'complete', fixtureHashes: fixture.hashes },
    ...(overhead === 'host-v2' ? { overheadModel: structuredClone(model), extensionCommit: EXTENSION_COMMIT } : {}) };
  const prepared = prepareItems(memories);
  const cell = { format: 'hr2-cell-v1', run, queries: queries.map(query => ({ id: query.id, ranked: ['a', 'b'],
    ...assemble(prepared, ['a', 'b'], { arm, budget, ...(overhead === 'host-v2' ? { cost } : { overhead }) }) })) };
  return { fixture, cell };
}

test('host scorer records authenticated digest, alias counts, envelope totals and budget-rejected queries', () => {
  const { fixture, cell } = example(), scored = scoreCell(fixture, cell);
  validateScoredCell(scored);
  assert.equal(scored.run.overheadModelDigest, HOST_V2_SHA256);
  assert.equal(scored.bodyEqualSpanCount, 7); assert.equal(scored.rankedBodyEqualSpanCount, 14);
  assert.equal(scored.budgetRejectedQueryCount, 7);
  assert.deepEqual(scored.queries[0].admitted.map(unit => unit.cost), [59, 10, 8]);
  assert.equal(scored.queries[0].used, 120);
  assert.equal(scored.queries[0].coverage, 0.5);
});

test('evidence ceiling attainment remains separate from budget-rejected scheduled units', () => {
  const { fixture, cell } = example('P-top', 192);
  fixture.corpus.memories[0].spans.push({ id: 'a#irrelevant', text: 'x '.repeat(1000) });
  for (const row of cell.queries) Object.assign(row, assemble(prepareItems(fixture.corpus.memories), row.ranked, { arm: 'P-top', budget: 192, cost }));
  const scored = scoreCell(fixture, cell);
  assert.equal(scored.summary.macroAssemblyLoss, 0);
  assert.equal(scored.budgetRejectedQueryCount, 7);
});

test('host report replay refuses malformed or retokenized cost inputs explicitly', () => {
  for (const mutate of [
    cell => { cell.assemblyItems[0] = null; },
    cell => { cell.assemblyItems[0].spans[0] = null; },
    cell => { cell.assemblyItems[0].body.tokens++; },
    cell => { cell.assemblyItems[0].body.text = 'different body'; },
  ]) {
    const { fixture, cell } = example(), scored = scoreCell(fixture, cell);
    mutate(scored);
    assert.throws(() => validateScoredCell(scored), /^Error: invalid_host_v2_cost_inputs$/);
  }
});

const corruptions = [
  ['altered constant', run => { run.overheadModel.constants.hN++; }],
  ['altered unused constant', run => { run.overheadModel.constants.T2++; }],
  ['extra constant', run => { run.overheadModel.constants.extra = 0; }],
  ['missing constant', run => { delete run.overheadModel.constants.T0; }],
  ['bodyTokens', run => { run.overheadModel.bodyTokens++; }],
  ['wrong sha256', run => { run.overheadModel.sha256 = '0'.repeat(64); }],
  ['wrong implementation commit', run => { run.overheadModel.implementationCommit = '00000000'; }],
  ['unknown model id', run => { run.overheadModel.id = 'host-v3'; }],
  ['wrong extension freeze', run => { run.extensionCommit = '42627f60'; }],
  ['inconsistent digest', run => { run.overheadModelDigest = null; }],
  ['unknown overhead', run => { run.overhead = 'host-v3'; }],
  ['numeric overhead with host model', run => { run.overhead = 0; }],
];
for (const [name, mutate] of corruptions) test(`host authentication refuses ${name} in scorer and provenance`, () => {
  const { fixture, cell } = example(), scored = scoreCell(fixture, cell);
  mutate(cell.run); mutate(scored.run);
  assert.throws(() => scoreCell(fixture, cell), /invalid_(host_v2_model|cell_run)/);
  assert.throws(() => validateScoredCell(scored), /invalid_(host_v2_model|scored_cell_provenance)/);
});
test('host constants authentication checks exact bytes, and numeric cells cannot masquerade as host cells', async () => {
  const bytes = await readFile(new URL('../assembly/overhead-host-v2.json', import.meta.url));
  assert.throws(() => authenticateHostV2(Buffer.concat([bytes, Buffer.from(' ')])), /host_v2_constants_hash/);
  const { fixture, cell } = example('P-top', 128, 0);
  cell.run.overhead = 'host-v2';
  assert.throws(() => scoreCell(fixture, cell), /invalid_host_v2_model/);
});
test('host replay refuses omissions, reordering, cost, total and diagnostic tampering', () => {
  for (const mutate of [
    cell => { cell.queries[0].admitted.pop(); cell.queries[0].used -= 8; },
    cell => { cell.queries[0].admitted.reverse(); },
    cell => { cell.queries[0].admitted[0].cost--; cell.queries[0].used--; },
    cell => { cell.queries[0].used--; },
    cell => { cell.queries[0].budgetRejected = false; },
    cell => { cell.queries[0].bodyEqualSpanCount++; },
  ]) {
    const { fixture, cell } = example(), scored = scoreCell(fixture, structuredClone(cell));
    mutate(cell); mutate(scored);
    assert.throws(() => scoreCell(fixture, cell), /cell_(assembly_replay_mismatch|unit_cost_or_id|total_cost)/);
    assert.throws(() => validateScoredCell(scored), /cell_assembly_replay_mismatch/);
  }
  const { fixture, cell } = example(), scored = scoreCell(fixture, cell);
  scored.bodyEqualSpanCount++;
  assert.throws(() => validateScoredCell(scored), /invalid_host_v2_diagnostics/);
});
test('legacy scalar cost tampering retains the frozen refusal code', () => {
  for (const overhead of [0, 8]) {
    const { fixture, cell } = example('P-top', 128, overhead);
    cell.queries[0].admitted[0].cost++; cell.queries[0].used++;
    assert.throws(() => scoreCell(fixture, cell), /^Error: cell_unit_cost_or_id$/);
  }
});

test('host comparisons refuse mixed models and different digests; primary selector ignores host-v2', () => {
  const host = example(), numeric = example('P-cover', 128, 0), candidate = example('P-cover');
  const baseline = scoreCell(host.fixture, host.cell), legacy = scoreCell(numeric.fixture, numeric.cell), after = scoreCell(candidate.fixture, candidate.cell);
  assert.equal(compareCells(baseline, legacy).bootstrap.error, 'invalid_comparison_cells');
  assert.equal(compareCells(legacy, baseline).bootstrap.error, 'invalid_comparison_cells');
  const wrong = structuredClone(after); wrong.run.overheadModelDigest = '0'.repeat(64);
  assert.equal(compareCells(baseline, wrong).bootstrap.error, 'invalid_comparison_cells');
  assert.throws(() => validateScoredCell(wrong), /invalid_host_v2_model/);
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: [baseline, after] });
  assert.equal(report.ok, true); assert.equal(report.outcomeReason, 'primary_cell_absent');
  assert.equal(report.comparisons[0].designation, 'exploratory');
  assert.equal(report.comparisons[0].intervalLabel, 'pointwise, unadjusted, exploratory 95% CI');
  // Synthetic scored metadata at the otherwise-primary coordinates; no test assembly.
  for (const cell of [baseline, after]) {
    Object.assign(cell.run, { split: 'test', ranking: 'A3--bge-m3', budget: 512,
      fixtureHashes: structuredClone(FROZEN_INPUTS.fixtureHashes), rankingMember: RANKINGS['A3--bge-m3'].member,
      rankingHash: FROZEN_INPUTS.members[RANKINGS['A3--bge-m3'].member] });
    cell.run.rankingRun = { ...cell.run.rankingRun, ...RANKINGS['A3--bge-m3'], split: 'test', fixtureHashes: cell.run.fixtureHashes };
    // The larger budget changes admissions; retain a deterministic empty ranking.
    cell.assemblyItems = [];
    for (const row of cell.queries) Object.assign(row, { ranked: [], ...assemble([], [], { arm: cell.run.arm, budget: 512, cost }) });
    cell.bodyEqualSpanCount = 0; cell.rankedBodyEqualSpanCount = 0; cell.budgetRejectedQueryCount = 0;
  }
  const atPrimary = buildReport({ format: 'hr2-scores-v1', ok: true, cells: [baseline, after] });
  assert.equal(atPrimary.ok, true); assert.equal(atPrimary.outcomeReason, 'primary_cell_absent');
  assert.equal(atPrimary.comparisons[0].designation, 'exploratory');
});

test('host full toy grid reports 48 exploratory contrasts, macro table, saturation and rejection counts', () => {
  const scored = Object.keys(RANKINGS).flatMap(ranking => BUDGETS.flatMap(budget => ARMS.map(arm => {
    const { fixture, cell } = example(arm, budget);
    cell.run.ranking = ranking; cell.run.rankingMember = RANKINGS[ranking].dev;
    cell.run.rankingRun = { ...cell.run.rankingRun, ...RANKINGS[ranking] };
    return scoreCell(fixture, cell);
  })));
  const report = buildReport({ format: 'hr2-scores-v1', ok: true, cells: scored });
  assert.equal(report.ok, true); assert.equal(report.comparisons.length, 48); assert.equal(report.hostV2.contrastCount, 48);
  assert.ok(report.comparisons.every(row => row.designation === 'exploratory' && row.bootstrap.requested === 10000 && row.bootstrap.seed === 'hr2-bootstrap-v1'));
  assert.equal(report.hostV2.macroCoverage.length, 15);
  assert.deepEqual(report.hostV2.saturation.map(row => row.budget), [192, 192, 192]);
  assert.equal(report.hostV2.cells.find(row => row.budget === 128).budgetRejectedQueryCount, 7);
  assert.equal(report.hostV2.cells.find(row => row.budget === 192).budgetRejectedQueryCount, 0);
  assert.match(reportMarkdown(report), /need not give monotone coverage/);
  assert.match(reportMarkdown(report), /Reaching the evidence ceiling does not mean every candidate unit fits/);
  // Saturation requires the entire suffix, not the first isolated zero-loss point.
  const ranking = scored.filter(cell => cell.run.ranking === 'A1');
  ranking.find(cell => cell.run.budget === 384).queries[0].assemblyLoss = 0.5;
  assert.equal(budgetSaturation(ranking).budget, 512);
  ranking.find(cell => cell.run.budget === 1536).queries[0].assemblyLoss = 0.5;
  assert.equal(budgetSaturation(ranking).label, 'not reached through 1,536');
  assert.equal(budgetSaturation(ranking.slice(1)).status, 'incomplete_grid');
});

test('host CLI selection is exclusive and its grid count is 120', async () => {
  await assert.rejects(runAssembly({ 'overhead-model': 'unknown' }), /invalid_overhead_model/);
  await assert.rejects(runAssembly({ 'overhead-model': 'host-v2', overheads: '0' }), /mutually_exclusive_overhead_options/);
  await assert.rejects(runAssembly({ 'overhead-model': 'host-v2', 'fixture-dir': '/not-read', rankings: '/not-read', split: 'dev', scale: 'S1000', budgets: '42', out: '/not-created' }), /context_item_too_large/);
  assert.equal(expectedCellCount({ arms: ARMS, rankings: Object.keys(RANKINGS), overheads: ['host-v2'], budgets: BUDGETS }), 120);
});

test('dev host-v2 CLI pipeline authenticates existing dev rankings into owned scratch only', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-host-v2-dev-' });
  const run = await runCli(workspace, ['evaluation/retrieval-research/assembly/run.mjs', '--fixture-dir', 'evaluation/retrieval-research/fixtures',
    '--rankings', 'evaluation/retrieval-research/results/dev', '--split', 'dev', '--scale', 'S1000', '--arms', 'P-top,P-cover,P-top-s1',
    '--rankings-select', 'A1', '--budgets', '128', '--overhead-model', 'host-v2', '--out', join(workspace.path, 'cells')]);
  assert.equal(run.code, 0, run.stderr); assert.equal(JSON.parse(run.stdout).cells, 3);
  const names = await readdir(join(workspace.path, 'cells'));
  assert.ok(names.every(name => name.includes('--Ohost-v2@42627f60--')));
  const cell = JSON.parse(await readFile(join(workspace.path, 'cells', names[0]), 'utf8'));
  assert.equal(cell.run.overhead, 'host-v2'); assert.deepEqual(cell.run.overheadModel, model);
  assert.equal(cell.run.extensionCommit, '4fb90832'); assert.equal(cell.run.protocolCommit, PROTOCOL_COMMIT);
  const scored = await runCli(workspace, ['evaluation/retrieval-research/assembly/score.mjs', '--fixture-dir', 'evaluation/retrieval-research/fixtures',
    '--cells', join(workspace.path, 'cells'), '--out', join(workspace.path, 'scores.json')]);
  assert.equal(scored.code, 0, scored.stderr);
  const reported = await runCli(workspace, ['evaluation/retrieval-research/assembly/report.mjs', '--scores', join(workspace.path, 'scores.json'),
    '--out', join(workspace.path, 'report.json'), '--markdown', join(workspace.path, 'report.md')]);
  assert.equal(reported.code, 0, reported.stderr);
  const report = JSON.parse(await readFile(join(workspace.path, 'report.json'), 'utf8'));
  assert.equal(report.hostV2.contrastCount, 2); assert.equal(report.outcomeReason, 'primary_cell_absent');
  t.diagnostic(`dev-only smoke: 3 cells, assembly exit ${run.code}, scoring exit ${scored.code}, reporting exit ${reported.code}; scratch ${workspace.path}`);
});
