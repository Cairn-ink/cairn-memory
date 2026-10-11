// Named one-shot envelope. Explicit existing ledger, reviewed manifest and key callback.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../experiment-budget/index.mjs';
import { createMocNaturalTransport } from './transport.mjs';
import { runMocNaturalComparison, emptyMocNaturalReport, mocNaturalResources } from './moc-prior-runner.mjs';
import { loadMocNaturalFreeze } from './moc-prior-evaluator.mjs';
import { MOC_NATURAL_VERSION, mocNaturalLimits, mocNaturalPolicies, mocNaturalSourceValueSha256,
  naturalHash, naturalFail, naturalErrorCode, freezeNatural, validateMocNaturalInputs } from './moc-prior-profile.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const mocNaturalPreflightArtifacts = Object.freeze(['preflight-review.json', 'operator-review.json']);
const git = args => execFileSync('/usr/bin/git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000,
  env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function outputIdentity(outputDirectory) {
  try {
    const directory = resolve(outputDirectory), identity = lstatSync(directory);
    if (!identity.isDirectory() || identity.isSymbolicLink() || realpathSync(directory) !== directory
      || identity.uid !== process.getuid() || (identity.mode & 0o777) !== 0o700) naturalFail('natural_output_unsafe');
    return { directory, dev: identity.dev, ino: identity.ino, uid: identity.uid, mode: identity.mode & 0o777 };
  } catch { naturalFail('natural_output_unsafe'); }
}
function regularBytes(path) {
  const identity = lstatSync(path);
  if (!identity.isFile() || identity.isSymbolicLink()) naturalFail('natural_artifact_invalid');
  return readFileSync(path);
}
function dependencyClosure() {
  const directory = realpathSync(join(root, 'adapters/openai/node_modules/tiktoken')), files = {};
  const visit = path => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), identity = lstatSync(child);
      if (identity.isDirectory()) visit(child);
      else if (identity.isFile()) files[relative(directory, child)] = naturalHash(readFileSync(child));
      else naturalFail('natural_artifact_invalid');
    }
  };
  visit(directory); return { directory, files };
}
function artifactClosure() {
  // Superset closure: static and deferred preparation imports, prompts, locks and controls.
  const paths = git(['ls-files', '--', 'core', 'adapters/openai', 'evaluation/algorithm-development',
    'evaluation/architecture', 'evaluation/longmemeval', 'evaluation/experiment-budget',
    'evaluation/experiments/cloud-retrieval-v1/candidate.mjs', 'plugins/cairn-memory/lib', 'tools/testing',
    'AGENTS.md', 'CONTRIBUTING.md', 'CONTEXT.md', 'package.json', 'package-lock.json',
    'docs/architecture.md', 'docs/protocol.md', 'docs/limitations.md', 'ROADMAP.md',
    'docs/plans/moc-prior*', 'docs/plans/cloud-retrieval-v1-candidate.md',
    'docs/experiment-budget.md', 'docs/experiment-request-guard.md',
    '.claude/skills/worktree-pr-workflow', 'tools/plugin-validation/package.json', 'tools/plugin-validation/package-lock.json'])
    .split('\n').filter(Boolean);
  if (!paths.includes('evaluation/algorithm-development/moc-prior-launch.mjs')) naturalFail('natural_artifact_invalid');
  return Object.fromEntries(paths.map(path => [path, naturalHash(regularBytes(join(root, path)))]));
}
function preflightFiles(identity, started = false) {
  const files = {};
  for (const name of readdirSync(identity.directory).sort()) {
    if (started && name === 'started.json') continue;
    if (!mocNaturalPreflightArtifacts.includes(name)) naturalFail('natural_output_contents');
    const path = join(identity.directory, name), stat = lstatSync(path);
    if (stat.uid !== identity.uid || (stat.mode & 0o777) !== 0o600 || stat.size > 1024 * 1024) naturalFail('natural_output_contents');
    files[name] = naturalHash(regularBytes(path));
  }
  return files;
}
async function prepare({ configuration, outputDirectory }, started = false) {
  const identity = outputIdentity(outputDirectory);
  const preflightArtifacts = preflightFiles(identity, started);
  if (configuration?.limitMicroUsd !== 400_000_000) naturalFail('natural_campaign_limit');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) naturalFail('natural_runtime_not_clean');
  const frozen = await loadMocNaturalFreeze(); // Loader checks all 19 batches before any key/call.
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  if (state.state !== 'open' || state.attempts.some(attempt => attempt.outcome === null)) naturalFail('natural_campaign_unsettled');
  if (state.reservedMicroUsd + 1_800_000 + 30_000_000 > state.limitMicroUsd
    || state.requestCount + 360 > state.requestCap) naturalFail('natural_unaffordable');
  return freezeNatural({ version: `${MOC_NATURAL_VERSION}-launch`, runtimeCommit: git(['rev-parse', 'HEAD']),
    nodeVersion: process.versions.node, nodeExecutable: realpathSync(process.execPath), nodeSha256: naturalHash(readFileSync(process.execPath)),
    model: 'gpt-4.1-mini-2025-04-14', limits: { ...mocNaturalLimits }, armPolicies: { ...mocNaturalPolicies },
    corpusHashes: frozen.hashes, modelInputs: structuredClone(frozen.modelInputs),
    protocol: structuredClone(frozen.protocol), artifactHashes: artifactClosure(), dependency: dependencyClosure(),
    outputIdentity: identity, preflightArtifacts, allowedPreflightArtifacts: [...mocNaturalPreflightArtifacts],
    campaign: { schemaVersion: state.schemaVersion, runId: state.runId, limitMicroUsd: state.limitMicroUsd,
      requestCap: state.requestCap, configurationSha256: naturalHash(JSON.stringify(configuration)) },
    checkpoint: { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd, historySha256: state.historySha256 },
    requestMaximum: 360, reservationMaximumMicroUsd: 1_800_000, localCeilingMicroUsd: 4_000_000, protectedMicroUsd: 30_000_000 });
}
export const prepareMocNaturalComparison = options => prepare(options);

