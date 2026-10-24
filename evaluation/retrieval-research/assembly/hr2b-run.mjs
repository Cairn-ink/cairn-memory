import { join, resolve } from 'node:path';
import { ARMS, assemble } from './arms.mjs';
import { HR2B, authenticateHR2bFixture, loadHR2bRankings, authenticateHR2bRanking } from './hr2b-profile.mjs';
import { authenticateHostV2, EXTENSION_COMMIT, HOST_V2_LIMITATIONS } from './host-v2.mjs';
import { hostV2Cost } from './cost.mjs';
import { COUNTER_ID } from './counter.mjs';
import { prepareItems } from './units.mjs';
import { implementationIdentity } from './identity.mjs';
import { validateOutputPath, validateOutputPaths, writeOutputJson } from './output-paths.mjs';
import { environment, list, emptyOutput } from './run.mjs';
import { fail, sha256 } from './auth.mjs';
import { requiredOption } from '../lib/fixture.mjs';

export async function runHR2bAssembly(options) {
  const allowed = ['_', 'fixture-dir', 'rankings', 'split', 'scale', 'arms', 'rankings-select', 'budgets', 'overheads', 'overhead-model', 'out'];
  if (Object.keys(options).some(key => !allowed.includes(key)) || options._?.length) fail('unknown_run_option');
  const fixtureDir = requiredOption(options, 'fixture-dir'), dir = requiredOption(options, 'rankings');
  const split = requiredOption(options, 'split'), scale = requiredOption(options, 'scale');
  if (!['dev', 'test'].includes(split) || scale !== 'S1000') fail('invalid_split_or_scale');
  const arms = list(options.arms ?? ARMS.join(','), ARMS, 'arms');
  const selections = list(options['rankings-select'] ?? HR2B.rankings.join(','), HR2B.rankings, 'rankings_select');
  const budgets = list(options.budgets ?? HR2B.budgets.join(','), HR2B.budgets.map(String), 'budgets').map(Number);
  if (options['overhead-model'] !== undefined && options['overhead-model'] !== 'host-v2') fail('invalid_overhead_model');
  if (options['overhead-model'] && options.overheads !== undefined) fail('mutually_exclusive_overhead_options');
  const overheads = options['overhead-model'] ? ['host-v2'] : options.overheads !== undefined ? list(options.overheads, ['0'], 'overheads').map(Number) : [0, 'host-v2'];
  const model = overheads.includes('host-v2') ? authenticateHostV2() : null;
  const out = validateOutputPath(requiredOption(options, 'out'));
  await emptyOutput(out, { create: false });
  const cellPath = (selection, arm, overhead, budget) => join(out, `${arm}--${selection}--O${overhead === 'host-v2' ? `host-v2@${model.implementationCommit}` : overhead}--B${budget}.json`);
  validateOutputPaths(selections.flatMap(selection => arms.flatMap(arm => overheads.flatMap(overhead => budgets.map(budget => cellPath(selection, arm, overhead, budget))))));
  const fixture = await authenticateHR2bFixture(fixtureDir), rankings = await loadHR2bRankings(dir, fixture);
  if (fixture.profile.placement.ok !== true) fail('hr2b_fixture_quota_failure');
  const sources = selections.map(selection => {
    const member = `${split}/${selection}.json`, bytes = rankings.bytes[member], ranking = JSON.parse(bytes);
    const queries = authenticateHR2bRanking(fixture, ranking, { selection, split, scale });
    return { selection, member, ranking, queries, hash: sha256(bytes) };
  });
  const items = prepareItems(fixture.corpus.memories), assembly = await implementationIdentity();
  const protocolProfile = { ...fixture.profile, rankingManifest: rankings.manifest, configuration: rankings.configuration, rankingFreezeHash: rankings.freezeHash };
  const env = environment();
  await emptyOutput(out);
  let cells = 0;
  for (const source of sources) for (const arm of arms) for (const overhead of overheads) for (const budget of budgets) {
    const cell = { format: 'hr2-cell-v1', run: { protocol: HR2B.protocol, protocolCommit: HR2B.protocolCommit,
      fixtureVersion: HR2B.version, protocolProfile, fixturePath: resolve(fixtureDir), rankingsPath: resolve(dir),
      commit: assembly.commit, implementation: { assembly }, fixtureHashes: fixture.hashes, counter: COUNTER_ID, environment: env,
      split, scale, arm, ranking: source.selection, rankingPath: resolve(dir, source.member), rankingMember: source.member,
      rankingHash: source.hash, rankingRun: source.ranking.run, overhead, budget, status: 'complete',
      ...(overhead === 'host-v2' ? { overheadModel: model, extensionCommit: EXTENSION_COMMIT, limitations: HOST_V2_LIMITATIONS } : {}) },
    queries: source.queries.map(query => {
      const ranked = source.ranking.queries[query.id].ranked;
      return { id: query.id, ranked, ...assemble(items, ranked, { arm, budget, overhead, diagnostics: true,
        ...(overhead === 'host-v2' ? { cost: hostV2Cost(model) } : {}) }) };
    }) };
    await writeOutputJson(cellPath(source.selection, arm, overhead, budget), cell); cells++;
  }
  return { ok: true, split, cells, expectedCells: arms.length * selections.length * overheads.length * budgets.length,
    grid: { arms, rankings: selections, overheads, budgets }, queriesPerCell: sources[0].queries.length };
}
