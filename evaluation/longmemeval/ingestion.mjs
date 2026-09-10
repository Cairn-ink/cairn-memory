import { createHash } from 'node:crypto';

import { captureSnapshot } from '../../core/capture-input.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';

export const INGESTION_PLAN_SCHEMA_VERSION = 'cairn-longmemeval-ingestion-plan-v1';
export const INGESTION_CLIENT = 'longmemeval-ingestion-v1';
export const CAPTURE_LIMITS = Object.freeze({
  rawMessageUtf16: 20_000,
  normalizedMessageUtf16: 4_000,
  normalizedBatchUtf16: 20_000,
  messagesPerBatch: 24,
});

const HISTORY_KEYS = ['question_id', 'sessions'];
const SESSION_KEYS = ['session_index', 'session_id', 'date', 'turns'];
const TURN_KEYS = ['turn_id', 'role', 'content'];
const NAMESPACE_KEYS = ['ownerId', 'scope', 'projectId'];
const PLAN_OPTIONS_KEYS = ['history', 'namespace'];
const INGEST_OPTIONS_KEYS = ['history', 'namespace', 'capture'];
const CASE_ID = /^lme-case-[a-f0-9]{64}$/u;
const TURN_ID = /^lme-turn-[a-f0-9]{64}$/u;

const SAFE_CAPTURE_ERROR_CODES = new Set([
  'classification_failed',
  'context_budget_exceeded',
  'event_payload_conflict',
  'extraction_failed',
  'index_revision_conflict',
  'invalid_input',
  'invalid_model_output',
  'model_cancelled',
  'model_not_configured',
  'model_timeout',
  'revision_conflict',
  'stale_admission',
  'storage_busy',
  'storage_error',
  'token_count_unavailable',
]);

export class LongMemEvalIngestionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'LongMemEvalIngestionError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new LongMemEvalIngestionError(code);
};

const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const exactObject = (value, keys, code = 'invalid_history') => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
  return value;
};

const denseArray = (value, minimum, code = 'invalid_history') => {
  if (!Array.isArray(value) || value.length < minimum || Object.keys(value).length !== value.length) fail(code);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail(code);
  }
  return value;
};

const validMetadata = (value) => typeof value === 'string'
  && value.trim().length > 0
  && !value.includes('\0');

const validCoreIdentifier = (value) => typeof value === 'string'
  && value.length > 0
  && value.length <= 200
  && value.trim() === value
  && !/[\x00-\x1f\x7f]/u.test(value);

const validSessionIndex = (value) => Number.isSafeInteger(value) && value >= 0;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const derivedId = (kind, coordinates) => `lme-${kind}-${sha256(JSON.stringify(coordinates))}`;

const normalizeCaptureText = (value) => redactSecrets(value.normalize('NFKC'))
  .replace(/\s+/gu, ' ')
  .trim();

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
};

const validateNamespace = (namespace) => {
  exactObject(namespace, NAMESPACE_KEYS, 'invalid_namespace');
  if (!validCoreIdentifier(namespace.ownerId)) fail('invalid_namespace');
  if (namespace.scope === 'personal' && namespace.projectId === null) {
    return { ownerId: namespace.ownerId, scope: 'personal', projectId: null };
  }
  if (namespace.scope === 'project' && validCoreIdentifier(namespace.projectId)) {
    return { ownerId: namespace.ownerId, scope: 'project', projectId: namespace.projectId };
  }
  fail('invalid_namespace');
};

