import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../core/contract.mjs';
import { createBenchmarkExperimentRequestGuard } from '../experiment-budget/request-guard.mjs';
import { planLongMemEvalCase } from '../longmemeval/ingestion.mjs';
import { aggregateOfficialScores, scorePublicComparison } from '../longmemeval/official-scoring.mjs';
import { runPublicComparison } from '../longmemeval/public-comparison.mjs';
import { createShapeValidators, deepFreeze, isPlainObject, validString } from '../longmemeval/validation.mjs';
import { PILOT_SCHEMA_VERSION, pilotEvaluatorFor, readRegularFile } from './pilot.mjs';
import { experimentPolicy } from './session.mjs';

export const PUBLIC_PILOT_SCHEMA_VERSION = 'cairn-longmemeval-public-pilot-v1';
export const PUBLIC_PILOT_JUDGE_TIMEOUT_MS = 90_000;
export const RECEIPT_EXCERPT_BOUND_UTF16 = 800;
export const PUBLIC_PILOT_LIMITS = deepFreeze({
  contextWindow: 123_000, outputTokens: 512, answerTimeoutMs: 200_000, recallLimit: 6,
});
export const PUBLIC_PILOT_INTERPRETATION = 'private plumbing pilot on a small selected roster; '
  + 'not a population estimate, not a competitiveness claim, and not an upstream leaderboard result';
export const PUBLIC_PILOT_LIMITATIONS = deepFreeze([
  'Cairn answer evidence is bounded to the 800-UTF-16-unit receipt prefix of each capture chunk; truncation.json counts what was cut.',
  'Paired blocking: when the full history exceeds the policy context window, no arm is measured for that case.',
  'The two evidence-bearing arms use different JSON evidence schemas (memory receipts versus session blocks).',
  'Arm order is fixed cairn, full-history, no-memory; an answer timeout blocks the later arms of that case.',
  'Cairn evidence is normalized and redacted by the core; full history is the raw prepared text.',
  'Cairn evidence is additionally capped by recallLimit and the core recall budgets, independent of contextWindow.',
  'The no-memory arm answers "I do not know" by instruction and therefore passes abstention cases trivially.',
  'Counted context and usage figures are local estimates or provider-reported usage, not invoices; count-call billing is unknown.',
  '`overall.coverage` is the resolved fraction of the fixed roster, not retrieval coverage.',
]);

const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const ANSWER_MODEL = 'gpt-4.1-mini-2025-04-14';
const JUDGE_MODEL = 'gpt-4o-2024-08-06';
const ARM_NAMES = ['cairn', 'full-history', 'no-memory'];
export const OWNER_ID = 'longmemeval-public-pilot';
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const CASE_STAGES = new Set(['pending', 'generating', 'generated', 'scoring', 'scored', 'blocked']);
const RUN_OPTION_KEYS = ['pilot', 'session', 'directory', 'limits', 'judgeTimeoutMs', 'referenceRenderings',
  'caps', 'manifest', 'onCase', 'caseIds'];

export function benchmarkStagePolicy() {
  return {
    answer: { endpoint: CHAT_ENDPOINT, model: ANSWER_MODEL, reservedMicroUsd: 50_820,
      maxRequestBytes: 1_500_000, maxResponseBytes: 262_144, timeoutMs: 180_000,
      maxInputTokens: 125_000, maxOutputTokens: 512, inputTokenFraming: 1_024,
      inputPrice: { microUsdNumerator: 2, tokenDenominator: 5 },
      outputPrice: { microUsdNumerator: 8, tokenDenominator: 5 } },
    judge: { endpoint: CHAT_ENDPOINT, model: JUDGE_MODEL, reservedMicroUsd: 10_400,
      maxRequestBytes: 100_000, maxResponseBytes: 65_536, timeoutMs: 60_000,
      maxInputTokens: 4_096, maxOutputTokens: 16, inputTokenFraming: 256,
      inputPrice: { microUsdNumerator: 5, tokenDenominator: 2 },
      outputPrice: { microUsdNumerator: 10, tokenDenominator: 1 } },
  };
}

export class PublicPilotError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PublicPilotError';
    this.code = code;
  }
}

const validators = createShapeValidators(PublicPilotError);
export const { fail } = validators;
const { exactObject } = validators;
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const priced = (tokens, price) => Math.ceil((tokens * price.microUsdNumerator) / price.tokenDenominator);
const elapsedMs = (started) => Math.max(0, Date.now() - started);
// Filesystem failures become fixed codes: a raw Node error would carry the path.
export const guarded = async (action, code) => { try { return await action(); } catch { return fail(code); } };
const safeError = (error, fallback) => ({
  code: validString(error?.code) && /^[a-z0-9_-]+$/u.test(error.code) ? error.code : fallback,
});
// Sorted-key JSON, so recorded and requested configurations compare by value.
export const canonical = (value) => JSON.stringify(value, (key, item) => (isPlainObject(item)
  ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));
// One reason per case: the generation reason first, otherwise the scoring reason; null when scored.
export const caseBlockedReason = (entry) => {
  if (entry.generation.status === 'blocked') return entry.generation.reason;
  if (entry.generation.status === 'failed') return 'generation_failed';
  if (entry.scoring.status === 'blocked' || entry.scoring.status === 'failed') {
    return entry.scoring.reason ?? 'scoring_failed';
  }
  return null;
};