export async function launchMocNaturalComparison({ configuration, manifest, outputDirectory, keyProvider,
  fetchImpl = globalThis.fetch } = {}) {
  if (typeof keyProvider !== 'function' || typeof fetchImpl !== 'function') naturalFail('natural_launch_failure');
  configuration = freezeNatural(structuredClone(configuration)); manifest = freezeNatural(structuredClone(manifest));
  // The manifest carries the source-only snapshot so on-disk drift cannot erase unrun slots.
  validateMocNaturalInputs(manifest?.modelInputs);
  if (manifest.version !== `${MOC_NATURAL_VERSION}-launch`
    || naturalHash(JSON.stringify(manifest.modelInputs)) !== mocNaturalSourceValueSha256) naturalFail('natural_manifest_mismatch');
  const identity = outputIdentity(outputDirectory), written = new Map();
  preflightFiles(identity); // Unknown preexisting output never becomes owned runtime evidence.
  let transport, report, firstFailure = null, runnerStarted = false, reportPersisted = false, recordWrites = 0;
  const checkOutput = () => {
    if (!isDeepStrictEqual(outputIdentity(identity.directory), identity)) naturalFail('natural_output_changed');
    for (const [name, bound] of written) {
      const stat = lstatSync(join(identity.directory, name));
      if (stat.dev !== bound.dev || stat.ino !== bound.ino || naturalHash(regularBytes(join(identity.directory, name))) !== bound.sha256) naturalFail('natural_output_changed');
    }
    for (const name of readdirSync(identity.directory)) {
      if (written.has(name)) continue;
      if (mocNaturalPreflightArtifacts.includes(name)) {
        if (manifest.preflightArtifacts?.[name] !== naturalHash(regularBytes(join(identity.directory, name)))) naturalFail('natural_output_changed');
        continue;
      }
      if (!/^0([1-4])-P0\1$/u.test(name)) naturalFail('natural_output_changed');
      const folder = join(identity.directory, name), stat = lstatSync(folder);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== identity.uid || (stat.mode & 0o777) !== 0o700) naturalFail('natural_output_changed');
      for (const child of readdirSync(folder)) if (!/^memory\.sqlite(?:-wal|-shm|-journal)?$/u.test(child)
        || !lstatSync(join(folder, child)).isFile() || lstatSync(join(folder, child)).isSymbolicLink()) naturalFail('natural_output_changed');
    }
    for (const name of Object.keys(manifest.preflightArtifacts ?? {}))
      if (!readdirSync(identity.directory).includes(name)) naturalFail('natural_output_changed');
  };
  const persist = (name, value) => {
    try {
      checkOutput();
      const fd = openSync(join(identity.directory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const bytes = `${JSON.stringify(value)}\n`; let stat;
      try { writeFileSync(fd, bytes); fsyncSync(fd); stat = fstatSync(fd); } finally { closeSync(fd); }
      written.set(name, { dev: stat.dev, ino: stat.ino, sha256: naturalHash(bytes) });
      const directoryFd = openSync(identity.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { if (fstatSync(directoryFd).ino !== identity.ino) naturalFail('natural_output_changed'); fsyncSync(directoryFd); }
      finally { closeSync(directoryFd); }
      checkOutput();
    } catch (error) { naturalFail(naturalErrorCode(error, 'natural_persistence_failure')); }
  };
  const checkRuntime = () => {
    try {
      checkOutput();
      if (git(['rev-parse', 'HEAD']) !== manifest.runtimeCommit || git(['status', '--porcelain', '--untracked-files=normal'])
        || realpathSync(process.execPath) !== manifest.nodeExecutable || naturalHash(readFileSync(process.execPath)) !== manifest.nodeSha256
        || !isDeepStrictEqual(artifactClosure(), manifest.artifactHashes)
        || !isDeepStrictEqual(dependencyClosure(), manifest.dependency)) naturalFail('natural_manifest_mismatch');
    } catch (error) { naturalFail(naturalErrorCode(error, 'natural_manifest_mismatch')); }
  };
  try {
    // Consume the fresh directory even when a pre-key gate fails; never resume it.
    persist('started.json', { manifest, startedAt: new Date().toISOString() });
    if (!isDeepStrictEqual(await prepare({ configuration, outputDirectory }, true), manifest)) naturalFail('natural_manifest_mismatch');
    let apiKey; try { apiKey = await keyProvider(); } catch { naturalFail('natural_key_failure'); }
    if (!isDeepStrictEqual(await prepare({ configuration, outputDirectory }, true), manifest)) naturalFail('natural_manifest_mismatch');
    checkRuntime();
    transport = createMocNaturalTransport({ configuration, checkpoint: {
      requestCount: manifest.checkpoint.requestCount, reservedMicroUsd: manifest.checkpoint.reservedMicroUsd },
      historySha256: manifest.checkpoint.historySha256, apiKey, fetchImpl,
      onRecord: record => {
        checkRuntime(); persist(`request-${String(++recordWrites).padStart(5, '0')}-${record.outcome === 'unknown' && record.failure === null ? 'pre' : 'post'}.json`, record);
      } });
    runnerStarted = true;
    report = await runMocNaturalComparison({ cases: manifest.modelInputs, transport, outputDirectory: identity.directory,
      onCase: row => { checkRuntime(); persist(`case-${row.id}.json`, row); } });
    persist('report.json', report); reportPersisted = true;
    if (report.fatal) naturalFail(report.fatal);
  } catch (error) {
    firstFailure = naturalErrorCode(error, 'natural_launch_failure');
    if (!report) {
      report = emptyMocNaturalReport(manifest.modelInputs, firstFailure); report.fatal = firstFailure;
      report.allFirstAnswersSettled = true; report.records = transport?.records() ?? []; report.resources = mocNaturalResources(report);
      try {
        for (const row of report.observations) persist(`case-${row.id}.json`, row);
        persist('report.json', report); reportPersisted = true;
      } catch { /* Failure remains closed; no callback/model dispatch follows. */ }
    }
  } finally {
    try { transport?.close(); } catch (error) { firstFailure ??= naturalErrorCode(error, 'algorithm_accounting_failure'); }
    try { persist('closed.json', { completed: reportPersisted && report?.fatal === null && firstFailure === null,
      runnerStarted, reportAvailable: reportPersisted, recordWrites, failure: firstFailure ?? report?.fatal ?? null,
      closedAt: new Date().toISOString() }); }
    catch (error) { firstFailure ??= naturalErrorCode(error, 'natural_persistence_failure'); }
  }
  if (firstFailure) naturalFail(firstFailure);
  return freezeNatural(report);
}
