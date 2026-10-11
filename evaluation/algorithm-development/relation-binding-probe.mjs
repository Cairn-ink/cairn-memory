// One-shot answer-only diagnostic. Explicit ports; no CLI, environment-key lookup,
// capture, retrieval, rubric parsing, retry or alternate accounting engine.
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../experiment-budget/index.mjs';
import { packMixedAnswer, packRelationBoundAnswer } from '../longmemeval/mixed-answer.mjs';
import { fail, freeze, sha256, snapshotJson } from '../longmemeval/mixed-validation.mjs';
import { algorithmLimits, createRelationBindingTransport } from './transport.mjs';
import { RELATION_BINDING_VERSION, loadRelationBindingInputs,
  relationBindingArms, relationBindingLimits, renderRelationBindingUnits, validateRelationBindingInputs } from './relation-binding-profile.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = value => JSON.parse(JSON.stringify(snapshotJson(value,
  { bytes: 2_000_000, nodes: 40_000, depth: 16 }, 'invalid_relation_binding_manifest')));
const git = args => execFileSync('/usr/bin/git', ['-C', root, ...args], {
  encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const checkpoint = state => ({ requestCount: state.requestCount,
  reservedMicroUsd: state.reservedMicroUsd, historySha256: state.historySha256 });

export function planRelationBindingAnswers(source) {
  const data = validateRelationBindingInputs(source), planned = [];
  for (const [index, row] of data.cases.entries()) {
    const units = renderRelationBindingUnits(row);
    const order = index % 2 ? ['relation', 'baseline'] : ['baseline', 'relation'];
    for (const arm of order) {
      const packed = (arm === 'relation' ? packRelationBoundAnswer : packMixedAnswer)(
        { question: row.question, units, countTokens: countOpenAITokens });
      if (packed.inputTokens > relationBindingLimits.inputTokens || packed.omittedIndices.length
        || packed.duplicateIndices.length || packed.selectedIndices.length !== units.length) fail('relation_binding_context_exceeded');
      const requestBody = JSON.stringify(packed.request);
      planned.push({ cellId: `${row.id}-${arm}`, id: row.id, ordinal: index + 1, arm,
        question: row.question, units, requestBody, requestSha256: sha256(requestBody), inputTokens: packed.inputTokens });
    }
  }
  return freeze(planned);
}

// Local copy of the existing launch's private owned-directory/exclusive-fsync seam.
// Kept local rather than broadening a shared launch or accounting API.
function outputIdentity(path, empty = false) {
  if (typeof path !== 'string' || resolve(path) !== path) fail('unsafe_output_directory');
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(path) !== path
    || entry.uid !== process.getuid() || (entry.mode & 0o777) !== 0o700) fail('unsafe_output_directory');
  if (empty && readdirSync(path).length) fail('output_already_used');
  return { directory: path, dev: entry.dev, ino: entry.ino, uid: entry.uid, mode: entry.mode & 0o777 };
}
function prepareInternal({ configuration, outputDirectory }, started = false) {
  configuration = snapshot(configuration);
  if (configuration.limitMicroUsd !== 400_000_000) fail('campaign_limit_mismatch');
  const output = outputIdentity(outputDirectory, !started);
  if (started && JSON.stringify(readdirSync(outputDirectory)) !== JSON.stringify(['started.json'])) fail('output_already_used');
  if (git(['status', '--porcelain', '--untracked-files=normal'])) fail('runtime_not_clean');
  const sourceSnapshot = loadRelationBindingInputs(), planned = planRelationBindingAnswers(sourceSnapshot);
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  if (state.state !== 'open' || state.attempts.some(row => row.outcome === null)) fail('campaign_unsettled');
  if (state.limitMicroUsd - state.reservedMicroUsd < algorithmLimits.protectedMicroUsd + algorithmLimits.reservedMicroUsd
    || state.requestCap - state.requestCount < algorithmLimits.httpRequests) fail('campaign_unaffordable');
  const files = git(['ls-files', '--', 'core', 'adapters/openai', 'evaluation/longmemeval',
    'evaluation/algorithm-development', 'evaluation/experiment-budget', 'plugins/cairn-memory/lib', 'tools/testing',
    'docs/plans/relation-binding-probe.md', 'docs/plans/relation-binding-fixtures.md']).split('\n').filter(Boolean);
  const artifactHashes = Object.fromEntries(files.map(path => [path, sha256(readFileSync(join(root, path)))]));
  // Rubric is opaque bytes for the manifest only, never interpreted or sent to an answering model.
  for (const path of ['evaluation/algorithm-development/relation-binding-cases.json',
    'evaluation/algorithm-development/relation-binding-rubric.json']) {
    if (!artifactHashes[path]) fail('relation_binding_freeze_missing');
  }
  const manifest = { schemaVersion: `${RELATION_BINDING_VERSION}-launch`, runtimeDirectory: root,
    runtimeCommit: git(['rev-parse', 'HEAD']), artifactHashes, nodeVersion: process.versions.node,
    nodeExecutable: realpathSync(process.execPath), nodeSha256: sha256(readFileSync(process.execPath)),
    configuration, outputIdentity: output, checkpoint: checkpoint(state), sourceSnapshot, planned,
    limits: relationBindingLimits, affordabilityLimits: algorithmLimits,
    limitation: 'Full submitted source answer-only diagnostic; no natural capture, retrieval, semantic support or promotion.' };
  return freeze({ ...manifest, sha256: sha256(JSON.stringify(manifest)) });
}
export const prepareRelationBindingProbe = options => prepareInternal(options);

function requireReview(receipt, manifest) {
  if (receipt?.manifestSha256 !== manifest.sha256
    || receipt?.standards?.decision !== 'approved' || receipt?.spec?.decision !== 'approved'
    || !['standards', 'spec'].every(axis => typeof receipt[axis].reviewerId === 'string' && receipt[axis].reviewerId.trim())
    || receipt.standards.reviewerId === receipt.spec.reviewerId) fail('relation_binding_review_missing');
}
const redact = (value, secret) => typeof value === 'string' ? (secret ? value.split(secret).join('[REDACTED]') : value)
  : Array.isArray(value) ? value.map(row => redact(row, secret))
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, row]) => [key, redact(row, secret)])) : value;
function failure(error, secret) {
  // Retain stable codes, never arbitrary exception messages (including key lookup errors).
  const code = typeof error?.code === 'string' ? error.code : 'relation_binding_failure';
  return secret && code.includes(secret) ? 'relation_binding_failure' : code;
}

