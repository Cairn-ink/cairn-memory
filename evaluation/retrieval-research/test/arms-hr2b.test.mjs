import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { hr2bToy } from './fixtures-tooling/hr2b.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';
import { runRankings, parseCLI } from '../run.mjs';
import { armDocuments, armQueries, HR2B_VERSION } from '../lib/fixture.mjs';
import { HR2B_FIXED, hr2bConfiguration, checkHR2bOptions } from '../lib/hr2b-configuration.mjs';

function options(path) {
  return { fixtureDir: path, fixtureVersion: HR2B_VERSION, split: 'dev', scale: 'S1000', arms: ['A1', 'A3'], models: ['bge-m3'],
    out: join(path, 'rankings/dev'), threads: 1, isolationVariant: 'with-foreign' };
}
const fixtureAPI = fixture => ({ loadFixture: async () => fixture, armDocuments, armQueries });
const embedderFactory = async () => ({ metadata: { stub: true }, embed: async texts => texts.map(() => Float32Array.of(1, 0)), close: async () => {} });
test('fixed HR-2b metadata/configuration precede toy indexing, keeping S1000, namespaces and body-only documents', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-ranking-' }), { fixture } = await hr2bToy(workspace);
  fixture.queries.queries = fixture.queries.queries.filter(query => query.id === 'q-dev-f0');
  fixture.labels.queries = fixture.labels.queries.filter(query => query.id === 'q-dev-f0');
  const selected = options(workspace.path), projections = [];
  const result = await runRankings(selected, { fixtureAPI: { ...fixtureAPI(fixture), armDocuments: (...args) => {
    projections.push(args[1]); return armDocuments(...args);
  } }, embedderFactory: async (...args) => {
    assert.deepEqual(JSON.parse(await readFile(join(workspace.path, 'rankings/configuration.json'))), hr2bConfiguration(fixture.hashes));
    return embedderFactory(...args);
  } });
  assert.equal(result.outputs.length, 2);
  for (const output of result.outputs) {
    assert.equal(output.run.fixtureVersion, HR2B_VERSION); assert.equal(output.run.status, 'complete');
    assert.deepEqual(output.run.configuration, hr2bConfiguration(fixture.hashes)); assert.equal(output.run.scale, 'S1000');
    assert.equal(Object.keys(output.queries).length, 1);
  }
  assert.ok(projections.every(projection => projection.namespace === 'target' && projection.scale === 'S1000' && projection.include === 'body'));
  assert.deepEqual(HR2B_FIXED.namespaces, ['target', 'foreign']);
  assert.deepEqual(HR2B_FIXED.fusion.weights, [.45, .45]);
  const configurationPath = join(workspace.path, 'rankings/configuration.json');
  const configuration = JSON.parse(await readFile(configurationPath)); configuration.horizon = 25;
  await writeFile(configurationPath, JSON.stringify(configuration));
  await assert.rejects(runRankings(selected, { fixtureAPI: fixtureAPI(fixture), embedderFactory }), /fixed_configuration/);
});
test('HR-2b refuses wrong arms/models/selection/scale/namespaces before model initialization', () => {
  for (const override of [{ arms: ['A1'] }, { arms: ['A1', 'A5-spans'] }, { models: ['openai-3-small'] }, { models: ['e5-small'] },
    { scale: 'S300' }, { lexical: 'A1+' }, { selectionPath: 'selection.json' }, { isolationVariant: 'without-foreign' }])
    assert.throws(() => checkHR2bOptions({ ...options('/toy'), ...override }), /hr2b_fixed_options_required/);
});
test('coordinator can record fixed configuration before calibration, and overwrite refuses', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-configuration-' }), { fixture, dir } = await hr2bToy(workspace);
  const path = join(workspace.path, 'before-rankings/configuration.json');
  const args = ['evaluation/retrieval-research/tools/hr2b-configuration.mjs', '--fixture', dir, '--out', path];
  const output = await runCli(workspace, args);
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(await readFile(path)), hr2bConfiguration(fixture.hashes));
  assert.equal((await runCli(workspace, args)).code, 1);
});


test('explicit HR-2b selection preserves the legacy test gate and authenticates the loaded version', async () => {
  let reads = 0;
  const dependencies = { fixtureAPI: { async loadFixture() { reads++; throw new Error('synthetic_fixture_read'); } } };
  const selected = { ...options('/toy'), split: 'test' };
  await assert.rejects(runRankings({ ...selected, fixtureVersion: undefined }, dependencies), /^Error: frozen_selection_required$/);
  assert.equal(reads, 0);
  await assert.rejects(runRankings(selected, dependencies), /^Error: synthetic_fixture_read$/);
  assert.equal(reads, 1);
  await assert.rejects(runRankings(options('/toy'), { fixtureAPI: { async loadFixture() { return { corpus: { version: 'hr1-fixture-v2' } }; } } }), /^Error: fixture_version_mismatch$/);
  const args = ['--fixture-dir', '/toy', '--split', 'dev', '--scale', 'S1000', '--arms', 'A1,A3', '--models', 'bge-m3', '--out', '/out'];
  assert.equal(parseCLI(args).fixtureVersion, undefined);
  assert.equal(parseCLI([...args, '--fixture-version', HR2B_VERSION]).fixtureVersion, HR2B_VERSION);
  assert.throws(() => parseCLI([...args, '--fixture-version', 'future']), /^Error: unsupported_fixture_version$/);
});
