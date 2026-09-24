#!/usr/bin/env node
// Private, one-shot operator wrapper around the reviewed public-pilot CLI.
import { spawnSync } from 'node:child_process';
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, openSync,
  readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { loadBenchmarkBudgetExtension } from '../experiment-budget/request-guard.mjs';
import { planLongMemEvalCase } from '../longmemeval/ingestion.mjs';
import { opaqueQuestionId } from '../longmemeval/prepare.mjs';
import { loadPreparedPilot } from './pilot.mjs';
import { benchmarkStagePolicy } from './public-pilot.mjs';
import { experimentPolicy } from './session.mjs';
import { failSmoke, ReliabilitySmokeError, selectFreshSmoke, smokeSha256 } from './reliability-smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
const PHASE_MAX_MICRO_USD = 12_000_000;
const PHASE_MAX_REQUESTS = 2_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const OUTPUT_FILES = { manifest: 'manifest.json', history: 'history.jsonl',
  questions: 'questions.jsonl', evaluator: 'evaluator.jsonl' };
const ANSWER_TEMPLATE = 'cairn-longmemeval-public-answer-v2';

export const USAGE = `Usage: node evaluation/live/reliability-smoke-cli.mjs --plan <private-0600-json> (--dry-run | --launch)\n`;

const exact = (value, keys, code) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) failSmoke(code);
};
const boundedInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const safePath = (value, code) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')
    || value.split(/[\\/]+/u).includes('..')) failSmoke(code);
  const resolved = path.resolve(value);
  if (resolved !== value || resolved === path.parse(resolved).root) failSmoke(code);
  return resolved;
};
const checkAncestors = (filename, code) => {
  let current = path.parse(filename).root;
  const parts = path.relative(current, path.dirname(filename)).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    let entry;
    try { entry = lstatSync(current); } catch { failSmoke(code); }
    if (!entry.isDirectory() || entry.isSymbolicLink()) failSmoke(code);
  }
};
const readBounded = (filename, maximum, code, privateMode = true) => {
  const resolved = safePath(filename, code);
  checkAncestors(resolved, code);
  let before; let descriptor;
  try {
    before = lstatSync(resolved);
    if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maximum
      || privateMode && process.platform !== 'win32' && (before.mode & 0o777) !== 0o600) failSmoke(code);
    descriptor = openSync(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) failSmoke(code);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs) {
      failSmoke(code);
    }
    return bytes;
  } catch (error) {
    if (error instanceof ReliabilitySmokeError) throw error;
    failSmoke(code);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
};
const readJson = (filename, maximum, code, privateMode = true) => {
  const bytes = readBounded(filename, maximum, code, privateMode);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { failSmoke(code); }
  return { value, sha256: smokeSha256(bytes) };
};
const verifyHash = (actual, expected, code) => {
  if (!SHA.test(expected) || actual !== expected) failSmoke(code);
};
const absent = (filename, code) => {
  const resolved = safePath(filename, code);
  checkAncestors(resolved, code);
  try { lstatSync(resolved); failSmoke(code); }
  catch (error) { if (error instanceof ReliabilitySmokeError || error?.code !== 'ENOENT') failSmoke(code); }
};
const canonical = (value) => JSON.stringify(value, (key, item) => item && !Array.isArray(item)
  && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0)) : item);
const authorityBindings = (directory) => readdirSync(directory)
  .filter((name) => name.startsWith('experiment-') && name.endsWith('.json')).sort()
  .map((name) => ({ name, sha256: smokeSha256(readBounded(path.join(directory, name),
    1024 * 1024, 'authority_invalid')) }));
const ledgerSnapshot = (configuration) => {
  const handle = reopenExperimentBudget(configuration);
  try {
    const state = handle.getState();
    const rows = state.attempts.map((attempt) => ({ attemptId: attempt.attemptId,
      channel: attempt.channel, reservedMicroUsd: attempt.reservedMicroUsd,
      outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd }));
    return { limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap,
      requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
      state: state.state, unsettledAttempts: rows.filter((row) => row.outcome === null).length,
      attemptsSha256: smokeSha256(canonical(rows)) };
  } finally { handle.close(); }
};

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 3 || argv[0] !== '--plan'
    || typeof argv[1] !== 'string' || !['--dry-run', '--launch'].includes(argv[2])) {
    failSmoke('invalid_arguments');
  }
  return { planPath: argv[1], mode: argv[2] === '--dry-run' ? 'dry-run' : 'launch' };
}