// ---------------------------------------------------------------------------
// Session: the only place the provider key is used, and only in headers.
// ---------------------------------------------------------------------------

export function createBenchmarkLiveSession(options = {}) {
  exactObject(options, ['ledger', 'apiKey', 'fetchImpl', 'benchmarkExtension'], 'invalid_benchmark_session');
  const { ledger, apiKey, fetchImpl, benchmarkExtension } = options;
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/u.test(apiKey)
    || typeof fetchImpl !== 'function') fail('invalid_benchmark_session');
  const guard = createBenchmarkExperimentRequestGuard({ ledger, policy: experimentPolicy(),
    benchmarkExtension, fetchImpl });
  const stages = guard.stages;
  let memoryModel;
  try { memoryModel = createOpenAIModel({ apiKey, fetchImpl: guard.cairnFetch }); }
  catch (error) { guard.close(); throw error; }

  const send = async (stageFetch, request, signal) => {
    const body = JSON.stringify({ ...request, store: false, stream: false });
    const response = await stageFetch(CHAT_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: signal ?? new AbortController().signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body,
    });
    let data;
    try { data = await response.json(); } catch { fail('invalid_completion'); }
    const choice = data?.choices?.[0];
    if (!Array.isArray(data?.choices) || data.choices.length !== 1 || !isPlainObject(choice)
      || choice.message?.role !== 'assistant' || typeof choice.message?.content !== 'string'
      || !['stop', 'length'].includes(choice.finish_reason)) fail('invalid_completion');
    return { text: choice.message.content, usage: data.usage };
  };
  const answer = async ({ request, signal } = {}) => {
    if (!isPlainObject(request) || request.model !== stages.answer.model) fail('invalid_answer_request');
    const { text, usage } = await send(guard.answerFetch, request, signal);
    return { text, usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens,
      costMicroUsd: priced(usage.prompt_tokens, stages.answer.inputPrice)
        + priced(usage.completion_tokens, stages.answer.outputPrice) } };
  };
  const judge = async ({ request, signal } = {}) => {
    if (!isPlainObject(request) || request.model !== stages.judge.model) fail('invalid_judge_request');
    const { text } = await send(guard.judgeFetch, request, signal);
    return { text };
  };
  return Object.freeze({ stages, memoryModel, countTokens: memoryModel.countTokens, answer, judge,
    attempts: () => guard.attempts(), getState: () => guard.getState(), isHalted: () => guard.isHalted(),
    close: () => guard.close() });
}

// ---------------------------------------------------------------------------
// Private artifact helpers.
// ---------------------------------------------------------------------------

export const resolveDirectory = (directory, code) => {
  if (!validString(directory) || directory.split(/[\\/]+/u).includes('..')) fail(code);
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) fail(code);
  return resolved;
};

// Inspect (or create) a directory without changing permissions on one this
// process did not create: the caller decides whether to accept it first. The
// returned handle is bound to the inspected inode, re-checked by device and
// inode after the open, so the later seal cannot follow a symlink or a path
// swapped underneath it while the caller was deciding. The caller owns that
// handle and must close it, which sealPrivateDirectory always does.
export const openPrivateDirectory = async (directory, code) => {
  let entry;
  try { entry = await lstat(directory); } catch (error) {
    if (error?.code !== 'ENOENT') return fail(code);
    await guarded(() => mkdir(directory, { mode: 0o700 }), code);
    entry = await guarded(() => lstat(directory), code);
  }
  const resolved = await guarded(() => realpath(directory), code);
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolved !== directory) fail(code);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0) | (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await guarded(() => open(directory, flags), code);
  let opened;
  try { opened = await handle.stat(); } catch { opened = null; }
  if (!opened?.isDirectory() || opened.dev !== entry.dev || opened.ino !== entry.ino) {
    await handle.close().catch(() => {});
    return fail(code);
  }
  return handle;
};

// Applied only once the caller has accepted the directory, through the handle
// the inspection bound to the inspected directory, and always closing it.
export const sealPrivateDirectory = async (handle, directory, code) => {
  try {
    await guarded(() => handle.chmod(0o700), code);
    await guarded(() => access(directory, fsConstants.W_OK), code);
  } finally { await handle.close().catch(() => {}); }
};

const ensurePrivateDirectory = async (directory, code) => {
  const handle = await openPrivateDirectory(directory, code);
  await sealPrivateDirectory(handle, directory, code);
};

export const writePrivateJson = async (filename, value) => {
  try {
    await writeFile(filename, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(filename, 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists');
    fail('output_write_failed');
  }
};

const replacePrivateJson = async (filename, value) => {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, filename);
  } catch { fail('output_write_failed'); }
};

export const readPrivateJson = async (filename, code) => {
  try { await lstat(filename); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return fail(code);
  }
  const bytes = await guarded(() => readRegularFile(filename, code, MAX_ARTIFACT_BYTES), code);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail(code); }
};

const databaseMeasurement = async (database) => {
  let bytes = 0;
  for (const filename of [database, `${database}-wal`, `${database}-shm`]) {
    try {
      const info = await stat(filename);
      if (!info.isFile()) fail('unsafe_output');
      await chmod(filename, 0o600);
      bytes += info.size;
    } catch (error) {
      if (error instanceof PublicPilotError) throw error;
      if (error?.code !== 'ENOENT') fail('unsafe_output');
    }
  }
  return { bytes };
};

