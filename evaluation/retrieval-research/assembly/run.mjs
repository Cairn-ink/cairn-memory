import { mkdir, readdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { cliMain, requiredOption, writeJson } from '../lib/fixture.mjs';
import { ARMS, assemble } from './arms.mjs';
import { COUNTER_ID } from './counter.mjs';
import { prepareItems } from './units.mjs';
import { PROTOCOL, PROTOCOL_COMMIT, RANKINGS, authenticateFixture, authenticateRanking, readRanking, inputManifest, fail } from './auth.mjs';

export const BUDGETS = Object.freeze([128, 192, 256, 384, 512, 768, 1024, 1536]);
async function implementationCommit() {
  const workspace = createTestWorkspace(null, { prefix: 'hr2-commit-' });
  let output;
  try {
    const path = join(workspace.path, 'commit');
    output = await open(path, 'w');
    const child = spawn('git', ['rev-parse', 'HEAD'], { cwd: new URL('../../../', import.meta.url), stdio: ['ignore', output.fd, 'inherit'] });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0) fail(`implementation_commit_exit:${code}`);
    const commit = (await readFile(path, 'utf8')).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) fail('implementation_commit_invalid');
    return commit;
  } finally { await output?.close(); await workspace.cleanup(); }
}
export function environment() {
  return { node: process.version, cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length,
    ramBytes: os.totalmem(), platform: os.platform(), os: os.release(), arch: os.arch() };
}
export function list(value, allowed, name) {
  const result = value.split(',');
  if (!result.length || new Set(result).size !== result.length || result.some(entry => !allowed.includes(entry))) fail(`invalid_${name}`);
  return result;
}
export async function emptyOutput(dir) {
  await mkdir(dir, { recursive: true });
  if ((await readdir(dir)).length) fail('output_directory_not_empty');
}
export async function runAssembly(options) {
  const allowed = ['_', 'fixture-dir', 'rankings', 'split', 'scale', 'arms', 'rankings-select', 'budgets', 'overheads', 'out'];
  if (Object.keys(options).some(key => !allowed.includes(key)) || options._?.length) fail('unknown_run_option');
  const fixtureDir = requiredOption(options, 'fixture-dir'), dir = requiredOption(options, 'rankings');
  const split = requiredOption(options, 'split'), scale = requiredOption(options, 'scale');
  if (!['dev', 'test'].includes(split) || scale !== 'S1000') fail('invalid_split_or_scale');
  const arms = list(options.arms ?? ARMS.join(','), ARMS, 'arms');
  const selections = list(options['rankings-select'] ?? Object.keys(RANKINGS).join(','), Object.keys(RANKINGS), 'rankings_select');
  const budgets = list(options.budgets ?? BUDGETS.join(','), BUDGETS.map(String), 'budgets').map(Number);
  const overheads = list(options.overheads ?? '0,8', ['0', '8'], 'overheads').map(Number);
  const out = requiredOption(options, 'out'), fixture = await authenticateFixture(fixtureDir);
  if (split === 'test') {
    const manifest = await inputManifest();
    for (const [name, hash] of Object.entries(manifest.fixtureHashes)) if (fixture.hashes[name] !== hash) fail(`hr2_fixture_hash_mismatch:${name}`);
  }
  const sources = [];
  for (const selection of selections) {
    const source = await readRanking(dir, selection, split);
    const queries = authenticateRanking(fixture, source.ranking, { selection, split, scale });
    sources.push({ ...source, selection, queries });
  }
  const items = prepareItems(fixture.corpus.memories);
  const commit = await implementationCommit();
  const env = environment();
  await emptyOutput(out);
  let cells = 0;
  for (const source of sources) for (const arm of arms) for (const overhead of overheads) for (const budget of budgets) {
    const cell = { format: 'hr2-cell-v1', run: { protocol: PROTOCOL, protocolCommit: PROTOCOL_COMMIT, commit, fixtureHashes: fixture.hashes,
      counter: COUNTER_ID, environment: env, split, scale, arm, ranking: source.selection, rankingPath: resolve(source.path),
      rankingMember: source.member, rankingHash: source.hash, rankingRun: source.ranking.run, overhead, budget, status: 'complete' },
    queries: source.queries.map(query => {
      const ranked = source.ranking.queries[query.id].ranked;
      return { id: query.id, ranked, ...assemble(items, ranked, { arm, budget, overhead }) };
    }) };
    await writeJson(join(out, `${arm}--${source.selection}--O${overhead}--B${budget}.json`), cell); cells++;
  }
  return { ok: true, split, cells, queriesPerCell: sources[0].queries.length };
}

await cliMain(import.meta.url, async options => { console.log(JSON.stringify(await runAssembly(options))); });