function validatePlan(plan, planPath) {
  exact(plan, ['version', 'source', 'exclusions', 'prepared', 'sidecar', 'ledger',
    'selection', 'runtimeCommit', 'authorizations', 'checkpoint', 'projection',
    'outputDirectory', 'keyFile'], 'invalid_plan');
  if (plan.version !== 'cairn-fresh-reliability-smoke-launch-v1' || !COMMIT.test(plan.runtimeCommit)) {
    failSmoke('invalid_plan');
  }
  for (const field of ['source', 'exclusions', 'sidecar', 'ledger']) {
    exact(plan[field], ['path', 'sha256'], 'invalid_plan');
    safePath(plan[field].path, 'invalid_plan');
    if (!SHA.test(plan[field].sha256)) failSmoke('invalid_plan');
  }
  exact(plan.prepared, ['directory', 'manifestSha256', 'historySha256', 'questionsSha256',
    'evaluatorSha256'], 'invalid_plan');
  safePath(plan.prepared.directory, 'invalid_plan');
  for (const key of ['manifestSha256', 'historySha256', 'questionsSha256', 'evaluatorSha256']) {
    if (!SHA.test(plan.prepared[key])) failSmoke('invalid_plan');
  }
  exact(plan.selection, ['membershipSha256', 'preparedOrderSha256'], 'invalid_plan');
  if (!SHA.test(plan.selection.membershipSha256) || !SHA.test(plan.selection.preparedOrderSha256)) {
    failSmoke('invalid_plan');
  }
  exact(plan.authorizations, ['benchmark', 'requestAllowance', 'budgetExtension', 'case', 'execution'],
    'invalid_plan');
  if (Object.values(plan.authorizations).some((value) => typeof value !== 'string' || !ID.test(value))
    || new Set(Object.values(plan.authorizations)).size !== 5) failSmoke('invalid_plan');
  exact(plan.checkpoint, ['requestCount', 'reservedMicroUsd', 'attemptsSha256'], 'invalid_plan');
  if (!boundedInteger(plan.checkpoint.requestCount) || !boundedInteger(plan.checkpoint.reservedMicroUsd)
    || !SHA.test(plan.checkpoint.attemptsSha256)) failSmoke('invalid_plan');
  exact(plan.projection, ['requests', 'reservedMicroUsd'], 'invalid_plan');
  if (!boundedInteger(plan.projection.requests) || !boundedInteger(plan.projection.reservedMicroUsd)
    || plan.projection.requests < 1 || plan.projection.reservedMicroUsd < 1) failSmoke('invalid_plan');
  const output = safePath(plan.outputDirectory, 'invalid_plan');
  const planDirectory = path.dirname(planPath);
  if (path.dirname(output) !== planDirectory) failSmoke('invalid_plan');
  safePath(plan.keyFile, 'invalid_plan');
  const parent = lstatSync(planDirectory);
  if (!parent.isDirectory() || parent.isSymbolicLink()
    || process.platform !== 'win32' && (parent.mode & 0o777) !== 0o700
    || realpathSync(planDirectory) !== planDirectory) failSmoke('invalid_plan');
  return plan;
}

function inspectRuntime(expected) {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'],
    { cwd: ROOT, encoding: 'utf8' });
  if (head.status !== 0 || status.status !== 0 || head.stdout.trim() !== expected || status.stdout !== '') {
    failSmoke('runtime_mismatch');
  }
}

function capture() {
  let value = '';
  return { write(chunk) {
    value += String(chunk);
    if (value.length > MAX_CAPTURE_BYTES) failSmoke('delegate_output_too_large');
    return true;
  }, text() { return value; } };
}
const delegateRecord = (output, expectedMode) => {
  const lines = output.trim().split('\n').filter(Boolean);
  let record;
  try { record = JSON.parse(lines.at(-1)); } catch { failSmoke('delegate_output_invalid'); }
  if (record?.mode !== expectedMode) failSmoke('delegate_output_invalid');
  return record;
};

