import { captureSnapshot } from './capture-input.mjs';
import { extractionRequest } from './capture.mjs';
import { countTokens } from './model-budget.mjs';
import { requestFits } from './model-packing.mjs';
import { denseArray, MemoryStoreError, object } from './validation.mjs';

/** Pure internal planner; the public core owns runtime readiness and envelopes. */
export function planCaptureMessageBatches(input, { model, captureQualification,
  captureSourcePolicy, episode = false }) {
  object(input, ['messages']);
  const messages = denseArray(input.messages, 1, 240).map((message) => {
    object(message, ['id', 'role', 'content', ...(episode ? ['occurredAt'] : [])]);
    return { id: message.id, role: message.role, content: message.content };
  });
  // Only message text enters an extraction request; identity is a placeholder.
  const snapshot = (batch) => captureSnapshot({ namespace: { ownerId: 'plan', scope: 'personal', projectId: null },
    client: 'plan', eventId: 'plan', sessionId: 'plan', messages: batch },
  episode ? 'source-bound-v2' : captureQualification, episode ? undefined : captureSourcePolicy);
  for (const message of messages) snapshot([message]);
  if (new Set(messages.map((message) => message.id)).size !== messages.length) throw new MemoryStoreError('invalid_input');
  countTokens(model, '');
  const fitsRequest = requestFits(model, 'extract');
  const fits = (indices) => {
    let request;
    try {
      request = extractionRequest(snapshot(indices.map((index) => messages[index])),
        { captureQualification, captureSourcePolicy, episode });
    } catch (error) {
      if (error instanceof MemoryStoreError && ['invalid_input', 'invalid_text'].includes(error.code)) return false;
      throw error;
    }
    return fitsRequest(request.system, request.input);
  };
  const batches = [];
  const oversizedMessageIndices = [];
  let batch = [];
  for (const index of messages.keys()) {
    if (batch.length && fits([...batch, index])) { batch.push(index); continue; }
    if (batch.length) batches.push(batch);
    batch = [];
    if (fits([index])) batch = [index]; else oversizedMessageIndices.push(index);
  }
  if (batch.length) batches.push(batch);
  return { batches, oversizedMessageIndices };
}
