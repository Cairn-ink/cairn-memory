// Capture boundaries read accessor-backed fields once through a snapshot. The engine may reread them.
// Proxies, functions and symbol values are refused with the entry's invalid code. Some engine entries accept stable Proxies.
import { boundedText } from '../privacy/text.mjs';
import { MODEL_OUTPUT_TOKENS } from './request-size.mjs';
import { detach, fail, identifier, isWellFormedText, revision,
  validateDenseArray, validateObject, validateReceiptEventTime } from './validate.mjs';

/** @import { MemoryKind, Receipt, Role } from '../ports/common.d.ts' */
/** @import { ClockAndHash } from '../ports/model.d.ts' */

/** Count only supplied user material. Multiple source windows share one message.
 * @param {unknown} [messages]
 */
export function extractionLimit(messages = []) {
  const detached = detach(messages, 'invalid_input');
  try { return countExtractionLimit(detached); }
  catch { fail('invalid_input'); }
}

/** @internal Count detached messages. @param {unknown} messages */
export function countExtractionLimit(messages) {
  const supplied = Array.isArray(messages) ? messages : [];
  return Math.max(5, Math.min(20, new Set(supplied.filter(message => message?.role === 'user')
    .map((message, index) => Number.isInteger(message.messageIndex) ? `w${message.messageIndex}` : `m${index}`)).size));
}

/** @param {unknown} [messages] */
export const extractionOutputTokens = messages => Math.ceil(MODEL_OUTPUT_TOKENS * extractionLimit(messages) / 5);

/** @type {readonly MemoryKind[]} */
const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];
const MAX_EXCERPT_UNITS = 800;

/** Copy trusted identity and normalize every message before claiming or calling a model.
 * @param {{namespace: {ownerId: string, scope: string, projectId: string}, client: unknown,
 *   eventId: unknown, sessionId: unknown, messages: unknown, causal?: unknown}} input
 * @param {string | null | undefined} captureQualification
 * @param {string | null | undefined} captureSourcePolicy
 * @param {boolean} retainTimes
 * @param {string | undefined} now
 * @param {ClockAndHash['sha256Hex']} sha256Hex
 */
export async function captureSnapshot(input, captureQualification, captureSourcePolicy, retainTimes = true, now, sha256Hex) {
  try {
    const [snapshot, qualification, sourcePolicy, keepTimes, clock] = detach(
      /** @type {const} */ ([input, captureQualification, captureSourcePolicy, retainTimes, now]), 'invalid_input');
    const namespace = { ownerId: snapshot.namespace.ownerId, scope: snapshot.namespace.scope,
      projectId: snapshot.namespace.projectId };
    const client = identifier(snapshot.client);
    const eventId = identifier(snapshot.eventId);
    const sessionId = identifier(snapshot.sessionId);
    let causal;
    if (snapshot.causal !== undefined) {
      const { streamId, sequence } = validateObject(snapshot.causal, ['streamId', 'sequence']);
      causal = { streamId: identifier(streamId), sequence: revision(sequence) };
    }
    const messages = validateDenseArray(snapshot.messages, 1, 24).map(raw => {
      const message = validateObject(raw, ['id', 'role', 'content', 'occurredAt']);
      const id = identifier(message.id);
      const role = message.role;
      if (role !== 'user' && role !== 'assistant') fail('invalid_input');
      if ((qualification || sourcePolicy === 'indexed-evidence-v1') && !isWellFormedText(message.content)) {
        fail('invalid_input');
      }
      const occurredAt = validateReceiptEventTime(message.occurredAt, clock);
      return { id, role, content: boundedText(message.content, 4000),
        ...(keepTimes && occurredAt !== null ? { occurredAt } : {}) };
    });
    if (new Set(messages.map(message => message.id)).size !== messages.length ||
        messages.reduce((sum, message) => sum + message.content.length, 0) > 20000) {
      fail('invalid_input');
    }
    // Receipt times are attributes and stay outside the replay digest.
    const payload = JSON.stringify([
      sourcePolicy === 'indexed-evidence-v1' ? 'cairn.capture.indexed-evidence.v1' :
        sourcePolicy ? 'cairn.capture.indexed-windows.v1' :
        qualification ? 'cairn.capture.v3' : causal ? 'cairn.capture.v2' : 'cairn.capture.v1',
      [namespace.ownerId, namespace.scope, namespace.projectId],
      client, eventId, sessionId, messages.map(({ id, role, content }) => [id, role, content]),
      ...(causal ? [[causal.streamId, causal.sequence]] : []),
      ...(qualification ? [qualification] : []),
      ...(sourcePolicy ? [sourcePolicy, 'nonoverlap-800-v1'] : []),
    ]);
    const payloadDigest = await sha256Hex(payload);
    return { namespace, client, eventId, sessionId, messages, payloadDigest, ...(causal ? { causal } : {}),
      ...(qualification ? { captureQualification: qualification } : {}),
      ...(sourcePolicy ? { captureSourcePolicy: sourcePolicy } : {}) };
  } catch { fail('invalid_input'); }
}

/** Detach the v2 evidence window and preserve the complete snapshot and replay digest.
 * @template {{content: string, occurredAt?: string}} Message
 * @param {{messages: readonly Message[]}} snapshot
 */
