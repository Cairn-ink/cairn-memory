#!/usr/bin/env node
// Guarded launcher for the private LongMemEval public-comparison pilot.
// Every input is explicit. The provider key is read from OPENAI_API_KEY inside
// main() only, handed to the session, and never printed or written anywhere.
import { lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, authorizeCaseDeadlineCapability,
  loadBenchmarkBudgetExtension, loadBenchmarkRequestAllowance } from '../experiment-budget/request-guard.mjs';
import { planLongMemEvalCase } from '../longmemeval/ingestion.mjs';
import { opaqueQuestionId } from '../longmemeval/prepare.mjs';
import { PUBLIC_ANSWER_TEMPLATE_VERSION,
  PUBLIC_ANSWER_TEMPLATE_VERSION_V2 } from '../longmemeval/public-comparison.mjs';
import { loadReferenceRenderings } from '../longmemeval/reference-rendering.mjs';
import { isPlainObject } from '../longmemeval/validation.mjs';
import {
  loadPreparedPilot,
  PILOT_DEFAULT_MAX_CASES,
  PILOT_MAX_CASES,
  readRegularFile,
} from './pilot.mjs';
import { mergePublicPilotRuns } from './public-pilot-merge.mjs';
import {
  benchmarkStagePolicy,
  canonical,
  createBenchmarkLiveSession,
  createCaseDeadlineLiveSession,
  CASE_TIMEOUT_POLICY_VERSION,
  OWNER_ID,
  projectCaseReservation,
  PUBLIC_PILOT_JUDGE_TIMEOUT_MS,
  PUBLIC_PILOT_LIMITS,
  runPublicPilot,
} from './public-pilot.mjs';
import { experimentPolicy } from './session.mjs';

export const USAGE = `Usage: node evaluation/live/public-pilot-cli.mjs [flags]

Required:
  --prepared <dir>            prepared v2 pilot directory (digest-checked)
  --ledger <file>             0600 JSON with exactly {directory, runId, limitMicroUsd, requestCap}
  --authorization-id <id>     benchmark extension authorization id (provisioned or re-verified)
  --output <dir>              new or resumable private run directory (0700); not needed with --dry-run

Optional:
  --request-allowance-authorization-id <id>
                              load an already-issued benchmark request allowance; never increases the cap
  --budget-extension-authorization-id <id>
                              load an already-issued benchmark budget extension; never changes allowance
  --max-prepared-cases <n>    prepared cohort ceiling, 1..500; default 7; grants no spending authority
  --cases <id,id,...>         source or opaque question ids to run, kept in roster order; default all
  --sidecar <file>            reference-rendering sidecar (render-reference-sidecar.py); needs --sidecar-sha256
  --sidecar-sha256 <hex>      expected sidecar digest
  --batch-cap-micro-usd <n>   this run's reservation cap in micro-USD; needs --batch-request-cap
  --batch-request-cap <n>     this run's request cap
  --run-commit <sha>          recorded in the run manifest and report
  --exclusions-file <file>    JSON array of excluded source question ids, recorded in the manifest and report
  --answer-template-version <version>
                              experimental answer boundary; cairn-longmemeval-public-answer-v1 (default) or v2
  --dry-run                   verify ledger, extension and prepared input, print projections, reserve nothing
  --case-timeout-policy <version>
  --case-authorization-id <id>
  --execution-id <id>
  --expected-request-count <n>
  --expected-reserved-micro-usd <n>
                              complete one-shot case-deadline opt-in; no resume in this or another process
  --transport-diagnostics <version>
                              bounded-v1, only with complete case-deadline opt-in; private generation diagnostics
  --help                      print this text

Merge (offline, no key, no ledger):
  --merge <dir,dir,...>       merge completed run directories into one paired report in --output;
                              no other flag may accompany it

Environment (real run only): OPENAI_API_KEY, read inside main() and used only in the Authorization header.
Exit codes: 0 done, 1 refused or failed (code on stderr), 2 missing OPENAI_API_KEY.
`;

const VALUE_FLAGS = ['--prepared', '--ledger', '--authorization-id', '--output', '--cases', '--sidecar',
  '--sidecar-sha256', '--batch-cap-micro-usd', '--batch-request-cap', '--run-commit', '--exclusions-file',
  '--answer-template-version', '--request-allowance-authorization-id',
  '--budget-extension-authorization-id', '--max-prepared-cases', '--merge'];
