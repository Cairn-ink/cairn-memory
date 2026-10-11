// One-shot integration envelope. Explicit operator arguments only; no CLI/key discovery.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../experiment-budget/index.mjs';
import { loadDevelopmentFreeze, loadModelInputs, hashCanonicalValue } from './corpus.mjs';
import { loadRequestedAnswerFreeze, loadEvidenceBundleFreeze } from './requested-answer.mjs';
import { createAlgorithmDevelopmentTransport, algorithmLimits } from './transport.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { runAlgorithmDevelopmentComparison } from './runner.mjs';
import { runComplementarySourceComparison } from './runner.mjs';
import { createComplementarySourceTransport } from './transport.mjs';
import { loadComplementarySourceFreeze } from './complementary.mjs';
import { complementaryPolicies, complementaryLimits, COMPLEMENTARY_VERSION } from './complementary-profile.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', ['-C', root, ...args], {
  encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
function checkpointOf(state) {
  return { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
    historySha256: state.historySha256 };
}

/** Read-only preflight. Returned values are observations, not a spending grant. */
async function prepare({ configuration }, prospective) {
  const complementary = prospective === 'source-diverse-complementary-v1';
  const bundle = complementary || prospective === 'source-diverse-linked-v1';
  const limits = complementary ? complementaryLimits : algorithmLimits;
  if (configuration.limitMicroUsd !== 400_000_000) fail('campaign_limit_mismatch');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) fail('runtime_not_clean');
  const corpus = complementary ? await loadComplementarySourceFreeze() : bundle ? await loadEvidenceBundleFreeze()
    : prospective ? await loadRequestedAnswerFreeze() : await loadDevelopmentFreeze();
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  if (state.state !== 'open' || state.attempts.some(row => row.outcome === null)) fail('campaign_unsettled');
  if (state.reservedMicroUsd + 10_000_000 + 30_000_000 > configuration.limitMicroUsd
    || state.requestCount + limits.httpRequests > configuration.requestCap) fail('campaign_unaffordable');
  const boundFiles = ['runner.mjs', 'transport.mjs', 'launch.mjs', 'requested-answer.mjs', 'coverage.mjs',
    'test/requested-answer.test.mjs', 'test/requested-answer-runner.test.mjs'];
  const artifactHashes = prospective ? Object.fromEntries(boundFiles.map(path => [path,
    hash(readFileSync(new URL(path, import.meta.url)))])) : null;
  if (prospective) for (const path of ['evaluation/architecture/source-diverse-selection-model.mjs',
    'evaluation/architecture/test/source-diverse-selection-model.test.mjs', 'docs/plans/source-diverse-qa24.md']) {
    artifactHashes[path] = hash(readFileSync(join(root, path)));
  }
  if (bundle) for (const path of ['evaluation/architecture/source-linked-evidence-model.mjs',
    'evaluation/architecture/test/source-linked-evidence-model.test.mjs',
    'evaluation/longmemeval/mixed-evidence.mjs', 'evaluation/longmemeval/mixed-answer.mjs',
    'evaluation/longmemeval/test/source-role-evidence.test.mjs', 'docs/plans/evidence-bundle-qa24.md',
    'evaluation/algorithm-development/test/evidence-bundle.test.mjs',
    'evaluation/algorithm-development/test/evidence-bundle-runner.test.mjs']) {
    artifactHashes[path] = hash(readFileSync(join(root, path)));
  }
  if (complementary) {
    // Bind the complete reviewed runtime/control closure, including prompts,
    // dependency locks, provenance, tokenizer and all new live protocol helpers.
    const files = git(['ls-files', '--', 'core', 'adapters/openai',
      'evaluation/algorithm-development', 'evaluation/architecture',
      'evaluation/longmemeval', 'evaluation/experiment-budget', 'plugins/cairn-memory/lib', 'tools/testing',
      'evaluation/experiments/cloud-retrieval-v1/candidate.mjs',
      'docs/plans/cloud-retrieval-v1-candidate.md', 'docs/plans/complementary-qa24.md']).split('\n').filter(Boolean);
    for (const path of files) artifactHashes[path] = hash(readFileSync(join(root, path)));
  }
  const treatment = bundle ? 'source-diverse-linked-v1' : 'source-diverse-v1';
  return Object.freeze({ version: complementary ? `${COMPLEMENTARY_VERSION}-launch-v1`
    : bundle ? 'source-diverse-linked-requested-answer-launch-v1'
    : prospective ? 'source-diverse-requested-answer-launch-v1' : 'algorithm-development-launch-v1',
    ...(bundle ? { evidenceFormat: 'source-role-evidence-v1', originalCorpusHashes: corpus.originalHashes } : {}),
    ...(prospective ? { treatment: complementary ? complementaryPolicies.complementary : treatment,
      armPolicies: complementary ? complementaryPolicies : { baseline: 'ordinary-v1', full: treatment },
      rubricVersion: bundle ? corpus.rubricVersion : corpus.version, model: DEFAULT_MODEL, limits, artifactHashes,
      campaign: { schemaVersion: state.schemaVersion, runId: state.runId, limitMicroUsd: state.limitMicroUsd,
        requestCap: state.requestCap, configurationSha256: hash(JSON.stringify(configuration)) } } : {}), runtimeCommit: git(['rev-parse', 'HEAD']),
    nodeVersion: process.versions.node, nodeSha256: hash(readFileSync(process.execPath)),
    ...(complementary ? { nodeExecutable: realpathSync(process.execPath) } : {}),
    corpusHashes: corpus.hashes, checkpoint: checkpointOf(state),
    requestMaximum: limits.httpRequests, reservationMaximumMicroUsd: 10_000_000, protectedMicroUsd: 30_000_000 });
}
export const prepareAlgorithmDevelopment = options => prepare(options, false);
export const prepareRequestedAnswerComparison = options => prepare(options, true);
export const prepareEvidenceBundleComparison = options => prepare(options, 'source-diverse-linked-v1');
export const prepareComplementarySourceComparison = options => prepare(options, 'source-diverse-complementary-v1');

