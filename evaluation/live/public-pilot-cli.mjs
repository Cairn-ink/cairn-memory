#!/usr/bin/env node
// Guarded launcher for the private LongMemEval public-comparison pilot.
// Every input is explicit. The provider key is read from OPENAI_API_KEY inside
// main() only, handed to the session, and never printed or written anywhere.
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { reopenExperimentBudget } from '../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension } from '../experiment-budget/request-guard.mjs';
import { planLongMemEvalCase } from '../longmemeval/ingestion.mjs';
import { opaqueQuestionId } from '../longmemeval/prepare.mjs';
import { PUBLIC_ANSWER_TEMPLATE_VERSION,
  PUBLIC_ANSWER_TEMPLATE_VERSION_V2 } from '../longmemeval/public-comparison.mjs';
import { loadReferenceRenderings } from '../longmemeval/reference-rendering.mjs';
import { isPlainObject } from '../longmemeval/validation.mjs';
import { loadPreparedPilot, readRegularFile } from './pilot.mjs';
import { mergePublicPilotRuns } from './public-pilot-merge.mjs';
import {
  benchmarkStagePolicy,
  createBenchmarkLiveSession,
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
  --help                      print this text

Merge (offline, no key, no ledger):
  --merge <dir,dir,...>       merge completed run directories into one paired report in --output;
                              no other flag may accompany it

Environment (real run only): OPENAI_API_KEY, read inside main() and used only in the Authorization header.
Exit codes: 0 done, 1 refused or failed (code on stderr), 2 missing OPENAI_API_KEY.
`;

const VALUE_FLAGS = ['--prepared', '--ledger', '--authorization-id', '--output', '--cases', '--sidecar',
  '--sidecar-sha256', '--batch-cap-micro-usd', '--batch-request-cap', '--run-commit', '--exclusions-file',
  '--answer-template-version', '--merge'];
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
    let exclusionRegistry = null;
    if (values['--exclusions-file'] !== undefined) {
      exclusionRegistry = await readPrivateJsonInput(values['--exclusions-file']);
      if (!Array.isArray(exclusionRegistry) || exclusionRegistry.some((item) => typeof item !== 'string')) {
        fail('invalid_exclusions');
      }
    }
    const policy = experimentPolicy();
    const stages = benchmarkStagePolicy();
    const benchmarkExtension = authorizeBenchmarkExtension({ ledger, policy,
      authorizationId: values['--authorization-id'], stages });
    const pilot = await loadPreparedPilot({ directory: values['--prepared'] });
    const caseIds = selectCases(pilot, values['--cases']);
    const ledgerState = ledgerSnapshot(ledger);
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
    const summary = { pilot: pilot.identity, caseIds, ...answerTemplateIdentity,
      models: { answer: stages.answer.model, judge: stages.judge.model },
      limits: PUBLIC_PILOT_LIMITS, judgeTimeoutMs: PUBLIC_PILOT_JUDGE_TIMEOUT_MS, caps: caps ?? null,
      extension: { authorizationId: benchmarkExtension.authorizationId, checkpoint: benchmarkExtension.checkpoint },
      ledger: ledgerState, projections, totals, fits, runCommit,
      exclusionCount: exclusionRegistry ? exclusionRegistry.length : null };
    if (dryRun) {
      stdout.write(`${JSON.stringify({ mode: 'dry-run', ...summary })}\n`);
      return 0;
    }
    const apiKey = env.OPENAI_API_KEY;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      stderr.write('missing_environment OPENAI_API_KEY\n');
      return 2;
    }
    if (typeof fetchImpl !== 'function') fail('missing_fetch');
    const referenceRenderings = sidecar === undefined ? undefined
      : await loadReferenceRenderings({ preparedDirectory: values['--prepared'], sidecarPath: sidecar,
        expectedSidecarSha256: sidecarSha256 });
    const session = createBenchmarkLiveSession({ ledger, apiKey, fetchImpl, benchmarkExtension });
    let report;
    try {
      report = await runPublicPilot({ pilot, session, directory: values['--output'], limits: PUBLIC_PILOT_LIMITS,
        judgeTimeoutMs: PUBLIC_PILOT_JUDGE_TIMEOUT_MS, referenceRenderings, caps, caseIds, answerTemplateVersion,
        manifest: { runCommit, authorizationId: benchmarkExtension.authorizationId,
          extensionCheckpoint: benchmarkExtension.checkpoint, ledgerRunId: ledger.runId,
          sidecarSha256: sidecarSha256 ?? null, exclusionRegistry, projections, totals },
        onCase: (progress) => { stdout.write(`${JSON.stringify({ progress })}\n`); } });
    } finally { session.close(); }
    stdout.write(`${JSON.stringify({ mode: 'run', directory: path.resolve(values['--output']), ...answerTemplateIdentity,
      summary: report.summary, common: report.official.common, cost: report.cost, latency: report.latency })}\n`);
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