const notify = async (callback, progress) => {
  if (!callback) return true;
  try { await callback(deepFreeze(progress)); return true; } catch { return false; }
};

// ---------------------------------------------------------------------------
// Projections, truncation and accounting.
// ---------------------------------------------------------------------------

const ledgerSummary = (state) => ({ limitMicroUsd: state.limitMicroUsd, requestCap: state.requestCap,
  reservedMicroUsd: state.reservedMicroUsd, requestCount: state.requestCount, state: state.state });

export const projectCaseReservation = (plan, stages) => {
  const cairnReservation = experimentPolicy().cairnCount.reservedMicroUsd;
  const batches = plan.batches.length;
  return {
    ingestionBatches: batches,
    requests: batches * 4 + 12,
    reservedMicroUsd: (batches * 4 + 6) * cairnReservation
      + 3 * stages.answer.reservedMicroUsd + 3 * stages.judge.reservedMicroUsd,
  };
};

// Fallback only: an empty evidence array is ambiguous between the no-memory arm
// and a Cairn arm that packed nothing, so the run's own arm order decides when
// it exists. Exported alongside labelCapturedArms for the fallback's own tests.
export const evidenceArmGuess = (request) => {
  let payload;
  try { payload = JSON.parse(request?.messages?.[1]?.content); } catch { return 'unknown'; }
  if (!Array.isArray(payload?.evidence)) return 'unknown';
  if (payload.evidence.length === 0) return 'unknown';
  if (payload.evidence.every((item) => Array.isArray(item?.receipts))) return 'cairn';
  if (payload.evidence.every((item) => Array.isArray(item?.turns))) return 'full-history';
  return 'unknown';
};

// An arm invoked the answer callback exactly when it reached the answer stage:
// preflight was measured and the request was not blocked before sending.
const answeringArms = (run) => (run ? run.arms
  .filter((arm) => isPlainObject(arm?.diagnostics?.preflight) && arm.status !== 'blocked') : []);

// Label each captured request by the arm that sent it, positionally in send
// order. Exported so the evidence-shape fallback can be exercised directly: the
// comparator catches every per-arm failure, so a run record and the captured
// requests cannot disagree through it today, and the fallback is defensive.
export const labelCapturedArms = (captured, run) => {
  const answering = answeringArms(run);
  const positional = run !== null && answering.length === captured.length;
  for (const [index, entry] of captured.entries()) {
    entry.armGuess = positional ? answering[index].name : entry.armGuess;
    entry.armLabelMethod = positional ? 'run-arm-order' : 'evidence-shape-fallback';
  }
  return captured;
};

const truncationRecord = ({ questionId, plan, run, captured }) => {
  const chunks = plan.batches.flatMap((batch) => batch.sourceMap);
  const lengths = new Map(chunks.map((chunk) => [`${chunk.turnId}:${chunk.chunkIndex}`, chunk.normalizedContent.length]));
  const overBound = (length) => Math.max(0, length - RECEIPT_EXCERPT_BOUND_UTF16);
  const turns = plan.sourceTurns;
  const capture = {
    turns: turns.length,
    turnsOverBound: turns.filter((turn) => turn.rawContent.length > RECEIPT_EXCERPT_BOUND_UTF16).length,
    chunks: chunks.length,
    chunksOverBound: chunks.filter((chunk) => chunk.normalizedContent.length > RECEIPT_EXCERPT_BOUND_UTF16).length,
    omittedUnits: chunks.reduce((sum, chunk) => sum + overBound(chunk.normalizedContent.length), 0),
  };
  const cairnArm = run?.arms.find((arm) => arm.name === 'cairn') ?? null;
  const retrieval = cairnArm?.diagnostics?.retrieval ?? null;
  const cairnRequest = captured.find((item) => item.armGuess === 'cairn')?.request;
  let packed = null;
  if (cairnRequest) {
    // Zero receipts is a measured zero, not an absent measurement: the row stays.
    const receipts = JSON.parse(cairnRequest.messages[1].content).evidence
      .flatMap((item) => (Array.isArray(item?.receipts) ? item.receipts : []));
    let truncated = 0;
    let omittedUnits = 0;
    let unmatched = 0;
    for (const receipt of receipts) {
      const length = lengths.get(`${receipt.source?.turnId}:${receipt.source?.chunkIndex}`);
      if (length === undefined) { unmatched += 1; continue; }
      if (length > RECEIPT_EXCERPT_BOUND_UTF16) { truncated += 1; omittedUnits += overBound(length); }
    }
    packed = { receipts: receipts.length, receiptsFromTruncatedChunks: truncated, omittedUnits, unmatched };
  }
  return deepFreeze({
    schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION,
    questionId,
    receiptExcerptBoundUtf16: RECEIPT_EXCERPT_BOUND_UTF16,
    capture,
    retrieval: retrieval ? {
      coverage: retrieval.coverage ?? null, candidateCount: retrieval.candidateCount ?? null,
      selectedCount: retrieval.selectedCount ?? null, omittedCount: retrieval.omitted?.length ?? null,
      retrievedSessionCount: retrieval.retrievedSessionIds?.length ?? null,
      packedSessionCount: retrieval.packedSessionIds?.length ?? null,
    } : null,
    packed,
    armStatus: Object.fromEntries(ARM_NAMES.map((name) => {
      const arm = run?.arms.find((candidate) => candidate.name === name);
      return [name, arm ? { status: arm.status, reason: arm.reason } : null];
    })),
  });
};

