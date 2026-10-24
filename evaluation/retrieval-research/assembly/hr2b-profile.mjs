import { placementQuotas } from '../lib/placement.mjs';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { HR2B_VERSION } from '../lib/fixture.mjs';
import { checkHR2bConfiguration, equal } from '../lib/hr2b-configuration.mjs';
import { FILES, authenticateRanking, selectedQueries, sha256, fail } from './auth.mjs';

export const HR2B = Object.freeze({ version: HR2B_VERSION, protocol: 'HR-2b v1', protocolCommit: 'c546bfc1',
  budgets: [1000, 1500, 2000, 4000], seed: 'hr2b-bootstrap-v1', rankings: ['A1', 'A3--bge-m3'],
  strata: ['fidelity', 'language', 'category', 'placement'],
  primary: { split: 'test', scale: 'S1000', ranking: 'A3--bge-m3', overhead: 'host-v2', budget: 1500 },
  decision: { baseline: 'P-top', candidate: 'P-top-s1', guard: 'later-receipt', adoptGain: 3, guardLoss: -5,
    resamples: 10000, minimumFamilies: 10, confidence: .95 },
  quotas: { groups: 30, families: 12, guardTestFamilies: 10, guardDevFamilies: 4 } });
export const isHR2b = value => value?.protocol === HR2B.protocol || value?.fixtureVersion === HR2B_VERSION;
export function parseManifest(markdown, required = []) {
  const entries = [...markdown.matchAll(/\| `([^`]+)` \| `([a-f0-9]{64})` \|/g)].map(match => [match[1], match[2]]);
  if (!entries.length || new Set(entries.map(([name]) => name)).size !== entries.length || entries.some(([name]) =>
    isAbsolute(name) || name.split(/[\\/]/u).some(part => !part || part === '.' || part === '..')) || required.some(name => !entries.some(([file]) => file === name))) fail('hr2b_manifest_files');
  return Object.fromEntries(entries);
}
export async function authenticateHR2bFixture(dir) {
  const markdown = await readFile(join(dir, 'FROZEN.md'), 'utf8'), manifest = parseManifest(markdown, FILES);
  const bytes = {}, hashes = {};
  for (const [name, expected] of Object.entries(manifest)) {
    bytes[name] = await readFile(join(dir, name));
    if (sha256(bytes[name]) !== expected) fail(`fixture_hash_mismatch:${name}`);
    if (FILES.includes(name)) hashes[name] = expected;
  }
  for (const name of FILES) {
    const version = JSON.parse(bytes[name]).version;
    if ((version !== undefined || !['hr1-split.json', 'hr1-label-audit.json'].includes(name)) && version !== HR2B_VERSION) fail('mixed_fixture_profiles');
  }
  const labels = JSON.parse(bytes['hr1-labels.json']);
  if (!labels.placement || !equal(labels.placement, placementQuotas(labels)) || !Array.isArray(labels.placement.guardCategories)) fail('hr2b_placement_metadata');
  return { hashes, corpus: JSON.parse(bytes['hr1-corpus.json']), queries: JSON.parse(bytes['hr1-queries.json']),
    split: JSON.parse(bytes['hr1-split.json']), profile: { ...HR2B, fixtureManifest: manifest, placement: labels.placement,
      fixtureFreezeHash: sha256(markdown) } };
}
export async function profileForDirectory(dir) {
  const corpus = JSON.parse(await readFile(join(dir, 'hr1-corpus.json'), 'utf8'));
  if (corpus.version === HR2B_VERSION) return HR2B;
  if (corpus.version !== undefined && corpus.version !== 'hr1-fixture-v2') fail('unsupported_fixture_version');
  return null;
}
export async function loadHR2bRankings(dir, fixture) {
  const markdown = await readFile(join(dir, 'FROZEN.md'), 'utf8');
  const required = ['configuration.json', 'host-v2-calibration.json', ...['dev', 'test'].flatMap(split => HR2B.rankings.map(name => `${split}/${name}.json`))];
  const manifest = parseManifest(markdown, required);
  const bytes = {};
  for (const [name, hash] of Object.entries(manifest)) {
    bytes[name] = await readFile(join(dir, name));
    if (sha256(bytes[name]) !== hash) fail(`ranking_member_hash_mismatch:${name}`);
  }
  const configuration = JSON.parse(bytes['configuration.json']);
  checkHR2bConfiguration(configuration, fixture.hashes);
  const calibration = JSON.parse(bytes['host-v2-calibration.json']);
  if (calibration.format !== 'hr2b-host-v2-calibration-v1' || calibration.serializerCommit !== 'b18dabe0') fail('hr2b_calibration_required');
  return { manifest, configuration, freezeHash: sha256(markdown), bytes };
}
export function authenticateHR2bRanking(fixture, ranking, options) {
  if (!HR2B.rankings.includes(options.selection) || ranking.run?.fixtureVersion !== HR2B_VERSION || ranking.run?.isolationVariant !== 'with-foreign') fail('hr2b_ranking_profile');
  checkHR2bConfiguration(ranking.run.configuration, fixture.hashes);
  return authenticateRanking(fixture, ranking, options);
}
// Snapshot metadata is authenticated afresh against the paths recorded at the
// producing stage, including dev rankings. No archived HR-2 path enters here.
export function validateHR2bSnapshot(run) {
  const profile = run.protocolProfile;
  if (!profile || !equal(Object.fromEntries(Object.keys(HR2B).map(key => [key, profile[key]])), HR2B) ||
      run.protocol !== HR2B.protocol || run.protocolCommit !== HR2B.protocolCommit || run.fixtureVersion !== HR2B_VERSION) fail('hr2b_protocol_profile');
  const fixtureFreeze = readFileSync(join(run.fixturePath, 'FROZEN.md'), 'utf8');
  const rankingFreeze = readFileSync(join(run.rankingsPath, 'FROZEN.md'), 'utf8');
  if (sha256(fixtureFreeze) !== profile.fixtureFreezeHash || sha256(rankingFreeze) !== profile.rankingFreezeHash) fail('hr2b_freeze_hash');
  const fixtureManifest = parseManifest(fixtureFreeze, FILES);
  const rankingManifest = parseManifest(rankingFreeze, ['configuration.json', 'host-v2-calibration.json', ...['dev', 'test'].flatMap(split => HR2B.rankings.map(name => `${split}/${name}.json`))]);
  if (!equal(fixtureManifest, profile.fixtureManifest) || !equal(rankingManifest, profile.rankingManifest)) fail('hr2b_profile_manifest_mismatch');
  for (const [name, hash] of Object.entries(fixtureManifest)) if (sha256(readFileSync(join(run.fixturePath, name))) !== hash) fail(`fixture_hash_mismatch:${name}`);
  for (const [name, hash] of Object.entries(rankingManifest)) if (sha256(readFileSync(join(run.rankingsPath, name))) !== hash) fail(`ranking_member_hash_mismatch:${name}`);
  if (!equal(run.fixtureHashes, Object.fromEntries(FILES.map(name => [name, fixtureManifest[name]])))) fail('hr2b_fixture_hashes');
  checkHR2bConfiguration(profile.configuration, run.fixtureHashes);
  const configuration = JSON.parse(readFileSync(join(run.rankingsPath, 'configuration.json'), 'utf8'));
  if (!equal(configuration, profile.configuration)) fail('hr2b_configuration_snapshot');
  if (run.rankingMember !== `${run.split}/${run.ranking}.json` || run.rankingHash !== rankingManifest[run.rankingMember]) fail('hr2b_ranking_member');
  const ranking = JSON.parse(readFileSync(join(run.rankingsPath, run.rankingMember), 'utf8'));
  if (!equal(run.rankingRun, ranking.run)) fail('hr2b_ranking_metadata');
  const labels = JSON.parse(readFileSync(join(run.fixturePath, 'hr1-labels.json'), 'utf8'));
  if (!equal(labels.placement, placementQuotas(labels)) || !equal(profile.placement, labels.placement)) fail('hr2b_placement_snapshot');
  const corpus = JSON.parse(readFileSync(join(run.fixturePath, 'hr1-corpus.json'), 'utf8'));
  const queries = JSON.parse(readFileSync(join(run.fixturePath, 'hr1-queries.json'), 'utf8'));
  const split = JSON.parse(readFileSync(join(run.fixturePath, 'hr1-split.json'), 'utf8'));
  authenticateHR2bRanking({ hashes: run.fixtureHashes, corpus, queries, split }, ranking, { selection: run.ranking, split: run.split, scale: run.scale });
  return { profile, corpus, expectedQueryIds: selectedQueries({ queries, split }, run.split).map(query => query.id), ranking };
}