async function invokeDelegate(args, env, dependencies) {
  // The import is deliberately deferred until after the outer launch marker.
  const delegate = dependencies.delegateMain ?? (await import('./public-pilot-cli.mjs')).main;
  const stdout = capture(); const stderr = capture();
  const code = await delegate(args, { env, stdout, stderr, fetchImpl: dependencies.fetchImpl ?? globalThis.fetch });
  if (code !== 0) failSmoke('delegate_failed');
  return delegateRecord(stdout.text(), args.includes('--dry-run') ? 'dry-run' : 'run');
}

function createLaunchMarker(filename, record) {
  let descriptor;
  try {
    descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${canonical(record)}\n`, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor); descriptor = undefined;
    const directoryDescriptor = openSync(path.dirname(filename), constants.O_RDONLY
      | (constants.O_NOFOLLOW ?? 0));
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
  } catch (error) {
    if (error?.code === 'EEXIST') failSmoke('launch_consumed');
    failSmoke('launch_marker_failed');
  } finally { if (descriptor !== undefined) try { closeSync(descriptor); } catch { /* terminal */ } }
}

function readKey(filename) {
  // The previously authorized local env file may be 0644. Descriptor identity,
  // no-follow and strict parsing still apply; this wrapper never changes it.
  const bytes = readBounded(filename, 64 * 1024, 'key_file_invalid', false);
  let key;
  try { key = parseEnv(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).OPENAI_API_KEY; }
  catch { failSmoke('key_file_invalid'); }
  if (typeof key !== 'string' || key.length === 0 || key !== key.trim() || /\s/u.test(key)) {
    failSmoke('key_file_invalid');
  }
  return key;
}

function verifyFrozenInputs(plan) {
  const source = readJson(plan.source.path, MAX_SOURCE_BYTES, 'source_invalid');
  verifyHash(source.sha256, plan.source.sha256, 'source_hash_mismatch');
  const excluded = readJson(plan.exclusions.path, 1024 * 1024, 'exclusions_invalid');
  verifyHash(excluded.sha256, plan.exclusions.sha256, 'exclusions_hash_mismatch');
  const selection = selectFreshSmoke(source.value, excluded.value);
  verifyHash(selection.membershipSha256, plan.selection.membershipSha256, 'selection_mismatch');
  verifyHash(selection.preparedOrderSha256, plan.selection.preparedOrderSha256, 'selection_mismatch');
  const manifest = readJson(path.join(plan.prepared.directory, OUTPUT_FILES.manifest),
    1024 * 1024, 'prepared_invalid');
  verifyHash(manifest.sha256, plan.prepared.manifestSha256, 'prepared_hash_mismatch');
  for (const field of ['history', 'questions', 'evaluator']) {
    const bytes = readBounded(path.join(plan.prepared.directory, OUTPUT_FILES[field]),
      32 * 1024 * 1024, 'prepared_invalid');
    verifyHash(smokeSha256(bytes), plan.prepared[`${field}Sha256`], 'prepared_hash_mismatch');
  }
  const expectedIds = selection.sourceQuestionIdsPreparedOrder;
  if (manifest.value?.dataset?.input_sha256 !== source.sha256
    || manifest.value?.selection?.count !== 6
    || JSON.stringify(manifest.value.selection.source_question_ids) !== JSON.stringify(expectedIds)
    || JSON.stringify(manifest.value.selection.question_ids)
      !== JSON.stringify(expectedIds.map(opaqueQuestionId))) failSmoke('prepared_roster_mismatch');
  const sidecar = readJson(plan.sidecar.path, 32 * 1024 * 1024, 'sidecar_invalid');
  verifyHash(sidecar.sha256, plan.sidecar.sha256, 'sidecar_hash_mismatch');
  if (sidecar.value?.source_sha256 !== source.sha256 || sidecar.value?.manifest_sha256 !== manifest.sha256
    || sidecar.value?.evaluator_sha256 !== plan.prepared.evaluatorSha256
    || !Array.isArray(sidecar.value.cases) || sidecar.value.cases.length !== 6
    || JSON.stringify(sidecar.value.cases.map((item) => item.source_question_id)) !== JSON.stringify(expectedIds)
    || JSON.stringify(sidecar.value.cases.map((item) => item.question_id))
      !== JSON.stringify(expectedIds.map(opaqueQuestionId))) failSmoke('sidecar_roster_mismatch');
  return { selection, caseIds: expectedIds.map(opaqueQuestionId) };
}

function verifyAuthority(plan, marker) {
  const ledgerFile = readJson(plan.ledger.path, 64 * 1024, 'ledger_config_invalid');
  verifyHash(ledgerFile.sha256, plan.ledger.sha256, 'ledger_config_hash_mismatch');
  exact(ledgerFile.value, ['directory', 'runId', 'limitMicroUsd', 'requestCap'], 'ledger_config_invalid');
  if (ledgerFile.value.limitMicroUsd !== 100_000_000 || !boundedInteger(ledgerFile.value.requestCap)) {
    failSmoke('ledger_config_invalid');
  }
  absent(marker, 'launch_consumed');
  const base = ledgerFile.value.directory;
  absent(path.join(base, `experiment-case-deadline-${plan.authorizations.execution}.json`), 'capability_not_new');
  absent(path.join(base, `experiment-case-deadline-${plan.authorizations.execution}.claim.json`), 'claim_not_new');
  absent(plan.outputDirectory, 'output_exists');
  const ledger = ledgerSnapshot(ledgerFile.value);
  if (ledger.state !== 'open' || ledger.unsettledAttempts !== 0
    || ledger.requestCount !== plan.checkpoint.requestCount
    || ledger.reservedMicroUsd !== plan.checkpoint.reservedMicroUsd
    || ledger.attemptsSha256 !== plan.checkpoint.attemptsSha256) failSmoke('checkpoint_mismatch');
  loadBenchmarkBudgetExtension({ ledger: ledgerFile.value, policy: experimentPolicy(),
    benchmarkAuthorizationId: plan.authorizations.benchmark,
    requestAllowanceAuthorizationId: plan.authorizations.requestAllowance,
    authorizationId: plan.authorizations.budgetExtension, stages: benchmarkStagePolicy() });
  return { configuration: ledgerFile.value, state: ledger, bindings: authorityBindings(base) };
}

function delegateBase(plan, caseIds) {
  const ids = plan.authorizations;
  return ['--prepared', plan.prepared.directory, '--ledger', plan.ledger.path,
    '--authorization-id', ids.benchmark,
    '--request-allowance-authorization-id', ids.requestAllowance,
    '--budget-extension-authorization-id', ids.budgetExtension,
    '--max-prepared-cases', '6', '--cases', caseIds.join(','),
    '--sidecar', plan.sidecar.path, '--sidecar-sha256', plan.sidecar.sha256,
    '--run-commit', plan.runtimeCommit, '--exclusions-file', plan.exclusions.path,
    '--answer-template-version', ANSWER_TEMPLATE];
}

function validateProjection(record, plan, caseIds) {
  if (record.maxPreparedCases !== 6 || record.runCommit !== plan.runtimeCommit
    || JSON.stringify(record.caseIds) !== JSON.stringify(caseIds)
    || record.answerTemplateVersion !== ANSWER_TEMPLATE
    || record.exclusionCount !== 82
    || record.models?.answer !== 'gpt-4.1-mini-2025-04-14'
    || record.models?.judge !== 'gpt-4o-2024-08-06'
    || record.requestAllowance?.authorizationId !== plan.authorizations.requestAllowance
    || record.budgetExtension?.authorizationId !== plan.authorizations.budgetExtension
    || !boundedInteger(record.totals?.requests) || !boundedInteger(record.totals?.reservedMicroUsd)
    || record.totals.requests < 1 || record.totals.reservedMicroUsd < 1) {
    failSmoke('delegate_projection_mismatch');
  }
  if (record.totals.requests > PHASE_MAX_REQUESTS || record.totals.reservedMicroUsd > PHASE_MAX_MICRO_USD
    || record.fits?.ledger !== true) failSmoke('projection_exceeds_cap');
  return record.totals;
}

async function projectedTotals(plan, caseIds) {
  const pilot = await loadPreparedPilot({ directory: plan.prepared.directory, maxCases: 6 });
  if (JSON.stringify(pilot.cases.map((item) => item.question.question_id)) !== JSON.stringify(caseIds)) {
    failSmoke('prepared_roster_mismatch');
  }
  const totals = { requests: 0, reservedMicroUsd: 0 };
  for (const item of pilot.cases) {
    const planCase = planLongMemEvalCase({ history: item.history,
      namespace: { ownerId: 'longmemeval-public-pilot', scope: 'project',
        projectId: item.question.question_id } });
    if (planCase.executable !== true) failSmoke('prepared_not_executable');
    const batches = planCase.batches.length;
    totals.requests += batches * 4 + 12;
    totals.reservedMicroUsd += (batches * 4 + 6) * 5_000 + 3 * 50_820 + 3 * 10_400;
  }
  if (totals.requests > PHASE_MAX_REQUESTS || totals.reservedMicroUsd > PHASE_MAX_MICRO_USD
    || canonical(totals) !== canonical(plan.projection)) failSmoke('projection_exceeds_cap');
  return totals;
}

export async function main(argv, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  try {
    const { planPath, mode } = parseArguments(argv);
    const resolvedPlan = safePath(planPath, 'invalid_plan');
    const input = readJson(resolvedPlan, 64 * 1024, 'invalid_plan');
    const plan = validatePlan(input.value, resolvedPlan);
    (dependencies.inspectRuntime ?? inspectRuntime)(plan.runtimeCommit);
    const { caseIds } = verifyFrozenInputs(plan);
    const marker = path.join(path.dirname(resolvedPlan), `smoke-launch-attempt-${plan.authorizations.execution}.json`);
    const before = verifyAuthority(plan, marker);
    const totals = await projectedTotals(plan, caseIds);
    if (before.state.limitMicroUsd - before.state.reservedMicroUsd < totals.reservedMicroUsd
      || before.state.requestCap - before.state.requestCount < totals.requests) {
      failSmoke('projection_exceeds_cap');
    }
    const base = delegateBase(plan, caseIds);
    const capped = [...base, '--batch-cap-micro-usd', String(totals.reservedMicroUsd),
      '--batch-request-cap', String(totals.requests)];
    if (mode === 'dry-run') {
      const result = await invokeDelegate([...capped, '--dry-run'], {}, dependencies);
      const delegatedTotals = validateProjection(result, plan, caseIds);
      if (canonical(delegatedTotals) !== canonical(totals) || result.fits?.caps !== true) {
        failSmoke('delegate_projection_mismatch');
      }
      const after = verifyAuthority(plan, marker);
      if (canonical(before.state) !== canonical(after.state)
        || canonical(before.bindings) !== canonical(after.bindings)) failSmoke('dry_run_mutated_authority');
      stdout.write(`${JSON.stringify({ mode, verified: true, selectedCount: 6,
        projectedRequests: totals.requests, projectedReservedMicroUsd: totals.reservedMicroUsd,
        remainingRequestAllowance: before.state.requestCap - before.state.requestCount,
        remainingReservedAllowanceMicroUsd: before.state.limitMicroUsd - before.state.reservedMicroUsd,
        caseDeadlineCapability: 'unissued' })}\n`);
      return 0;
    }
    const checked = verifyAuthority(plan, marker);
    if (canonical(before.state) !== canonical(checked.state)
      || canonical(before.bindings) !== canonical(checked.bindings)) failSmoke('authority_changed');
    createLaunchMarker(marker, { version: 'cairn-fresh-reliability-smoke-attempt-v1',
      executionId: plan.authorizations.execution, runtimeCommit: plan.runtimeCommit,
      planSha256: input.sha256, checkpoint: plan.checkpoint });
    const key = (dependencies.readKey ?? readKey)(plan.keyFile);
    const result = await invokeDelegate([...capped, '--output', plan.outputDirectory,
      '--case-timeout-policy', 'case-deadline-v1',
      '--case-authorization-id', plan.authorizations.case,
      '--execution-id', plan.authorizations.execution,
      '--expected-request-count', String(plan.checkpoint.requestCount),
      '--expected-reserved-micro-usd', String(plan.checkpoint.reservedMicroUsd),
      '--transport-diagnostics', 'bounded-v1'], { OPENAI_API_KEY: key }, dependencies);
    if (result.answerTemplateVersion !== ANSWER_TEMPLATE) failSmoke('delegate_output_invalid');
    stdout.write(`${JSON.stringify({ mode: 'launch', verified: true, selectedCount: 6,
      projectedRequests: totals.requests, projectedReservedMicroUsd: totals.reservedMicroUsd,
      completed: result.summary?.scored ?? null })}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof ReliabilitySmokeError ? error.code : 'smoke_failed'}\n`);
    return 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
