// Synthetic OFF-by-default public-core execution. No provider/default integration.
import { verifySourcePartition } from './offline.mjs';

const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const identity = (part, partitionIndex) => ({ partitionIndex,
  groupIndex: part.groupIndex, eventId: part.eventId,
  messageIds: part.messages.map(message => message.id) });

/**
 * Revalidate/detach the ENTIRE plan synchronously before the first capture.
 * Observe public results, never re-admit/retry/fallback. Stage entry is not a
 * count of provider callbacks; synthetic tests count actual model ports apart.
 * Only the injected trusted public core and its original counter are supported.
 */
export async function executeSourcePartition({ core, input, plan, countTokens, arm = 'partition' }) {
  if (!['partition', 'unchanged'].includes(arm) || typeof core?.capture !== 'function')
    throw Object.assign(new Error('diagnostic_input_invalid'), { code: 'diagnostic_input_invalid' });
  const verified = verifySourcePartition({ core, input, plan, countTokens });
  const parts = arm === 'partition' ? verified.partitions : verified.originalBatches;
  const outcomes = [];
  let stopped = false;
  for (const [partitionIndex, part] of parts.entries()) {
    const captureInput = { namespace: part.namespace, client: part.client,
      sessionId: part.sessionId, eventId: part.eventId, messages: part.messages };
    let result;
    try { result = await core.capture(captureInput); }
    catch { result = { ok: false, error: { code: 'diagnostic_capture_unavailable', retryable: false } }; }
    const classification = result.ok ? result.value.classification?.status : undefined;
    const attemptedStages = ['capture',
      ...(['applied', 'failed'].includes(classification) ? ['initial-classification'] : [])];
    const status = !result.ok ? 'capture_failed' : classification === 'failed' ? 'classification_failed'
      : result.value.processing ? 'processing' : result.value.duplicate ? 'replayed' : 'completed';
    outcomes.push({ ...identity(part, partitionIndex), status, attemptedStages, result });
    if (!result.ok || classification === 'failed' || result.value.processing) { stopped = true; break; }
  }
  return freeze({ arm, semanticCoverage: 'unassessed', stopped, outcomes,
    untouchedSuffix: parts.slice(outcomes.length).map((part, index) => identity(part, index + outcomes.length)) });
}
