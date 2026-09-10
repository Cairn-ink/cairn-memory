import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import { openMemoryCore } from '../../core/contract.mjs';
import {
  ANSWER_INSTRUCTION,
  ANSWER_TEMPLATE_VERSION,
  runLongMemEvalComparison,
} from '../longmemeval/comparison.mjs';
import { planLongMemEvalCase, projectIngestionFailure } from '../longmemeval/ingestion.mjs';
import { opaqueQuestionId, SCHEMA_VERSION as PREPARATION_SCHEMA_VERSION } from '../longmemeval/prepare.mjs';
import { scoreLongMemEvalComparison } from '../longmemeval/scoring.mjs';
import { deepFreeze, isPlainObject, validString } from '../longmemeval/validation.mjs';

export const PILOT_SCHEMA_VERSION = 'cairn-longmemeval-live-pilot-v1';
export const PILOT_GENERATION_CONCURRENCY = 3;
export const PILOT_LIMITS = deepFreeze({
  evidenceTokens: 6_000,
  requestTokens: 8_000,
  outputTokens: 512,
  answerTimeoutMs: 60_000,
  recallLimit: 6,
  lexicalLimit: 100,
});

const ARTIFACTS = deepFreeze({
  history: 'history.jsonl',
  questions: 'questions.jsonl',
  evaluator: 'evaluator.jsonl',
});
const ARM_NAMES = ['cairn', 'lexical', 'no-memory'];
const QUESTION_TYPES = new Set([
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'temporal-reasoning',
  'knowledge-update',
  'multi-session',
]);
const PRIVATE_PILOTS = new WeakMap();
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export class LivePilotError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LivePilotError';
    this.code = code;
  }
}

const fail = (code) => { throw new LivePilotError(code); };
const exactObject = (value, keys, code) => {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
  return value;
};
const denseArray = (value, minimum, code) => {
  if (!Array.isArray(value) || value.length < minimum || Object.keys(value).length !== value.length) {
    fail(code);
  }
  return value;
};
const safeInteger = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const elapsedMs = (started) => Math.max(0, Date.now() - started);

const resolveDirectory = (directory, code) => {
  if (!validString(directory) || directory.split(/[\\/]+/u).includes('..')) fail(code);
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) fail(code);
  return resolved;
};

const validateDirectory = async (directory, code) => {
  let entry;
  let resolved;
  try {
    entry = await lstat(directory);
    resolved = await realpath(directory);
  } catch { fail(code); }
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolved !== directory) fail(code);
};

const readRegularFile = async (filename, code, maximumBytes) => {
  let before;
  try { before = await lstat(filename); } catch { fail(code); }
  if (!before.isFile() || before.isSymbolicLink()
    || before.size < 1 || before.size > maximumBytes) fail(code);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try { handle = await open(filename, flags); } catch { fail(code); }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size < 1 || opened.size > maximumBytes) fail(code);
    const content = await handle.readFile();
    const after = await handle.stat();
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || content.length !== opened.size) {
      fail('input_changed_during_read');
    }
    return content;
  } catch (error) {
    if (error instanceof LivePilotError) throw error;
    fail(code);
  } finally {
    await handle.close().catch(() => {});
  }
};

const decodeJson = (bytes, code) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(code); }
};

const parseJsonLines = (bytes, metadata) => {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail('invalid_artifact'); }
  if (!text.endsWith('\n') || text.includes('\r')) fail('invalid_artifact');
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== metadata.record_count || lines.some((line) => line.length === 0)) {
    fail('artifact_record_count_mismatch');
  }
  try { return lines.map((line) => JSON.parse(line)); }
  catch { fail('invalid_artifact'); }
};

const validateArtifactMetadata = (value, expectedFilename) => {
  exactObject(value, ['filename', 'sha256', 'byte_count', 'record_count'], 'invalid_manifest');
  if (value.filename !== expectedFilename || !/^[a-f0-9]{64}$/u.test(value.sha256)
    || !safeInteger(value.byte_count, 1) || !safeInteger(value.record_count, 1)) {
    fail('invalid_manifest');
  }
};

