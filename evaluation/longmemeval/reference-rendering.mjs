import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual, TextDecoder } from 'node:util';

import { opaqueQuestionId, SCHEMA_VERSION as PREPARATION_SCHEMA_VERSION } from './prepare.mjs';
import { deepFreeze, isPlainObject } from './validation.mjs';

export const REFERENCE_RENDERING_SCHEMA_VERSION = 'cairn-longmemeval-reference-rendering-v1';
export const REFERENCE_RENDERER = 'python3-json-load-str-v1';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_SIDECAR_BYTES = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAPABILITIES = new WeakMap();

export class ReferenceRenderingError extends Error {
  constructor(code) { super(code); this.name = 'ReferenceRenderingError'; this.code = code; }
}
const fail = (code) => { throw new ReferenceRenderingError(code); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys, code) => {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) fail(code);
};
const dense = (value) => Array.isArray(value) && Object.keys(value).length === value.length;
const parse = (bytes, code) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(code); }
};

async function readRegular(filename, maxBytes, code) {
  let before;
  try { before = await lstat(filename); } catch { fail(code); }
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > maxBytes) fail(code);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try { handle = await open(filename, flags); } catch { fail(code); }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) fail(code);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) fail(code);
    return bytes;
  } catch (error) {
    if (error instanceof ReferenceRenderingError) throw error;
    fail(code);
  } finally { await handle.close().catch(() => {}); }
}

const validReference = (value) => {
  const scalar = (item) => typeof item === 'string' || typeof item === 'number' && Number.isFinite(item);
  return scalar(value) || dense(value) && value.length > 0 && value.every(scalar);
};

// These tokens are issued only after the pinned sidecar and prepared bytes have been checked.
// Their rendered text is never exposed as an enumerable or serializable property.
export const resolveReferenceRendering = (capability, evaluator) => {
  const saved = capability !== null && typeof capability === 'object' ? CAPABILITIES.get(capability) : undefined;
  if (!saved || !isDeepStrictEqual(saved.evaluator, evaluator)) fail('rendering_mismatch');
  return saved.referenceText;
};

export async function loadReferenceRenderings({ preparedDirectory, sidecarPath, expectedSidecarSha256 }) {
  if (typeof preparedDirectory !== 'string' || !preparedDirectory.trim()
    || typeof sidecarPath !== 'string' || !sidecarPath.trim()
    || typeof expectedSidecarSha256 !== 'string' || !SHA256.test(expectedSidecarSha256)) fail('invalid_options');
  const directory = path.resolve(preparedDirectory);
  let directoryInfo;
  try { directoryInfo = await lstat(directory); } catch { fail('invalid_prepared_directory'); }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) fail('invalid_prepared_directory');
  const entries = (await readdir(directory)).sort();
  if (!isDeepStrictEqual(entries, ['evaluator.jsonl', 'history.jsonl', 'manifest.json', 'questions.jsonl'])) {
    fail('invalid_prepared_directory');
  }
  const manifestBytes = await readRegular(path.join(directory, 'manifest.json'), MAX_MANIFEST_BYTES, 'invalid_manifest');
  const evaluatorBytes = await readRegular(path.join(directory, 'evaluator.jsonl'), MAX_ARTIFACT_BYTES,
    'invalid_evaluator');
  const sidecarBytes = await readRegular(path.resolve(sidecarPath), MAX_SIDECAR_BYTES, 'invalid_sidecar');
  if (sha256(sidecarBytes) !== expectedSidecarSha256) fail('sidecar_digest_mismatch');
  const manifest = parse(manifestBytes, 'invalid_manifest');
  const sidecar = parse(sidecarBytes, 'invalid_sidecar');
  if (!isPlainObject(manifest) || manifest.schema_version !== PREPARATION_SCHEMA_VERSION
    || !isPlainObject(manifest.dataset) || !SHA256.test(manifest.dataset.input_sha256 ?? '')
    || !isPlainObject(manifest.selection) || !dense(manifest.selection.question_ids)
    || !dense(manifest.selection.source_question_ids)
    || !Number.isSafeInteger(manifest.selection.count) || manifest.selection.count < 1
    || manifest.selection.count !== manifest.selection.question_ids.length
    || manifest.selection.count !== manifest.selection.source_question_ids.length
    || !isPlainObject(manifest.artifacts) || !isPlainObject(manifest.artifacts.evaluator)) fail('invalid_manifest');
  const metadata = manifest.artifacts.evaluator;
  if (metadata.filename !== 'evaluator.jsonl' || metadata.sha256 !== sha256(evaluatorBytes)
    || metadata.byte_count !== evaluatorBytes.length || metadata.record_count !== manifest.selection.count) {
    fail('evaluator_digest_mismatch');
  }
  const ids = manifest.selection.question_ids;
  const sourceIds = manifest.selection.source_question_ids;
  if (new Set(ids).size !== ids.length || new Set(sourceIds).size !== sourceIds.length
    || ids.some((id, index) => typeof id !== 'string' || typeof sourceIds[index] !== 'string'
      || opaqueQuestionId(sourceIds[index]) !== id)) fail('invalid_manifest');
  if (!evaluatorBytes.toString('utf8').endsWith('\n') || evaluatorBytes.includes(13)) fail('invalid_evaluator');
  const lines = evaluatorBytes.toString('utf8').slice(0, -1).split('\n');
  if (lines.length !== ids.length || lines.some((line) => !line)) fail('invalid_evaluator');
  const evaluators = lines.map((line) => parse(Buffer.from(line), 'invalid_evaluator'));
  exact(sidecar, ['schema_version', 'renderer', 'python_version', 'source_sha256', 'manifest_sha256',
    'evaluator_sha256', 'cases'], 'invalid_sidecar');
  if (sidecar.schema_version !== REFERENCE_RENDERING_SCHEMA_VERSION || sidecar.renderer !== REFERENCE_RENDERER
    || typeof sidecar.python_version !== 'string' || !/^3\.\d+\.\d+$/u.test(sidecar.python_version)
    || sidecar.source_sha256 !== manifest.dataset.input_sha256
    || sidecar.manifest_sha256 !== sha256(manifestBytes)
    || sidecar.evaluator_sha256 !== metadata.sha256
    || !dense(sidecar.cases) || sidecar.cases.length !== ids.length) fail('sidecar_mismatch');
  const result = new Map();
  for (let index = 0; index < ids.length; index += 1) {
    const evaluator = evaluators[index];
    const item = sidecar.cases[index];
    exact(evaluator, ['question_id', 'source_question_id', 'question_type', 'reference_answer',
      'answer_session_ids', 'turn_labels'], 'invalid_evaluator');
    exact(item, ['question_id', 'source_question_id', 'reference_text'], 'invalid_sidecar');
    if (evaluator.question_id !== ids[index] || evaluator.source_question_id !== sourceIds[index]
      || !validReference(evaluator.reference_answer)) fail('evaluator_mismatch');
    if (item.question_id !== ids[index] || item.source_question_id !== sourceIds[index]
      || typeof item.reference_text !== 'string') fail('sidecar_mismatch');
    const token = Object.freeze(Object.create(null));
    CAPABILITIES.set(token, { evaluator: deepFreeze(structuredClone(evaluator)),
      referenceText: item.reference_text });
    result.set(ids[index], token);
  }
  return result;
}
