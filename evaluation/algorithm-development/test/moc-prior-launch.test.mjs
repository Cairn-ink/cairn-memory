import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { naturalTestLedger, naturalFakeProvider, naturalTestSecret } from './moc-prior-runner.test.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const gitEnv = { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Synthetic test', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
  GIT_COMMITTER_NAME: 'Synthetic test', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid' };
const git = (directory, args) => execFileSync('/usr/bin/git', ['-C', directory, ...args],
  { encoding: 'utf8', env: gitEnv, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'natural-moc-launch-' });
  const directory = join(workspace.path, 'synthetic-checkout');
  // Commits exist only in this owned synthetic repository, never the task worktree.
  git(root, ['clone', '--shared', '--no-hardlinks', '--quiet', root, directory]);
  const changed = new Set([...git(root, ['diff', '--name-only']).split('\n'),
    ...git(root, ['ls-files', '--others', '--exclude-standard']).split('\n')].filter(Boolean));
  for (const name of changed) {
    const target = join(directory, name); mkdirSync(join(target, '..'), { recursive: true });
    cpSync(join(root, name), target, { dereference: false, verbatimSymlinks: true });
  }
  if (changed.size) {
    git(directory, ['add', '--', ...changed]);
    git(directory, ['commit', '--quiet', '-m', 'Owned synthetic natural-runtime fixture']);
  }
  const dependency = join(directory, 'adapters/openai/node_modules/tiktoken');
  mkdirSync(join(dependency, '..'), { recursive: true });
  cpSync(realpathSync(join(root, 'adapters/openai/node_modules/tiktoken')), dependency, { recursive: true });
  const configuration = naturalTestLedger(join(workspace.path, 'ledger'));
  const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
  const api = await import(pathToFileURL(join(directory, 'evaluation/algorithm-development/moc-prior-launch.mjs')));
  const manifest = await api.prepareMocNaturalComparison({ configuration, outputDirectory });
  return { workspace, directory, dependency, configuration, outputDirectory, api, manifest };
}
const json = (f, name) => JSON.parse(readFileSync(join(f.outputDirectory, name), 'utf8'));

test('NR6 clean committed closure, actual tokenizer package/Node/output/checkpoint and one-shot start before key', async t => {
  const f = await fixture(t), requests = [], recordsSeen = [];
  assert.equal(f.manifest.requestMaximum, 360); assert.equal(f.manifest.reservationMaximumMicroUsd, 1_800_000);
  assert.equal(f.manifest.localCeilingMicroUsd, 4_000_000);
  assert.equal(f.manifest.nodeExecutable, realpathSync(process.execPath));
  assert.equal(f.manifest.dependency.directory, realpathSync(f.dependency));
  assert.ok(Object.keys(f.manifest.dependency.files).some(name => name.endsWith('.wasm')));
  for (const path of ['core/runtime.mjs', 'core/prompts/recall-select.md', 'evaluation/algorithm-development/runner.mjs',
    'evaluation/architecture/full-label-model.mjs', 'evaluation/architecture/source-diverse-selection-model.mjs',
    'evaluation/experiments/cloud-retrieval-v1/candidate.mjs', 'adapters/openai/package-lock.json']) assert.ok(f.manifest.artifactHashes[path], path);
  const provider = naturalFakeProvider({ empty: true }); let keys = 0;
  const report = await f.api.launchMocNaturalComparison({ ...f, keyProvider() {
    keys++; assert.equal(existsSync(join(f.outputDirectory, 'started.json')), true); return naturalTestSecret;
  }, fetchImpl: async (url, options) => {
    requests.push({ url, body: options.body });
    const names = execFileSync('/usr/bin/find', [f.outputDirectory, '-maxdepth', '1', '-name', 'request-*-pre.json'], { encoding: 'utf8' });
    assert.ok(names.trim(), 'durable pre-request record exists before fake HTTP'); recordsSeen.push(names);
    return provider(url, options);
  } });
  assert.equal(keys, 1); assert.equal(report.fatal, null); assert.equal(report.observations.length, 4);
  assert.equal(report.outcomesDenominator, 8); assert.equal(report.records.length, requests.length);
  assert.equal(recordsSeen.length, requests.length); assert.equal(json(f, 'closed.json').completed, true);
  assert.equal(json(f, 'report.json').records.length, requests.length);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, requests.length);
  for (const row of report.observations) for (const arm of Object.values(row.arms)) {
    assert.equal(arm.status, 'completed'); assert.ok(requests.some(request => request.body === JSON.stringify(arm.packed.request)));
  }
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider() { keys++; return naturalTestSecret; }, fetchImpl: provider }));
  assert.equal(keys, 1); assert.equal(json(f, 'closed.json').completed, true, 'first closure is retained unchanged');
});

