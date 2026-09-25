import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fsyncSync, fstatSync, lstatSync, mkdirSync,
  openSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runtimeFiles, packageName, packageVersion } from '../../packaging/build.mjs';
import { loadQualifiedSourcePairInstalledCoreDeadline } from '../experiment-budget/installed-core-deadline.mjs';
import { inspectQualifiedSourcePairParent, authorizeQualifiedSourcePairCapability,
  createQualifiedSourcePairExperimentRequestGuard } from '../experiment-budget/request-guard.mjs';
import { qualifiedSourcePairProtocol, runQualifiedSourcePair } from '../longmemeval/public-comparison.mjs';
import { aggregateQualifiedSourceScores, scoreQualifiedSourcePair } from '../longmemeval/qualified-source-scoring.mjs';
import { loadReferenceRenderings } from '../longmemeval/reference-rendering.mjs';
import { loadPreparedPilot, pilotEvaluatorFor } from './pilot.mjs';
import { createQualifiedSourcePairPhaseQuota } from './qualified-source-pair-phase-quota.mjs';

export const QUALIFIED_SOURCE_PAIR_LAUNCH_PLAN_VERSION = 'cairn-qualified-source-pair-launch-plan-v1';
export const QUALIFIED_SOURCE_PAIR_LAUNCH_REPORT_VERSION = 'cairn-qualified-source-pair-launch-report-v1';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const QUESTION_ID = /^lme-case-[0-9a-f]{64}$/u;
const ARM_NAMES = ['qualified-prefix', 'indexed-windows'];
const HARNESS_FILES = Object.freeze([
  'core/capture-input.mjs',
  'core/model-budget.mjs',
  'core/model-call.mjs',
  'core/model-diagnostics.mjs',
  'core/source-windows.mjs',
  'core/validation.mjs',
  'evaluation/experiment-budget/index.mjs',
  'evaluation/experiment-budget/installed-core-deadline.mjs',
  'evaluation/experiment-budget/request-guard.mjs',
  'evaluation/experiment-budget/transport-diagnostics.mjs',
  'evaluation/longmemeval/comparison.mjs',
  'evaluation/longmemeval/ingestion.mjs',
  'evaluation/longmemeval/official-scoring.mjs',
  'evaluation/longmemeval/prepare.mjs',
  'evaluation/longmemeval/public-comparison.mjs',
  'evaluation/longmemeval/qualified-source-scoring.mjs',
  'evaluation/longmemeval/receipt-canonicalization.mjs',
  'evaluation/longmemeval/reference-rendering.mjs',
  'evaluation/longmemeval/scoring.mjs',
  'evaluation/longmemeval/validation.mjs',
  'evaluation/live/pilot.mjs',
  'evaluation/live/public-pilot.mjs',
  'evaluation/live/qualified-source-pair-launch.mjs',
  'evaluation/live/qualified-source-pair-launch-cli.mjs',
  'evaluation/live/qualified-source-pair-phase-quota.mjs',
  'packaging/artifact-files.json',
  'packaging/build.mjs',
  'plugins/cairn-memory/lib/redact.mjs',
]);
const ARTIFACT_EXTRAS = Object.freeze({
  'bin/cairn-memory.mjs': 'packaging/bin/cairn-memory.mjs',
  'README.md': 'packaging/README.md',
  'THIRD_PARTY_NOTICES.md': 'packaging/THIRD_PARTY_NOTICES.md',
  'licenses/tiktoken-LICENSE': 'packaging/licenses/tiktoken-LICENSE',
});
const MAX_PLAN_BYTES = 64 * 1024;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_PREPARED_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const NS_OWNER = 'longmemeval-qualified-source-pair';

export class QualifiedSourcePairLaunchError extends Error {
  constructor(code) { super(code); this.name = 'QualifiedSourcePairLaunchError'; this.code = code; }
}
const fail = (code) => { throw new QualifiedSourcePairLaunchError(code); };
const own = (value, key) => Object.hasOwn(value, key);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const dense = (value, minimum, maximum) => Array.isArray(value)
  && value.length >= minimum && value.length <= maximum
  && Object.keys(value).length === value.length
  && Object.keys(value).every((key, index) => key === String(index));
const safe = (value) => Number.isSafeInteger(value) && value >= 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value, (key, item) => item && !Array.isArray(item)
  && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map((name) =>
    [name, item[name]])) : item);
