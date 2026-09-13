import { createHash } from 'node:crypto';
import { boundedText, denseArray, fail, identifier, object, revision } from './validation.mjs';

const kinds = ['fact', 'preference', 'decision', 'instruction', 'context'];

/** Copy trusted identity and normalize every message before claiming or calling a model. */
export function captureSnapshot(input, captureQualification) {
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
      object(message, ['id', 'role', 'content']);
      const id = identifier(message.id);
      const role = message.role;
      if (!['user', 'assistant'].includes(role)) fail('invalid_input');
      if (captureQualification && (typeof message.content !== 'string' || !message.content.isWellFormed())) {
        fail('invalid_input');
      }
      return { id, role, content: boundedText(message.content, 4000) };
    });
    if (new Set(messages.map((message) => message.id)).size !== messages.length ||
        messages.reduce((sum, message) => sum + message.content.length, 0) > 20000) {
      fail('invalid_input');
    }
    const payloadDigest = createHash('sha256').update(JSON.stringify([
      captureQualification ? 'cairn.capture.v3' : causal ? 'cairn.capture.v2' : 'cairn.capture.v1',
      [namespace.ownerId, namespace.scope, namespace.projectId],
      client, eventId, sessionId, messages.map(({ id, role, content }) => [id, role, content]),
      ...(causal ? [[causal.streamId, causal.sequence]] : []),
      ...(captureQualification ? [captureQualification] : []),
    ]), 'utf8').digest('hex');
    return { namespace, client, eventId, sessionId, messages, payloadDigest, ...(causal ? { causal } : {}),
      ...(captureQualification ? { captureQualification } : {}) };
  } catch { fail('invalid_input'); }
}

/** Detached v2 evidence window. The complete snapshot and replay digest stay unchanged. */
export function retainedSourceView(snapshot) {
  try {
    const truncatedMessageIndices = [];
    const messages = snapshot.messages.map((message, index) => {
      const content = boundedText(boundedText(message.content, 800, true), 800, true);
      if (content !== message.content) truncatedMessageIndices.push(index);
      return Object.freeze({ ...message, content });
    });
    return Object.freeze({ messages: Object.freeze(messages),
      retainedSourceWindow: Object.freeze({ maxUnitsPerMessage: 800,
        truncatedMessageIndices: Object.freeze(truncatedMessageIndices) }) });
  } catch { fail('invalid_input'); }
}

/** The extractor chooses indices; all receipt identity and text comes from the trusted source view. */
export function extractedItems(output, snapshot, retainedMessages) {
  try {
    const sourceMessages = retainedMessages ?? snapshot.messages;
    object(output, ['items']);
    return denseArray(output.items, 0, 5).map((item) => {
      object(item, ['content', 'kind', 'confidence', 'sourceIndices']);
      if (snapshot.captureQualification && (typeof item.content !== 'string' || !item.content.isWellFormed())) {
        fail('invalid_model_output');
      }
      const content = boundedText(item.content, 600);
      if (!kinds.includes(item.kind) || typeof item.confidence !== 'number' ||
          !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        fail('invalid_model_output');
      }
      const indices = denseArray(item.sourceIndices, 1, 4);
      if (new Set(indices).size !== indices.length || indices.some((index) =>
          !Number.isInteger(index) || index < 0 || index >= sourceMessages.length)) {
        fail('invalid_model_output');
      }
      const receipts = indices.map((index) => {
        const message = sourceMessages[index];
        return { client: snapshot.client, sessionId: snapshot.sessionId,
          eventId: message.id, role: message.role,
          excerpt: retainedMessages === undefined ? boundedText(message.content, 800, true) : message.content };
      });
      return { content, kind: item.kind, confidence: item.confidence, receipts,
        ...(snapshot.causal ? { sourceIndices: [...indices] } : {}) };
    });
  } catch { fail('invalid_model_output'); }
}
