import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

export const MAX_INPUT_BYTES = 512 * 1024 * 1024;
export const CORE_MESSAGE_LIMIT_UTF16_CHARACTERS = 4_000;
export const SCHEMA_VERSION = 'cairn-longmemeval-preparation-v1';

const QUESTION_TYPES = new Set([
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'temporal-reasoning',
  'knowledge-update',
  'multi-session',
]);

const OPTION_KEYS = new Set([
  'inputPath',
  'expectedSha256',
  'datasetRevision',
  'datasetVariant',
  'questionIds',
  'outputDirectory',
]);

const REQUIRED_INSTANCE_FIELDS = [
  'question_id',
  'question_type',
  'question',
  'answer',
  'question_date',
  'haystack_session_ids',
  'haystack_dates',
  'haystack_sessions',
  'answer_session_ids',
];

export class PreparationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PreparationError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new PreparationError(code);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const nonemptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const utf8Bytes = (value) => Buffer.byteLength(value, 'utf8');

const validateReferenceAnswer = (answer) => {
  const scalar = (value) => typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value));
  if (scalar(answer)) return;
  if (Array.isArray(answer) && answer.length > 0 && answer.every(scalar)) return;
  fail('invalid_dataset');
};

const validateOptions = (options) => {
  if (!isPlainObject(options)) fail('invalid_options');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) fail('invalid_options');
  }
  const {
    inputPath,
    expectedSha256,
    datasetRevision,
    datasetVariant,
    questionIds,
    outputDirectory,
  } = options;
  if (!nonemptyString(inputPath) || inputPath.includes('\0')) fail('invalid_options');
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256 ?? '')) fail('invalid_options');
  if (!nonemptyString(datasetRevision)) fail('invalid_options');
  if (datasetVariant !== 's-cleaned') fail('invalid_options');
  if (!nonemptyString(outputDirectory) || outputDirectory.includes('\0')) fail('invalid_options');
  if (!Array.isArray(questionIds) || questionIds.length === 0) fail('invalid_selection');
  if (!questionIds.every(nonemptyString)) fail('invalid_selection');
  if (new Set(questionIds).size !== questionIds.length) fail('invalid_selection');
  return {
    inputPath: path.resolve(inputPath),
    expectedSha256: expectedSha256.toLowerCase(),
    datasetRevision,
    datasetVariant,
    questionIds,
    outputDirectory: path.resolve(outputDirectory),
    rawOutputDirectory: outputDirectory,
  };
};

const pathPartsFromRoot = (target) => {
  const root = path.parse(target).root;
  const relative = path.relative(root, target);
  return { root, parts: relative === '' ? [] : relative.split(path.sep) };
};

const assertNoSymlinkAncestors = async (directory) => {
  const { root, parts } = pathPartsFromRoot(directory);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let entry;
    try {
      entry = await lstat(current);
    } catch {
      fail('unsafe_output');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) fail('unsafe_output');
  }
  let resolved;
  try {
    resolved = await realpath(directory);
  } catch {
    fail('unsafe_output');
  }
  if (resolved !== directory) fail('unsafe_output');
};

const validateOutputTarget = async (outputDirectory, rawOutputDirectory) => {
  if (outputDirectory === path.parse(outputDirectory).root) fail('unsafe_output');
  const rawParts = rawOutputDirectory.split(/[\\/]+/u);
  if (rawParts.includes('..')) fail('unsafe_output');
  const parent = path.dirname(outputDirectory);
  await assertNoSymlinkAncestors(parent);
  try {
    await lstat(outputDirectory);
    fail('output_exists');
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    if (error?.code !== 'ENOENT') fail('unsafe_output');
  }
  return parent;
};