const PUBLIC_CODES = new Set(['invalid_arguments', 'invalid_plan', 'launch_consumed',
  'claim_consumed', 'output_exists', 'prepared_invalid', 'prepared_mismatch',
  'installed_mismatch', 'harness_mismatch', 'checkpoint_mismatch',
  'phase_caps_exceed_headroom', 'stage_mismatch', 'roster_mismatch',
  'protocol_mismatch', 'evaluator_mismatch', 'reference_unverified',
  'sidecar_invalid', 'missing_key', 'launch_failed', 'launch_output_failed']);
export const publicQualifiedSourcePairLaunchCode = (error) => error instanceof QualifiedSourcePairLaunchError
  && PUBLIC_CODES.has(error.code) ? error.code : 'launch_failed';

function absolutePath(value, errorCode) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || value === path.parse(value).root || /[\x00-\x1f\x7f]/u.test(value)
    || value.split(path.sep).some((part) => part === '.' || part === '..')) fail(errorCode);
  for (let current = value; current !== path.parse(value).root; current = path.dirname(current)) {
    let entry;
    try { entry = lstatSync(current); }
    catch (error) { if (error?.code === 'ENOENT') continue; fail(errorCode); }
    if (entry.isSymbolicLink()) fail(errorCode);
  }
  return value;
}

function privateDirectory(directory, errorCode) {
  absolutePath(directory, errorCode);
  let entry;
  try { entry = lstatSync(directory); } catch { fail(errorCode); }
  if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(directory) !== directory
    || process.platform !== 'win32' && (entry.mode & 0o777) !== 0o700) fail(errorCode);
  return entry;
}

function regularBytes(filename, maximum, errorCode, privateMode) {
  absolutePath(filename, errorCode);
  if (privateMode) privateDirectory(path.dirname(filename), errorCode);
  let before, descriptor;
  try {
    before = lstatSync(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum
      || privateMode && process.platform !== 'win32' && (before.mode & 0o777) !== 0o600
      || realpathSync(filename) !== filename) fail(errorCode);
    descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) fail(errorCode);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail(errorCode);
    return bytes;
  } catch (error) {
    if (error instanceof QualifiedSourcePairLaunchError) throw error;
    fail(errorCode);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}

function absent(filename, errorCode) {
  absolutePath(filename, errorCode);
  try { lstatSync(filename); fail(errorCode); }
  catch (error) { if (error instanceof QualifiedSourcePairLaunchError || error?.code !== 'ENOENT') fail(errorCode); }
}