const stageTotals = (attempts) => {
  const totals = {};
  for (const attempt of attempts) {
    const entry = totals[attempt.stage] ??= { requests: 0, reservedMicroUsd: 0, knownActualMicroUsd: 0,
      unknownCostRequests: 0, outcomes: {} };
    entry.requests += 1;
    entry.reservedMicroUsd += attempt.reservedMicroUsd;
    if (attempt.actualMicroUsd === null) entry.unknownCostRequests += 1;
    else entry.knownActualMicroUsd += attempt.actualMicroUsd;
    entry.outcomes[attempt.outcome ?? 'unsettled'] = (entry.outcomes[attempt.outcome ?? 'unsettled'] ?? 0) + 1;
  }
  return totals;
};

export const sumStageTotals = (target, source) => {
  for (const [stage, entry] of Object.entries(source)) {
    const total = target[stage] ??= { requests: 0, reservedMicroUsd: 0, knownActualMicroUsd: 0,
      unknownCostRequests: 0, outcomes: {} };
    total.requests += entry.requests;
    total.reservedMicroUsd += entry.reservedMicroUsd;
    total.knownActualMicroUsd += entry.knownActualMicroUsd;
    total.unknownCostRequests += entry.unknownCostRequests;
    for (const [outcome, count] of Object.entries(entry.outcomes)) {
      total.outcomes[outcome] = (total.outcomes[outcome] ?? 0) + count;
    }
  }
  return target;
};

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

const validateSession = (session) => {
  if (!session || typeof session !== 'object') fail('invalid_session');
  if (['answer', 'judge', 'countTokens', 'attempts', 'getState', 'isHalted']
    .some((key) => typeof session[key] !== 'function') || !isPlainObject(session.stages)
    || !isPlainObject(session.stages.answer) || !isPlainObject(session.stages.judge)
    || !validString(session.stages.answer.model) || !validString(session.stages.judge.model)
    || !safeInteger(session.stages.answer.reservedMicroUsd, 1)
    || !safeInteger(session.stages.judge.reservedMicroUsd, 1)
    || !session.memoryModel || typeof session.memoryModel !== 'object') fail('invalid_session');
};

const validateOptions = (options) => {
  if (!isPlainObject(options) || Object.keys(options).some((key) => !RUN_OPTION_KEYS.includes(key))
    || ['pilot', 'session', 'directory'].some((key) => !Object.hasOwn(options, key))) fail('invalid_options');
  const { pilot } = options;
  if (!pilot || typeof pilot !== 'object' || pilot.schemaVersion !== PILOT_SCHEMA_VERSION
    || !Array.isArray(pilot.cases) || pilot.cases.length < 1 || !isPlainObject(pilot.identity)
    || !validString(pilot.identity.manifestSha256) || !Array.isArray(pilot.identity.questionIds)) fail('invalid_pilot');
  validateSession(options.session);
  const limits = options.limits ?? PUBLIC_PILOT_LIMITS;
  exactObject(limits, ['contextWindow', 'outputTokens', 'answerTimeoutMs', 'recallLimit'], 'invalid_limits');
  if (Object.values(limits).some((value) => !safeInteger(value, 1))) fail('invalid_limits');
  const judgeTimeoutMs = options.judgeTimeoutMs ?? PUBLIC_PILOT_JUDGE_TIMEOUT_MS;
  if (!safeInteger(judgeTimeoutMs, 1) || judgeTimeoutMs > 2_147_483_647) fail('invalid_options');
  if (options.caps !== undefined) {
    exactObject(options.caps, ['reservedMicroUsd', 'requests'], 'invalid_caps');
    if (!safeInteger(options.caps.reservedMicroUsd) || !safeInteger(options.caps.requests)) fail('invalid_caps');
  }
  if (options.referenceRenderings !== undefined && !(options.referenceRenderings instanceof Map)) fail('invalid_options');
  if (options.onCase !== undefined && typeof options.onCase !== 'function') fail('invalid_options');
  let manifest = null;
  if (options.manifest !== undefined) {
    if (!isPlainObject(options.manifest)) fail('invalid_manifest');
    try { manifest = JSON.parse(JSON.stringify(options.manifest)); } catch { fail('invalid_manifest'); }
  }
  let caseIds = pilot.cases.map((item) => item.question.question_id);
  if (options.caseIds !== undefined) {
    if (!Array.isArray(options.caseIds) || options.caseIds.length < 1
      || options.caseIds.some((id) => !caseIds.includes(id))
      || new Set(options.caseIds).size !== options.caseIds.length) fail('invalid_case_selection');
    caseIds = caseIds.filter((id) => options.caseIds.includes(id));
  }
  return { pilot, session: options.session, limits: structuredClone(limits), judgeTimeoutMs,
    caps: options.caps ? structuredClone(options.caps) : null, manifest, caseIds,
    referenceRenderings: options.referenceRenderings, onCase: options.onCase };
};