const validateDataset = (data) => {
  if (!Array.isArray(data) || data.length === 0) fail('invalid_dataset');
  const questionIds = new Set();
  const opaqueIds = new Set();
  const stats = {
    source_instance_count: data.length,
    source_session_count: 0,
    source_turn_count: 0,
    source_history_content_utf16_characters: 0,
    source_history_content_utf8_bytes: 0,
    source_question_utf16_characters: 0,
    source_question_utf8_bytes: 0,
    source_max_turn_utf16_characters: 0,
    source_max_turn_utf8_bytes: 0,
    source_raw_turns_over_core_message_limit_count: 0,
    source_duplicate_session_id_occurrence_count: 0,
  };

  for (const instance of data) {
    if (!isPlainObject(instance)) fail('invalid_dataset');
    if (!REQUIRED_INSTANCE_FIELDS.every((field) => hasOwn(instance, field))) fail('invalid_dataset');
    if (!nonemptyString(instance.question_id) || questionIds.has(instance.question_id)) fail('invalid_dataset');
    questionIds.add(instance.question_id);
    const opaqueId = opaqueQuestionId(instance.question_id);
    if (opaqueIds.has(opaqueId)) fail('invalid_dataset');
    opaqueIds.add(opaqueId);
    if (!QUESTION_TYPES.has(instance.question_type)) fail('invalid_dataset');
    if (!nonemptyString(instance.question) || !nonemptyString(instance.question_date)) fail('invalid_dataset');
    validateReferenceAnswer(instance.answer);
    if (!Array.isArray(instance.haystack_session_ids)
      || !Array.isArray(instance.haystack_dates)
      || !Array.isArray(instance.haystack_sessions)
      || instance.haystack_session_ids.length === 0
      || instance.haystack_session_ids.length !== instance.haystack_dates.length
      || instance.haystack_session_ids.length !== instance.haystack_sessions.length) {
      fail('invalid_dataset');
    }
    if (!instance.haystack_session_ids.every(nonemptyString)
      || !instance.haystack_dates.every(nonemptyString)) {
      fail('invalid_dataset');
    }
    if (!Array.isArray(instance.answer_session_ids)
      || !instance.answer_session_ids.every(nonemptyString)
      || new Set(instance.answer_session_ids).size !== instance.answer_session_ids.length) {
      fail('invalid_dataset');
    }
    const sessionIds = new Set(instance.haystack_session_ids);
    if (!instance.answer_session_ids.every((id) => sessionIds.has(id))) fail('invalid_dataset');

    const firstSessionById = new Map();
    for (let sessionIndex = 0; sessionIndex < instance.haystack_sessions.length; sessionIndex += 1) {
      const sessionId = instance.haystack_session_ids[sessionIndex];
      const session = instance.haystack_sessions[sessionIndex];
      if (firstSessionById.has(sessionId)) {
        stats.source_duplicate_session_id_occurrence_count += 1;
        if (!isDeepStrictEqual(firstSessionById.get(sessionId), session)) fail('invalid_dataset');
        if (instance.answer_session_ids.includes(sessionId)) fail('ambiguous_evidence_session');
      } else {
        firstSessionById.set(sessionId, session);
      }
    }

    stats.source_session_count += instance.haystack_sessions.length;
    stats.source_question_utf16_characters += instance.question.length;
    stats.source_question_utf8_bytes += utf8Bytes(instance.question);
    for (const session of instance.haystack_sessions) {
      if (!Array.isArray(session) || session.length === 0) fail('invalid_dataset');
      stats.source_turn_count += session.length;
      for (const turn of session) {
        if (!isPlainObject(turn)
          || (turn.role !== 'user' && turn.role !== 'assistant')
          || typeof turn.content !== 'string'
          || (hasOwn(turn, 'has_answer') && typeof turn.has_answer !== 'boolean')) {
          fail('invalid_dataset');
        }
        const contentUtf16 = turn.content.length;
        const contentUtf8 = utf8Bytes(turn.content);
        stats.source_history_content_utf16_characters += contentUtf16;
        stats.source_history_content_utf8_bytes += contentUtf8;
        stats.source_max_turn_utf16_characters = Math.max(stats.source_max_turn_utf16_characters, contentUtf16);
        stats.source_max_turn_utf8_bytes = Math.max(stats.source_max_turn_utf8_bytes, contentUtf8);
        if (contentUtf16 > CORE_MESSAGE_LIMIT_UTF16_CHARACTERS) {
          stats.source_raw_turns_over_core_message_limit_count += 1;
        }
      }
    }
  }
  return { questionIds, stats };
};

export const opaqueQuestionId = (sourceQuestionId) => `lme-case-${sha256(sourceQuestionId)}`;

export const stableTurnId = (sourceQuestionId, sessionIndex, sourceSessionId, turnIndex) => {
  const coordinates = JSON.stringify([sourceQuestionId, sessionIndex, sourceSessionId, turnIndex]);
  return `lme-turn-${sha256(coordinates)}`;
};