function validatePlan(plan, planPath) {
  const required = ['schemaVersion', 'executionId', 'prepared', 'installed', 'harness', 'ledger',
    'parent', 'checkpoint', 'answerModel', 'limits', 'judgeTimeoutMs', 'roster', 'phaseCaps',
    'outputDirectory', 'keyFile'];
  if (!exact(plan, own(plan, 'referenceSidecar') ? [...required, 'referenceSidecar'] : required)
    || plan.schemaVersion !== QUALIFIED_SOURCE_PAIR_LAUNCH_PLAN_VERSION
    || typeof plan.executionId !== 'string' || !ID.test(plan.executionId)) fail('invalid_plan');
  if (!exact(plan.prepared, ['directory', 'manifestSha256', 'historySha256', 'questionsSha256',
    'evaluatorSha256']) || !exact(plan.installed, ['receiptPath', 'receiptSha256', 'artifactSha256'])
    || !exact(plan.harness, ['commit', 'sourceHashes'])
    || !exact(plan.ledger, ['directory', 'runId', 'limitMicroUsd', 'requestCap'])
    || !exact(plan.checkpoint, ['requestCount', 'reservedMicroUsd', 'attemptsSha256'])
    || !exact(plan.limits, ['contextWindow', 'outputTokens', 'answerTimeoutMs', 'recallLimit'])
    || !exact(plan.phaseCaps, ['generation', 'scoring'])) fail('invalid_plan');
  for (const [filename, maximum, errorCode] of [
    [plan.prepared.directory, 0, 'invalid_plan'], [plan.installed.receiptPath, 0, 'invalid_plan'],
    [plan.ledger.directory, 0, 'invalid_plan'], [plan.outputDirectory, 0, 'invalid_plan'],
    [plan.keyFile, 0, 'invalid_plan']]) {
    void maximum;
    absolutePath(filename, errorCode);
  }
  if (!['manifestSha256', 'historySha256', 'questionsSha256', 'evaluatorSha256']
    .every((key) => typeof plan.prepared[key] === 'string' && SHA.test(plan.prepared[key]))
    || !SHA.test(plan.installed.receiptSha256) || !SHA.test(plan.installed.artifactSha256)
    || !COMMIT.test(plan.harness.commit) || !SHA.test(plan.checkpoint.attemptsSha256)
    || !safe(plan.checkpoint.requestCount) || !safe(plan.checkpoint.reservedMicroUsd)
    || typeof plan.answerModel !== 'string' || !plan.answerModel
    || !safe(plan.judgeTimeoutMs) || plan.judgeTimeoutMs < 1
    || !Object.values(plan.limits).every((value) => safe(value) && value > 0)
    || plan.limits.recallLimit > 12) fail('invalid_plan');
  if (!exact(plan.harness.sourceHashes, HARNESS_FILES)
    || !HARNESS_FILES.every((name) => SHA.test(plan.harness.sourceHashes[name]))) fail('invalid_plan');
  for (const phase of ['generation', 'scoring']) {
    if (!exact(plan.phaseCaps[phase], ['requests', 'reservedMicroUsd'])
      || !safe(plan.phaseCaps[phase].requests) || !safe(plan.phaseCaps[phase].reservedMicroUsd)) {
      fail('invalid_plan');
    }
  }
  if (!dense(plan.roster, 1, 250)) fail('invalid_plan');
  const questions = new Set();
  for (const item of plan.roster) {
    if (!exact(item, ['questionId', 'armOrder', 'protocolDigest'])
      || typeof item.questionId !== 'string' || !QUESTION_ID.test(item.questionId)
      || questions.has(item.questionId) || !SHA.test(item.protocolDigest)
      || !dense(item.armOrder, 2, 2)
      || new Set(item.armOrder).size !== 2
      || ARM_NAMES.some((name) => !item.armOrder.includes(name))) fail('invalid_plan');
    questions.add(item.questionId);
  }
  if (own(plan, 'referenceSidecar')) {
    if (!exact(plan.referenceSidecar, ['path', 'sha256'])
      || !SHA.test(plan.referenceSidecar.sha256)) fail('invalid_plan');
    absolutePath(plan.referenceSidecar.path, 'invalid_plan');
  }
  const directory = path.dirname(planPath);
  privateDirectory(directory, 'invalid_plan');
  if (path.dirname(plan.outputDirectory) !== directory || plan.outputDirectory === plan.prepared.directory
    || plan.outputDirectory === plan.ledger.directory || plan.outputDirectory === directory
    || plan.prepared.directory === directory || plan.ledger.directory === directory) fail('invalid_plan');
  const marker = path.join(directory, `qualified-source-pair-launch-${plan.executionId}.json`);
  const failure = path.join(directory, `qualified-source-pair-launch-${plan.executionId}.failure.json`);
  const inputFiles = [planPath, plan.keyFile, plan.installed.receiptPath,
    plan.referenceSidecar?.path, ...['manifest.json', 'history.jsonl', 'questions.jsonl',
      'evaluator.jsonl'].map((name) => path.join(plan.prepared.directory, name))].filter(Boolean);
  const inside = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`);
  if (new Set(inputFiles).size !== inputFiles.length
    || inputFiles.some((filename) => [marker, failure, plan.outputDirectory].includes(filename)
      || inside(plan.ledger.directory, filename) || inside(plan.outputDirectory, filename))
    || [plan.prepared.directory, plan.ledger.directory, path.dirname(plan.installed.receiptPath)]
      .some((parent) => inside(parent, plan.outputDirectory)
        || inside(plan.outputDirectory, parent))) {
    fail('invalid_plan');
  }
  return { marker, failure };
}

function verifyHarness(plan) {
  let commit;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT,
    encoding: 'utf8', timeout: 5_000 }).trim(); }
  catch { fail('harness_mismatch'); }
  if (commit !== plan.harness.commit) fail('harness_mismatch');
  for (const name of HARNESS_FILES) {
    if (sha256(regularBytes(path.join(ROOT, name), 4 * 1024 * 1024,
      'harness_mismatch', false)) !== plan.harness.sourceHashes[name]) fail('harness_mismatch');
  }
}

function verifyInstalled(plan) {
  const receiptBytes = regularBytes(plan.installed.receiptPath, MAX_RECEIPT_BYTES,
    'installed_mismatch', true);
  if (sha256(receiptBytes) !== plan.installed.receiptSha256) fail('installed_mismatch');
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString('utf8')); } catch { fail('installed_mismatch'); }
  const fields = ['artifact', 'executable', 'databasePath', 'ownerId', 'projectId', 'stdio'];
  if (!exact(receipt, own(receipt, 'captureQualification')
    ? [...fields, 'captureQualification'] : fields)
    || !exact(receipt.artifact, ['path', 'sha256', 'name', 'version', 'sourceHashes'])
    || receipt.artifact.sha256 !== plan.installed.artifactSha256
    || receipt.artifact.name !== packageName || receipt.artifact.version !== packageVersion
    || receipt.captureQualification !== 'source-bound-v2') fail('installed_mismatch');
  absolutePath(receipt.executable, 'installed_mismatch');
  absolutePath(receipt.artifact.path, 'installed_mismatch');
  if (sha256(regularBytes(receipt.artifact.path, MAX_ARCHIVE_BYTES,
    'installed_mismatch', false)) !== receipt.artifact.sha256) fail('installed_mismatch');
  const root = path.dirname(path.dirname(receipt.executable));
  if (path.basename(root) !== packageName || receipt.executable !== path.join(root, 'bin/cairn-memory.mjs')) {
    fail('installed_mismatch');
  }
  const expectedNames = [...runtimeFiles, ...Object.keys(ARTIFACT_EXTRAS)];
  if (!exact(receipt.artifact.sourceHashes, expectedNames)
    || expectedNames.some((name) => !SHA.test(receipt.artifact.sourceHashes[name]))) {
    fail('installed_mismatch');
  }
  for (const name of expectedNames) {
    const expected = receipt.artifact.sourceHashes[name];
    const source = ARTIFACT_EXTRAS[name] ?? name;
    if (sha256(regularBytes(path.join(root, name), 4 * 1024 * 1024,
      'installed_mismatch', false)) !== expected
      || sha256(regularBytes(path.join(ROOT, source), 4 * 1024 * 1024,
        'installed_mismatch', false)) !== expected) fail('installed_mismatch');
  }
  let manifest;
  try { manifest = JSON.parse(regularBytes(path.join(root, 'package.json'), MAX_RECEIPT_BYTES,
    'installed_mismatch', false).toString('utf8')); }
  catch { fail('installed_mismatch'); }
  if (manifest.name !== packageName || manifest.version !== packageVersion
    || manifest.type !== 'module') fail('installed_mismatch');
  return { root, artifactSha256: receipt.artifact.sha256,
    sourceHashesSha256: sha256(canonical(receipt.artifact.sourceHashes)) };
}

function verifyPrepared(plan) {
  privateDirectory(plan.prepared.directory, 'prepared_invalid');
  for (const [name, key] of [['manifest.json', 'manifestSha256'], ['history.jsonl', 'historySha256'],
    ['questions.jsonl', 'questionsSha256'], ['evaluator.jsonl', 'evaluatorSha256']]) {
    const maximum = name === 'manifest.json' ? 1024 * 1024 : MAX_PREPARED_BYTES;
    if (sha256(regularBytes(path.join(plan.prepared.directory, name), maximum,
      'prepared_invalid', true)) !== plan.prepared[key]) fail('prepared_mismatch');
  }
}

function validateHeadroom(plan, state) {
  if (state.requestCount !== plan.checkpoint.requestCount
    || state.reservedMicroUsd !== plan.checkpoint.reservedMicroUsd
    || sha256(canonical(state.attempts)) !== plan.checkpoint.attemptsSha256) fail('checkpoint_mismatch');
  const requests = plan.phaseCaps.generation.requests + plan.phaseCaps.scoring.requests;
  const money = plan.phaseCaps.generation.reservedMicroUsd + plan.phaseCaps.scoring.reservedMicroUsd;
  if (!Number.isSafeInteger(requests) || !Number.isSafeInteger(money)
    || requests > state.requestCap - state.requestCount
    || money > state.limitMicroUsd - state.reservedMicroUsd) fail('phase_caps_exceed_headroom');
}

export async function preflightQualifiedSourcePairLaunch({ planPath }) {
  absolutePath(planPath, 'invalid_plan');
  const planBytes = regularBytes(planPath, MAX_PLAN_BYTES, 'invalid_plan', true);
  let plan;
  try { plan = JSON.parse(planBytes.toString('utf8')); } catch { fail('invalid_plan'); }
  const paths = validatePlan(plan, planPath);
  absent(paths.marker, 'launch_consumed');
  absent(paths.failure, 'launch_consumed');
  absent(plan.outputDirectory, 'output_exists');
  absent(path.join(plan.ledger.directory,
    `experiment-qualified-source-pair-${plan.executionId}.claim.json`), 'claim_consumed');
  verifyHarness(plan);
  const installed = verifyInstalled(plan);
  verifyPrepared(plan);
  const state = inspectQualifiedSourcePairParent({ ledger: plan.ledger,
    policy: plan.parent.policy, benchmarkExtension: plan.parent });
  validateHeadroom(plan, state);
  if (plan.answerModel !== plan.parent.stages?.answer?.model
    || plan.parent.stages.answer.timeoutMs + 1_000 > plan.limits.answerTimeoutMs
    || plan.parent.stages.judge.timeoutMs + 1_000 > plan.judgeTimeoutMs) fail('stage_mismatch');
  const pilot = await loadPreparedPilot({ directory: plan.prepared.directory, maxCases: 500 });
  if (pilot.identity.manifestSha256 !== plan.prepared.manifestSha256
    || pilot.identity.historySha256 !== plan.prepared.historySha256
    || pilot.identity.questionsSha256 !== plan.prepared.questionsSha256
    || pilot.identity.evaluatorSha256 !== plan.prepared.evaluatorSha256) fail('prepared_mismatch');
  if (plan.roster.length !== pilot.cases.length) fail('roster_mismatch');
  const selected = [];
  for (const [index, entry] of plan.roster.entries()) {
    const item = pilot.cases[index];
    if (item.question.question_id !== entry.questionId) fail('roster_mismatch');
    const namespace = { ownerId: NS_OWNER, scope: 'project', projectId: entry.questionId };
    const data = { history: item.history, question: item.question, namespace,
      answerModel: plan.answerModel, limits: plan.limits, armOrder: entry.armOrder };
    const protocol = qualifiedSourcePairProtocol(data);
    if (protocol.digest !== entry.protocolDigest) fail('protocol_mismatch');
    const evaluator = pilotEvaluatorFor(pilot, entry.questionId);
    if (!evaluator) fail('evaluator_mismatch');
    selected.push({ data, protocol, evaluator });
  }
  let renderings = null;
  if (own(plan, 'referenceSidecar')) {
    regularBytes(plan.referenceSidecar.path, MAX_PREPARED_BYTES, 'sidecar_invalid', true);
    renderings = await loadReferenceRenderings({ preparedDirectory: plan.prepared.directory,
      sidecarPath: plan.referenceSidecar.path,
      expectedSidecarSha256: plan.referenceSidecar.sha256 });
  }
  if (selected.some(({ evaluator, data }) => typeof evaluator.reference_answer !== 'string'
    && !renderings?.has(data.question.question_id))) fail('reference_unverified');
  const compactRoster = selected.map(({ protocol }) => ({ questionId: protocol.questionId,
    protocolDigest: protocol.digest, armOrder: [...protocol.armOrder],
    arms: protocol.arms.map(({ name, scopeId }) => ({ name, scopeId })) }));
  const scoreRoster = selected.map(({ protocol, evaluator }) => ({ protocol,
    sourceQuestionId: evaluator.source_question_id, questionType: evaluator.question_type }));
  return { plan, planSha256: sha256(planBytes), paths, installed, state, selected,
    compactRoster, scoreRoster, renderings,
    publicSummary: { mode: 'dry-run', verified: true, selectedCount: selected.length,
      artifactSha256: installed.artifactSha256,
      protocolSetSha256: sha256(canonical(compactRoster.map((entry) => entry.protocolDigest))),
      checkpoint: { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd },
      phaseCaps: plan.phaseCaps } };
}

function writePrivateDurable(filename, value, errorCode = 'launch_output_failed') {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  if (bytes.length > 64 * 1024 * 1024) fail(errorCode);
  let descriptor;
  try {
    descriptor = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    const directory = openSync(path.dirname(filename), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve first error. */ } }
    fail(errorCode);
  }
}

function makePrivateDirectory(directory) {
  absent(directory, 'output_exists');
  try {
    mkdirSync(directory, { mode: 0o700 });
    const entry = lstatSync(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink()
      || process.platform !== 'win32' && (entry.mode & 0o777) !== 0o700) fail('launch_output_failed');
    const parent = openSync(path.dirname(directory), constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } catch (error) {
    if (error instanceof QualifiedSourcePairLaunchError) throw error;
    fail('launch_output_failed');
  }
}

function defaultReadKey(filename) {
  return regularBytes(filename, 1024, 'missing_key', true).toString('utf8').trim();
}

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 512
    && !/[\s\x00-\x1f\x7f]/u.test(key);
}

function accounting(baseline, guard, quota) {
  let current, attempts, caseTimeouts, transportDiagnostics;
  try {
    current = guard.getState();
    attempts = guard.attempts();
    caseTimeouts = guard.caseTimeouts();
    transportDiagnostics = guard.transportDiagnostics?.() ?? null;
  } catch { fail('accounting_failed'); }
  const prior = baseline.attempts.length;
  const owned = current.attempts.slice(prior);
  const used = quota.snapshot().used;
  const shadowRequests = used.generation.requests + used.scoring.requests;
  const shadowReserved = used.generation.reservedMicroUsd + used.scoring.reservedMicroUsd;
  const requests = current.requestCount - baseline.requestCount;
  const reservedMicroUsd = current.reservedMicroUsd - baseline.reservedMicroUsd;
  if (!safe(requests) || !safe(reservedMicroUsd) || requests !== owned.length
    || attempts.length !== owned.length
    || requests > shadowRequests || reservedMicroUsd > shadowReserved
    || canonical(current.attempts.slice(0, prior)) !== canonical(baseline.attempts)) {
    fail('accounting_failed');
  }
  return { baseline: { requestCount: baseline.requestCount,
    reservedMicroUsd: baseline.reservedMicroUsd },
  current: { requestCount: current.requestCount, reservedMicroUsd: current.reservedMicroUsd },
  owned: { requests, reservedMicroUsd,
    knownActualMicroUsd: owned.reduce((sum, row) => sum + (row.actualMicroUsd ?? 0), 0),
    unknownCostRequests: owned.filter((row) => row.actualMicroUsd === null).length,
    pendingRequests: owned.filter((row) => row.outcome === null).length },
  shadow: quota.snapshot(), attempts, caseTimeouts, transportDiagnostics };
}

async function stageText(fetchRoute, endpoint, key, request, signal) {
  const response = await fetchRoute(endpoint, { method: 'POST', redirect: 'error', signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, store: false, stream: false }) });
  const body = await response.json();
  const text = body?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('invalid_stage_response');
  return { text };
}

async function runInstalled(preflight, key, fetchImpl, recordFailureContext) {
  const { plan, paths, installed, selected, compactRoster, scoreRoster, renderings } = preflight;
  const policy = plan.parent.policy;
  const stages = plan.parent.stages;
  const installedCoreDeadline = await loadQualifiedSourcePairInstalledCoreDeadline({ packageRoot: installed.root });
  const capability = authorizeQualifiedSourcePairCapability({ ledger: plan.ledger, policy,
    benchmarkExtension: plan.parent, authorizationId: plan.executionId,
    executionId: plan.executionId, checkpoint: { requestCount: plan.checkpoint.requestCount,
      reservedMicroUsd: plan.checkpoint.reservedMicroUsd }, roster: compactRoster });
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: plan.ledger,
    policy, benchmarkExtension: plan.parent, qualifiedSourcePairCapability: capability,
    fetchImpl, transportDiagnostics: 'bounded-v1', installedCoreDeadline });
  let firstFailure = null;
  let firstFailureStage = null;
  let secondaryFailure = null;
  let secondaryFailureStage = null;
  let guardClosed = false;
  const generations = new Map();
  const scorings = new Map();
  const databasePaths = [];
  const started = Date.now();
  try {
    const quota = createQualifiedSourcePairPhaseQuota({ guard, policy, stages,
      phaseCaps: plan.phaseCaps });
    const [installedCore, installedAdapter] = await Promise.all([
      import(pathToFileURL(path.join(installed.root, 'core/index.mjs')).href),
      import(pathToFileURL(path.join(installed.root, 'adapters/openai/index.mjs')).href),
    ]);
    if (typeof installedCore.openMemoryCore !== 'function'
      || typeof installedAdapter.createOpenAIModel !== 'function') fail('installed_mismatch');
    const model = installedAdapter.createOpenAIModel({ apiKey: key,
      fetchImpl: quota.cairnFetch });
    const countTokens = model.countTokens.bind(model);
    const answer = ({ request, signal }) => stageText(quota.answerFetch,
      stages.answer.endpoint, key, request, signal);
    const judge = ({ request, signal }) => stageText(quota.judgeFetch,
      stages.judge.endpoint, key, request, signal);
    makePrivateDirectory(plan.outputDirectory);
    const casesDirectory = path.join(plan.outputDirectory, 'cases');
    makePrivateDirectory(casesDirectory);
    writePrivateDurable(path.join(plan.outputDirectory, 'manifest.json'), {
      version: QUALIFIED_SOURCE_PAIR_LAUNCH_REPORT_VERSION, executionId: plan.executionId,
      planSha256: preflight.planSha256, artifactSha256: installed.artifactSha256,
      sourceHashesSha256: installed.sourceHashesSha256, harnessCommit: plan.harness.commit,
      prepared: plan.prepared, checkpoint: plan.checkpoint, phaseCaps: plan.phaseCaps,
      protocols: compactRoster.map(({ questionId, protocolDigest, armOrder }) =>
        ({ questionId, protocolDigest, armOrder })),
      interpretation: 'source-pair-evaluation-not-product-parity-or-host-integration-proof' });
    for (const { data, protocol } of selected) {
      if (quota.execution.isHalted()) break;
      const caseDirectory = path.join(casesDirectory, data.question.question_id);
      makePrivateDirectory(caseDirectory);
      const cores = {};
      try {
        for (const [name, keyName, sourcePolicy] of [
          [ARM_NAMES[0], 'qualifiedPrefix', null], [ARM_NAMES[1], 'indexedWindows', 'indexed-windows-v1'],
        ]) {
          const filename = path.join(caseDirectory, `${name}.sqlite`);
          absent(filename, 'output_exists');
          cores[keyName] = installedCore.openMemoryCore({ path: filename, model,
            captureQualification: 'source-bound-v2',
            ...(sourcePolicy ? { captureSourcePolicy: sourcePolicy } : {}) });
          databasePaths.push(filename);
        }
        const run = await runQualifiedSourcePair({ ...data, cores, answer, countTokens,
          execution: quota.execution });
        if (canonical(run.protocol) !== canonical(protocol)) fail('protocol_mismatch');
        generations.set(protocol.questionId, run);
        writePrivateDurable(path.join(caseDirectory, 'generation.json'), run);
      } catch (error) {
        if (!firstFailure) {
          firstFailure = publicQualifiedSourcePairLaunchCode(error);
          firstFailureStage = 'generation';
        }
        break;
      }
      finally {
        for (const core of Object.values(cores)) {
          try { core.close(); } catch {
            secondaryFailure ??= 'core_close_failed';
            secondaryFailureStage ??= 'core_close';
          }
        }
      }
      if (generations.get(protocol.questionId)?.executionStatus === 'halted') {
        firstFailure ??= generations.get(protocol.questionId).haltReason;
        firstFailureStage ??= 'generation';
        break;
      }
    }
    if (!firstFailure && !quota.execution.isHalted()) {
      for (const { data, protocol, evaluator } of selected) {
        if (quota.execution.isHalted()) break;
        const run = generations.get(protocol.questionId);
        if (!run) break;
        try {
          const result = await scoreQualifiedSourcePair({ run, expectedProtocol: protocol,
            evaluator, judge, judgeTimeoutMs: plan.judgeTimeoutMs, execution: quota.execution,
            ...(renderings ? { referenceRendering: renderings.get(protocol.questionId) } : {}) });
          scorings.set(protocol.questionId, result);
          writePrivateDurable(path.join(casesDirectory, data.question.question_id,
            'scoring.json'), result);
          if (result.executionStatus === 'halted') {
            firstFailure ??= result.haltReason;
            firstFailureStage ??= 'scoring';
            break;
          }
        } catch (error) {
          if (!firstFailure) {
            firstFailure = publicQualifiedSourcePairLaunchCode(error);
            firstFailureStage = 'scoring';
          }
          break;
        }
      }
    }
    if (!firstFailure && quota.execution.isHalted()) {
      firstFailure = quota.snapshot().haltReason ?? 'guard_halted';
      firstFailureStage = 'execution';
    }
    const aggregate = aggregateQualifiedSourceScores({ roster: scoreRoster,
      records: [...scorings.values()] });
    const observed = accounting(preflight.state, guard, quota);
    try { guard.close(); guardClosed = true; }
    catch {
      secondaryFailure ??= 'guard_close_failed';
      secondaryFailureStage ??= 'guard_close';
    }
    const storageBytes = databasePaths.reduce((sum, filename) => {
      try { return sum + statSync(filename).size; } catch { return sum; }
    }, 0);
    const report = { version: QUALIFIED_SOURCE_PAIR_LAUNCH_REPORT_VERSION,
      executionId: plan.executionId, planSha256: preflight.planSha256,
      artifactSha256: installed.artifactSha256, harnessCommit: plan.harness.commit,
      status: firstFailure || secondaryFailure || quota.execution.isHalted() ? 'halted' : 'completed',
      firstFailure, firstFailureStage, secondaryFailure, secondaryFailureStage,
      protocolSetSha256: preflight.publicSummary.protocolSetSha256,
      fixedCaseCount: selected.length, generationRecordCount: generations.size,
      scoringRecordCount: scorings.size, aggregate, accounting: observed,
      latencyMs: Date.now() - started, databaseBytes: storageBytes,
      interpretation: 'source-pair-evaluation-not-product-parity-or-host-integration-proof' };
    writePrivateDurable(path.join(plan.outputDirectory, 'report.json'), report);
    return { mode: 'launch', status: report.status, selectedCount: selected.length,
      generatedCount: generations.size, scoredCount: scorings.size,
      reservedMicroUsd: observed.owned.reservedMicroUsd,
      requestCount: observed.owned.requests,
      unresolved: aggregate.arms['qualified-prefix'].overall.unresolved
        + aggregate.arms['indexed-windows'].overall.unresolved };
  } catch (error) {
    const finalCode = publicQualifiedSourcePairLaunchCode(error);
    const earlier = firstFailure ?? secondaryFailure;
    recordFailureContext({ firstFailure: earlier ?? finalCode,
      firstFailureStage: firstFailure ? firstFailureStage
        : secondaryFailure ? secondaryFailureStage : 'launch',
      secondaryFailures: [
        ...(firstFailure && secondaryFailure ? [{ stage: secondaryFailureStage, code: secondaryFailure }] : []),
        ...(earlier ? [{ stage: 'terminal_persistence_or_accounting', code: finalCode }] : []),
      ].slice(0, 2) });
    throw error;
  } finally {
    if (!guardClosed) {
      try { guard.close(); } catch { /* First failure and durable claim remain authoritative. */ }
    }
  }
}

export async function runQualifiedSourcePairLaunch({ planPath, mode, fetchImpl = globalThis.fetch,
  readKey = defaultReadKey }) {
  if (!['dry-run', 'launch'].includes(mode) || typeof planPath !== 'string') fail('invalid_arguments');
  const first = await preflightQualifiedSourcePairLaunch({ planPath });
  if (mode === 'dry-run') return first.publicSummary;
  if (typeof fetchImpl !== 'function' || typeof readKey !== 'function') fail('invalid_arguments');
  // A second independent read is required immediately before consuming the
  // launch. A changed plan, prepared input, parent or ledger never reuses the
  // first snapshot.
  const checked = await preflightQualifiedSourcePairLaunch({ planPath });
  if (first.planSha256 !== checked.planSha256
    || canonical(first.state) !== canonical(checked.state)
    || canonical(first.compactRoster) !== canonical(checked.compactRoster)
    || canonical(first.installed) !== canonical(checked.installed)) fail('preflight_changed');
  writePrivateDurable(checked.paths.marker, { version: 'qualified-source-pair-launch-attempt-v1',
    executionId: checked.plan.executionId, planSha256: checked.planSha256,
    artifactSha256: checked.installed.artifactSha256,
    checkpoint: checked.plan.checkpoint }, 'launch_consumed');
  let key;
  let failureContext = null;
  try {
    key = readKey(checked.plan.keyFile);
    if (!validKey(key)) fail('missing_key');
    return await runInstalled(checked, key, fetchImpl, (context) => { failureContext = context; });
  } catch (error) {
    const firstCode = publicQualifiedSourcePairLaunchCode(error);
    try {
      writePrivateDurable(checked.paths.failure, {
        version: 'qualified-source-pair-launch-failure-v1',
        executionId: checked.plan.executionId, planSha256: checked.planSha256,
        code: firstCode, markerConsumed: true,
        ...(failureContext ?? { firstFailure: firstCode, firstFailureStage: 'launch',
          secondaryFailures: [] }),
      }, 'failure_record_write_failed');
    } catch { /* Irrevocable marker is still authoritative. */ }
    throw error;
  } finally { key = undefined; }
}