const validateManifest = (manifest) => {
  exactObject(manifest, ['schema_version', 'preparation_kind', 'dataset', 'selection',
    'artifacts', 'sizes', 'compatibility', 'boundaries'], 'invalid_manifest');
  if (manifest.schema_version !== PREPARATION_SCHEMA_VERSION || manifest.preparation_kind !== 'pilot') {
    fail('invalid_manifest');
  }
  exactObject(manifest.dataset, ['declared_variant', 'declared_revision', 'input_sha256',
    'input_byte_count', 'identity_scope', 'oracle_warning'], 'invalid_manifest');
  if (manifest.dataset.declared_variant !== 's-cleaned'
    || !validString(manifest.dataset.declared_revision)
    || !/^[a-f0-9]{64}$/u.test(manifest.dataset.input_sha256)
    || !safeInteger(manifest.dataset.input_byte_count, 1)
    || !validString(manifest.dataset.identity_scope) || !validString(manifest.dataset.oracle_warning)) {
    fail('invalid_manifest');
  }
  exactObject(manifest.selection, ['kind', 'source_question_ids', 'question_ids', 'count'],
    'invalid_manifest');
  denseArray(manifest.selection.source_question_ids, 1, 'invalid_manifest');
  denseArray(manifest.selection.question_ids, 1, 'invalid_manifest');
  if (manifest.selection.kind !== 'pilot' || !safeInteger(manifest.selection.count, 1)
    || manifest.selection.count > 7
    || manifest.selection.count !== manifest.selection.question_ids.length
    || manifest.selection.count !== manifest.selection.source_question_ids.length
    || manifest.selection.question_ids.some((id) => !validString(id))
    || manifest.selection.source_question_ids.some((id) => !validString(id))
    || new Set(manifest.selection.question_ids).size !== manifest.selection.count
    || new Set(manifest.selection.source_question_ids).size !== manifest.selection.count
    || manifest.selection.source_question_ids.some((id, index) =>
      opaqueQuestionId(id) !== manifest.selection.question_ids[index])) fail('invalid_manifest');

  exactObject(manifest.artifacts, ['history', 'questions', 'evaluator'], 'invalid_manifest');
  for (const [name, filename] of Object.entries(ARTIFACTS)) {
    validateArtifactMetadata(manifest.artifacts[name], filename);
    if (manifest.artifacts[name].record_count !== manifest.selection.count) fail('invalid_manifest');
  }
  if (!isPlainObject(manifest.sizes) || !isPlainObject(manifest.compatibility)) fail('invalid_manifest');
  exactObject(manifest.boundaries, ['model_facing_files', 'private_evaluator_file',
    'private_manifest_file', 'filesystem_split_is_not_an_os_sandbox'], 'invalid_manifest');
  if (JSON.stringify(manifest.boundaries.model_facing_files)
      !== JSON.stringify([ARTIFACTS.history, ARTIFACTS.questions])
    || manifest.boundaries.private_evaluator_file !== ARTIFACTS.evaluator
    || manifest.boundaries.private_manifest_file !== 'manifest.json'
    || manifest.boundaries.filesystem_split_is_not_an_os_sandbox !== true) fail('invalid_manifest');
};

const validateQuestion = (question) => {
  exactObject(question, ['question_id', 'text', 'date'], 'invalid_question');
  if (!validString(question.question_id) || !validString(question.text) || !validString(question.date)) {
    fail('invalid_question');
  }
};

const validateReference = (reference) => {
  const scalar = (value) => typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value));
  if (scalar(reference)) return;
  if (Array.isArray(reference) && reference.length > 0
    && Object.keys(reference).length === reference.length && reference.every(scalar)) return;
  fail('invalid_evaluator');
};

const validateEvaluator = (evaluator, history, question, sourceQuestionId) => {
  exactObject(evaluator, ['question_id', 'source_question_id', 'question_type',
    'reference_answer', 'answer_session_ids', 'turn_labels'], 'invalid_evaluator');
  if (evaluator.question_id !== question.question_id
    || evaluator.source_question_id !== sourceQuestionId
    || opaqueQuestionId(evaluator.source_question_id) !== evaluator.question_id
    || !QUESTION_TYPES.has(evaluator.question_type)) fail('evaluator_mismatch');
  validateReference(evaluator.reference_answer);
  denseArray(evaluator.answer_session_ids, 0, 'invalid_evaluator');
  denseArray(evaluator.turn_labels, 0, 'invalid_evaluator');
  const sessionCounts = new Map();
  const turnIds = new Set();
  for (const sourceSession of history.sessions) {
    sessionCounts.set(sourceSession.session_id, (sessionCounts.get(sourceSession.session_id) ?? 0) + 1);
    for (const turn of sourceSession.turns) turnIds.add(turn.turn_id);
  }
  if (new Set(evaluator.answer_session_ids).size !== evaluator.answer_session_ids.length
    || evaluator.answer_session_ids.some((id) => !validString(id)
      || sessionCounts.get(id) !== 1)) fail('invalid_evaluator');
  const labels = new Set();
  for (const label of evaluator.turn_labels) {
    exactObject(label, ['turn_id', 'has_answer'], 'invalid_evaluator');
    if (!turnIds.has(label.turn_id) || labels.has(label.turn_id)
      || typeof label.has_answer !== 'boolean') fail('invalid_evaluator');
    labels.add(label.turn_id);
  }
};

