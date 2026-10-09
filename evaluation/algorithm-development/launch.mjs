// One-shot integration envelope. Explicit operator arguments only; no CLI/key discovery.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../experiment-budget/index.mjs';
import { loadDevelopmentFreeze } from './corpus.mjs';
import { createAlgorithmDevelopmentTransport } from './transport.mjs';
import { runAlgorithmDevelopmentComparison } from './runner.mjs';

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
export async function prepareAlgorithmDevelopment({ configuration }) {
  if (configuration.limitMicroUsd !== 400_000_000) fail('campaign_limit_mismatch');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) fail('runtime_not_clean');
  const corpus = await loadDevelopmentFreeze();
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  if (state.state !== 'open' || state.attempts.some(row => row.outcome === null)) fail('campaign_unsettled');
  if (state.reservedMicroUsd + 10_000_000 + 30_000_000 > configuration.limitMicroUsd
    || state.requestCount + 1968 > configuration.requestCap) fail('campaign_unaffordable');
  return Object.freeze({ version: 'algorithm-development-launch-v1', runtimeCommit: git(['rev-parse', 'HEAD']),
    nodeVersion: process.versions.node, nodeSha256: hash(readFileSync(process.execPath)),
    corpusHashes: corpus.hashes, checkpoint: checkpointOf(state),
    requestMaximum: 1968, reservationMaximumMicroUsd: 10_000_000, protectedMicroUsd: 30_000_000 });
}

/** The caller must supply a reviewed prospective manifest and a fresh owned directory. */
export async function launchAlgorithmDevelopment({ configuration, manifest, outputDirectory, keyProvider,
  fetchImpl = globalThis.fetch }) {
  if (typeof keyProvider !== 'function' || typeof fetchImpl !== 'function') fail('invalid_launch');
  // Detach operator data before awaiting credential lookup or caller callbacks.
  configuration = structuredClone(configuration);
  manifest = structuredClone(manifest);
  const observed = await prepareAlgorithmDevelopment({ configuration });
  if (JSON.stringify(observed) !== JSON.stringify(manifest)) fail('manifest_mismatch');
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
  let transport, records = 0, report;
  try {
    const apiKey = await keyProvider();
    transport = createAlgorithmDevelopmentTransport({ configuration,
      checkpoint: { requestCount: manifest.checkpoint.requestCount,
        reservedMicroUsd: manifest.checkpoint.reservedMicroUsd },
      historySha256: manifest.checkpoint.historySha256, apiKey, fetchImpl,
      onRecord: record => persist(`request-${String(++records).padStart(5, '0')}.json`, record) });
    // Only the model-facing half leaves preflight; no evaluator gold reaches the runner.
    const { modelInputs } = await loadDevelopmentFreeze();
    report = await runAlgorithmDevelopmentComparison({ cases: modelInputs, transport,
      outputDirectory: directory, onCase: row => persist(`case-${row.id}.json`, row) });
    persist('report.json', report);
    return report;
  } finally {
    // Unknown/pending reservations survive failures. Do not repair or refund them.
    try { transport?.close(); }
    finally { persist('closed.json', { completed: report !== undefined, records,
      closedAt: new Date().toISOString() }); }
  }
}