export function retainedSourceView(snapshot) {
  try {
    const sourceSnapshot = detach(snapshot, 'invalid_input');
    /** @type {number[]} */
    const truncatedMessageIndices = [];
    const messages = sourceSnapshot.messages.map((message, index) => {
      const prefix = boundedText(message.content, MAX_EXCERPT_UNITS, true);
      const content = boundedText(prefix, MAX_EXCERPT_UNITS, true);
      if (content !== message.content) truncatedMessageIndices.push(index);
      const { occurredAt, ...source } = message;
      return Object.freeze({ ...source, content });
    });
    return Object.freeze({ messages: Object.freeze(messages),
      retainedSourceWindow: Object.freeze({ maxUnitsPerMessage: MAX_EXCERPT_UNITS,
        truncatedMessageIndices: Object.freeze(truncatedMessageIndices) }) });
  } catch { fail('invalid_input'); }
}

/** The extractor chooses indices. Receipt identity and text come from the trusted source view.
 * @template {{id: string, role: Role, content: string}} Message
 * @param {unknown} output
 * @param {{messages: readonly Message[], client: string, sessionId: string, causal?: unknown,
 *   captureQualification?: string, captureSourcePolicy?: string, sessionEpisodes?: boolean}} snapshot
 * @param {readonly Message[]} [retainedMessages]
 * @param {(reason: string) => void} [onInvalid]
 * @param {ReadonlyArray<Partial<Pick<Receipt, 'client' | 'sessionId'>> | null>} [sourceReceipts]
 * @param {number} [limit]
 */
export function extractedItems(output, snapshot, retainedMessages, onInvalid, sourceReceipts, limit) {
  const [detached, sourceSnapshot, messages, receipts, maximum] = detachExtraction(
    /** @type {const} */ ([output, snapshot, retainedMessages, sourceReceipts, limit]), onInvalid);
  return extractDetachedItems(detached, sourceSnapshot, messages, onInvalid, receipts, maximum);
}

/** @internal @template T @param {T} data @param {(reason: string) => void} [onInvalid] @returns {T} */
export function detachExtraction(data, onInvalid) {
  try { return structuredClone(data); }
  catch { rejectExtraction('invalid_extraction_output_shape', onInvalid); }
}

/** @internal @param {string} reason @param {(reason: string) => void} [onInvalid] @returns {never} */
export function rejectExtraction(reason, onInvalid) {
  try { onInvalid?.(reason); } catch { /* Diagnostics are isolated from validation. */ }
  fail('invalid_model_output');
}

/** @internal Validate extraction against already detached source data.
 * @template {{id: string, role: Role, content: string}} Message
 * @param {unknown} output
 * @param {{messages: readonly Message[], client: string, sessionId: string, causal?: unknown,
 *   captureQualification?: string, captureSourcePolicy?: string, sessionEpisodes?: boolean}} snapshot
 * @param {readonly Message[] | undefined} retainedMessages
 * @param {(reason: string) => void} [onInvalid]
 * @param {ReadonlyArray<Partial<Pick<Receipt, 'client' | 'sessionId'>> | null>} [sourceReceipts]
 * @param {number} [limit]
 */
export function extractDetachedItems(output, snapshot, retainedMessages, onInvalid, sourceReceipts, limit) {
  let reason = 'invalid_extraction_output_shape';
  try {
    const sourceMessages = retainedMessages ?? snapshot.messages;
    const maximum = limit === undefined ? countExtractionLimit(sourceMessages) : limit;
    const { items } = validateObject(output, ['items']);
    return validateDenseArray(items, 0, maximum).map(raw => {
      reason = 'invalid_extraction_item_shape';
      const item = validateObject(raw, ['content', 'kind', 'confidence', 'sourceIndices', ...(snapshot.sessionEpisodes ? ['procedural'] : [])]);
      if (Object.hasOwn(item, 'procedural') && (item.procedural !== true ||
          (item.kind !== 'preference' && item.kind !== 'instruction'))) fail('invalid_model_output');
      reason = 'invalid_extraction_text';
      if ((snapshot.captureQualification || snapshot.captureSourcePolicy === 'indexed-evidence-v1') && !isWellFormedText(item.content)) {
        fail('invalid_model_output');
      }
      const content = boundedText(item.content, 600);
      reason = 'invalid_extraction_value';
      const kind = kinds.find(kind => kind === item.kind);
      const confidence = item.confidence;
      if (kind === undefined || typeof confidence !== 'number' ||
          !Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail('invalid_model_output');
      reason = 'invalid_extraction_source_shape';
      const suppliedIndices = validateDenseArray(item.sourceIndices, 1, 4);
      reason = 'invalid_extraction_source_duplicate';
      if (new Set(suppliedIndices).size !== suppliedIndices.length) fail('invalid_model_output');
      reason = 'invalid_extraction_source_range';
      if (suppliedIndices.some(index => typeof index !== 'number' || !Number.isInteger(index) || index < 0 ||
          index >= sourceMessages.length)) {
        fail('invalid_model_output');
      }
      const indices = /** @type {number[]} */ (suppliedIndices);
      const receipts = indices.map(index => {
        const message = sourceMessages[index];
        return { client: sourceReceipts?.[index]?.client ?? snapshot.client,
          sessionId: sourceReceipts?.[index]?.sessionId ?? snapshot.sessionId,
          eventId: message.id, role: message.role,
          excerpt: retainedMessages === undefined ? boundedText(message.content, MAX_EXCERPT_UNITS, true) : message.content };
      });
      return { content, kind, confidence, receipts,
        ...(snapshot.sessionEpisodes && item.procedural === true ? { proceduralProposal: true } : {}),
        ...(snapshot.causal ? { sourceIndices: [...indices] } : {}) };
    });
  } catch {
    rejectExtraction(reason, onInvalid);
  }
}