const loadArtifacts = async (directory, manifest) => {
  const records = {};
  for (const [name, filename] of Object.entries(ARTIFACTS)) {
    const bytes = await readRegularFile(path.join(directory, filename), 'invalid_artifact',
      MAX_ARTIFACT_BYTES);
    const metadata = manifest.artifacts[name];
    if (bytes.length !== metadata.byte_count) fail('artifact_byte_count_mismatch');
    if (sha256(bytes) !== metadata.sha256) fail('artifact_digest_mismatch');
    records[name] = parseJsonLines(bytes, metadata);
  }
  return records;
};

export async function loadPreparedPilot(options) {
  exactObject(options, ['directory'], 'invalid_options');
  const directory = resolveDirectory(options.directory, 'invalid_prepared_directory');
  await validateDirectory(directory, 'invalid_prepared_directory');
  const entries = (await readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([
    ARTIFACTS.evaluator, ARTIFACTS.history, 'manifest.json', ARTIFACTS.questions,
  ].sort())) fail('invalid_prepared_directory');

  const manifestBytes = await readRegularFile(path.join(directory, 'manifest.json'), 'invalid_manifest',
    MAX_MANIFEST_BYTES);
  const manifest = decodeJson(manifestBytes, 'invalid_manifest');
  validateManifest(manifest);
  const records = await loadArtifacts(directory, manifest);
  const cases = [];
  const evaluators = new Map();
  for (let index = 0; index < manifest.selection.count; index += 1) {
    const history = records.history[index];
    const question = records.questions[index];
    const evaluator = records.evaluator[index];
    validateQuestion(question);
    if (history?.question_id !== question.question_id
      || question.question_id !== manifest.selection.question_ids[index]) fail('case_identity_mismatch');
    try {
      planLongMemEvalCase({ history, namespace: {
        ownerId: 'longmemeval-live-pilot', scope: 'project', projectId: question.question_id,
      } });
    } catch { fail('invalid_history'); }
    validateEvaluator(evaluator, history, question, manifest.selection.source_question_ids[index]);
    const generationCase = deepFreeze({ history, question });
    cases.push(generationCase);
    evaluators.set(question.question_id, deepFreeze(evaluator));
  }

  const pilot = deepFreeze({
    schemaVersion: PILOT_SCHEMA_VERSION,
    identity: {
      manifestSha256: sha256(manifestBytes),
      historySha256: manifest.artifacts.history.sha256,
      questionsSha256: manifest.artifacts.questions.sha256,
      evaluatorSha256: manifest.artifacts.evaluator.sha256,
      questionIds: [...manifest.selection.question_ids],
      count: manifest.selection.count,
    },
    cases,
  });
  PRIVATE_PILOTS.set(pilot, deepFreeze({ evaluators }));
  return pilot;
}

const snapshotSession = (session) => {
  if (!isPlainObject(session) || !validString(session.modelId)
    || !isPlainObject(session.memoryModel) || typeof session.countTokens !== 'function'
    || typeof session.answer !== 'function' || typeof session.judge !== 'function') {
    fail('invalid_session');
  }
  const model = session.memoryModel;
  if (!safeInteger(model.contextWindow, 1) || model.countTokens !== session.countTokens
    || !['countTokens', 'extract', 'classify', 'select', 'rank']
      .every((key) => typeof model[key] === 'function')) fail('invalid_session');
  return deepFreeze({
    modelId: session.modelId,
    countTokens: session.countTokens,
    answer: session.answer,
    judge: session.judge,
    memoryModel: {
      contextWindow: model.contextWindow,
      countTokens: model.countTokens,
      extract: model.extract,
      classify: model.classify,
      select: model.select,
      rank: model.rank,
    },
  });
};