const casePaths = (directory, questionId) => {
  const caseDirectory = path.join(directory, 'cases', questionId);
  return { directory: caseDirectory,
    database: path.join(caseDirectory, 'memory.sqlite'),
    generation: path.join(caseDirectory, 'generation.json'),
    answerRequests: path.join(caseDirectory, 'answer-requests.json'),
    truncation: path.join(caseDirectory, 'truncation.json'),
    accounting: path.join(caseDirectory, 'accounting.json'),
    timings: path.join(caseDirectory, 'timings.json'),
    scoring: path.join(caseDirectory, 'scoring.json') };
};

// Only a blocked generation legitimately has generation.json alone; a completed
// or failed one was written with its four companions, and both can follow real
// spend. Missing any of them means the case was interrupted mid-write and its
// cost cannot be reported, so the resume stops rather than reporting zero.
const requireCaseArtifacts = async (files, generation) => {
  if (generation?.status === 'blocked') return;
  for (const filename of [files.accounting, files.answerRequests, files.truncation]) {
    if (await readPrivateJson(filename, 'invalid_artifact') === null) fail('invalid_checkpoint');
  }
};

const blockedGeneration = (questionId, reason, extra = {}) => deepFreeze({
  schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId, status: 'blocked', reason, ...extra,
});

async function generateCase({ item, files, session, limits, plan, projected, ledgerBefore }) {
  const questionId = item.question.question_id;
  const namespace = { ownerId: OWNER_ID, scope: 'project', projectId: questionId };
  const captured = [];
  const answer = async (call) => {
    const order = captured.length;
    const startedAt = Date.now();
    const entry = { order, armGuess: evidenceArmGuess(call.request), request: structuredClone(call.request),
      startedAt, elapsedMs: null, status: 'pending' };
    captured.push(entry);
    try {
      const result = await session.answer(call);
      entry.status = 'returned';
      return result;
    } catch (error) {
      entry.status = 'threw';
      entry.error = safeError(error, 'answer_failed');
      throw error;
    } finally { entry.elapsedMs = elapsedMs(startedAt); }
  };
  await ensurePrivateDirectory(files.directory, 'unsafe_output');
  let handle;
  try { handle = await open(files.database, 'wx', 0o600); }
  catch (error) { return fail(error?.code === 'EEXIST' ? 'output_exists' : 'output_write_failed'); }
  await guarded(() => handle.close(), 'output_write_failed');
  await guarded(() => chmod(files.database, 0o600), 'output_write_failed');
  const started = Date.now();
  const attemptStart = session.attempts().length;
  let core;
  let run;
  let error;
  try {
    core = openMemoryCore({ path: files.database, model: session.memoryModel });
    run = await runPublicComparison({ history: item.history, question: item.question, namespace, core,
      answer, countTokens: session.countTokens, answerModel: session.stages.answer.model, limits });
  } catch (caught) { error = safeError(caught, 'generation_failed'); }
  finally { core?.close(); }
  const database = await databaseMeasurement(files.database);
  const generation = deepFreeze({
    schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId,
    status: run ? 'completed' : 'failed', latencyMs: elapsedMs(started), database, projected,
    ...(run ? { run } : { error }),
  });
  const attempts = session.attempts().slice(attemptStart);
  const ledgerAfter = ledgerSummary(session.getState());
  labelCapturedArms(captured, run ?? null);
  await writePrivateJson(files.generation, generation);
  await writePrivateJson(files.answerRequests, { schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId,
    requests: captured });
  await writePrivateJson(files.truncation, truncationRecord({ questionId, plan, run: run ?? null, captured }));
  await writePrivateJson(files.accounting, { schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId,
    phase: 'generation', ledgerBefore, ledgerAfter, attempts, totals: stageTotals(attempts) });
  await writePrivateJson(files.timings, { schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId,
    caseLatencyMs: generation.latencyMs,
    answerRequests: captured.map(({ order, armGuess, armLabelMethod, startedAt, elapsedMs: ms, status }) =>
      ({ order, armGuess, armLabelMethod, startedAt, elapsedMs: ms, status })),
    arms: run ? run.arms.map((arm) => ({ name: arm.name, status: arm.status, reason: arm.reason,
      latencyMs: arm.diagnostics?.latencyMs ?? null })) : [] });
  return { generation, attemptIds: attempts.map((attempt) => attempt.attemptId) };
}

const summarizeArm = (arm) => arm ? { name: arm.name, status: arm.status, reason: arm.reason,
  inputTokens: arm.diagnostics?.preflight?.inputTokens ?? null,
  latencyMs: arm.diagnostics?.latencyMs ?? null } : null;

