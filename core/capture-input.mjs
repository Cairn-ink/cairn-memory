import { quantitySchema, validQuantity } from './quantity-ledger.mjs';
import { createHash } from 'node:crypto';
import { boundedText, denseArray, fail, identifier, object, receiptEventTime, revision } from './validation.mjs';

// Count only supplied user material; multiple source windows share one message.
export function extractionLimit(messages = []) {
  const supplied = Array.isArray(messages) ? messages : [];
  return Math.max(5, Math.min(20, new Set(supplied.filter(message => message?.role === 'user')
    .map((message, index) => Number.isInteger(message.messageIndex) ? `w${message.messageIndex}` : `m${index}`)).size));
}

export const extractionOutputTokens = (messages) => Math.ceil(1024 * extractionLimit(messages) / 5);

const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];

/** Copy trusted identity and normalize every message before claiming or calling a model. */
export function captureSnapshot(input, captureQualification, captureSourcePolicy, retainTimes = true, now) {
  try {
    const namespace = { ownerId: input.namespace.ownerId, scope: input.namespace.scope,
      projectId: input.namespace.projectId };
    const client = identifier(input.client);
    const eventId = identifier(input.eventId);
    const sessionId = identifier(input.sessionId);
    let causal;
    if (input.causal !== undefined) {
      object(input.causal, ['streamId', 'sequence']);
      causal = { streamId: identifier(input.causal.streamId), sequence: revision(input.causal.sequence) };
    }
    const messages = denseArray(input.messages, 1, 24).map((message) => {
      object(message, ['id', 'role', 'content', 'occurredAt']);
      const id = identifier(message.id);
      const role = message.role;
      if (!['user', 'assistant'].includes(role)) fail('invalid_input');
      if ((captureQualification || captureSourcePolicy === 'indexed-evidence-v1') &&
          (typeof message.content !== 'string' || !message.content.isWellFormed())) {
        fail('invalid_input');
      }
      // Null and absence both mean no asserted receipt time.
      const occurredAt = receiptEventTime(message.occurredAt, now);
      return { id, role, content: boundedText(message.content, 4000),
        ...(retainTimes && occurredAt !== null ? { occurredAt } : {}) };
    });
    if (new Set(messages.map((message) => message.id)).size !== messages.length ||
        messages.reduce((sum, message) => sum + message.content.length, 0) > 20000) {
      fail('invalid_input');
    }
    // Receipt times are attributes: retain main's identity on every layout.
    const payloadDigest = createHash('sha256').update(JSON.stringify([
      captureSourcePolicy === 'indexed-evidence-v1' ? 'cairn.capture.indexed-evidence.v1' :
        captureSourcePolicy ? 'cairn.capture.indexed-windows.v1' :
        captureQualification ? 'cairn.capture.v3' : causal ? 'cairn.capture.v2' : 'cairn.capture.v1',
      [namespace.ownerId, namespace.scope, namespace.projectId],
      client, eventId, sessionId, messages.map(({ id, role, content }) => [id, role, content]),
      ...(causal ? [[causal.streamId, causal.sequence]] : []),
      ...(captureQualification ? [captureQualification] : []),
      ...(captureSourcePolicy ? [captureSourcePolicy, 'nonoverlap-800-v1'] : []),
    ]), 'utf8').digest('hex');
    return { namespace, client, eventId, sessionId, messages, payloadDigest, ...(causal ? { causal } : {}),
      ...(captureQualification ? { captureQualification } : {}),
      ...(captureSourcePolicy ? { captureSourcePolicy } : {}) };
  } catch { fail('invalid_input'); }
}

/** Detached v2 evidence window. The complete snapshot and replay digest stay unchanged. */
export function retainedSourceView(snapshot) {
  try {
    const truncatedMessageIndices = [];
    const messages = snapshot.messages.map((message, index) => {
      const content = boundedText(boundedText(message.content, 800, true), 800, true);
      if (content !== message.content) truncatedMessageIndices.push(index);
      const { occurredAt, ...source } = message;
      return Object.freeze({ ...source, content });
    });
    return Object.freeze({ messages: Object.freeze(messages),
      retainedSourceWindow: Object.freeze({ maxUnitsPerMessage: 800,
        truncatedMessageIndices: Object.freeze(truncatedMessageIndices) }) });
  } catch { fail('invalid_input'); }
}