const preflightQuestion = (counter, modelId, question) => {
  const evidenceTokens = counter(JSON.stringify([]));
  const request = {
    templateVersion: ANSWER_TEMPLATE_VERSION,
    instruction: ANSWER_INSTRUCTION,
    question: { text: question.text, date: question.date },
    evidence: [],
  };
  const requestTokens = counter(JSON.stringify({
    model: modelId, request, maxOutputTokens: PILOT_LIMITS.outputTokens,
  }));
  if (!safeInteger(evidenceTokens) || !safeInteger(requestTokens)) fail('token_count_unavailable');
  if (evidenceTokens > PILOT_LIMITS.evidenceTokens || requestTokens > PILOT_LIMITS.requestTokens) {
    fail('question_or_framing_too_large');
  }
};

const outputPlan = async (directory, pilot) => {
  const resolved = resolveDirectory(directory, 'unsafe_output');
  await validateDirectory(resolved, 'unsafe_output');
  let entries;
  try { entries = await readdir(resolved); } catch { fail('unsafe_output'); }
  if (entries.length !== 0) fail('output_not_empty');
  await access(resolved, fsConstants.W_OK).catch(() => fail('unsafe_output'));
  const cases = pilot.cases.map((item, index) => {
    const caseDirectory = path.join(resolved, `case-${String(index + 1).padStart(4, '0')}`);
    return {
      questionId: item.question.question_id,
      directory: caseDirectory,
      database: path.join(caseDirectory, 'memory.sqlite'),
      generation: path.join(caseDirectory, 'generation.json'),
      scoring: path.join(caseDirectory, 'scoring.json'),
    };
  });
  return { directory: resolved, aggregate: path.join(resolved, 'aggregate.json'), cases };
};

const createOutputs = async (plan) => {
  await chmod(plan.directory, 0o700);
  for (const item of plan.cases) {
    await mkdir(item.directory, { mode: 0o700 });
    await chmod(item.directory, 0o700);
    const handle = await open(item.database, 'wx', 0o600);
    await handle.close();
    await chmod(item.database, 0o600);
    for (const target of [item.generation, item.scoring]) {
      try { await lstat(target); fail('output_exists'); }
      catch (error) {
        if (error instanceof LivePilotError) throw error;
        if (error?.code !== 'ENOENT') fail('unsafe_output');
      }
    }
  }
  try { await lstat(plan.aggregate); fail('output_exists'); }
  catch (error) {
    if (error instanceof LivePilotError) throw error;
    if (error?.code !== 'ENOENT') fail('unsafe_output');
  }
};