const projectSelected = (data, selectedIds) => {
  const selected = data.filter((instance) => selectedIds.has(instance.question_id));
  const histories = [];
  const questions = [];
  const evaluators = [];
  const blockers = [];
  const stats = {
    selected_question_count: selected.length,
    selected_session_count: 0,
    selected_turn_count: 0,
    selected_history_content_utf16_characters: 0,
    selected_history_content_utf8_bytes: 0,
    selected_question_utf16_characters: 0,
    selected_question_utf8_bytes: 0,
    selected_max_turn_utf16_characters: 0,
    selected_max_turn_utf8_bytes: 0,
    selected_duplicate_session_id_occurrence_count: 0,
  };

  for (const instance of selected) {
    const questionId = opaqueQuestionId(instance.question_id);
    const sessions = [];
    const turnLabels = [];
    const selectedSessionIds = new Set();
    for (let sessionIndex = 0; sessionIndex < instance.haystack_sessions.length; sessionIndex += 1) {
      const sourceSessionId = instance.haystack_session_ids[sessionIndex];
      if (selectedSessionIds.has(sourceSessionId)) {
        stats.selected_duplicate_session_id_occurrence_count += 1;
      }
      selectedSessionIds.add(sourceSessionId);
      const turns = instance.haystack_sessions[sessionIndex].map((turn, turnIndex) => {
        const turnId = stableTurnId(instance.question_id, sessionIndex, sourceSessionId, turnIndex);
        const contentUtf16 = turn.content.length;
        const contentUtf8 = utf8Bytes(turn.content);
        stats.selected_turn_count += 1;
        stats.selected_history_content_utf16_characters += contentUtf16;
        stats.selected_history_content_utf8_bytes += contentUtf8;
        stats.selected_max_turn_utf16_characters = Math.max(stats.selected_max_turn_utf16_characters, contentUtf16);
        stats.selected_max_turn_utf8_bytes = Math.max(stats.selected_max_turn_utf8_bytes, contentUtf8);
        if (contentUtf16 > CORE_MESSAGE_LIMIT_UTF16_CHARACTERS) {
          blockers.push({
            source_question_id: instance.question_id,
            question_id: questionId,
            session_index: sessionIndex,
            session_id: sourceSessionId,
            turn_id: turnId,
            utf16_character_count: contentUtf16,
            utf8_byte_count: contentUtf8,
          });
        }
        if (hasOwn(turn, 'has_answer')) {
          turnLabels.push({ turn_id: turnId, has_answer: turn.has_answer });
        }
        return { turn_id: turnId, role: turn.role, content: turn.content };
      });
      sessions.push({
        session_index: sessionIndex,
        session_id: sourceSessionId,
        date: instance.haystack_dates[sessionIndex],
        turns,
      });
    }
    stats.selected_session_count += sessions.length;
    stats.selected_question_utf16_characters += instance.question.length;
    stats.selected_question_utf8_bytes += utf8Bytes(instance.question);
    histories.push({ question_id: questionId, sessions });
    questions.push({ question_id: questionId, text: instance.question, date: instance.question_date });
    evaluators.push({
      question_id: questionId,
      source_question_id: instance.question_id,
      question_type: instance.question_type,
      reference_answer: instance.answer,
      answer_session_ids: [...instance.answer_session_ids],
      turn_labels: turnLabels,
    });
  }
  return { selected, histories, questions, evaluators, blockers, stats };
};

const jsonLines = (records) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
const artifactMetadata = (filename, content) => ({
  filename,
  sha256: sha256(content),
  byte_count: utf8Bytes(content),
  record_count: content.split('\n').length - 1,
});