VALUE_FLAGS.push('--case-timeout-policy', '--case-authorization-id', '--execution-id',
  '--expected-request-count', '--expected-reserved-micro-usd', '--transport-diagnostics');
const BOOLEAN_FLAGS = ['--dry-run', '--help'];
const MAX_INPUT_BYTES = 1024 * 1024;

export class PublicPilotCliError extends Error {
  constructor(code, detail = null) {
    super(code);
    this.name = 'PublicPilotCliError';
    this.code = code;
    this.detail = detail;
  }
}

const fail = (code, detail) => { throw new PublicPilotCliError(code, detail); };
const errorCode = (error) => (typeof error?.code === 'string' && /^[a-zA-Z0-9_:-]{1,80}$/u.test(error.code)
  ? error.code : 'failure');

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== 'string')) fail('invalid_arguments');
  const values = {};
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_FLAGS.includes(token)) {
      if (flags[token]) fail('duplicate_flag', token);
      flags[token] = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(token)) fail('unknown_flag');
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--') || Object.hasOwn(values, token)) fail('invalid_flag_value', token);
    values[token] = value;
    index += 1;
  }
  return { values, flags };
}

const parseCount = (text, flag) => {
  if (typeof text !== 'string' || !/^[0-9]{1,15}$/u.test(text)) fail('invalid_number', flag);
  return Number(text);
};

async function readPrivateJsonInput(filename, { requireMode600 = false } = {}) {
  const resolved = path.resolve(filename);
  let entry;
  try { entry = await lstat(resolved); } catch { fail('input_unreadable'); }
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > MAX_INPUT_BYTES) fail('input_unreadable');
  if (requireMode600 && (entry.mode & 0o777) !== 0o600) fail('input_permissions');
  let bytes;
  try { bytes = await readRegularFile(resolved, 'input_unreadable', MAX_INPUT_BYTES); }
  catch { return fail('input_unreadable'); }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return fail('input_invalid_json'); }
}

const validateLedgerConfig = (value) => {
  const keys = ['directory', 'runId', 'limitMicroUsd', 'requestCap'];
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key)) || typeof value.directory !== 'string'
    || typeof value.runId !== 'string' || !Number.isSafeInteger(value.limitMicroUsd)
    || !Number.isSafeInteger(value.requestCap)) fail('invalid_ledger_config');
  return { directory: value.directory, runId: value.runId,
    limitMicroUsd: value.limitMicroUsd, requestCap: value.requestCap };
};

const selectCases = (pilot, text) => {
  const roster = pilot.cases.map((item) => item.question.question_id);
  if (text === undefined) return roster;
  const tokens = text.split(',').map((item) => item.trim()).filter(Boolean);
  if (tokens.length === 0) fail('invalid_case_selection');
  const selected = tokens.map((token) => (roster.includes(token) ? token : opaqueQuestionId(token)));
  if (selected.some((id) => !roster.includes(id)) || new Set(selected).size !== selected.length) fail('unknown_case');
  return roster.filter((id) => selected.includes(id));
};

const ledgerSnapshot = (ledger) => {
  const handle = reopenExperimentBudget(ledger);
  try {
    const state = handle.getState();
    return { limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap,
      reservedMicroUsd: state.reservedMicroUsd, requestCount: state.requestCount, state: state.state,
      unsettledAttempts: state.attempts.filter((attempt) => attempt.outcome === null).length };
  } finally { handle.close(); }
};