/** The caller must supply a reviewed prospective manifest and a fresh owned directory. */
async function launch({ configuration, manifest, outputDirectory, keyProvider,
  fetchImpl = globalThis.fetch }, prospective) {
  const complementary = prospective === 'source-diverse-complementary-v1';
  const bundle = complementary || prospective === 'source-diverse-linked-v1';
  if (typeof keyProvider !== 'function' || typeof fetchImpl !== 'function') fail('invalid_launch');
  const version = complementary ? `${COMPLEMENTARY_VERSION}-launch-v1`
    : bundle ? 'source-diverse-linked-requested-answer-launch-v1'
    : prospective ? 'source-diverse-requested-answer-launch-v1' : 'algorithm-development-launch-v1';
  if (manifest?.version !== version || prospective && (manifest.treatment !== (complementary ? complementaryPolicies.complementary : bundle ? 'source-diverse-linked-v1' : 'source-diverse-v1')
    || manifest.rubricVersion !== 'algorithm-development-requested-answer-v2')
    || bundle && manifest.evidenceFormat !== 'source-role-evidence-v1'
    || !prospective && Object.hasOwn(manifest, 'treatment')) fail('manifest_mismatch');
  // Detach operator data before awaiting credential lookup or caller callbacks.
  configuration = structuredClone(configuration);
  manifest = structuredClone(manifest);
  const observed = await prepare({ configuration }, prospective);
  if (JSON.stringify(observed) !== JSON.stringify(manifest)) fail('manifest_mismatch');
  // Retain only the validated source-facing half before the marker/key. Its
  // canonical identity is already bound by the reviewed manifest; pre-run
  // failures remain representable even if the on-disk corpus is then damaged.
  const sourceSnapshot = complementary ? await loadModelInputs() : null;
  if (complementary && hashCanonicalValue(sourceSnapshot) !== manifest.corpusHashes.modelInputs) fail('manifest_mismatch');
  const directory = resolve(outputDirectory), identity = lstatSync(directory);
  if (!identity.isDirectory() || identity.isSymbolicLink() || realpathSync(directory) !== directory
    || identity.uid !== process.getuid() || (identity.mode & 0o777) !== 0o700) fail('unsafe_output_directory');
  const checkDirectory = () => {
    const current = lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev
      || current.ino !== identity.ino) fail('output_directory_changed');
  };
  const persist = (name, value) => {
    checkDirectory();
    const fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT
      | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    const dir = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (fstatSync(dir).ino !== identity.ino) fail('output_directory_changed'); fsyncSync(dir); }
    finally { closeSync(dir); }
    checkDirectory();
  };
  // Exclusive marker precedes credential lookup: a failed launch is never resumed.
  persist('started.json', { manifest, startedAt: new Date().toISOString() });
  let transport, records = 0, report, launchError, runnerStarted = false, reportPersisted = false;
  try {
    const apiKey = await keyProvider();
    if (complementary && JSON.stringify(await prepare({ configuration }, prospective)) !== JSON.stringify(manifest)) fail('manifest_mismatch');
    transport = (complementary ? createComplementarySourceTransport : createAlgorithmDevelopmentTransport)({ configuration,
      checkpoint: { requestCount: manifest.checkpoint.requestCount,
        reservedMicroUsd: manifest.checkpoint.reservedMicroUsd },
      historySha256: manifest.checkpoint.historySha256, apiKey, fetchImpl,
      onRecord: record => persist(`request-${String(++records).padStart(5, '0')}.json`, record) });
    // Only the model-facing half leaves preflight; no evaluator gold reaches the runner.
    const modelInputs = complementary ? sourceSnapshot : (await loadDevelopmentFreeze()).modelInputs;
    runnerStarted = true;
    report = await (complementary ? runComplementarySourceComparison : runAlgorithmDevelopmentComparison)({ cases: modelInputs, transport,
      ...(prospective ? { treatment: bundle ? 'source-diverse-linked-v1' : 'source-diverse-v1' } : {}),
      outputDirectory: directory, onCase: row => persist(`case-${row.id}.json`, row) });
    persist('report.json', report);
    reportPersisted = true;
    return report;
  } catch (error) {
    launchError = error;
    if (complementary && !runnerStarted && report === undefined) {
      const failure = error.code ?? 'complementary_launch_failure';
      try {
        report = await runComplementarySourceComparison({ cases: sourceSnapshot,
          transport: { records: () => [], assertHealthy() { fail(failure); }, endCase() { fail(failure); } },
          outputDirectory: directory, onCase: row => persist(`case-${row.id}.json`, row) });
        persist('report.json', report);
        reportPersisted = true;
      } catch (persistenceError) {
        launchError = new AggregateError([error, persistenceError], 'Complementary launch and observation persistence failed', { cause: error });
      }
    }
    throw launchError;
  } finally {
    // Unknown/pending reservations survive failures. Do not repair or refund them.
    let closeError;
    try { transport?.close(); }
    catch (error) {
      if (!complementary) throw error;
      closeError = error;
    }
    finally {
      try { persist('closed.json', { completed: report !== undefined && (!complementary || reportPersisted && report.fatal === null && !launchError && !closeError), records,
        ...(complementary ? { runnerStarted, reportAvailable: reportPersisted,
          failure: launchError?.code ?? launchError?.cause?.code ?? closeError?.code ?? (launchError || closeError ? 'complementary_launch_failure' : report?.fatal ?? null) } : {}),
        closedAt: new Date().toISOString() }); }
      catch (persistenceError) {
        if (complementary && (launchError || closeError)) throw new AggregateError([launchError ?? closeError, persistenceError], 'Launch and closure persistence failed', { cause: launchError ?? closeError });
        throw persistenceError;
      }
    }
    if (closeError) {
      if (launchError) throw new AggregateError([launchError, closeError], 'Launch and transport closure failed', { cause: launchError });
      throw closeError;
    }
  }
}
export const launchAlgorithmDevelopment = options => launch(options, false);
export const launchRequestedAnswerComparison = options => launch(options, true);
export const launchEvidenceBundleComparison = options => launch(options, 'source-diverse-linked-v1');
export const launchComplementarySourceComparison = options => launch(options, 'source-diverse-complementary-v1');