test('NR6 initial runtime drift retains all source snapshots/eight unrun outcomes without key or HTTP', async t => {
  const f = await fixture(t); let keys = 0, calls = 0;
  const path = join(f.directory, 'evaluation/architecture/full-label-model.mjs'); writeFileSync(path, `${readFileSync(path)}\n// owned initial drift\n`);
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider() { keys++; return naturalTestSecret; },
    fetchImpl: async () => { calls++; return Response.json({}); } }), error => error.code === 'natural_runtime_not_clean');
  assert.equal(keys, 0); assert.equal(calls, 0);
  const report = json(f, 'report.json'); assert.equal(report.observations.length, 4); assert.equal(report.outcomesDenominator, 8);
  assert.ok(report.observations.every(row => row.source.sessions.length === 19 && Object.values(row.arms).every(arm => arm.failureStage === 'not_run')));
  assert.equal(json(f, 'closed.json').failure, 'natural_runtime_not_clean');
});

test('NR6 after-key artifact and installed copied-tokenizer drift stop before first request', async t => {
  for (const kind of ['source', 'tokenizer']) {
    const f = await fixture(t); let keys = 0, calls = 0;
    await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider() {
      keys++; const path = kind === 'source' ? join(f.directory, 'evaluation/experiments/cloud-retrieval-v1/candidate.mjs')
        : join(f.dependency, 'tiktoken.js');
      writeFileSync(path, `${readFileSync(path)}\n// owned after-key drift\n`); return naturalTestSecret;
    }, fetchImpl: async () => { calls++; return Response.json({}); } }));
    assert.equal(keys, 1); assert.equal(calls, 0);
    const report = json(f, 'report.json'); assert.equal(report.outcomesDenominator, 8); assert.equal(report.records.length, 0);
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, 0);
    assert.equal(json(f, 'closed.json').completed, false);
  }
});

test('NR6 malicious key callback error is closed/redacted and durable with all four/eight failures', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider() {
    const error = new Error(`Credential ${naturalTestSecret}`); error.code = naturalTestSecret; throw error;
  }, fetchImpl: async () => { calls++; return Response.json({}); } }), error => error.code === 'natural_key_failure');
  assert.equal(calls, 0); assert.equal(json(f, 'closed.json').failure, 'natural_key_failure');
  const report = json(f, 'report.json'); assert.equal(report.observations.length, 4);
  assert.ok(report.observations.every(row => Object.values(row.arms).every(arm => arm.failure === 'natural_key_failure')));
  assert.equal(JSON.stringify(report).includes(naturalTestSecret), false);
  assert.equal(readFileSync(join(f.outputDirectory, 'closed.json'), 'utf8').includes(naturalTestSecret), false);
});

test('NR6 explicitly declared preflight files are bound; undeclared contents fail before key', async t => {
  const f = await fixture(t); let keys = 0;
  const review = join(f.outputDirectory, 'operator-review.json'); writeFileSync(review, '{}\n', { mode: 0o600 });
  const manifest = await f.api.prepareMocNaturalComparison(f); assert.ok(manifest.preflightArtifacts['operator-review.json']);
  writeFileSync(join(f.outputDirectory, 'foreign.json'), '{}\n', { mode: 0o600 });
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, manifest, keyProvider() { keys++; return naturalTestSecret; } }),
    error => error.code === 'natural_output_contents');
  assert.equal(keys, 0);
});

test('NR5/6 actual owned database-write failure globally stops later dispatch and retains eight unresolved slots', async t => {
  const f = await fixture(t); let calls = 0;
  const provider = naturalFakeProvider();
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider: () => naturalTestSecret,
    fetchImpl: async (url, options) => {
      calls++;
      if (calls === 1) {
        const db = new DatabaseSync(join(f.outputDirectory, '01-P01/memory.sqlite'));
        try { db.exec("CREATE TRIGGER synthetic_write_failure BEFORE INSERT ON memories BEGIN SELECT RAISE(FAIL, 'synthetic owned write failure'); END"); }
        finally { db.close(); }
      }
      return provider(url, options);
    } }), error => error.code === 'storage_error');
  assert.equal(calls, 2, 'only the first extraction count/generation dispatch occurs');
  const report = json(f, 'report.json');
  assert.equal(report.fatal, 'storage_error'); assert.equal(report.observations.length, 4);
  assert.ok(report.observations.every(row => Object.values(row.arms).every(arm => arm.status === 'unresolved')));
  assert.ok(report.observations.slice(1).every(row => row.capture.modelCalls.length === 0));
  assert.equal(json(f, 'closed.json').completed, false);
});

test('NR6 durable output replacement during fake HTTP stops all later requests without overwriting first evidence', async t => {
  const f = await fixture(t); let calls = 0, firstPre;
  await assert.rejects(f.api.launchMocNaturalComparison({ ...f, keyProvider: () => naturalTestSecret,
    fetchImpl: async () => {
      calls++; firstPre = join(f.outputDirectory, 'request-00001-pre.json');
      assert.ok(existsSync(firstPre)); writeFileSync(firstPre, 'synthetic owned evidence corruption\n');
      return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    } }), error => error.code === 'natural_output_changed');
  assert.equal(calls, 1); assert.equal(readFileSync(firstPre, 'utf8'), 'synthetic owned evidence corruption\n');
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, 1);
  assert.equal(existsSync(join(f.outputDirectory, '02-P02')), false);
  assert.equal(existsSync(join(f.outputDirectory, 'request-00002-post.json')), false);
});