export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr,
  fetchImpl = globalThis.fetch } = {}) {
  try {
    const { values, flags } = parseArguments(argv);
    if (flags['--help']) { stdout.write(USAGE); return 0; }
    const dryRun = flags['--dry-run'] === true;
    const caseFlags = ['--case-timeout-policy', '--case-authorization-id', '--execution-id',
      '--expected-request-count', '--expected-reserved-micro-usd'];
    const suppliedCaseFlags = caseFlags.filter((flag) => Object.hasOwn(values, flag));
    if (suppliedCaseFlags.length !== 0 && suppliedCaseFlags.length !== caseFlags.length) fail('case_flags_incomplete');
    const caseTimeoutPolicy = suppliedCaseFlags.length ? values['--case-timeout-policy'] : null;
    if (caseTimeoutPolicy !== null && caseTimeoutPolicy !== CASE_TIMEOUT_POLICY_VERSION) fail('invalid_case_timeout_policy');
    const transportDiagnostics = values['--transport-diagnostics'];
    if (transportDiagnostics !== undefined && transportDiagnostics !== 'bounded-v1') fail('invalid_transport_diagnostics');
    if (transportDiagnostics !== undefined && caseTimeoutPolicy === null) fail('transport_diagnostics_requires_case_deadline');
    for (const flag of ['--case-authorization-id', '--execution-id']) {
      if (caseTimeoutPolicy && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(values[flag])) fail('invalid_case_identifier');
    }
    const expectedRequestCount = caseTimeoutPolicy
      ? parseCount(values['--expected-request-count'], '--expected-request-count') : null;
    const expectedReservedMicroUsd = caseTimeoutPolicy
      ? parseCount(values['--expected-reserved-micro-usd'], '--expected-reserved-micro-usd') : null;
    if (values['--merge'] !== undefined) {
      if (dryRun || Object.keys(values).some((flag) => !['--merge', '--output'].includes(flag))) {
        fail('invalid_merge_arguments');
      }
      if (!Object.hasOwn(values, '--output')) fail('missing_required_flag', '--output');
      const directories = values['--merge'].split(',').map((item) => item.trim()).filter(Boolean);
      if (directories.length === 0) fail('invalid_merge_arguments');
      const merged = await mergePublicPilotRuns({ directories, output: values['--output'] });
      stdout.write(`${JSON.stringify({ mode: 'merge', directory: path.resolve(values['--output']),
        summary: merged.summary, common: merged.official.common, cost: merged.cost })}\n`);
      return 0;
    }
    const answerTemplateVersion = values['--answer-template-version'] ?? PUBLIC_ANSWER_TEMPLATE_VERSION;
    if (![PUBLIC_ANSWER_TEMPLATE_VERSION, PUBLIC_ANSWER_TEMPLATE_VERSION_V2].includes(answerTemplateVersion)) {
      fail('invalid_answer_template_version');
    }
    const answerTemplateIdentity = answerTemplateVersion === PUBLIC_ANSWER_TEMPLATE_VERSION_V2
      ? { answerTemplateVersion } : {};
    for (const required of ['--prepared', '--ledger', '--authorization-id', ...(dryRun ? [] : ['--output'])]) {
      if (!Object.hasOwn(values, required)) fail('missing_required_flag', required);
    }
    const maxPreparedCases = values['--max-prepared-cases'] === undefined
      ? PILOT_DEFAULT_MAX_CASES
      : parseCount(values['--max-prepared-cases'], '--max-prepared-cases');
    if (!Number.isSafeInteger(maxPreparedCases) || maxPreparedCases < 1
      || maxPreparedCases > PILOT_MAX_CASES) fail('invalid_max_prepared_cases');
    const sidecar = values['--sidecar'];
    const sidecarSha256 = values['--sidecar-sha256'];
    if ((sidecar === undefined) !== (sidecarSha256 === undefined)) fail('sidecar_flags_incomplete');
    const capMicroUsd = values['--batch-cap-micro-usd'];
    const capRequests = values['--batch-request-cap'];
    if ((capMicroUsd === undefined) !== (capRequests === undefined)) fail('cap_flags_incomplete');
    const caps = capMicroUsd === undefined ? undefined
      : { reservedMicroUsd: parseCount(capMicroUsd, '--batch-cap-micro-usd'),
        requests: parseCount(capRequests, '--batch-request-cap') };
    const runCommit = values['--run-commit'] ?? null;
    if (runCommit !== null && !/^[0-9a-f]{7,64}$/u.test(runCommit)) fail('invalid_run_commit');
    const ledger = validateLedgerConfig(await readPrivateJsonInput(values['--ledger'], { requireMode600: true }));
    if (caseTimeoutPolicy && (expectedRequestCount > ledger.requestCap
      || expectedReservedMicroUsd > ledger.limitMicroUsd)) fail('invalid_case_checkpoint');
    let exclusionRegistry = null;
    if (values['--exclusions-file'] !== undefined) {
      exclusionRegistry = await readPrivateJsonInput(values['--exclusions-file']);
      if (!Array.isArray(exclusionRegistry) || exclusionRegistry.some((item) => typeof item !== 'string')) {
        fail('invalid_exclusions');
      }
    }
    const policy = experimentPolicy();
    const stages = benchmarkStagePolicy();
    const requestAllowanceAuthorizationId = values['--request-allowance-authorization-id'];
    const budgetExtensionAuthorizationId = values['--budget-extension-authorization-id'];
    for (const [identifier, code] of [[requestAllowanceAuthorizationId, 'invalid_request_allowance_identifier'],
      [budgetExtensionAuthorizationId, 'invalid_budget_extension_identifier']]) {
      if (identifier !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(identifier)) fail(code);
    }
    if (budgetExtensionAuthorizationId !== undefined && requestAllowanceAuthorizationId === undefined) {
      fail('budget_extension_requires_request_allowance');
    }
    const benchmarkExtension = budgetExtensionAuthorizationId !== undefined
      ? loadBenchmarkBudgetExtension({ ledger, policy,
        benchmarkAuthorizationId: values['--authorization-id'],
        requestAllowanceAuthorizationId, authorizationId: budgetExtensionAuthorizationId, stages })
      : requestAllowanceAuthorizationId === undefined
      ? authorizeBenchmarkExtension({ ledger, policy, authorizationId: values['--authorization-id'], stages })
      : loadBenchmarkRequestAllowance({ ledger, policy,
        benchmarkAuthorizationId: values['--authorization-id'],
        authorizationId: requestAllowanceAuthorizationId, stages });
    const effectiveRequestAllowance = benchmarkExtension.originalRequestAllowance ?? benchmarkExtension;
    const benchmarkAuthorizationId = effectiveRequestAllowance.originalBenchmarkExtension?.authorizationId
      ?? benchmarkExtension.authorizationId;
    const pilot = await loadPreparedPilot({ directory: values['--prepared'], maxCases: maxPreparedCases });
    const caseIds = selectCases(pilot, values['--cases']);
    const ledgerState = ledgerSnapshot(ledger);
    const preflightReferenceRenderings = caseTimeoutPolicy && sidecar !== undefined
      ? await loadReferenceRenderings({ preparedDirectory: values['--prepared'], sidecarPath: sidecar,
        expectedSidecarSha256: sidecarSha256 }) : undefined;
    const caseSchedule = [...caseIds.map((caseId) => ({ phase: 'generation', caseId })),
      ...caseIds.map((caseId) => ({ phase: 'scoring', caseId }))];
    if (caseTimeoutPolicy) {
      const claim = path.join(ledger.directory,
        `experiment-case-deadline-${values['--execution-id']}.claim.json`);
      try { await lstat(claim); fail('capability_consumed'); }
      catch (error) { if (error instanceof PublicPilotCliError || error?.code !== 'ENOENT') throw error; }
    }
    const caseDeadlineCapability = caseTimeoutPolicy ? authorizeCaseDeadlineCapability({ ledger, policy,
      benchmarkExtension, authorizationId: values['--case-authorization-id'], executionId: values['--execution-id'],
      checkpoint: { requestCount: expectedRequestCount, reservedMicroUsd: expectedReservedMicroUsd },
      schedule: caseSchedule }) : null;
    const caseTimeoutIdentity = caseDeadlineCapability ? {
      effectivePolicyVersion: CASE_TIMEOUT_POLICY_VERSION,
      executionId: caseDeadlineCapability.executionId,
      authorizationId: caseDeadlineCapability.authorizationId,
      capabilityDigest: createHash('sha256').update(canonical([caseDeadlineCapability]), 'utf8').digest('hex'),
    } : null;
    const projections = caseIds.map((questionId) => {
      const item = pilot.cases.find((candidate) => candidate.question.question_id === questionId);
      const plan = planLongMemEvalCase({ history: item.history,
        namespace: { ownerId: OWNER_ID, scope: 'project', projectId: questionId } });
      return { questionId, ...projectCaseReservation(plan, stages) };
    });
    const totals = projections.reduce((sum, item) => ({ reservedMicroUsd: sum.reservedMicroUsd + item.reservedMicroUsd,
      requests: sum.requests + item.requests }), { reservedMicroUsd: 0, requests: 0 });
    const fits = {
      caps: caps ? totals.reservedMicroUsd <= caps.reservedMicroUsd && totals.requests <= caps.requests : null,
      ledger: ledgerState.limitMicroUsd - ledgerState.reservedMicroUsd >= totals.reservedMicroUsd
        && ledgerState.requestCap - ledgerState.requestCount >= totals.requests,
    };
    const summary = { pilot: pilot.identity, caseIds, maxPreparedCases, ...answerTemplateIdentity,
      models: { answer: stages.answer.model, judge: stages.judge.model },
      limits: PUBLIC_PILOT_LIMITS, judgeTimeoutMs: PUBLIC_PILOT_JUDGE_TIMEOUT_MS, caps: caps ?? null,
      extension: { authorizationId: benchmarkAuthorizationId, checkpoint: benchmarkExtension.checkpoint },
      ledger: ledgerState, projections, totals, fits, runCommit,
      exclusionCount: exclusionRegistry ? exclusionRegistry.length : null };
    const requestAllowance = requestAllowanceAuthorizationId === undefined ? null : {
        version: effectiveRequestAllowance.version,
        authorizationId: effectiveRequestAllowance.authorizationId,
        priorRequestCap: effectiveRequestAllowance.priorLedger.requestCap,
        requestCap: effectiveRequestAllowance.ledger.requestCap,
        checkpoint: effectiveRequestAllowance.checkpoint,
        historicalDigest: effectiveRequestAllowance.historicalDigest,
      };
    const budgetExtension = budgetExtensionAuthorizationId === undefined ? null : {
      version: benchmarkExtension.version,
      authorizationId: benchmarkExtension.authorizationId,
      priorLimitMicroUsd: benchmarkExtension.priorLedger.limitMicroUsd,
      limitMicroUsd: benchmarkExtension.ledger.limitMicroUsd,
      priorRequestCap: benchmarkExtension.priorLedger.requestCap,
      requestCap: benchmarkExtension.ledger.requestCap,
      checkpoint: benchmarkExtension.checkpoint,
      historicalDigest: benchmarkExtension.historicalDigest,
    };
    if (requestAllowance) summary.requestAllowance = requestAllowance;
    if (budgetExtension) summary.budgetExtension = budgetExtension;
    if (caseTimeoutIdentity) {
      summary.caseTimeoutIdentity = caseTimeoutIdentity;
      summary.caseTimeoutRestriction = 'live-process-only; one-shot; no resume or retry';
    }
    if (transportDiagnostics) summary.transportDiagnostics = transportDiagnostics;
    if (dryRun) {
      stdout.write(`${JSON.stringify({ mode: 'dry-run', ...summary })}\n`);
      return 0;
    }
    if (caseDeadlineCapability) {
      try { await lstat(path.resolve(values['--output'])); fail('case_output_must_be_new'); }
      catch (error) { if (error instanceof PublicPilotCliError || error?.code !== 'ENOENT') throw error; }
    }
    const apiKey = env.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      stderr.write('missing_environment OPENAI_API_KEY\n');
      return 2;
    }
    if (typeof fetchImpl !== 'function') fail('missing_fetch');
    const referenceRenderings = preflightReferenceRenderings ?? (sidecar === undefined ? undefined
      : await loadReferenceRenderings({ preparedDirectory: values['--prepared'], sidecarPath: sidecar,
        expectedSidecarSha256: sidecarSha256 }));
    const session = caseDeadlineCapability
      ? createCaseDeadlineLiveSession({ ledger, apiKey, fetchImpl, benchmarkExtension, caseDeadlineCapability,
        ...(transportDiagnostics ? { transportDiagnostics } : {}) })
      : createBenchmarkLiveSession({ ledger, apiKey, fetchImpl, benchmarkExtension });
    let report;
    try {
      report = await runPublicPilot({ pilot, session, directory: values['--output'], limits: PUBLIC_PILOT_LIMITS,
        judgeTimeoutMs: PUBLIC_PILOT_JUDGE_TIMEOUT_MS, referenceRenderings, caps, caseIds, answerTemplateVersion,
        manifest: { runCommit, authorizationId: benchmarkAuthorizationId, maxPreparedCases,
          extensionCheckpoint: benchmarkExtension.checkpoint, ledgerRunId: ledger.runId,
          sidecarSha256: sidecarSha256 ?? null, exclusionRegistry, projections, totals,
          ...(requestAllowance ? { requestAllowance } : {}),
          ...(budgetExtension ? { budgetExtension } : {}) },
        onCase: (progress) => { stdout.write(`${JSON.stringify({ progress })}\n`); } });
    } finally { session.close(); }
    stdout.write(`${JSON.stringify({ mode: 'run', directory: path.resolve(values['--output']), ...answerTemplateIdentity,
      summary: report.summary, common: report.official.common, cost: report.cost, latency: report.latency,
      ...(requestAllowance ? { requestAllowance } : {}),
      ...(budgetExtension ? { budgetExtension } : {}) })}\n`);
    return 0;
  } catch (error) {
    const detail = typeof error?.detail === 'string' ? ` ${error.detail}` : '';
    stderr.write(`${errorCode(error)}${detail}\n`);
    return 1;
  }
}

const invokedDirectly = typeof process.argv[1] === 'string'
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