/** The extractor chooses indices; all receipt identity and text comes from the trusted source view. */
export function extractedItems(output, snapshot, retainedMessages, onInvalid = () => {}, sourceReceipts, limit = extractionLimit(retainedMessages ?? snapshot.messages)) {
  let reason = 'invalid_extraction_output_shape';
  try {
    const sourceMessages = retainedMessages ?? snapshot.messages;
    object(output, snapshot.ledger ? ['items', 'quantities'] : ['items']);
    const items = denseArray(output.items, 0, limit);
    const quantities = new Map();
    if (snapshot.ledger) for (const quantity of extractionQuantities(output.quantities, items.length, onInvalid)) {
      const entries = quantities.get(quantity.item);
      if (entries) entries.push(quantity);
      else quantities.set(quantity.item, [quantity]);
    }
    return items.map((item, index) => {
      reason = 'invalid_extraction_item_shape';
      object(item, ['content', 'kind', 'confidence', 'sourceIndices', ...(snapshot.sessionEpisodes ? ['procedural'] : [])]);
      if (Object.hasOwn(item, 'procedural') && (item.procedural !== true || !['preference','instruction'].includes(item.kind))) fail('invalid_model_output');
      reason = 'invalid_extraction_text';
      if ((snapshot.captureQualification || snapshot.captureSourcePolicy === 'indexed-evidence-v1') &&
          (typeof item.content !== 'string' || !item.content.isWellFormed())) {
        fail('invalid_model_output');
      }
      const content = boundedText(item.content, 600);
      reason = 'invalid_extraction_value';
      if (!kinds.includes(item.kind) || typeof item.confidence !== 'number' ||
          !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        fail('invalid_model_output');
      }
      reason = 'invalid_extraction_source_shape';
      const indices = denseArray(item.sourceIndices, 1, 4);
      reason = 'invalid_extraction_source_duplicate';
      if (new Set(indices).size !== indices.length) fail('invalid_model_output');
      reason = 'invalid_extraction_source_range';
      if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= sourceMessages.length)) {
        fail('invalid_model_output');
      }
      const receipts = indices.map((index) => {
        const message = sourceMessages[index];
        return { client: sourceReceipts?.[index]?.client ?? snapshot.client,
          sessionId: sourceReceipts?.[index]?.sessionId ?? snapshot.sessionId,
          eventId: message.id, role: message.role,
          excerpt: retainedMessages === undefined ? boundedText(message.content, 800, true) : message.content };
      });
      return { content, kind: item.kind, confidence: item.confidence, receipts,
        ...(quantities.has(index) ? { quantities: quantities.get(index) } : {}),
        ...(snapshot.sessionEpisodes && item.procedural === true ? { proceduralProposal: true } : {}),
        ...(snapshot.causal ? { sourceIndices: [...indices] } : {}) };
    });
  } catch {
    try { onInvalid(reason); } catch { /* Diagnostics never change validation. */ }
    fail('invalid_model_output');
  }
}


export const quantityInstructions = `Besides items, return quantities: a separate list written after the items. It never changes which items you write; most items have no quantity, and an empty list is normal. Add one entry for each amount the user reports about themselves in an item's content:
  item: the 0-based index of that item in items;
  kind: "record" for something that happened (a purchase or payment, steps walked, hours slept, a weight measured) or "goal" for a target or limit the user sets for themselves;
  measure: what is measured, lowercase English (spend, steps, sleep_hours, weight, distance, ...);
  value: the number exactly as stated, without currency symbols or thousands separators;
  unit: an ISO currency code for money (USD, TWD, EUR, ...), otherwise the unit as stated (steps, hours, kg, km);
  group: the broad class, one of food, transport, housing, shopping, bills, health, fitness, entertainment, work, other;
  category: the specific item in lowercase English, one or two words (coffee, lunch, groceries, taxi, daily_steps); "" if none;
  period: for a goal, the period it applies to (day, week, month, year); for a record, "none";
  comparator: for a goal, "at_most" or "at_least"; for a record, "none".
  An item that states several amounts gets one entry per amount. Project budgets, prices quoted by others, and amounts from the assistant are not quantities.`;

export function quantityInput(value, itemCount) {
  const fields = quantitySchema.items.required;
  object(value, fields);
  if (!fields.every(key => Object.hasOwn(value, key)) || !validQuantity(value, itemCount)) fail('invalid_input');
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}

export function extractionQuantities(value, itemCount, onInvalid) {
  if (value === undefined) return [];
  const drop = () => { try { onInvalid('invalid_extraction_quantity'); } catch { /* Observation is optional. */ } };
  if (!Array.isArray(value)) {
    drop();
    return [];
  }
  const valid = [];
  for (const entry of value) {
    try { valid.push(quantityInput(entry, itemCount)); }
    catch { drop(); }
  }
  return valid;
}