export async function runPublicPilot(options) {
  const { pilot, session, limits, judgeTimeoutMs, caps, manifest, caseIds, referenceRenderings, onCase }
    = validateOptions(options);
  const directory = resolveDirectory(options.directory, 'unsafe_output');
  const directoryHandle = await openPrivateDirectory(directory, 'unsafe_output');
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const manifestPath = path.join(directory, 'manifest.json');
  const casesRoot = path.join(directory, 'cases');
  const started = Date.now();
  let checkpoint;
  let sealed = false;
  try {
    checkpoint = await readPrivateJson(checkpointPath, 'invalid_checkpoint');
    if (checkpoint === null) {
      const entries = await guarded(() => readdir(directory), 'unsafe_output');
      if (entries.length !== 0) fail('output_not_empty');
      await sealPrivateDirectory(directoryHandle, directory, 'unsafe_output');
      sealed = true;
      checkpoint = { schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, pilotManifestSha256: pilot.identity.manifestSha256,
        baseline: ledgerSummary(session.getState()), caseIds, halted: false, cases: {} };
      await writePrivateJson(manifestPath, { schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION,
        createdAt: new Date(started).toISOString(), pilot: pilot.identity, caseIds,
        stages: session.stages, limits, judgeTimeoutMs, caps,
        receiptExcerptBoundUtf16: RECEIPT_EXCERPT_BOUND_UTF16,
        limitations: PUBLIC_PILOT_LIMITATIONS, interpretation: PUBLIC_PILOT_INTERPRETATION, operator: manifest });
      await replacePrivateJson(checkpointPath, checkpoint);
    } else if (!isPlainObject(checkpoint) || checkpoint.schemaVersion !== PUBLIC_PILOT_SCHEMA_VERSION
      || checkpoint.pilotManifestSha256 !== pilot.identity.manifestSha256
      || !isPlainObject(checkpoint.baseline) || !isPlainObject(checkpoint.cases)
      || !Array.isArray(checkpoint.caseIds) || JSON.stringify(checkpoint.caseIds) !== JSON.stringify(caseIds)) {
      fail('run_directory_mismatch');
    } else {
      // The recorded configuration must match, so a resumed run cannot change its own rules.
      const recorded = await readPrivateJson(manifestPath, 'invalid_artifact');
      if (!isPlainObject(recorded) || canonical(recorded.limits) !== canonical(limits)
        || recorded.judgeTimeoutMs !== judgeTimeoutMs || canonical(recorded.caps ?? null) !== canonical(caps)
        || canonical(recorded.stages) !== canonical(session.stages)) fail('run_directory_mismatch');
      await sealPrivateDirectory(directoryHandle, directory, 'unsafe_output');
      sealed = true;
    }
  } finally {
    if (!sealed) await directoryHandle.close().catch(() => {});
  }
  await ensurePrivateDirectory(casesRoot, 'unsafe_output');
  const saveCheckpoint = () => replacePrivateJson(checkpointPath, checkpoint);
  const runUsage = () => {
    const state = ledgerSummary(session.getState());
    return { ledger: state, reservedMicroUsd: state.reservedMicroUsd - checkpoint.baseline.reservedMicroUsd,
      requestCount: state.requestCount - checkpoint.baseline.requestCount };
  };
  const capReason = (projected) => {
    const usage = runUsage();
    if (caps && (usage.reservedMicroUsd + projected.reservedMicroUsd > caps.reservedMicroUsd
      || usage.requestCount + projected.requests > caps.requests)) return 'cap_exhausted_projected';
    if (usage.ledger.limitMicroUsd - usage.ledger.reservedMicroUsd < projected.reservedMicroUsd
      || usage.ledger.requestCap - usage.ledger.requestCount < projected.requests) return 'ledger_allowance_insufficient';
    return null;
  };
  const caseState = (questionId) => {
    const state = checkpoint.cases[questionId];
    if (state !== undefined && (!isPlainObject(state) || !CASE_STAGES.has(state.stage))) fail('invalid_checkpoint');
    return state ?? { stage: 'pending' };
  };
  const setStage = async (questionId, stage, extra = {}) => {
    const previous = checkpoint.cases[questionId] ?? {};
    const attemptIds = [...(previous.attemptIds ?? []), ...(extra.attemptIds ?? [])];
    checkpoint.cases[questionId] = { stage, ...extra, attemptIds };
    await saveCheckpoint();
  };
  const selected = caseIds.map((id) => pilot.cases.find((item) => item.question.question_id === id));
  let callbackFailures = 0;
  const generations = new Map();

  // Generation phase: every checkpoint is durable before the evaluator is touched.
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const questionId = item.question.question_id;
    const files = casePaths(directory, questionId);
    const state = caseState(questionId);
    let generation = null;
    if (['generated', 'scoring', 'scored', 'blocked'].includes(state.stage)) {
      generation = await readPrivateJson(files.generation, 'invalid_artifact');
      if (generation === null) fail('invalid_checkpoint');
      await requireCaseArtifacts(files, generation);
    } else if (state.stage === 'generating') {
      generation = await readPrivateJson(files.generation, 'invalid_artifact');
      if (generation !== null) await requireCaseArtifacts(files, generation);
      if (generation === null) {
        await ensurePrivateDirectory(files.directory, 'unsafe_output');
        generation = blockedGeneration(questionId, 'interrupted');
        await writePrivateJson(files.generation, generation);
        await setStage(questionId, 'blocked', { reason: 'interrupted', phase: 'generation' });
      } else await setStage(questionId, 'generated');
    } else {
      const namespace = { ownerId: OWNER_ID, scope: 'project', projectId: questionId };
      let plan;
      try { plan = planLongMemEvalCase({ history: item.history, namespace }); }
      catch { fail('invalid_pilot'); }
      const projected = projectCaseReservation(plan, session.stages);
      const halted = checkpoint.halted || session.isHalted();
      const reason = halted ? 'paid_work_halted' : capReason(projected);
      if (reason) {
        await ensurePrivateDirectory(files.directory, 'unsafe_output');
        generation = blockedGeneration(questionId, reason, { projected });
        await writePrivateJson(files.generation, generation);
        await setStage(questionId, 'blocked', { reason, phase: 'generation' });
      } else {
        await setStage(questionId, 'generating');
        const ledgerBefore = ledgerSummary(session.getState());
        const generated = await generateCase({ item, files, session, limits, plan, projected, ledgerBefore });
        generation = generated.generation;
        await setStage(questionId, 'generated', { attemptIds: generated.attemptIds });
      }
    }
    generations.set(questionId, generation);
    if (session.isHalted() && !checkpoint.halted) { checkpoint.halted = true; await saveCheckpoint(); }
    if (!await notify(onCase, { stage: 'generation', index, caseCount: selected.length, questionId,
      status: generation.status })) callbackFailures += 1;
  }

  // Scoring phase.
  const scorings = new Map();
  const roster = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const questionId = item.question.question_id;
    const files = casePaths(directory, questionId);
    const generation = generations.get(questionId);
    const evaluator = pilotEvaluatorFor(pilot, questionId);
    if (!evaluator) fail('invalid_pilot');
    roster.push({ questionId, sourceQuestionId: evaluator.source_question_id, questionType: evaluator.question_type });
    const state = caseState(questionId);
    let scoring = null;
    if (state.stage === 'scored') {
      scoring = await readPrivateJson(files.scoring, 'invalid_artifact');
      if (scoring === null) fail('invalid_checkpoint');
    } else if (state.stage === 'scoring') {
      scoring = await readPrivateJson(files.scoring, 'invalid_artifact');
      if (scoring === null) {
        scoring = deepFreeze({ schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId, status: 'blocked',
          reason: 'interrupted' });
        await writePrivateJson(files.scoring, scoring);
        await setStage(questionId, 'blocked', { reason: 'interrupted', phase: 'scoring' });
      } else await setStage(questionId, 'scored');
    } else if (state.stage === 'blocked' || generation.status !== 'completed') {
      scoring = await readPrivateJson(files.scoring, 'invalid_artifact');
      if (scoring === null) {
        scoring = deepFreeze({ schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId, status: 'blocked',
          reason: generation.status === 'blocked' ? generation.reason : 'generation_failed' });
        await writePrivateJson(files.scoring, scoring);
      }
    } else {
      const projected = { reservedMicroUsd: 3 * session.stages.judge.reservedMicroUsd, requests: 3 };
      const halted = checkpoint.halted || session.isHalted();
      const reason = halted ? 'paid_work_halted' : capReason(projected);
      if (reason) {
        scoring = deepFreeze({ schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId, status: 'blocked', reason });
        await writePrivateJson(files.scoring, scoring);
        await setStage(questionId, 'blocked', { reason, phase: 'scoring' });
      } else {
        await setStage(questionId, 'scoring');
        const scoringStarted = Date.now();
        const attemptStart = session.attempts().length;
        const ledgerBefore = ledgerSummary(session.getState());
        let score;
        let error;
        try {
          score = await scorePublicComparison({ run: generation.run, evaluator, judge: session.judge,
            judgeTimeoutMs, ...(referenceRenderings?.has(questionId)
              ? { referenceRendering: referenceRenderings.get(questionId) } : {}) });
        } catch (caught) { error = safeError(caught, 'scoring_failed'); }
        const attempts = session.attempts().slice(attemptStart);
        scoring = deepFreeze({ schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, questionId,
          status: score ? 'completed' : 'failed', latencyMs: elapsedMs(scoringStarted),
          accounting: { ledgerBefore, ledgerAfter: ledgerSummary(session.getState()), attempts,
            totals: stageTotals(attempts) },
          ...(score ? { score } : { error }) });
        await writePrivateJson(files.scoring, scoring);
        await setStage(questionId, 'scored', { attemptIds: attempts.map((attempt) => attempt.attemptId) });
      }
    }
    scorings.set(questionId, scoring);
    if (session.isHalted() && !checkpoint.halted) { checkpoint.halted = true; await saveCheckpoint(); }
    if (!await notify(onCase, { stage: 'scoring', index, caseCount: selected.length, questionId,
      status: scoring.status })) callbackFailures += 1;
  }

  // Aggregate and redacted report. A completed directory is returned as it was written.
  const aggregatePath = path.join(directory, 'aggregate.json');
  const existingReport = await readPrivateJson(path.join(directory, 'report.json'), 'invalid_artifact');
  if (existingReport !== null) {
    if (await readPrivateJson(aggregatePath, 'invalid_artifact') === null) fail('invalid_artifact');
    return deepFreeze(existingReport);
  }
  // aggregate.json is derived from the per-case files; the operator may delete it and resume.
  if (await readPrivateJson(aggregatePath, 'invalid_artifact') !== null) fail('aggregate_without_report');
  const records = [...scorings.values()].filter((scoring) => scoring.status === 'completed')
    .map((scoring) => scoring.score);
  const official = aggregateOfficialScores({ roster, records });
  const cost = {};
  const truncation = { turns: 0, turnsOverBound: 0, chunks: 0, chunksOverBound: 0, omittedUnits: 0,
    packedReceipts: 0, packedReceiptsFromTruncatedChunks: 0, packedOmittedUnits: 0 };
  const latency = { generationMs: 0, scoringMs: 0 };
  const cases = [];
  for (const item of selected) {
    const questionId = item.question.question_id;
    const files = casePaths(directory, questionId);
    const generation = generations.get(questionId);
    const scoring = scorings.get(questionId);
    const rosterItem = roster.find((entry) => entry.questionId === questionId);
    const accounting = await readPrivateJson(files.accounting, 'invalid_artifact');
    const truncated = await readPrivateJson(files.truncation, 'invalid_artifact');
    if (accounting) sumStageTotals(cost, accounting.totals);
    if (scoring?.accounting) sumStageTotals(cost, scoring.accounting.totals);
    if (truncated) {
      truncation.turns += truncated.capture.turns;
      truncation.turnsOverBound += truncated.capture.turnsOverBound;
      truncation.chunks += truncated.capture.chunks;
      truncation.chunksOverBound += truncated.capture.chunksOverBound;
      truncation.omittedUnits += truncated.capture.omittedUnits;
      if (truncated.packed) {
        truncation.packedReceipts += truncated.packed.receipts;
        truncation.packedReceiptsFromTruncatedChunks += truncated.packed.receiptsFromTruncatedChunks;
        truncation.packedOmittedUnits += truncated.packed.omittedUnits;
      }
    }
    latency.generationMs += generation.latencyMs ?? 0;
    latency.scoringMs += scoring.latencyMs ?? 0;
    cases.push({
      questionId, sourceQuestionId: rosterItem.sourceQuestionId, questionType: rosterItem.questionType,
      abstention: rosterItem.sourceQuestionId.includes('_abs'),
      generation: { status: generation.status, reason: generation.reason ?? null, latencyMs: generation.latencyMs ?? null,
        projected: generation.projected ?? null },
      scoring: { status: scoring.status, reason: scoring.reason ?? null, latencyMs: scoring.latencyMs ?? null,
        referenceSerialization: scoring.score?.compatibility?.referenceSerialization ?? null },
      arms: ARM_NAMES.map((name) => {
        const arm = summarizeArm(generation.run?.arms.find((candidate) => candidate.name === name) ?? null);
        const scored = scoring.score?.arms.find((candidate) => candidate.name === name) ?? null;
        return { name, generation: arm, judgment: scored ? scored.judgment : null,
          referenceSessionCoverage: scored?.referenceSessionCoverage ?? null };
      }),
      truncation: truncated ? { capture: truncated.capture, packed: truncated.packed } : null,
      cost: { generation: accounting?.totals ?? null, scoring: scoring.accounting?.totals ?? null },
    });
  }
  const totalReserved = Object.values(cost).reduce((sum, entry) => sum + entry.reservedMicroUsd, 0);
  const totalKnown = Object.values(cost).reduce((sum, entry) => sum + entry.knownActualMicroUsd, 0);
  const totalRequests = Object.values(cost).reduce((sum, entry) => sum + entry.requests, 0);
  const totalUnknown = Object.values(cost).reduce((sum, entry) => sum + entry.unknownCostRequests, 0);
  const summary = {
    fixedN: selected.length,
    generated: cases.filter((item) => item.generation.status === 'completed').length,
    generationFailed: cases.filter((item) => item.generation.status === 'failed').length,
    generationBlocked: cases.filter((item) => item.generation.status === 'blocked').length,
    scored: cases.filter((item) => item.scoring.status === 'completed').length,
    blockedReasons: Object.fromEntries(cases.map(caseBlockedReason).filter(Boolean)
      .reduce((map, reason) => map.set(reason, (map.get(reason) ?? 0) + 1), new Map())),
    halted: checkpoint.halted,
    progressCallbackFailures: callbackFailures,
  };
  const aggregate = deepFreeze({
    schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, generatedAt: new Date().toISOString(),
    interpretation: PUBLIC_PILOT_INTERPRETATION, pilot: pilot.identity, caseIds, limits, judgeTimeoutMs, caps,
    stages: session.stages, summary, official,
    cost: { byStage: cost, reservedMicroUsd: totalReserved, knownActualMicroUsd: totalKnown,
      unknownCostRequests: totalUnknown, requests: totalRequests, ledger: runUsage().ledger },
    latency: { ...latency, totalMs: elapsedMs(started) }, truncation,
    receiptExcerptBoundUtf16: RECEIPT_EXCERPT_BOUND_UTF16,
  });
  await writePrivateJson(aggregatePath, aggregate);
  const report = deepFreeze({
    schemaVersion: PUBLIC_PILOT_SCHEMA_VERSION, generatedAt: aggregate.generatedAt,
    interpretation: PUBLIC_PILOT_INTERPRETATION, operator: manifest, pilot: pilot.identity, caseIds,
    models: { answer: session.stages.answer.model, judge: session.stages.judge.model },
    limits, judgeTimeoutMs, caps, receiptExcerptBoundUtf16: RECEIPT_EXCERPT_BOUND_UTF16,
    limitations: PUBLIC_PILOT_LIMITATIONS, summary, official, cost: aggregate.cost,
    latency: aggregate.latency, truncation, cases,
  });
  await writePrivateJson(path.join(directory, 'report.json'), report);
  // Return exactly what was written, so callers and resumed runs see one shape.
  return deepFreeze(JSON.parse(JSON.stringify(report)));
}