const writePrivateJson = async (filename, value) => {
  try {
    await writeFile(filename, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await chmod(filename, 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') fail('output_exists');
    fail('output_write_failed');
  }
};

const databaseMeasurement = async (database) => {
  const files = [];
  for (const filename of [database, `${database}-wal`, `${database}-shm`]) {
    try {
      const info = await stat(filename);
      if (!info.isFile()) fail('unsafe_output');
      await chmod(filename, 0o600);
      files.push({ name: path.basename(filename), bytes: info.size });
    } catch (error) {
      if (error instanceof LivePilotError) throw error;
      if (error?.code !== 'ENOENT') fail('unsafe_output');
    }
  }
  return { bytes: files.reduce((sum, item) => sum + item.bytes, 0), files };
};

const safeError = (error, fallback) => ({
  code: validString(error?.code) && /^[a-z0-9_-]+$/u.test(error.code) ? error.code : fallback,
});

const notify = async (callback, progress) => {
  if (!callback) return true;
  try { await callback(deepFreeze(progress)); return true; }
  catch { return false; }
};

const coverageTotals = () => ({ availableCases: 0, numerator: 0, denominator: 0 });
const armTotals = (name) => ({
  name,
  attemptedCases: 0,
  notAttemptedCases: 0,
  completedCases: 0,
  failedCases: 0,
  judgeAttemptedCases: 0,
  judgedCases: 0,
  correctCases: 0,
  incorrectCases: 0,
  unknownCases: 0,
  judgeFailedCases: 0,
  coverage: { retrieved: coverageTotals(), packed: coverageTotals() },
  blockingFlags: {},
  latencyMs: { generation: 0, judging: 0 },
});

const addCoverage = (total, value) => {
  if (value === null) return;
  total.availableCases += 1;
  total.numerator += value.numerator;
  total.denominator += value.denominator;
};

const publicCase = (record) => {
  const summary = {
    questionId: record.questionId,
    generationStatus: record.generation.status,
    scoringStatus: record.scoring.status,
    databaseBytes: record.generation.database.bytes,
    latencyMs: {
      generation: record.generation.latencyMs,
      judging: record.scoring.latencyMs,
    },
    blockingFlags: record.generation.run?.blockingFlags ?? [],
    arms: [],
  };
  for (const name of ARM_NAMES) {
    const arm = record.generation.run?.arms.find((candidate) => candidate.name === name);
    const scored = record.scoring.score?.arms.find((candidate) => candidate.name === name);
    const failure = name === 'cairn'
      ? arm?.retrieval?.ingestion?.outcomes.map(projectIngestionFailure).find(Boolean) : null;
    summary.arms.push({
      name,
      generationStatus: arm?.status ?? 'not-attempted',
      ...(failure ? { ingestionFailure: {
        stage: failure.errorStage, reason: failure.error.code,
      } } : {}),
      judgeStatus: scored?.semanticJudge.status ?? 'not-attempted',
      ...(scored?.semanticJudge.reason ? { judgeReason: scored.semanticJudge.reason } : {}),
    });
  }
  return summary;
};

const aggregateResults = ({ pilot, modelId, records, callbackFailures, started }) => {
  const arms = new Map(ARM_NAMES.map((name) => [name, armTotals(name)]));
  const flags = {};
  for (const record of records) {
    for (const arm of record.generation.run?.arms ?? []) {
      const total = arms.get(arm.name);
      total.attemptedCases += 1;
      total[arm.status === 'completed' ? 'completedCases' : 'failedCases'] += 1;
      total.latencyMs.generation += arm.latencyMs;
      for (const flag of arm.blockingFlags) {
        total.blockingFlags[flag.code] = (total.blockingFlags[flag.code] ?? 0) + 1;
        const key = `${arm.name}:${flag.code}`;
        flags[key] = (flags[key] ?? 0) + 1;
      }
    }
    for (const scored of record.scoring.score?.arms ?? []) {
      const total = arms.get(scored.name);
      addCoverage(total.coverage.retrieved, scored.referenceSessionEvidenceCoverage.retrieved);
      addCoverage(total.coverage.packed, scored.referenceSessionEvidenceCoverage.packed);
      if (scored.semanticJudge.status === 'scored') {
        total.judgeAttemptedCases += 1;
        total.judgedCases += 1;
        total[scored.semanticJudge.value ? 'correctCases' : 'incorrectCases'] += 1;
      } else if (scored.semanticJudge.reason !== 'arm_failed') {
        total.judgeAttemptedCases += 1;
        if (scored.semanticJudge.reason === 'judge_unknown') total.unknownCases += 1;
        else total.judgeFailedCases += 1;
      }
      total.latencyMs.judging += scored.semanticJudge.latencyMs ?? 0;
    }
  }
  for (const total of arms.values()) {
    total.notAttemptedCases = pilot.identity.count - total.attemptedCases;
  }
  return deepFreeze({
    schemaVersion: PILOT_SCHEMA_VERSION,
    pilot: structuredClone(pilot.identity),
    modelId,
    generationConcurrency: PILOT_GENERATION_CONCURRENCY,
    plannedCases: pilot.identity.count,
    limits: structuredClone(PILOT_LIMITS),
    cases: records.map(publicCase),
    arms: [...arms.values()],
    blockingFlags: flags,
    failures: {
      generationCases: records.filter((item) => item.generation.status === 'failed').length,
      scoringCases: records.filter((item) => item.scoring.status === 'failed').length,
      progressCallbacks: callbackFailures,
    },
    storage: { databaseBytes: records.reduce((sum, item) => sum + item.generation.database.bytes, 0) },
    latencyMs: {
      generation: records.reduce((sum, item) => sum + item.generation.latencyMs, 0),
      judging: records.reduce((sum, item) => sum + item.scoring.latencyMs, 0),
      total: elapsedMs(started),
    },
    interpretation: 'seven-case-or-smaller-pilot-not-full-dataset-or-official-longmemeval-score',
  });
};

export async function runPilot(options) {
  if (!isPlainObject(options) || !Object.hasOwn(options, 'pilot')
    || !Object.hasOwn(options, 'directory') || !Object.hasOwn(options, 'session')
    || Object.keys(options).some((key) => !['pilot', 'directory', 'session', 'onCase'].includes(key))
    || (Object.hasOwn(options, 'onCase') && typeof options.onCase !== 'function')) {
    fail('invalid_options');
  }
  const pilot = options.pilot;
  const directory = options.directory;
  const onCase = options.onCase;
  const privatePilot = PRIVATE_PILOTS.get(pilot);
  if (!privatePilot || pilot.schemaVersion !== PILOT_SCHEMA_VERSION) fail('invalid_pilot');
  const session = snapshotSession(options.session);
  for (const item of pilot.cases) {
    try { preflightQuestion(session.countTokens, session.modelId, item.question); }
    catch (error) {
      if (error instanceof LivePilotError) throw error;
      fail('token_count_unavailable');
    }
  }
  const plan = await outputPlan(directory, pilot);
  await createOutputs(plan);

  const started = Date.now();
  const records = new Array(pilot.cases.length);
  let callbackFailures = 0;
  const generateCase = async (index) => {
    const item = pilot.cases[index];
    const target = plan.cases[index];
    const caseStarted = Date.now();
    let core;
    let run;
    let error;
    try {
      core = openMemoryCore({ path: target.database, model: session.memoryModel });
      run = await runLongMemEvalComparison({
        history: item.history,
        question: item.question,
        namespace: { ownerId: 'longmemeval-live-pilot', scope: 'project',
          projectId: item.question.question_id },
        core,
        answer: session.answer,
        countTokens: session.countTokens,
        answerModel: session.modelId,
        limits: PILOT_LIMITS,
      });
    } catch (caught) { error = safeError(caught, 'generation_failed'); }
    finally { core?.close(); }
    const database = await databaseMeasurement(target.database);
    const generation = deepFreeze({
      schemaVersion: PILOT_SCHEMA_VERSION,
      questionId: item.question.question_id,
      status: run ? 'completed' : 'failed',
      latencyMs: elapsedMs(caseStarted),
      database,
      ...(run ? { run } : { error }),
    });
    records[index] = { questionId: item.question.question_id, generation, scoring: null };
    await writePrivateJson(target.generation, generation);
    if (!await notify(onCase, {
      stage: 'generation', index, caseCount: pilot.cases.length,
      questionId: item.question.question_id, status: generation.status,
    })) callbackFailures += 1;
  };
  for (let offset = 0; offset < pilot.cases.length;
    offset += PILOT_GENERATION_CONCURRENCY) {
    const batch = await Promise.allSettled(Array.from(
      { length: Math.min(PILOT_GENERATION_CONCURRENCY, pilot.cases.length - offset) },
      (_, relativeIndex) => generateCase(offset + relativeIndex),
    ));
    // A local checkpoint failure must not return while sibling paid work remains
    // active. Drain this batch, then stop before starting any further cases.
    const failed = batch.find(item => item.status === 'rejected');
    if (failed) throw failed.reason;
  }

  // The evaluator remains unreachable until every generation checkpoint is durable.
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const target = plan.cases[index];
    const scoringStarted = Date.now();
    let score;
    let error;
    if (record.generation.run) {
      try {
        score = await scoreLongMemEvalComparison({
          run: record.generation.run,
          evaluator: privatePilot.evaluators.get(record.questionId),
          judge: session.judge,
          judgeModel: session.modelId,
          judgeTimeoutMs: PILOT_LIMITS.answerTimeoutMs,
        });
      } catch (caught) { error = safeError(caught, 'scoring_failed'); }
    } else {
      error = { code: 'generation_failed' };
    }
    record.scoring = deepFreeze({
      schemaVersion: PILOT_SCHEMA_VERSION,
      questionId: record.questionId,
      status: score ? 'completed' : 'failed',
      latencyMs: elapsedMs(scoringStarted),
      ...(score ? { score } : { error }),
    });
    await writePrivateJson(target.scoring, record.scoring);
    if (!await notify(onCase, {
      stage: 'scoring', index, caseCount: records.length, questionId: record.questionId,
      status: record.scoring.status,
    })) callbackFailures += 1;
  }

  const aggregate = aggregateResults({ pilot, modelId: session.modelId,
    records, callbackFailures, started });
  await writePrivateJson(plan.aggregate, aggregate);
  return aggregate;
}