const validateHistory = (history) => {
  exactObject(history, HISTORY_KEYS);
  if (!CASE_ID.test(history.question_id)) fail('invalid_history');
  const seenTurns = new Set();
  const sessions = denseArray(history.sessions, 1).map((session, sessionIndex) => {
    exactObject(session, SESSION_KEYS);
    if (session.session_index !== sessionIndex
      || !validSessionIndex(session.session_index)
      || !validMetadata(session.session_id)
      || !validMetadata(session.date)) fail('invalid_history');
    const turns = denseArray(session.turns, 1).map((turn) => {
      exactObject(turn, TURN_KEYS);
      if (!TURN_ID.test(turn.turn_id)
        || seenTurns.has(turn.turn_id)
        || !['user', 'assistant'].includes(turn.role)
        || typeof turn.content !== 'string') fail('invalid_history');
      seenTurns.add(turn.turn_id);
      return { turn_id: turn.turn_id, role: turn.role, content: turn.content };
    });
    return {
      session_index: session.session_index,
      session_id: session.session_id,
      date: session.date,
      turns,
    };
  });
  return { question_id: history.question_id, sessions };
};

const pointBoundariesThrough = (value, start, maximumUtf16) => {
  const boundaries = [];
  let offset = start;
  for (const point of value.slice(start)) {
    if (offset + point.length - start > maximumUtf16) break;
    offset += point.length;
    boundaries.push(offset);
  }
  return boundaries;
};

const normalizedCandidate = (content) => {
  const normalized = normalizeCaptureText(content);
  return {
    normalized,
    valid: content.length <= CAPTURE_LIMITS.rawMessageUtf16
      && normalized.length > 0
      && normalized !== '[REDACTED]'
      && !normalized.includes('\0')
      && normalized.length <= CAPTURE_LIMITS.normalizedMessageUtf16,
  };
};