export async function executeRelationBindingProbe({ configuration, outputDirectory, manifest,
  reviewReceipt, keyProvider, fetchImpl }) {
  if (typeof keyProvider !== 'function' || typeof fetchImpl !== 'function') fail('invalid_relation_binding_ports');
  configuration = snapshot(configuration); manifest = snapshot(manifest); reviewReceipt = snapshot(reviewReceipt);
  if (manifest.schemaVersion !== `${RELATION_BINDING_VERSION}-launch`) fail('manifest_mismatch');
  const observed = prepareInternal({ configuration, outputDirectory });
  if (JSON.stringify(observed) !== JSON.stringify(manifest)) fail('manifest_mismatch');
  requireReview(reviewReceipt, manifest);
  // Detached before the explicit asynchronous credential port; failures retain all fixed slots.
  const planned = freeze(snapshot(manifest.planned)), sources = freeze(snapshot(manifest.sourceSnapshot));
  const identity = manifest.outputIdentity;
  const persist = (name, value) => {
    if (JSON.stringify(outputIdentity(outputDirectory)) !== JSON.stringify(identity)) fail('output_directory_changed');
    const fd = openSync(join(outputDirectory, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    const dir = openSync(outputDirectory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (fstatSync(dir).ino !== identity.ino) fail('output_directory_changed'); fsyncSync(dir); }
    finally { closeSync(dir); }
    if (JSON.stringify(outputIdentity(outputDirectory)) !== JSON.stringify(identity)) fail('output_directory_changed');
  };
  persist('started.json', { manifest, reviewReceipt, startedAt: new Date().toISOString() });
  let transport, secret = null, fatal = null, accountingFailure = null, finalBudget = null;
  let requestSnapshots = 0, attempts = 0, dispatched = 0, reportAvailable = false, persistenceFailure = null;
  const ownAttemptIds = new Set();
  const cells = planned.map(cell => ({ cellId: cell.cellId, id: cell.id, ordinal: cell.ordinal, arm: cell.arm,
    status: 'unresolved', failure: 'not_run', answer: null, latencyMs: null }));
  const onRecord = row => {
    if (row.outcome === 'unknown' && row.latencyMs === undefined) {
      ownAttemptIds.add(row.attemptId);
      if (++attempts > relationBindingLimits.httpRequests) fail('relation_binding_request_cap');
    }
    if (attempts * row.reservedMicroUsd > relationBindingLimits.localCeilingMicroUsd) fail('relation_binding_local_ceiling');
    persist(`request-${String(++requestSnapshots).padStart(3, '0')}.json`, redact(row, secret));
  };
  const began = performance.now();
  try {
    if (JSON.stringify(prepareInternal({ configuration, outputDirectory }, true)) !== JSON.stringify(manifest)) fail('manifest_mismatch');
    secret = await keyProvider();
    if (JSON.stringify(prepareInternal({ configuration, outputDirectory }, true)) !== JSON.stringify(manifest)) fail('manifest_mismatch');
    transport = createRelationBindingTransport({ configuration,
      checkpoint: { requestCount: manifest.checkpoint.requestCount, reservedMicroUsd: manifest.checkpoint.reservedMicroUsd },
      historySha256: manifest.checkpoint.historySha256, apiKey: secret, onRecord,
      fetchImpl: async (url, options) => {
        const scheduled = planned[dispatched];
        if (!scheduled || options.body !== scheduled.requestBody || url !== 'https://api.openai.com/v1/chat/completions') fail('relation_binding_unplanned_request');
        dispatched++;
        return fetchImpl(url, options);
      } });
    for (const [index, scheduled] of planned.entries()) {
      if (index % 2 === 0) transport.beginCase({ id: scheduled.id, ordinal: scheduled.ordinal });
      transport.beginArm(scheduled.arm);
      persist(`cell-${scheduled.cellId}-start.json`, scheduled);
      const started = performance.now();
      try {
        const result = await transport.answer({ question: scheduled.question, units: scheduled.units });
        if (JSON.stringify(result.packed.request) !== scheduled.requestBody) fail('relation_binding_request_mismatch');
        Object.assign(cells[index], { status: 'completed', failure: null, answer: result.answer, latencyMs: performance.now() - started });
        persist(`cell-${scheduled.cellId}-end.json`, cells[index]);
      } catch (error) {
        cells[index].failure = failure(error, secret); cells[index].latencyMs = performance.now() - started;
        persist(`cell-${scheduled.cellId}-end.json`, redact(cells[index], secret)); throw error;
      }
      if (index % 2 === 1) transport.endCase();
    }
  } catch (error) { fatal = failure(error, secret); }
  finally {
    try { transport?.close(); } catch (error) { fatal ??= failure(error, secret); }
    try {
      const state = inspectEmbeddingExperimentBudgetSnapshot(configuration); finalBudget = checkpoint(state);
      if (state.requestCount !== manifest.checkpoint.requestCount + attempts
        || state.reservedMicroUsd !== manifest.checkpoint.reservedMicroUsd + attempts * 5000
        || state.attempts.some(row => row.outcome === null)
        || state.attempts.slice(manifest.checkpoint.requestCount).some(row => !ownAttemptIds.has(row.attemptId))) fail('relation_binding_accounting_drift');
    } catch (error) { accountingFailure = failure(error, secret); fatal ??= 'relation_binding_accounting_failure'; }
    for (const cell of cells) if (cell.failure === 'not_run') cell.failure = fatal ?? 'not_run';
    const records = transport?.records() ?? [];
    const resources = Object.fromEntries(relationBindingArms.map(arm => {
      const rows = records.filter(row => row.arm === arm), requests = planned.filter(row => row.arm === arm);
      return [arm, { plannedAnswers: requests.length, attemptedRequests: rows.length,
        finalRequestLocalInputTokens: requests.reduce((sum, row) => sum + row.inputTokens, 0),
        reportedInputTokens: rows.reduce((sum, row) => sum + (row.usage?.input_tokens ?? 0), 0),
        reportedOutputTokens: rows.reduce((sum, row) => sum + (row.usage?.output_tokens ?? 0), 0),
        usageUnknownRequests: rows.filter(row => row.usage === null).length,
        reservedMicroUsd: rows.reduce((sum, row) => sum + row.reservedMicroUsd, 0),
        knownProfileEstimateMicroUsd: rows.reduce((sum, row) => sum + (row.actualMicroUsd ?? 0), 0),
        requestElapsedMs: rows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) }];
    }));
    const report = redact({ schemaVersion: `${RELATION_BINDING_VERSION}-result`, manifestSha256: manifest.sha256,
      sourceSha256: manifest.artifactHashes['evaluation/algorithm-development/relation-binding-cases.json'],
      rubricSha256: manifest.artifactHashes['evaluation/algorithm-development/relation-binding-rubric.json'],
      denominator: 24, sourceDenominator: 12, sourceSnapshot: sources, planned,
      completed: cells.filter(cell => cell.status === 'completed').length, attempted: attempts, dispatched,
      fatal, accountingFailure, cells, records, resources, finalBudget,
      latencyMs: performance.now() - began, limitation: manifest.limitation }, secret);
    try { persist('report.json', report); reportAvailable = true; }
    catch (error) { persistenceFailure = failure(error, secret); fatal ??= 'relation_binding_persistence_failure'; }
    try {
      persist('closure.json', redact({ manifestSha256: manifest.sha256, closedAt: new Date().toISOString(), fatal,
        accountingFailure, persistenceFailure, attempted: attempts, dispatched, requestSnapshots, finalBudget, reportAvailable }, secret));
    } catch (error) { persistenceFailure ??= failure(error, secret); fatal ??= 'relation_binding_persistence_failure'; }
    secret = null;
    if (persistenceFailure) fail('relation_binding_persistence_failure');
  }
  return freeze(JSON.parse(readFileSync(join(outputDirectory, 'report.json'), 'utf8')));
}
