import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createOwnedGitFixture } from '../../../tools/testing/owned-git-fixture.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings,
  inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { loadLargePoolFreeze } from '../large-pool.mjs';
import { loadLargePoolInputs, largePoolLimits } from '../large-pool-profile.mjs';
import { launchLargePoolComparison, launchComplementarySourceComparison } from '../launch.mjs';

test('L1/L2 source loader excludes gold and preflight binds exactly six normal capture batches', async t => {
  const frozen = await loadLargePoolFreeze(), inputs = await loadLargePoolInputs();
  assert.deepEqual(inputs, frozen.modelInputs); assert.equal(frozen.modelInputs.length, 6);
  const sourceModule = readFileSync(new URL('../large-pool-profile.mjs', import.meta.url), 'utf8');
  assert.equal(/from ['"]\.\/large-pool\.mjs|large-pool-rubric\.json/u.test(sourceModule), false);
  const workspace = createTestWorkspace(t, { prefix: 'large-pool-source-only-' });
  const casesPath = join(workspace.path, 'sources.json');
  writeFileSync(casesPath, JSON.stringify(inputs));
  assert.deepEqual(await loadLargePoolInputs({ casesPath, rubricPath: '/does-not-exist' }), inputs);
  const leaked = structuredClone(inputs); leaked[0].gold = 'Mina'; writeFileSync(casesPath, JSON.stringify(leaked));
  await assert.rejects(loadLargePoolInputs({ casesPath }));
});

test('L5 old/new closed launch identities reject before key lookup', async () => {
  let keys = 0; const options = { configuration: {}, keyProvider: () => { keys++; }, fetchImpl: () => assert.fail('No HTTP') };
  await assert.rejects(launchLargePoolComparison({ ...options, manifest: { version: 'complementary-source-requested-answer-launch-v1' } }), { code: 'manifest_mismatch' });
  await assert.rejects(launchComplementarySourceComparison({ ...options, manifest: { version: 'large-pool-six-v1-launch' } }), { code: 'manifest_mismatch' });
  assert.equal(keys, 0);
});

test('L5/L9 exact manifest, source pre-key snapshot, key failure and exclusive one-shot closure', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'large-pool-manifest-' });
  const root = fileURLToPath(new URL('../../../', import.meta.url)), owned = createOwnedGitFixture(workspace), checkout = owned.path;
  const archive = execFileSync('/usr/bin/git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-x', '-C', checkout], { input: archive });
  cpSync(join(root, 'evaluation/algorithm-development'), join(checkout, 'evaluation/algorithm-development'), { recursive: true });
  cpSync(join(root, 'docs/plans/large-pool-six.md'), join(checkout, 'docs/plans/large-pool-six.md'));
  cpSync(join(root, 'docs/plans/large-pool-six-fixtures.md'), join(checkout, 'docs/plans/large-pool-six-fixtures.md'));
  cpSync(join(root, 'adapters/openai/node_modules'), join(checkout, 'adapters/openai/node_modules'), { recursive: true });
  owned.commit('Owned large-pool manifest fixture');
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close(); const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const module = await import(pathToFileURL(join(checkout, 'evaluation/algorithm-development/launch.mjs')));
  const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
  const manifest = await module.prepareLargePoolComparison({ configuration, outputDirectory });
  assert.deepEqual(manifest.limits, largePoolLimits); assert.equal(manifest.requestMaximum, 252); assert.equal(manifest.reservationMaximumMicroUsd, 2_000_000);
  for (const path of ['evaluation/algorithm-development/large-pool-profile.mjs', 'evaluation/algorithm-development/large-pool.mjs',
    'evaluation/algorithm-development/large-pool-cases.json', 'evaluation/algorithm-development/large-pool-rubric.json',
    'docs/plans/large-pool-six.md', 'docs/plans/large-pool-six-fixtures.md']) assert.ok(manifest.artifactHashes[path]);
  let keys = 0, http = 0;
  const options = { configuration, manifest, outputDirectory, keyProvider: () => { keys++; throw new Error('synthetic key failure'); }, fetchImpl: () => { http++; assert.fail('No HTTP'); } };
  for (const mutate of [value => value.limits.httpRequests++, value => value.nodeSha256 = '0'.repeat(64), value => value.checkpoint.requestCount++, value => value.outputIdentity.ino++]) {
    const changed = structuredClone(manifest); mutate(changed);
    await assert.rejects(module.launchLargePoolComparison({ ...options, manifest: changed }), { code: 'manifest_mismatch' });
  }
  assert.equal(keys, 0); assert.equal(existsSync(join(outputDirectory, 'started.json')), false);
  await assert.rejects(module.launchLargePoolComparison(options), /synthetic key failure/u);
  const retained = JSON.parse(readFileSync(join(outputDirectory, 'report.json')));
  assert.equal(retained.observations.length, 6); assert.equal(retained.denominator, 6);
  assert.equal(retained.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 12);
  assert.equal(JSON.parse(readFileSync(join(outputDirectory, 'closed.json'))).completed, false);
  await assert.rejects(module.launchLargePoolComparison(options), { code: 'EEXIST' }); assert.equal(keys, 1); assert.equal(http, 0);
  const corruptionDirectory = join(workspace.path, 'corrupt'); mkdirSync(corruptionDirectory, { mode: 0o700 });
  const corruptManifest = await module.prepareLargePoolComparison({ configuration, outputDirectory: corruptionDirectory });
  const path = join(checkout, 'evaluation/algorithm-development/large-pool-cases.json'), original = readFileSync(path);
  const before = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  try {
    await assert.rejects(module.launchLargePoolComparison({ ...options, manifest: corruptManifest, outputDirectory: corruptionDirectory,
      keyProvider: () => { writeFileSync(path, '{'); return 'synthetic-key'; } }), { code: 'runtime_not_clean' });
  } finally { writeFileSync(path, original); }
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(configuration), before); assert.equal(http, 0);
  const corrupt = JSON.parse(readFileSync(join(corruptionDirectory, 'report.json')));
  assert.deepEqual(corrupt.observations.map(row => row.source), JSON.parse(original));
  assert.equal(corrupt.fatal, 'runtime_not_clean'); assert.equal(corrupt.observations.length, 6);
  assert.equal(JSON.parse(readFileSync(join(corruptionDirectory, 'closed.json'))).runnerStarted, false);
});