const writePrivateFile = async (filename, content) => {
  await writeFile(filename, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await chmod(filename, 0o600);
};

export async function prepareLongMemEval(options) {
  const validated = validateOptions(options);
  // Reject directories and special files before open(), since opening a FIFO for reading can block.
  const pathInfo = await stat(validated.inputPath).catch(() => fail('invalid_input_file'));
  if (!pathInfo.isFile()) fail('invalid_input_file');
  if (pathInfo.size <= 0 || pathInfo.size > MAX_INPUT_BYTES) fail('input_size_out_of_bounds');
  const inputHandle = await open(validated.inputPath, 'r').catch(() => fail('invalid_input_file'));
  let inputInfo;
  let input;
  try {
    inputInfo = await inputHandle.stat();
    if (!inputInfo.isFile()) fail('invalid_input_file');
    if (inputInfo.size <= 0 || inputInfo.size > MAX_INPUT_BYTES) fail('input_size_out_of_bounds');
    if (inputInfo.dev !== pathInfo.dev || inputInfo.ino !== pathInfo.ino) fail('input_changed_during_read');
    input = await inputHandle.readFile();
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    fail('invalid_input_file');
  } finally {
    await inputHandle.close().catch(() => {});
  }
  if (input.length !== inputInfo.size) fail('input_changed_during_read');
  const inputDigest = sha256(input);
  if (inputDigest !== validated.expectedSha256) fail('digest_mismatch');

  let data;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(input);
    data = JSON.parse(decoded);
  } catch {
    fail('malformed_json');
  }
  const { questionIds: availableIds, stats: sourceStats } = validateDataset(data);
  if (!validated.questionIds.every((id) => availableIds.has(id))) fail('invalid_selection');
  const outputParent = await validateOutputTarget(validated.outputDirectory, validated.rawOutputDirectory);
  await access(outputParent, fsConstants.W_OK).catch(() => fail('unsafe_output'));

  const projected = projectSelected(data, new Set(validated.questionIds));
  const history = jsonLines(projected.histories);
  const questions = jsonLines(projected.questions);
  const evaluator = jsonLines(projected.evaluators);
  const artifacts = {
    history: artifactMetadata('history.jsonl', history),
    questions: artifactMetadata('questions.jsonl', questions),
    evaluator: artifactMetadata('evaluator.jsonl', evaluator),
  };
  const manifest = {
    schema_version: SCHEMA_VERSION,
    preparation_kind: 'pilot',
    dataset: {
      declared_variant: validated.datasetVariant,
      declared_revision: validated.datasetRevision,
      input_sha256: inputDigest,
      input_byte_count: input.length,
      identity_scope: 'declared-provenance-not-upstream-authenticity-proof',
      oracle_warning: 'shape-and-hash-do-not-certify-oracle-source',
    },
    selection: {
      kind: 'pilot',
      source_question_ids: projected.selected.map((instance) => instance.question_id),
      question_ids: projected.histories.map((record) => record.question_id),
      count: projected.selected.length,
    },
    artifacts,
    sizes: { ...sourceStats, ...projected.stats },
    compatibility: {
      core_message_limit_utf16_characters: CORE_MESSAGE_LIMIT_UTF16_CHARACTERS,
      raw_source_measurement_only: true,
      selected_raw_turns_over_core_message_limit_count: projected.blockers.length,
      selected_raw_turns_over_core_message_limit: projected.blockers,
      absence_of_raw_size_blockers_does_not_prove_capture_or_context_compatibility: true,
      measurements_are_not_token_or_cost_estimates: true,
    },
    boundaries: {
      model_facing_files: ['history.jsonl', 'questions.jsonl'],
      private_evaluator_file: 'evaluator.jsonl',
      private_manifest_file: 'manifest.json',
      filesystem_split_is_not_an_os_sandbox: true,
    },
  };
  const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestDigest = sha256(manifestContent);

  // All input, selection, target and artifact construction checks finish before this first write.
  await validateOutputTarget(validated.outputDirectory, validated.rawOutputDirectory);
  await mkdir(validated.outputDirectory, { mode: 0o700 });
  await chmod(validated.outputDirectory, 0o700);
  await writePrivateFile(path.join(validated.outputDirectory, 'history.jsonl'), history);
  await writePrivateFile(path.join(validated.outputDirectory, 'questions.jsonl'), questions);
  await writePrivateFile(path.join(validated.outputDirectory, 'evaluator.jsonl'), evaluator);
  await writePrivateFile(path.join(validated.outputDirectory, 'manifest.json'), manifestContent);

  return {
    manifest,
    summary: {
      source_instance_count: sourceStats.source_instance_count,
      selected_question_count: projected.stats.selected_question_count,
      selected_session_count: projected.stats.selected_session_count,
      selected_turn_count: projected.stats.selected_turn_count,
      selected_raw_turns_over_core_message_limit_count: projected.blockers.length,
      input_byte_count: input.length,
      input_sha256: inputDigest,
      history_sha256: artifacts.history.sha256,
      questions_sha256: artifacts.questions.sha256,
      evaluator_sha256: artifacts.evaluator.sha256,
      manifest_sha256: manifestDigest,
    },
  };
}