const findChunkEnd = (content, start) => {
  const boundaries = pointBoundariesThrough(content, start, CAPTURE_LIMITS.rawMessageUtf16);
  if (boundaries.length === 0) return null;
  const maximum = boundaries.at(-1);
  const maximumCandidate = normalizedCandidate(content.slice(start, maximum));
  if (maximumCandidate.valid) return { end: maximum, normalized: maximumCandidate.normalized };
  if (maximumCandidate.normalized.length === 0 || maximumCandidate.normalized === '[REDACTED]') return null;

  // With redaction-sensitive turns excluded before splitting, normalized prefix length is
  // effectively monotone for this bound search. Every selected result is still checked by
  // the real core preflight below, so this search never substitutes for captureSnapshot.
  let low = 0;
  let high = boundaries.length - 1;
  let best = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const end = boundaries[middle];
    const candidate = normalizedCandidate(content.slice(start, end));
    if (candidate.normalized.length <= CAPTURE_LIMITS.normalizedMessageUtf16) {
      if (candidate.valid) best = { end, normalized: candidate.normalized };
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
};

const preflight = (input) => {
  try {
    return captureSnapshot(input);
  } catch {
    return null;
  }
};

const chunkTurn = ({ questionId, session, turn, turnIndex, coreSessionId }) => {
  const base = {
    questionId,
    sessionIndex: session.session_index,
    sourceSessionId: session.session_id,
    sourceDate: session.date,
    turnIndex,
    turnId: turn.turn_id,
    role: turn.role,
  };
  const wholeNormalized = normalizeCaptureText(turn.content);
  const singleMessageId = derivedId('message', [
    questionId, session.session_index, session.session_id, turnIndex, turn.turn_id,
    0, 0, turn.content.length,
  ]);
  const singleInput = {
    namespace: { ownerId: 'preflight', scope: 'personal', projectId: null },
    client: INGESTION_CLIENT,
    eventId: 'preflight-event',
    sessionId: coreSessionId,
    messages: [{ id: singleMessageId, role: turn.role, content: turn.content }],
  };
  const singleSnapshot = preflight(singleInput);
  if (singleSnapshot) {
    return { chunks: [{ ...base, chunkIndex: 0, rawStartUtf16: 0,
      rawEndUtf16: turn.content.length, rawContent: turn.content,
      normalizedContent: singleSnapshot.messages[0].content, messageId: singleMessageId }] };
  }

  const nfkc = turn.content.normalize('NFKC');
  if (wholeNormalized.length === 0) {
    return { blocker: { code: 'empty_normalized_turn', ...base, rawContent: turn.content,
      rawUtf16: turn.content.length, normalizedUtf16: 0 } };
  }
  if (wholeNormalized === '[REDACTED]') {
    return { blocker: { code: 'fully_redacted_turn', ...base, rawContent: turn.content,
      rawUtf16: turn.content.length, normalizedUtf16: wholeNormalized.length } };
  }
  if (redactSecrets(nfkc) !== nfkc) {
    return { blocker: { code: 'redaction_sensitive_split', ...base, rawContent: turn.content,
      rawUtf16: turn.content.length, normalizedUtf16: wholeNormalized.length } };
  }
  if (wholeNormalized.includes('\0')) {
    return { blocker: { code: 'invalid_normalized_turn', ...base, rawContent: turn.content,
      rawUtf16: turn.content.length, normalizedUtf16: wholeNormalized.length } };
  }

  const chunks = [];
  let start = 0;
  while (start < turn.content.length) {
    const found = findChunkEnd(turn.content, start);
    if (!found || found.end <= start) {
      return { blocker: { code: 'unpartitionable_turn', ...base, rawContent: turn.content,
        rawUtf16: turn.content.length, normalizedUtf16: wholeNormalized.length } };
    }
    const chunkIndex = chunks.length;
    const rawContent = turn.content.slice(start, found.end);
    const messageId = derivedId('message', [
      questionId, session.session_index, session.session_id, turnIndex, turn.turn_id,
      chunkIndex, start, found.end,
    ]);
    chunks.push({ ...base, chunkIndex, rawStartUtf16: start, rawEndUtf16: found.end,
      rawContent, normalizedContent: found.normalized, messageId });
    start = found.end;
  }
  return { chunks };
};

const batchSession = ({ questionId, namespace, session, coreSessionId, chunks }) => {
  const batches = [];
  let pending = [];
  let normalizedTotal = 0;

  const flush = () => {
    if (pending.length === 0) return;
    const sessionBatchIndex = batches.length;
    const eventId = derivedId('event', [questionId, session.session_index, session.session_id,
      sessionBatchIndex, pending.map((chunk) => chunk.messageId)]);
    const input = {
      namespace: { ...namespace },
      client: INGESTION_CLIENT,
      eventId,
      sessionId: coreSessionId,
      messages: pending.map((chunk) => ({
        id: chunk.messageId,
        role: chunk.role,
        content: chunk.rawContent,
      })),
    };
    const snapshot = preflight(input);
    if (!snapshot) fail('internal_preflight_failed');
    const sourceMap = pending.map((chunk, messageIndex) => ({ messageIndex, ...chunk }));
    batches.push({
      sessionBatchIndex,
      source: { questionId, sessionIndex: session.session_index,
        sourceSessionId: session.session_id, sourceDate: session.date },
      captureInput: input,
      normalizedCapture: {
        messages: snapshot.messages,
        normalizedTotalUtf16: snapshot.messages.reduce((sum, message) => sum + message.content.length, 0),
        payloadDigest: snapshot.payloadDigest,
      },
      sourceMap,
    });
    pending = [];
    normalizedTotal = 0;
  };

  for (const chunk of chunks) {
    if (pending.length === CAPTURE_LIMITS.messagesPerBatch
      || normalizedTotal + chunk.normalizedContent.length > CAPTURE_LIMITS.normalizedBatchUtf16) flush();
    pending.push(chunk);
    normalizedTotal += chunk.normalizedContent.length;
  }
  flush();
  return batches;
};

const buildPlan = (history, namespace) => {
  const sourceTurns = [];
  const blockers = [];
  const batches = [];
  let rawSourceUtf16 = 0;
  let normalizedEngineUtf16 = 0;

  for (const session of history.sessions) {
    const coreSessionId = derivedId('session', [history.question_id, session.session_index, session.session_id]);
    const sessionChunks = [];
    for (let turnIndex = 0; turnIndex < session.turns.length; turnIndex += 1) {
      const turn = session.turns[turnIndex];
      sourceTurns.push({ questionId: history.question_id, sessionIndex: session.session_index,
        sourceSessionId: session.session_id, sourceDate: session.date, turnIndex,
        turnId: turn.turn_id, role: turn.role, rawContent: turn.content });
      rawSourceUtf16 += turn.content.length;
      const result = chunkTurn({ questionId: history.question_id, session, turn, turnIndex, coreSessionId });
      if (result.blocker) blockers.push(result.blocker);
      else {
        sessionChunks.push(...result.chunks);
        normalizedEngineUtf16 += result.chunks.reduce((sum, chunk) => sum + chunk.normalizedContent.length, 0);
      }
    }
    batches.push(...batchSession({ questionId: history.question_id, namespace,
      session, coreSessionId, chunks: sessionChunks }));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    batches[batchIndex].batchIndex = batchIndex;
  }
  return {
    schemaVersion: INGESTION_PLAN_SCHEMA_VERSION,
    questionId: history.question_id,
    namespace,
    executable: blockers.length === 0,
    sourceTurns,
    blockers,
    batches,
    summary: {
      sourceSessionCount: history.sessions.length,
      sourceTurnCount: sourceTurns.length,
      rawSourceUtf16,
      plannedBatchCount: batches.length,
      plannedMessageCount: batches.reduce((sum, batch) => sum + batch.captureInput.messages.length, 0),
      normalizedEngineUtf16,
      blockerCount: blockers.length,
      rawReconstruction: blockers.length === 0 ? 'exact-from-source-map' : 'exact-from-source-turns',
      engineInputNormalization: 'NFKC-redacted-whitespace-folded',
      modelContextFitEstablished: false,
    },
    limits: { ...CAPTURE_LIMITS },
  };
};

export function planLongMemEvalCase(options) {
  exactObject(options, PLAN_OPTIONS_KEYS, 'invalid_options');
  const history = validateHistory(options.history);
  const namespace = validateNamespace(options.namespace);
  return deepFreeze(buildPlan(history, namespace));
}

const exactResponseObject = (value, keys) => {
  if (!isPlainObject(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) return false;
  return Object.keys(value).every((key) => keys.includes(key));
};

const safeError = (error, fallback) => {
  const code = SAFE_CAPTURE_ERROR_CODES.has(error?.code) ? error.code : fallback;
  return { code, retryable: code === error?.code && error?.retryable === true };
};

// Accept both ingestion outcomes and their comparison summaries. Status fixes
// the stage; only finite codes cross either reporting boundary.
export const projectIngestionFailure = (outcome) => {
  if (outcome?.status === 'partial') {
    const error = outcome.result?.classification?.error ?? outcome.error;
    if (!error) return null;
    return { errorStage: 'classification',
      error: safeError(error, 'classification_failed') };
  }
  if (['failed', 'unknown'].includes(outcome?.status)) {
    if (!outcome.error) return null;
    const fallback = ['capture_failed', 'capture_processing', 'malformed_capture_response',
      'capture_threw'].includes(outcome.error?.code) ? outcome.error.code : 'capture_failed';
    return { errorStage: 'capture', error: {
      code: safeError(outcome.error, fallback).code,
      retryable: SAFE_CAPTURE_ERROR_CODES.has(outcome.error?.code)
        && outcome.error.retryable === true,
    } };
  }
  return null;
};

const validMemoryRef = (value) => exactResponseObject(value, ['id', 'revision'])
  && validCoreIdentifier(value.id)
  && Number.isSafeInteger(value.revision)
  && value.revision >= 1;

const validMemoryIds = (value) => Array.isArray(value)
  && Object.keys(value).length === value.length
  && value.every(validCoreIdentifier);

const classifyCaptureResponse = (response) => {
  if (!isPlainObject(response) || typeof response.ok !== 'boolean') return null;
  if (response.ok === false) {
    if (!exactResponseObject(response, ['ok', 'error'])
      || !exactResponseObject(response.error, ['code', 'retryable'])
      || typeof response.error.code !== 'string'
      || typeof response.error.retryable !== 'boolean') return null;
    return { status: 'failed', error: safeError(response.error, 'capture_failed') };
  }
  if (!exactResponseObject(response, ['ok', 'value']) || !isPlainObject(response.value)) return null;
  const value = response.value;
  if (exactResponseObject(value, ['processing']) && value.processing === true) {
    return { status: 'unknown', error: { code: 'capture_processing', retryable: false } };
  }
  if (exactResponseObject(value, ['duplicate', 'memoryIds', 'suppressedCount'])
    && value.duplicate === true
    && validMemoryIds(value.memoryIds)
    && Number.isSafeInteger(value.suppressedCount)
    && value.suppressedCount >= 0) {
    return { status: 'duplicate', result: structuredClone(value) };
  }
  if (!exactResponseObject(value, ['duplicate', 'admission', 'classification'])
    || value.duplicate !== false
    || !exactResponseObject(value.admission, ['memories', 'suppressedCount', 'indexRevision'])
    || !Array.isArray(value.admission.memories)
    || Object.keys(value.admission.memories).length !== value.admission.memories.length
    || !value.admission.memories.every(validMemoryRef)
    || !Number.isSafeInteger(value.admission.suppressedCount)
    || value.admission.suppressedCount < 0
    || !Number.isSafeInteger(value.admission.indexRevision)
    || value.admission.indexRevision < 1
    || !isPlainObject(value.classification)) return null;

  const classification = value.classification;
  const skipped = exactResponseObject(classification, ['status', 'reason'])
    && classification.status === 'skipped'
    && ['empty', 'already_filed'].includes(classification.reason);
  const applied = exactResponseObject(classification, ['status', 'memoryRevisions', 'indexRevision'])
    && classification.status === 'applied'
    && Array.isArray(classification.memoryRevisions)
    && Object.keys(classification.memoryRevisions).length === classification.memoryRevisions.length
    && classification.memoryRevisions.every((item) => exactResponseObject(item, ['memoryId', 'revision'])
      && validCoreIdentifier(item.memoryId)
      && Number.isSafeInteger(item.revision)
      && item.revision >= 1)
    && Number.isSafeInteger(classification.indexRevision)
    && classification.indexRevision >= 1;
  const failed = exactResponseObject(classification, ['status', 'error'])
    && classification.status === 'failed'
    && exactResponseObject(classification.error, ['code', 'retryable'])
    && typeof classification.error.code === 'string'
    && typeof classification.error.retryable === 'boolean';
  if (skipped || applied) return { status: 'completed', result: structuredClone(value) };
  if (failed) return { status: 'partial', result: {
    duplicate: false,
    admission: structuredClone(value.admission),
    classification: { status: 'failed', error: safeError(classification.error, 'classification_failed') },
  } };
  return null;
};

export async function ingestLongMemEvalCase(options) {
  exactObject(options, INGEST_OPTIONS_KEYS, 'invalid_options');
  if (typeof options.capture !== 'function') fail('invalid_options');
  const capture = options.capture;
  // Clone and recursively freeze all source, map and future batch input state before
  // the first await. Mutating the caller's history cannot alter later capture calls.
  const plan = deepFreeze(structuredClone(planLongMemEvalCase({
    history: options.history,
    namespace: options.namespace,
  })));
  const outcomes = plan.batches.map((batch) => ({ batchIndex: batch.batchIndex,
    eventId: batch.captureInput.eventId, status: 'not_run' }));
  if (!plan.executable) return deepFreeze({ plan, outcomes });

  for (let index = 0; index < plan.batches.length; index += 1) {
    const batch = plan.batches[index];
    let classified;
    try {
      const response = await capture(structuredClone(batch.captureInput));
      classified = classifyCaptureResponse(response) ?? {
        status: 'unknown', error: { code: 'malformed_capture_response', retryable: false },
      };
    } catch {
      classified = { status: 'unknown', error: { code: 'capture_threw', retryable: false } };
    }
    outcomes[index] = { batchIndex: batch.batchIndex, eventId: batch.captureInput.eventId, ...classified };
    if (!['completed', 'duplicate'].includes(classified.status)) break;
  }
  return deepFreeze({ plan, outcomes });
}
